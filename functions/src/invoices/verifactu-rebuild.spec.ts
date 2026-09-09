import { describe, expect, it } from 'vitest';
import { registroParaEnvio, RegistroInconsistenteError, type FacturaGuardada } from './verifactu-rebuild';
import { buildRegistroAlta, sistemaInformatico } from './verifactu';
import { computeRegistroAltaHash, formatFechaExpedicion, formatFechaHoraHuso } from './hash';
import { calculateInvoiceTotals } from './invoice-core';

const EMISOR = { nif: 'B88866900', nombre: 'VELTO MOBILITY, S.L.' };

/**
 * Una factura como la deja `issueInvoice`: los campos del documento y el
 * registro que se selló al emitirla.
 */
function facturaEmitida(overrides: Partial<FacturaGuardada> = {}): FacturaGuardada {
  const issueDate = new Date('2026-09-09T12:00:00+02:00');
  const lines = [
    { description: 'Alquiler 5 días', quantity: 5, unitPrice: 30, vatRate: 0.21, taxRegime: 'standard' as const }
  ];
  const totals = calculateInvoiceTotals(lines);
  const fullNumber = '2026/0001';
  const huella = computeRegistroAltaHash({
    idEmisorFactura: EMISOR.nif,
    numSerieFactura: fullNumber,
    fechaExpedicion: issueDate,
    tipoFactura: 'F1',
    cuotaTotal: totals.vat,
    importeTotal: totals.total,
    huellaAnterior: '',
    fechaHoraGenRegistro: issueDate
  });
  const verifactu = buildRegistroAlta({
    emisorNif: EMISOR.nif,
    emisorNombre: EMISOR.nombre,
    fullNumber,
    fechaExpedicion: formatFechaExpedicion(issueDate),
    tipoFactura: 'F1',
    descripcionOperacion: 'Alquiler 5 días',
    destinatario: { nombreRazon: 'Cliente', nif: '12345678Z' },
    lines,
    desglose: totals.byVatRate,
    cuotaTotal: totals.vat,
    importeTotal: totals.total,
    sistema: sistemaInformatico(EMISOR.nif, EMISOR.nombre),
    fechaHoraHusoGenRegistro: formatFechaHoraHuso(issueDate),
    huella
  });
  return {
    fullNumber,
    issueDate,
    tipoFacturaAeat: 'F1',
    recipient: { name: 'Cliente', taxId: '12345678Z' },
    lines,
    totals,
    verifactu,
    ...overrides
  };
}

describe('el registro que se manda', () => {
  it('reproduce el que se selló al emitir', () => {
    const f = facturaEmitida();
    expect(registroParaEnvio(f, EMISOR)).toEqual(f.verifactu);
  });

  /**
   * ⚠️ **La razón de ser de todo esto.** Un registro rechazado por la AEAT no
   * queda registrado: hay que corregirlo y reenviarlo. Con el registro
   * congelado dentro de una factura inmutable eso es imposible, y como todo lo
   * que viene detrás encadena con su huella, la facturación se queda parada sin
   * remedio. Pasó de verdad con un NIF-IVA extranjero en el campo `NIF`.
   */
  it('aplica la corrección de un campo que NO entra en la huella', () => {
    const f = facturaEmitida({ recipient: { name: 'SRL', taxId: 'RO12345678' } });
    // Se simula el registro guardado con el error de aquel día.
    f.verifactu.Destinatarios = { IDDestinatario: [{ NombreRazon: 'SRL', NIF: 'RO12345678' }] };

    const corregido = registroParaEnvio(f, EMISOR);

    expect(corregido.Destinatarios!.IDDestinatario[0].IDOtro).toMatchObject({
      CodigoPais: 'RO',
      IDType: '02'
    });
    expect(corregido.Destinatarios!.IDDestinatario[0].NIF).toBeUndefined();
    // Y la huella no se mueve: el destinatario no entra en ella, así que sigue
    // siendo la misma factura y el mismo eslabón de la cadena.
    expect(corregido.Huella).toBe(f.verifactu.Huella);
  });

  /**
   * ⚠️ **Los hechos históricos no se recalculan.** El encadenamiento dice con
   * qué factura se encadenó esta **al emitirse**; recalcularlo hoy la ataría a
   * la última emitida, que ya es otra, y rompería la cadena entera.
   */
  it('el encadenamiento sale del registro guardado, no de la última factura', () => {
    const f = facturaEmitida();
    const anterior = {
      IDEmisorFactura: EMISOR.nif,
      NumSerieFactura: '2025/0099',
      FechaExpedicionFactura: '31-12-2025',
      Huella: 'C'.repeat(64)
    };
    f.verifactu.Encadenamiento = { RegistroAnterior: anterior };
    // La huella sellada tiene que corresponder a ESE encadenamiento.
    f.verifactu.Huella = computeRegistroAltaHash({
      idEmisorFactura: EMISOR.nif,
      numSerieFactura: f.fullNumber,
      fechaExpedicion: f.issueDate,
      tipoFactura: 'F1',
      cuotaTotal: f.totals.vat,
      importeTotal: f.totals.total,
      huellaAnterior: anterior.Huella,
      fechaHoraGenRegistro: new Date(f.verifactu.FechaHoraHusoGenRegistro)
    });

    expect(registroParaEnvio(f, EMISOR).Encadenamiento).toEqual({ RegistroAnterior: anterior });
  });

  /**
   * ⚠️ El instante de generación es el del sello. Tomando «ahora», la huella de
   * un registro dependería de cuándo se reintenta el envío.
   */
  it('el instante de generación es el del sello, no el de ahora', () => {
    const f = facturaEmitida();
    expect(registroParaEnvio(f, EMISOR).FechaHoraHusoGenRegistro).toBe(
      f.verifactu.FechaHoraHusoGenRegistro
    );
  });

  /**
   * ⚠️ **La versión del sistema es la que emitió, no la de hoy.** Poner la
   * actual diría que una factura de marzo la emitió el software de septiembre —
   * y esa versión es la que ampara la declaración responsable de aquel momento.
   */
  it('el sistema informático es el que emitió, con su versión', () => {
    const f = facturaEmitida();
    f.verifactu.SistemaInformatico.Version = '0.9';
    expect(registroParaEnvio(f, EMISOR).SistemaInformatico.Version).toBe('0.9');
  });

  /**
   * ⚠️ **La huella se comprueba, no se copia.** Es lo que separa «corregir cómo
   * se declara un dato» de «cambiar la factura»: si un importe se hubiera
   * movido, esto lo dice en vez de mandar a la Agencia un registro que no se
   * corresponde con el documento.
   */
  it('si un importe no cuadra con la huella sellada, NO se manda', () => {
    const f = facturaEmitida();
    f.totals = { ...f.totals, total: f.totals.total + 1 };
    expect(() => registroParaEnvio(f, EMISOR)).toThrow(RegistroInconsistenteError);
  });

  it('y tampoco si cambia el tipo de factura, que también entra en la huella', () => {
    const f = facturaEmitida();
    f.tipoFacturaAeat = 'R1';
    expect(() => registroParaEnvio(f, EMISOR)).toThrow(RegistroInconsistenteError);
  });
});
