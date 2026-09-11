/**
 * Este fichero existe por una razón concreta: **`invoice-core.ts` es una copia**
 * de `src/app/shared/utils/invoice.util.ts`, y dos copias de la misma regla
 * acaban divergiendo. Cuando eso pasa, la pantalla deja emitir algo que la
 * function rechaza — o al revés, que es peor.
 *
 * Así que aquí se prueban **los mismos casos** que en el `.spec` del frontend,
 * con los mismos números. Si alguien cambia una regla en un lado y no en el
 * otro, uno de los dos ficheros se pone rojo.
 */

import { describe, expect, it } from 'vitest';
import {
  calculateInvoiceTotals,
  cashAllowedFor,
  formatInvoiceNumber,
  invoiceSeriesFor,
  InvoiceLineInput,
  requiredMentionKeys,
  validateInvoiceInput
} from './invoice-core';

const linea = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  description: 'Alquiler de vehículo sin conductor',
  quantity: 1,
  unitPrice: 165,
  vatRate: 0.21,
  ...over
});

const destinatario = {
  name: 'EUROCONSTRUCCIONES 2020, S.L.U.',
  taxId: 'B12345678',
  address: 'Urbanización El Romeral, 12, 28500 Arganda del Rey (Madrid)'
};

describe('calculateInvoiceTotals — mismos números que el frontend', () => {
  it('SUMA el IVA al neto', () => {
    expect(calculateInvoiceTotals([linea()])).toMatchObject({
      base: 165,
      vat: 34.65,
      total: 199.65
    });
  });

  it('la factura real de Dorel: 3.000 € al 21 % son 3.630 €', () => {
    expect(calculateInvoiceTotals([linea({ unitPrice: 3000 })])).toMatchObject({
      base: 3000,
      vat: 630,
      total: 3630
    });
  });

  it('3 × 36,30 € cuadra al céntimo', () => {
    expect(calculateInvoiceTotals([linea({ quantity: 3, unitPrice: 36.3 })])).toMatchObject({
      base: 108.9,
      vat: 22.87,
      total: 131.77
    });
  });

  it('redondea cada línea antes de sumar', () => {
    const t = calculateInvoiceTotals([
      linea({ quantity: 1, unitPrice: 0.105, vatRate: 0 }),
      linea({ quantity: 1, unitPrice: 0.105, vatRate: 0 }),
      linea({ quantity: 1, unitPrice: 0.105, vatRate: 0 })
    ]);
    expect(t.base).toBe(0.33);
  });

  it('desglosa por tipo, de mayor a menor', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 100, vatRate: 0.21 }),
      linea({ unitPrice: 50, vatRate: 0 })
    ]);
    expect(t.byVatRate.map((x) => x.vatRate)).toEqual([0.21, 0]);
    expect(t.total).toBe(171);
  });

  it('sin líneas vale cero, no NaN', () => {
    expect(calculateInvoiceTotals([])).toMatchObject({ base: 0, vat: 0, total: 0, byVatRate: [] });
  });

  it('aguanta un null sin reventar: viene de una petición externa', () => {
    expect(calculateInvoiceTotals(null).total).toBe(0);
  });
});

describe('regímenes de IVA — mismos números que el frontend', () => {
  it('REBU: base sobre el margen y total SIN sumar la cuota otra vez', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 7000, purchasePrice: 5500, taxRegime: 'rebu' })
    ]);
    expect(t.base).toBe(1239.67);
    expect(t.vat).toBe(260.33);
    // 7.000 y no 7.260,33: en REBU el impuesto va dentro del precio.
    expect(t.total).toBe(7000);
  });

  it('REBU con pérdida: base cero, nunca cuota negativa', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 4000, purchasePrice: 5500, taxRegime: 'rebu' })
    ]);
    expect(t.base).toBe(0);
    expect(t.total).toBe(4000);
  });

  it('exenta: importe al total, sin cuota y fuera del desglose por tipo', () => {
    const t = calculateInvoiceTotals([linea({ unitPrice: 8000, taxRegime: 'exempt_eu' })]);
    expect(t.vat).toBe(0);
    expect(t.total).toBe(8000);
    expect(t.byVatRate).toHaveLength(0);
    expect(t.exemptTotal).toBe(8000);
  });

  it('mezcla general, REBU y exenta y cuadra', () => {
    const t = calculateInvoiceTotals([
      linea({ unitPrice: 100, taxRegime: 'standard' }),
      linea({ unitPrice: 7000, purchasePrice: 5500, taxRegime: 'rebu' }),
      linea({ unitPrice: 3000, taxRegime: 'exempt_eu' })
    ]);
    expect(t.total).toBe(10121);
  });

  it('REBU sin precio de compra se rechaza antes de emitir', () => {
    expect(
      validateInvoiceInput({
        recipient: destinatario,
        lines: [linea({ unitPrice: 7000, taxRegime: 'rebu' })],
        paymentMethod: 'transfer'
      })['lines[0].purchasePrice']
    ).toBe('invoices.problems.rebuPurchasePriceRequired');
  });

  it('la entrega intracomunitaria exige NIF-IVA de otro Estado', () => {
    expect(
      validateInvoiceInput({
        recipient: destinatario,
        lines: [linea({ taxRegime: 'exempt_eu' })],
        paymentMethod: 'transfer',
        // Con el régimen permitido: lo que se prueba aquí es el NIF-IVA del
        // comprador, no el ROI del emisor. Son dos requisitos distintos y los
        // dos hacen falta.
        euRegimesEnabled: true
      })['recipientTaxId']
    ).toBe('invoices.problems.euVatIdRequired');
  });

  /**
   * ⚠️ **El bloqueo por ROI, que es lo único que impide una factura fiscalmente
   * incorrecta e imposible de editar.**
   *
   * Sin alta en el Registro de Operadores Intracomunitarios, estos dos regímenes
   * dejan de repercutir un IVA que sí se debe. Y la AEAT **no nos salva**: acepta
   * el registro igual, porque su validación es de forma. Hasta el 11 de
   * septiembre de 2026 esto solo estaba escrito en la documentación.
   */
  describe('sin ROI no se puede emitir intracomunitario', () => {
    const euNif = { ...destinatario, taxId: 'DE123456789' };

    it('bloquea la entrega intracomunitaria exenta', () => {
      expect(
        validateInvoiceInput({
          recipient: euNif,
          lines: [linea({ taxRegime: 'exempt_eu' })],
          paymentMethod: 'transfer',
          euRegimesEnabled: false
        })['lines[0].taxRegime']
      ).toBe('invoices.problems.euRegimeNotAvailable');
    });

    it('bloquea la inversión del sujeto pasivo', () => {
      expect(
        validateInvoiceInput({
          recipient: euNif,
          lines: [linea({ taxRegime: 'reverse_charge' })],
          paymentMethod: 'transfer',
          euRegimesEnabled: false
        })['lines[0].taxRegime']
      ).toBe('invoices.problems.euRegimeNotAvailable');
    });

    /**
     * ⚠️ **Falla cerrado.** Quien añada una llamada y se olvide del parámetro
     * bloquea dos regímenes que hoy no se deben usar — un formulario que se
     * queja. Al revés sería una factura que ya no se puede editar.
     */
    it('sin decir nada, se bloquean igual', () => {
      expect(
        validateInvoiceInput({
          recipient: euNif,
          lines: [linea({ taxRegime: 'exempt_eu' })],
          paymentMethod: 'transfer'
        })['lines[0].taxRegime']
      ).toBe('invoices.problems.euRegimeNotAvailable');
    });

    it('con el permiso puesto, pasan: es lo que hay que poder probar en preproducción', () => {
      expect(
        validateInvoiceInput({
          recipient: euNif,
          lines: [linea({ taxRegime: 'exempt_eu' })],
          paymentMethod: 'transfer',
          euRegimesEnabled: true
        })['lines[0].taxRegime']
      ).toBeUndefined();
    });

    it('no toca a los demás regímenes, que no dependen del ROI', () => {
      for (const taxRegime of ['standard', 'exempt_other', 'rebu'] as const) {
        expect(
          validateInvoiceInput({
            recipient: destinatario,
            lines: [linea({ taxRegime, purchasePrice: 100, exemptionNote: 'art. 20' })],
            paymentMethod: 'transfer',
            euRegimesEnabled: false
          })['lines[0].taxRegime'],
          taxRegime
        ).toBeUndefined();
      }
    });
  });

  it('las menciones obligatorias salen sin repetirse', () => {
    const m = requiredMentionKeys([
      linea({ taxRegime: 'rebu', purchasePrice: 1 }),
      linea({ taxRegime: 'rebu', purchasePrice: 1 }),
      linea({ taxRegime: 'reverse_charge' })
    ]);
    expect(m).toHaveLength(2);
    expect(m).toContain('invoices.mentions.rebu');
  });
});

describe('numeración', () => {
  it('compone 2026/0001', () => {
    expect(formatInvoiceNumber('2026', 1)).toBe('2026/0001');
  });

  it('usa el año de expedición', () => {
    expect(invoiceSeriesFor(new Date('2027-02-10T12:00:00'))).toBe('2027');
  });

  it('serie propia para rectificativas', () => {
    expect(invoiceSeriesFor(new Date('2026-09-08T12:00:00'), true)).toBe('R2026');
  });
});

describe('límite del efectivo', () => {
  it('999,99 € sí; 1.000 € no', () => {
    expect(cashAllowedFor(999.99)).toBe(true);
    expect(cashAllowedFor(1000)).toBe(false);
  });
});

describe('validateInvoiceInput — mismas claves i18n que el frontend', () => {
  it('acepta una factura completa', () => {
    expect(
      validateInvoiceInput({
        recipient: destinatario,
        lines: [linea()],
        paymentMethod: 'transfer'
      })
    ).toEqual({});
  });

  it('exige los tres datos del destinatario', () => {
    const p = validateInvoiceInput({ recipient: {}, lines: [linea()], paymentMethod: 'transfer' });
    expect(p['recipientName']).toBe('invoices.problems.recipientNameRequired');
    expect(p['recipientTaxId']).toBe('invoices.problems.recipientTaxIdRequired');
    expect(p['recipientAddress']).toBe('invoices.problems.recipientAddressRequired');
  });

  it('rechaza sin líneas', () => {
    expect(
      validateInvoiceInput({ recipient: destinatario, lines: [], paymentMethod: 'transfer' })[
        'lines'
      ]
    ).toBe('invoices.problems.linesRequired');
  });

  it('rechaza efectivo por encima del límite mirando el TOTAL', () => {
    expect(
      validateInvoiceInput({
        recipient: destinatario,
        lines: [linea({ unitPrice: 1400, vatRate: 0 })],
        paymentMethod: 'cash'
      })['paymentMethod']
    ).toBe('invoices.problems.cashLimitExceeded');
  });

  it('rechaza un negativo: eso es una rectificativa', () => {
    expect(
      validateInvoiceInput({
        recipient: destinatario,
        lines: [linea({ unitPrice: -50 })],
        paymentMethod: 'transfer'
      })['lines[0].unitPrice']
    ).toBe('invoices.problems.linePriceInvalid');
  });

  it('no acepta una petición sin nada, que es lo que llegaría de un cliente roto', () => {
    const p = validateInvoiceInput({});
    expect(Object.keys(p).length).toBeGreaterThan(0);
  });
});
