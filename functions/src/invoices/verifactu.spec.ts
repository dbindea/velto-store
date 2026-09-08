import { afterEach, describe, expect, it } from 'vitest';
import {
  buildQrUrl,
  buildRegistroAlta,
  qrBaseUrl,
  sistemaInformatico,
  verifactuEnabled,
  TIPO_HUELLA_SHA256
} from './verifactu';

const base = {
  emisorNif: 'B88866900',
  emisorNombre: 'VELTO MOBILITY, S.L.',
  fullNumber: '2026/0007',
  fechaExpedicion: '08-09-2026',
  tipoFactura: 'F1' as const,
  descripcionOperacion: 'Alquiler de vehículo sin conductor',
  destinatario: { nombreRazon: 'Cliente Pruebas', nif: '12345678Z' },
  lines: [{ taxRegime: 'standard', vatRate: 0.21 }],
  desglose: [{ vatRate: 0.21, base: 200, vat: 42 }],
  cuotaTotal: 42,
  importeTotal: 242,
  sistema: sistemaInformatico('B88866900', 'VELTO MOBILITY, S.L.'),
  fechaHoraHusoGenRegistro: '2026-09-08T19:20:30+02:00',
  huella: 'A'.repeat(64)
};

describe('el registro de alta', () => {
  it('la primera factura declara PrimerRegistro', () => {
    const r = buildRegistroAlta(base);
    expect(r.encadenamiento).toEqual({ primerRegistro: 'S' });
  });

  /**
   * ⚠️ El encadenamiento necesita los CUATRO datos del anterior, no solo su
   * huella. La factura guardaba únicamente `previousHash`, y el número y la
   * fecha habría que buscarlos después sobre una colección que no se puede
   * editar.
   */
  it('las siguientes llevan número, fecha y huella del registro anterior', () => {
    const r = buildRegistroAlta({
      ...base,
      anterior: {
        numSerieFactura: '2026/0006',
        fechaExpedicionFactura: '07-09-2026',
        huella: 'B'.repeat(64)
      }
    });
    expect(r.encadenamiento).toEqual({
      registroAnterior: {
        idEmisorFactura: 'B88866900',
        numSerieFactura: '2026/0006',
        fechaExpedicionFactura: '07-09-2026',
        huella: 'B'.repeat(64)
      }
    });
  });

  it('los importes van con dos decimales exactos, como en la huella', () => {
    const r = buildRegistroAlta({ ...base, cuotaTotal: 42.5, importeTotal: 242.5 });
    expect(r.cuotaTotal).toBe('42.50');
    expect(r.importeTotal).toBe('242.50');
    expect(r.desglose[0].baseImponibleOimporteNoSujeto).toBe('200.00');
  });

  it('el tipo impositivo se declara como porcentaje, no como fracción', () => {
    // `0.21` es la fracción con la que trabaja la aplicación; la AEAT quiere 21.
    expect(buildRegistroAlta(base).desglose[0].tipoImpositivo).toBe('21.00');
  });

  it('una operación general es sujeta y no exenta', () => {
    const r = buildRegistroAlta(base);
    expect(r.desglose[0].claveRegimen).toBe('01');
    expect(r.desglose[0].calificacionOperacion).toBe('S1');
    expect(r.desglose[0].operacionExenta).toBeUndefined();
  });

  /**
   * ⚠️ Una exenta **no es un 0 %**: va fuera del desglose por tipo y con su
   * clave de exención, que es lo que dice por qué no hay cuota. Declararla como
   * sujeta al 0 % sería declarar mal el impuesto, no un fallo de formato.
   */
  it('una entrega intracomunitaria exenta lleva su clave y no lleva cuota', () => {
    const r = buildRegistroAlta({
      ...base,
      lines: [{ taxRegime: 'exempt_eu' }],
      desglose: [],
      exemptTotal: 12000,
      cuotaTotal: 0,
      importeTotal: 12000
    });
    const exenta = r.desglose.find((d) => d.operacionExenta);
    expect(exenta?.operacionExenta).toBe('E5');
    expect(exenta?.cuotaRepercutida).toBeUndefined();
    expect(exenta?.baseImponibleOimporteNoSujeto).toBe('12000.00');
  });

  it('la inversión del sujeto pasivo se declara S2, no como exenta', () => {
    const r = buildRegistroAlta({
      ...base,
      lines: [{ taxRegime: 'reverse_charge' }],
      desglose: [],
      exemptTotal: 5000,
      cuotaTotal: 0,
      importeTotal: 5000
    });
    const isp = r.desglose.find((d) => d.calificacionOperacion === 'S2');
    expect(isp).toBeTruthy();
  });

  it('REBU se declara con su clave de régimen propia', () => {
    const r = buildRegistroAlta({
      ...base,
      lines: [{ taxRegime: 'rebu', vatRate: 0.21 }],
      desglose: [{ vatRate: 0.21, base: 1239.67, vat: 260.33 }]
    });
    expect(r.desglose[0].claveRegimen).toBe('03');
  });

  it('la huella se declara como SHA-256', () => {
    expect(buildRegistroAlta(base).tipoHuella).toBe(TIPO_HUELLA_SHA256);
  });

  it('la descripción se recorta a 500 caracteres', () => {
    const r = buildRegistroAlta({ ...base, descripcionOperacion: 'x'.repeat(900) });
    expect(r.descripcionOperacion).toHaveLength(500);
  });
});

describe('las rectificativas', () => {
  const rectificativa = {
    ...base,
    fullNumber: 'R2026/0001',
    tipoFactura: 'R1' as const,
    rectificada: { numSerieFactura: '2026/0003', fechaExpedicionFactura: '05-09-2026' }
  };

  it('identifican la factura que rectifican', () => {
    const r = buildRegistroAlta({ ...rectificativa, tipoRectificativa: 'I' });
    expect(r.facturasRectificadas?.[0].numSerieFactura).toBe('2026/0003');
    expect(r.tipoRectificativa).toBe('I');
  });

  /**
   * ⚠️ En `S` hay que informar de la base y la cuota rectificadas; en `I`, no.
   * No es formato: son campos distintos del registro, y ya está escrito así en
   * `docs/facturacion.md`.
   */
  it('por sustitución declaran base y cuota rectificadas', () => {
    const r = buildRegistroAlta({
      ...rectificativa,
      tipoRectificativa: 'S',
      importeRectificacion: { baseRectificada: 500, cuotaRectificada: 105 }
    });
    expect(r.importeRectificacion).toEqual({
      baseRectificada: '500.00',
      cuotaRectificada: '105.00'
    });
  });

  it('por diferencias NO las declaran', () => {
    const r = buildRegistroAlta({
      ...rectificativa,
      tipoRectificativa: 'I',
      importeRectificacion: { baseRectificada: 500, cuotaRectificada: 105 }
    });
    expect(r.importeRectificacion).toBeUndefined();
  });
});

describe('el QR de cotejo', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('lleva los cuatro parámetros que pide la AEAT', () => {
    const url = new URL(
      buildQrUrl({
        nif: 'B88866900',
        numSerieFactura: '2026/0007',
        fechaExpedicion: '08-09-2026',
        importeTotal: '242.00'
      })
    );
    expect(url.searchParams.get('nif')).toBe('B88866900');
    expect(url.searchParams.get('numserie')).toBe('2026/0007');
    expect(url.searchParams.get('fecha')).toBe('08-09-2026');
    expect(url.searchParams.get('importe')).toBe('242.00');
  });

  /**
   * ⚠️ El número de factura lleva una barra —`2026/0007`— y sin escapar
   * rompería la ruta de la URL: el QR llevaría a una página que no existe y
   * nadie lo notaría hasta que un cliente lo escaneara.
   */
  it('escapa la barra del número de factura', () => {
    const url = buildQrUrl({
      nif: 'B88866900',
      numSerieFactura: '2026/0007',
      fechaExpedicion: '08-09-2026',
      importeTotal: '242.00'
    });
    expect(url).toContain('numserie=2026%2F0007');
  });

  it('apunta al validador de pruebas salvo que el entorno diga lo contrario', () => {
    process.env['VELTO_VERIFACTU_ENV'] = 'test';
    expect(qrBaseUrl()).toContain('prewww2.aeat.es');
    process.env['VELTO_VERIFACTU_ENV'] = 'live';
    expect(qrBaseUrl()).toContain('agenciatributaria.gob.es');
  });

  /**
   * ⚠️ La leyenda y el hecho se deciden juntos. Sin envío, la factura calla:
   * mandar al cliente a cotejar una factura que la AEAT no tiene es el mismo
   * error que el contrato que anunciaba una firma digital inexistente.
   */
  it('el QR está apagado mientras no se remita el registro', () => {
    delete process.env['VELTO_VERIFACTU_ENABLED'];
    expect(verifactuEnabled()).toBe(false);
    process.env['VELTO_VERIFACTU_ENABLED'] = 'false';
    expect(verifactuEnabled()).toBe(false);
    process.env['VELTO_VERIFACTU_ENABLED'] = 'true';
    expect(verifactuEnabled()).toBe(true);
  });
});
