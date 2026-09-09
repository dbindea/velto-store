/**
 * Lo que se prueba aquí es lo que cuesta dinero o cuesta una sanción:
 *
 * - que el IVA se **sume** y que base + cuota cuadre al céntimo;
 * - que el desglose por tipo exista cuando hay varios en la misma factura;
 * - que el límite del efectivo mire el **total** y no el saldo, porque la ley
 *   prohíbe fraccionar;
 * - que la numeración use el año de **expedición** y no el de la operación;
 * - que el plazo del día 16 solo vigile a las empresas.
 */

import { describe, expect, it } from 'vitest';
import {
  allowsNegativeAmounts,
  calculateInvoiceTotals,
  canRectify,
  cashAllowedFor,
  differsFromReservation,
  formatInvoiceNumber,
  taxIdCarriesCountry,
  invoiceDeadlineFor,
  invoiceSeriesFor,
  isInvoiceOverdue,
  lineBase,
  linesFromReservation,
  needsOperationDate,
  rebuMargin,
  suggestPaymentMethod,
  validateInvoice,
  validateRectifying
} from './invoice.util';
import { InvoiceLine } from '@shared/models/invoice.model';

const linea = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  description: 'Alquiler de vehículo sin conductor',
  quantity: 1,
  unitPrice: 165,
  vatRate: 0.21,
  ...over
});

const destinatario = {
  type: 'company' as const,
  name: 'EUROCONSTRUCCIONES 2020, S.L.U.',
  taxId: 'B12345678',
  address: 'Urbanización El Romeral, 12, 28500 Arganda del Rey (Madrid)'
};

describe('calculateInvoiceTotals', () => {
  it('SUMA el IVA al precio de línea, que es neto', () => {
    const t = calculateInvoiceTotals([linea()]);
    expect(t.base).toBe(165);
    expect(t.vat).toBe(34.65);
    expect(t.total).toBe(199.65);
  });

  it('reproduce la factura real de Dorel: 3.000 € al 21 % son 3.630 €', () => {
    const t = calculateInvoiceTotals([linea({ unitPrice: 3000 })]);
    expect(t.base).toBe(3000);
    expect(t.vat).toBe(630);
    expect(t.total).toBe(3630);
  });

  it('base + cuota cuadra al céntimo con importes que arrastran decimales', () => {
    // 3 × 36,30 € es el caso que produjo `58.900000000000006` en el asistente
    // de reservas: la cuota sale 22,869 y hay que redondearla antes de sumar.
    const t = calculateInvoiceTotals([linea({ quantity: 3, unitPrice: 36.3 })]);
    expect(t.base).toBe(108.9);
    expect(t.vat).toBe(22.87);
    expect(t.total).toBe(131.77);
    // Y lo impreso cuadra: las dos cifras de arriba suman exactamente la de
    // abajo, que es lo que mira quien recibe la factura.
    expect(t.total).toBe(Math.round((t.base + t.vat) * 100) / 100);
  });

  it('desglosa por tipo cuando la factura mezcla varios', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 100, vatRate: 0.21 }),
      linea({ description: 'Concepto exento', unitPrice: 50, vatRate: 0 })
    ]);
    expect(t.byVatRate).toHaveLength(2);
    // De mayor a menor: el 21 % primero, que es lo que el ojo busca.
    expect(t.byVatRate[0].vatRate).toBe(0.21);
    expect(t.byVatRate[0].vat).toBe(21);
    expect(t.byVatRate[1].vatRate).toBe(0);
    expect(t.byVatRate[1].vat).toBe(0);
    expect(t.total).toBe(171);
  });

  it('agrupa varias líneas del mismo tipo en un solo subtotal', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 100 }),
      linea({ description: 'Combustible', unitPrice: 40 })
    ]);
    expect(t.byVatRate).toHaveLength(1);
    expect(t.byVatRate[0].base).toBe(140);
    expect(t.total).toBe(169.4);
  });

  it('redondea CADA línea antes de sumar, para que lo impreso cuadre', () => {
    // 0,105 € por unidad redondea a 0,11 en la línea. Sumando en crudo y
    // redondeando al final saldría 0,32 y la factura no cuadraría con sus
    // propias líneas.
    const t = calculateInvoiceTotals([
      linea({ quantity: 1, unitPrice: 0.105, vatRate: 0 }),
      linea({ quantity: 1, unitPrice: 0.105, vatRate: 0 }),
      linea({ quantity: 1, unitPrice: 0.105, vatRate: 0 })
    ]);
    expect(t.base).toBe(0.33);
  });

  it('ignora líneas vacías sin romper los totales', () => {
    const t = calculateInvoiceTotals([
      linea(),
      { description: '', quantity: 0, unitPrice: 0, vatRate: 0.21 }
    ]);
    expect(t.total).toBe(199.65);
  });

  it('una factura sin líneas vale cero, no NaN', () => {
    const t = calculateInvoiceTotals([]);
    expect(t).toMatchObject({ base: 0, vat: 0, total: 0, byVatRate: [] });
  });
});

describe('regímenes de IVA — venta de vehículos', () => {
  it('régimen general: el 21 % se suma al precio', () => {
    const t = calculateInvoiceTotals([
      linea({ description: 'Renault Clio 0001PRB', unitPrice: 8000, taxRegime: 'standard' })
    ]);
    expect(t.base).toBe(8000);
    expect(t.vat).toBe(1680);
    expect(t.total).toBe(9680);
  });

  it('REBU: la base es el MARGEN, no el precio de venta', () => {
    // Comprado a un particular por 5.500 €, vendido por 7.000 €.
    // Margen 1.500 → base 1.239,67 y cuota 260,33.
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 7000, purchasePrice: 5500, taxRegime: 'rebu' })
    ]);
    expect(t.base).toBe(1239.67);
    expect(t.vat).toBe(260.33);
    expect(t.base + t.vat).toBeCloseTo(1500, 2);
  });

  it('REBU: el total es el precio de venta, SIN sumarle la cuota otra vez', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 7000, purchasePrice: 5500, taxRegime: 'rebu' })
    ]);
    // 7.000 y no 7.260: en REBU el impuesto va dentro del precio.
    expect(t.total).toBe(7000);
    expect(t.rebuTotal).toBe(7000);
  });

  it('REBU vendido con pérdida: base cero, nunca una cuota negativa', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 4000, purchasePrice: 5500, taxRegime: 'rebu' })
    ]);
    expect(t.base).toBe(0);
    expect(t.vat).toBe(0);
    expect(t.total).toBe(4000);
  });

  it('exenta intracomunitaria: importe al total y cuota cero', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 8000, taxRegime: 'exempt_eu' })
    ]);
    expect(t.vat).toBe(0);
    expect(t.total).toBe(8000);
    expect(t.exemptTotal).toBe(8000);
  });

  it('una exenta NO aparece como un tipo del 0 %', () => {
    // Meterla en el desglose imprimiría «IVA 0 %», que es justo lo que la norma
    // no quiere: pide la referencia a la exención, no un tipo inventado.
    const t = calculateInvoiceTotals([linea({ unitPrice: 8000, taxRegime: 'exempt_export' })]);
    expect(t.byVatRate).toHaveLength(0);
  });

  it('inversión del sujeto pasivo: sin cuota, como una exenta', () => {
    const t = calculateInvoiceTotals([linea({ unitPrice: 5000, taxRegime: 'reverse_charge' })]);
    expect(t.vat).toBe(0);
    expect(t.total).toBe(5000);
  });

  it('mezcla los tres mundos en una sola factura y cuadra', () => {
    const t = calculateInvoiceTotals([
      linea({ description: 'Alquiler', unitPrice: 100, taxRegime: 'standard' }),
      linea({ description: 'Coche REBU', unitPrice: 7000, purchasePrice: 5500, taxRegime: 'rebu' }),
      linea({ description: 'Venta UE', unitPrice: 3000, taxRegime: 'exempt_eu' })
    ]);
    // 100 + 21 de IVA general, + 7.000 con su IVA dentro, + 3.000 exentos.
    expect(t.total).toBe(10121);
    expect(t.exemptTotal).toBe(3000);
    expect(t.rebuTotal).toBe(7000);
  });

  it('sin régimen se comporta como general: es lo que era todo antes', () => {
    const conRegimen = calculateInvoiceTotals([linea({ taxRegime: 'standard' })]);
    const sinRegimen = calculateInvoiceTotals([linea()]);
    expect(sinRegimen).toEqual(conRegimen);
  });
});

describe('validación por régimen', () => {
  it('REBU exige el precio de compra: sin él, el margen sería el precio entero', () => {
    const p = validateInvoice({
      recipient: destinatario,
      lines: [linea({ unitPrice: 7000, taxRegime: 'rebu' })],
      paymentMethod: 'transfer'
    });
    expect(p['lines[0].purchasePrice']).toBe('invoices.problems.rebuPurchasePriceRequired');
  });

  it('«otra exención» exige decir cuál: lo pide el art. 6.1.j)', () => {
    const p = validateInvoice({
      recipient: destinatario,
      lines: [linea({ taxRegime: 'exempt_other' })],
      paymentMethod: 'transfer'
    });
    expect(p['lines[0].exemptionNote']).toBe('invoices.problems.exemptionNoteRequired');
  });

  it('la entrega intracomunitaria exige NIF-IVA de otro Estado miembro', () => {
    const p = validateInvoice({
      recipient: destinatario, // NIF español B12345678
      lines: [linea({ taxRegime: 'exempt_eu' })],
      paymentMethod: 'transfer'
    });
    expect(p['recipientTaxId']).toBe('invoices.problems.euVatIdRequired');
  });

  it('un NIF español con ES delante tampoco vale para una entrega a otro Estado', () => {
    const p = validateInvoice({
      recipient: { ...destinatario, taxId: 'ESB12345678' },
      lines: [linea({ taxRegime: 'exempt_eu' })],
      paymentMethod: 'transfer'
    });
    expect(p['recipientTaxId']).toBe('invoices.problems.euVatIdRequired');
  });

  it('acepta un NIF-IVA portugués', () => {
    const p = validateInvoice({
      recipient: { ...destinatario, taxId: 'PT501234567' },
      lines: [linea({ taxRegime: 'exempt_eu' })],
      paymentMethod: 'transfer'
    });
    expect(p['recipientTaxId']).toBeUndefined();
  });
});

describe('rectificativas', () => {
  const base = {
    rectifies: { invoiceId: 'abc123', fullNumber: '2026/0001' },
    rectifyingType: 'I' as const,
    rectifyingReason: 'R1' as const,
    rectifyingNote: 'Operación anulada por devolución del vehículo'
  };

  it('acepta una rectificativa por diferencias completa', () => {
    expect(validateRectifying(base)).toEqual({});
  });

  it('exige saber a qué factura rectifica', () => {
    expect(validateRectifying({ ...base, rectifies: null })['rectifies']).toBe(
      'invoices.problems.rectifiedInvoiceRequired'
    );
  });

  it('exige la modalidad y el motivo, que son claves de la norma', () => {
    const p = validateRectifying({ ...base, rectifyingType: null, rectifyingReason: null });
    expect(p['rectifyingType']).toBeTruthy();
    expect(p['rectifyingReason']).toBeTruthy();
  });

  it('exige explicar la rectificación en palabras', () => {
    expect(validateRectifying({ ...base, rectifyingNote: '   ' })['rectifyingNote']).toBe(
      'invoices.problems.rectifyingNoteRequired'
    );
  });

  it('por SUSTITUCIÓN pide base y cuota rectificadas', () => {
    const p = validateRectifying({ ...base, rectifyingType: 'S' });
    expect(p['rectifiedBase']).toBe('invoices.problems.rectifiedBaseRequired');
    expect(p['rectifiedVat']).toBe('invoices.problems.rectifiedVatRequired');
  });

  it('por SUSTITUCIÓN con base y cuota, pasa', () => {
    expect(
      validateRectifying({ ...base, rectifyingType: 'S', rectifiedBase: 165, rectifiedVat: 34.65 })
    ).toEqual({});
  });

  it('por DIFERENCIAS no pide base ni cuota rectificadas', () => {
    // En `I` esos campos NO se rellenan: el registro que va a la AEAT es otro.
    const p = validateRectifying(base);
    expect(p['rectifiedBase']).toBeUndefined();
    expect(p['rectifiedVat']).toBeUndefined();
  });
});

describe('canRectify', () => {
  it('solo una factura emitida', () => {
    expect(canRectify({ status: 'issued', kind: 'invoice' })).toBe(true);
  });

  it('un borrador se edita, no se rectifica', () => {
    expect(canRectify({ status: 'draft', kind: 'invoice' })).toBe(false);
  });

  it('una rectificativa no se rectifica desde aquí', () => {
    expect(canRectify({ status: 'issued', kind: 'rectifying' })).toBe(false);
  });
});

describe('allowsNegativeAmounts', () => {
  it('una rectificativa por diferencias SÍ admite negativos: así se anula', () => {
    expect(allowsNegativeAmounts('rectifying', 'I')).toBe(true);
  });

  it('por sustitución no: se emiten los datos correctos completos', () => {
    expect(allowsNegativeAmounts('rectifying', 'S')).toBe(false);
  });

  it('una factura ordinaria nunca', () => {
    expect(allowsNegativeAmounts('invoice')).toBe(false);
  });
});

describe('rebuMargin', () => {
  it('resta compra de venta', () => {
    expect(rebuMargin(linea({ unitPrice: 7000, purchasePrice: 5500, taxRegime: 'rebu' }))).toBe(
      1500
    );
  });

  it('nunca es negativo', () => {
    expect(rebuMargin(linea({ unitPrice: 4000, purchasePrice: 5500, taxRegime: 'rebu' }))).toBe(0);
  });
});

describe('lineBase', () => {
  it('multiplica cantidad por precio unitario', () => {
    expect(lineBase(linea({ quantity: 3, unitPrice: 55 }))).toBe(165);
  });
});

describe('numeración', () => {
  it('compone 2026/0001 con cuatro dígitos', () => {
    expect(formatInvoiceNumber('2026', 1)).toBe('2026/0001');
    expect(formatInvoiceNumber('2026', 137)).toBe('2026/0137');
  });

  it('no trunca si algún día se pasa de cuatro dígitos', () => {
    expect(formatInvoiceNumber('2026', 12345)).toBe('2026/12345');
  });

  it('la serie es el año de EXPEDICIÓN, no el de la operación', () => {
    // Factura emitida en febrero de 2027 por un alquiler de noviembre de 2026.
    expect(invoiceSeriesFor(new Date('2027-02-10T12:00:00'))).toBe('2027');
  });

  it('las rectificativas van en serie propia', () => {
    expect(invoiceSeriesFor(new Date('2026-09-08T12:00:00'), true)).toBe('R2026');
  });
});

describe('límite del efectivo', () => {
  it('permite por debajo de 1.000 €', () => {
    expect(cashAllowedFor(999.99)).toBe(true);
  });

  it('prohíbe 1.000 € exactos: la ley dice «igual o superior»', () => {
    expect(cashAllowedFor(1000)).toBe(false);
  });

  it('mira el TOTAL, no lo que quede pendiente: no se puede fraccionar', () => {
    // Alquiler de 1.400 € con 700 € ya cobrados. El saldo cabría en efectivo,
    // pero la operación no: son dos cobros del mismo alquiler.
    const problems = validateInvoice({
      recipient: destinatario,
      lines: [linea({ unitPrice: 1400, vatRate: 0 })],
      paymentMethod: 'cash'
    });
    expect(problems['paymentMethod']).toBe('invoices.problems.cashLimitExceeded');
  });
});

describe('suggestPaymentMethod', () => {
  it('propone «pagada» cuando no queda saldo', () => {
    expect(suggestPaymentMethod(199.65, 199.65)).toBe('paid');
  });

  it('propone transferencia cuando queda algo', () => {
    expect(suggestPaymentMethod(199.65, 50)).toBe('transfer');
  });

  it('no se confunde con los céntimos de un cobro parcial', () => {
    expect(suggestPaymentMethod(108.9, 108.9)).toBe('paid');
  });
});

describe('validateInvoice', () => {
  it('acepta una factura completa', () => {
    const problems = validateInvoice({
      recipient: destinatario,
      lines: [linea()],
      paymentMethod: 'transfer'
    });
    expect(problems).toEqual({});
  });

  it('exige nombre, NIF y domicilio del destinatario', () => {
    const problems = validateInvoice({
      recipient: { type: 'individual' },
      lines: [linea()],
      paymentMethod: 'transfer'
    });
    expect(problems['recipientName']).toBeTruthy();
    expect(problems['recipientTaxId']).toBeTruthy();
    expect(problems['recipientAddress']).toBeTruthy();
  });

  it('rechaza una factura sin líneas', () => {
    const problems = validateInvoice({
      recipient: destinatario,
      lines: [],
      paymentMethod: 'transfer'
    });
    expect(problems['lines']).toBe('invoices.problems.linesRequired');
  });

  it('señala la línea concreta que está mal', () => {
    const problems = validateInvoice({
      recipient: destinatario,
      lines: [linea(), linea({ description: '', unitPrice: 10 })],
      paymentMethod: 'transfer'
    });
    expect(problems['lines[1].description']).toBeTruthy();
    expect(problems['lines[0].description']).toBeUndefined();
  });

  it('permite una línea a coste cero, que es legítima', () => {
    const problems = validateInvoice({
      recipient: destinatario,
      lines: [linea({ unitPrice: 0 })],
      paymentMethod: 'transfer'
    });
    expect(problems['lines[0].unitPrice']).toBeUndefined();
  });

  it('rechaza un importe negativo: eso es una rectificativa, no una factura', () => {
    const problems = validateInvoice({
      recipient: destinatario,
      lines: [linea({ unitPrice: -50 })],
      paymentMethod: 'transfer'
    });
    expect(problems['lines[0].unitPrice']).toBe('invoices.problems.linePriceInvalid');
  });

  it('deja pagar en efectivo por debajo del límite', () => {
    const problems = validateInvoice({
      recipient: destinatario,
      lines: [linea({ unitPrice: 500, vatRate: 0 })],
      paymentMethod: 'cash'
    });
    expect(problems['paymentMethod']).toBeUndefined();
  });
});

describe('plazo de expedición', () => {
  it('vence el día 16 del mes siguiente', () => {
    const limite = invoiceDeadlineFor(new Date(2026, 7, 3)); // agosto
    expect(limite.getMonth()).toBe(8); // septiembre
    expect(limite.getDate()).toBe(16);
  });

  it('cruza bien el fin de año', () => {
    const limite = invoiceDeadlineFor(new Date(2026, 11, 20)); // diciembre
    expect(limite.getFullYear()).toBe(2027);
    expect(limite.getMonth()).toBe(0);
  });

  it('avisa cuando el destinatario es una empresa y ya pasó el plazo', () => {
    expect(
      isInvoiceOverdue({
        recipientType: 'company',
        operationDate: new Date(2026, 6, 10),
        now: new Date(2026, 7, 20)
      })
    ).toBe(true);
  });

  it('NO avisa de un particular: a él se le factura cuando la pide', () => {
    expect(
      isInvoiceOverdue({
        recipientType: 'individual',
        operationDate: new Date(2026, 0, 10),
        now: new Date(2026, 11, 31)
      })
    ).toBe(false);
  });

  it('no avisa antes de tiempo', () => {
    expect(
      isInvoiceOverdue({
        recipientType: 'company',
        operationDate: new Date(2026, 7, 10),
        now: new Date(2026, 8, 15)
      })
    ).toBe(false);
  });
});

describe('needsOperationDate', () => {
  it('no la pide si se factura el mismo día del servicio', () => {
    const d = new Date(2026, 8, 8);
    expect(needsOperationDate(d, new Date(2026, 8, 8))).toBe(false);
  });

  it('la pide cuando difiere, que es lo que exige el art. 6.1.f)', () => {
    expect(needsOperationDate(new Date(2026, 7, 10), new Date(2026, 5, 1))).toBe(true);
  });
});

describe('linesFromReservation', () => {
  it('propone una línea con el neto y el tipo congelados en la reserva', () => {
    const [l] = linesFromReservation({
      description: 'Alquiler Kia Ceed · 7777ATM',
      netPrice: 165,
      vatRate: 0.21
    });
    expect(l.quantity).toBe(1);
    expect(l.unitPrice).toBe(165);
    expect(l.vatRate).toBe(0.21);
  });
});

describe('differsFromReservation', () => {
  it('detecta que se facturó otro importe', () => {
    expect(differsFromReservation(250, 199.65)).toBe(true);
  });

  it('no salta por un redondeo', () => {
    expect(differsFromReservation(199.65, 199.650000001)).toBe(false);
  });

  it('no salta cuando no hay reserva de origen', () => {
    expect(differsFromReservation(250, null)).toBe(false);
    expect(differsFromReservation(250, undefined)).toBe(false);
  });
});

/**
 * El país del destinatario.
 *
 * ⚠️ **Esto lo encontró preproducción, no un test.** Facturando a un turista con
 * pasaporte, la AEAT devolvió el `1111`: «El campo CodigoPais es obligatorio
 * cuando IDType es distinto de NIF-IVA (02)». El esquema lo declara opcional y
 * el servicio lo exige igual, así que el XML era válido y la factura ya estaba
 * emitida — es decir, sin arreglo posible. Por eso se comprueba **antes** de
 * consumir número, y no al remitir.
 */
describe('el país del destinatario', () => {
  const conNif = (taxId: string, countryCode?: string) =>
    validateInvoice({
      recipient: { ...destinatario, taxId, countryCode },
      lines: [linea({})],
      paymentMethod: 'transfer'
    })['recipientCountry'];

  it('un NIF español no lo pide: lo lleva dentro', () => {
    expect(conNif('B12345678')).toBeUndefined();
    expect(conNif('12345678Z')).toBeUndefined();
    expect(conNif('X4273299Z')).toBeUndefined();
  });

  it('un NIF-IVA europeo tampoco: el prefijo ES el país', () => {
    expect(conNif('RO12345674')).toBeUndefined();
    expect(conNif('DE811569869')).toBeUndefined();
  });

  /** El caso que la AEAT rechazó: un turista con pasaporte. */
  it('un pasaporte SÍ lo pide', () => {
    expect(conNif('AB1234567')).toBe('invoices.problems.recipientCountryRequired');
  });

  it('y deja de pedirlo en cuanto se indica', () => {
    expect(conNif('AB1234567', 'GB')).toBeUndefined();
  });

  /**
   * ⚠️ Dos letras cualesquiera no valen: `CodigoPais` es ISO 3166-1 alfa-2 y
   * un valor inventado se rechaza igual que la ausencia.
   */
  it('un país mal escrito no cuenta como indicado', () => {
    expect(conNif('AB1234567', 'Reino Unido')).toBe(
      'invoices.problems.recipientCountryRequired'
    );
  });
});

describe('qué identificadores llevan el país dentro', () => {
  it('los españoles y los NIF-IVA europeos, sí', () => {
    expect(taxIdCarriesCountry('B12345678')).toBe(true);
    expect(taxIdCarriesCountry('ESB12345678')).toBe(true);
    expect(taxIdCarriesCountry('RO12345674')).toBe(true);
  });

  /**
   * ⚠️ Grecia usa `EL` en el NIF-IVA y no su código ISO `GR`: sacando la lista
   * de ISO 3166 se le pediría el país a todo cliente griego.
   */
  it('Grecia va con EL, que es su prefijo de NIF-IVA', () => {
    expect(taxIdCarriesCountry('EL123456789')).toBe(true);
  });

  it('un pasaporte y un identificador de fuera de la Unión, no', () => {
    expect(taxIdCarriesCountry('AB1234567')).toBe(false);
    expect(taxIdCarriesCountry('CHE123456789')).toBe(false);
  });
});
