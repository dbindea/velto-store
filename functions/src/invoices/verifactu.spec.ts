import { afterEach, describe, expect, it } from 'vitest';
import {
  buildQrUrl,
  buildRegistroAlta,
  qrBaseUrl,
  sistemaInformatico,
  verifactuEnabled,
  IMPUESTO_IVA,
  TIPO_HUELLA_SHA256
} from './verifactu';

/**
 * ⚠️ **Los nombres de ENTRADA son los nuestros; los de SALIDA, los del esquema
 * oficial.** No es incoherencia: la entrada es la API interna y la salida se
 * serializa tal cual al XML que va a la AEAT, así que ahí manda
 * `SuministroInformacion.xsd` y no nuestro gusto.
 */
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
    expect(buildRegistroAlta(base).Encadenamiento).toEqual({ PrimerRegistro: 'S' });
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
    expect(r.Encadenamiento).toEqual({
      RegistroAnterior: {
        IDEmisorFactura: 'B88866900',
        NumSerieFactura: '2026/0006',
        FechaExpedicionFactura: '07-09-2026',
        Huella: 'B'.repeat(64)
      }
    });
  });

  /**
   * Los nombres de campo salen tal cual al XML, así que un error de grafía aquí
   * es un registro que la AEAT rechaza. Contrastados contra
   * `SuministroInformacion.xsd`, `RegistroFacturacionAltaType`.
   */
  it('usa los nombres del esquema oficial', () => {
    const r = buildRegistroAlta(base);
    expect(Object.keys(r)).toEqual([
      'IDVersion',
      'IDFactura',
      'NombreRazonEmisor',
      'TipoFactura',
      'DescripcionOperacion',
      'Desglose',
      'CuotaTotal',
      'ImporteTotal',
      'Encadenamiento',
      'SistemaInformatico',
      'FechaHoraHusoGenRegistro',
      'TipoHuella',
      'Huella',
      'Destinatarios'
    ]);
    expect(Object.keys(r.IDFactura)).toEqual([
      'IDEmisorFactura',
      'NumSerieFactura',
      'FechaExpedicionFactura'
    ]);
    expect(Object.keys(r.SistemaInformatico)).toEqual([
      'NombreRazon',
      'NIF',
      'NombreSistemaInformatico',
      'IdSistemaInformatico',
      'Version',
      'NumeroInstalacion',
      'TipoUsoPosibleSoloVerifactu',
      'TipoUsoPosibleMultiOT',
      'IndicadorMultiplesOT'
    ]);
  });

  it('los importes van con dos decimales exactos, como en la huella', () => {
    const r = buildRegistroAlta({ ...base, cuotaTotal: 42.5, importeTotal: 242.5 });
    expect(r.CuotaTotal).toBe('42.50');
    expect(r.ImporteTotal).toBe('242.50');
    expect(r.Desglose.DetalleDesglose[0].BaseImponibleOimporteNoSujeto).toBe('200.00');
  });

  it('el tipo impositivo se declara como porcentaje, no como fracción', () => {
    // `0.21` es la fracción con la que trabaja la aplicación; la AEAT quiere 21.
    expect(buildRegistroAlta(base).Desglose.DetalleDesglose[0].TipoImpositivo).toBe('21.00');
  });

  it('una operación general es sujeta y no exenta, y declara el impuesto', () => {
    const d = buildRegistroAlta(base).Desglose.DetalleDesglose[0];
    expect(d.Impuesto).toBe(IMPUESTO_IVA);
    expect(d.ClaveRegimen).toBe('01');
    expect(d.CalificacionOperacion).toBe('S1');
    expect(d.OperacionExenta).toBeUndefined();
  });

  /**
   * ⚠️ Una exenta **no es un 0 %**: va fuera del desglose por tipo y con su
   * clave de exención, que es lo que dice por qué no hay cuota. `E5` es el
   * artículo 25 —entregas intracomunitarias—, contrastado contra el diseño de
   * registro de la AEAT.
   */
  it('una entrega intracomunitaria exenta lleva E5 y no lleva cuota', () => {
    const r = buildRegistroAlta({
      ...base,
      lines: [{ taxRegime: 'exempt_eu' }],
      desglose: [],
      exemptTotal: 12000,
      cuotaTotal: 0,
      importeTotal: 12000
    });
    const exenta = r.Desglose.DetalleDesglose.find((d) => d.OperacionExenta);
    expect(exenta?.OperacionExenta).toBe('E5');
    expect(exenta?.CuotaRepercutida).toBeUndefined();
    expect(exenta?.BaseImponibleOimporteNoSujeto).toBe('12000.00');
    // `CalificacionOperacion` y `OperacionExenta` son alternativas en el
    // esquema: rellenar las dos es un registro inválido.
    expect(exenta?.CalificacionOperacion).toBeUndefined();
  });

  it('una exportación se declara con la clave de régimen 02 y E2 (art. 21)', () => {
    const r = buildRegistroAlta({
      ...base,
      lines: [{ taxRegime: 'exempt_export' }],
      desglose: [],
      exemptTotal: 8000,
      cuotaTotal: 0,
      importeTotal: 8000
    });
    const exenta = r.Desglose.DetalleDesglose.find((d) => d.OperacionExenta);
    expect(exenta?.ClaveRegimen).toBe('02');
    expect(exenta?.OperacionExenta).toBe('E2');
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
    const isp = r.Desglose.DetalleDesglose.find((d) => d.CalificacionOperacion === 'S2');
    expect(isp).toBeTruthy();
    expect(isp?.OperacionExenta).toBeUndefined();
  });

  it('REBU se declara con su clave de régimen propia (03, bienes usados)', () => {
    const r = buildRegistroAlta({
      ...base,
      lines: [{ taxRegime: 'rebu', vatRate: 0.21 }],
      desglose: [{ vatRate: 0.21, base: 1239.67, vat: 260.33 }]
    });
    expect(r.Desglose.DetalleDesglose[0].ClaveRegimen).toBe('03');
  });

  it('la huella se declara como SHA-256', () => {
    expect(buildRegistroAlta(base).TipoHuella).toBe(TIPO_HUELLA_SHA256);
  });

  it('la descripción se recorta a 500 caracteres', () => {
    const r = buildRegistroAlta({ ...base, descripcionOperacion: 'x'.repeat(900) });
    expect(r.DescripcionOperacion).toHaveLength(500);
  });

  /**
   * ⚠️ Solo cuando difiere, que es cuando la norma la pide — y es el caso normal
   * aquí: se factura en agosto un alquiler de junio. Puesta siempre, el registro
   * repetiría la fecha de expedición y diría que el servicio se prestó ese día.
   */
  it('la fecha de operación solo se declara si difiere de la expedición', () => {
    expect(buildRegistroAlta({ ...base, fechaOperacion: '08-09-2026' }).FechaOperacion).toBeUndefined();
    expect(buildRegistroAlta({ ...base, fechaOperacion: '01-08-2026' }).FechaOperacion).toBe(
      '01-08-2026'
    );
  });

  it('el destinatario va con los nombres del esquema', () => {
    const r = buildRegistroAlta(base);
    expect(r.Destinatarios).toEqual({
      IDDestinatario: [{ NombreRazon: 'Cliente Pruebas', NIF: '12345678Z' }]
    });
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
    expect(r.FacturasRectificadas?.IDFacturaRectificada[0].NumSerieFactura).toBe('2026/0003');
    expect(r.TipoRectificativa).toBe('I');
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
    expect(r.ImporteRectificacion).toEqual({
      BaseRectificada: '500.00',
      CuotaRectificada: '105.00'
    });
  });

  it('por diferencias NO las declaran', () => {
    const r = buildRegistroAlta({
      ...rectificativa,
      tipoRectificativa: 'I',
      importeRectificacion: { baseRectificada: 500, cuotaRectificada: 105 }
    });
    expect(r.ImporteRectificacion).toBeUndefined();
  });
});

/**
 * El QR de cotejo, contrastado contra
 * `DetalleEspecificacTecnCodigoQRfactura.pdf` (AEAT).
 */
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
   * ⚠️ **La especificación lo advierte expresamente**, con un ejemplo de URL
   * incorrecta: sin codificar, un `&` o una `/` dentro del número parten la URL
   * y el QR lleva a una página que no existe. Nadie lo nota hasta que un cliente
   * lo escanea.
   */
  it('codifica los caracteres del número de factura', () => {
    const barra = buildQrUrl({
      nif: 'B88866900',
      numSerieFactura: '2026/0007',
      fechaExpedicion: '08-09-2026',
      importeTotal: '242.00'
    });
    expect(barra).toContain('numserie=2026%2F0007');

    // El ejemplo literal de la AEAT: `12345678&G33` → `12345678%26G33`.
    const ampersand = buildQrUrl({
      nif: '89890001K',
      numSerieFactura: '12345678&G33',
      fechaExpedicion: '01-01-2024',
      importeTotal: '241.40'
    });
    expect(ampersand).toContain('numserie=12345678%26G33');
  });

  it('las dos URL son las oficiales, y el entorno decide cuál', () => {
    process.env['VELTO_VERIFACTU_ENV'] = 'test';
    expect(qrBaseUrl()).toBe('https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR');
    process.env['VELTO_VERIFACTU_ENV'] = 'live';
    expect(qrBaseUrl()).toBe(
      'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR'
    );
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
