/**
 * La aritmética y las reglas de la factura, del lado del backend.
 *
 * ⚠️ **Esto está DUPLICADO a propósito** en `src/app/shared/utils/invoice.util.ts`.
 * La app y las functions compilan con tsconfigs separados y no pueden compartir
 * módulo —el motivo técnico está en la nota sobre `rootDir` de CLAUDE.md—, así
 * que la misma decisión que ya se tomó con el IVA en `contracts/pdf.ts` se
 * repite aquí: **si cambia una regla, se cambia en los dos sitios.**
 *
 * Y no es duplicación por comodidad. Lo que se congela en un documento fiscal
 * no puede fiarse de la cifra que enseñó la pantalla, así que la function
 * recalcula los totales y revalida antes de emitir. Es la misma defensa en
 * profundidad que aplican los guards del workflow.
 */

/** ⚠️ 1.000 €, y la ley dice «igual o superior», así que el máximo es 999,99. */
export const MAX_CASH_PAYMENT = 1000;

export const INVOICE_NUMBER_PADDING = 4;
export const RECTIFYING_SERIES_PREFIX = 'R';

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  /** Precio unitario **sin IVA**. */
  unitPrice: number;
  /** ⚠️ Fracción (`0.21`), no porcentaje. */
  vatRate: number;
}

export interface VatSubtotal {
  vatRate: number;
  base: number;
  vat: number;
}

export interface InvoiceTotals {
  base: number;
  vat: number;
  total: number;
  byVatRate: VatSubtotal[];
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * La serie es el ejercicio **de expedición**, no el de la operación: una
 * factura emitida en 2027 por un alquiler de 2026 va en la serie `2027`.
 */
export function invoiceSeriesFor(date: Date, rectifying = false): string {
  const year = date.getFullYear();
  return rectifying ? `${RECTIFYING_SERIES_PREFIX}${year}` : String(year);
}

export function formatInvoiceNumber(series: string, number: number): string {
  return `${series}/${String(number).padStart(INVOICE_NUMBER_PADDING, '0')}`;
}

/**
 * ⚠️ **El IVA se SUMA al precio de línea, que es neto**, y **cada línea se
 * redondea antes de sumar**: si se suma en crudo y se redondea al final, la
 * base impresa puede no coincidir con la suma de las líneas impresas, y en una
 * factura ese céntimo hay que explicárselo a alguien.
 */
export function calculateInvoiceTotals(lines: InvoiceLineInput[] | undefined | null): InvoiceTotals {
  const porTipo = new Map<number, VatSubtotal>();

  for (const line of lines || []) {
    const cantidad = Number(line?.quantity) || 0;
    const precio = Number(line?.unitPrice) || 0;
    const tipo = Number(line?.vatRate) || 0;
    if (!cantidad || !precio) continue;

    const base = roundMoney(cantidad * precio);
    const cuota = roundMoney(base * tipo);

    const acumulado = porTipo.get(tipo);
    if (acumulado) {
      acumulado.base = roundMoney(acumulado.base + base);
      acumulado.vat = roundMoney(acumulado.vat + cuota);
    } else {
      porTipo.set(tipo, { vatRate: tipo, base, vat: cuota });
    }
  }

  const byVatRate = [...porTipo.values()].sort((a, b) => b.vatRate - a.vatRate);
  const base = roundMoney(byVatRate.reduce((s, x) => s + x.base, 0));
  const vat = roundMoney(byVatRate.reduce((s, x) => s + x.vat, 0));

  return { base, vat, total: roundMoney(base + vat), byVatRate };
}

export function cashAllowedFor(total: number): boolean {
  return (Number(total) || 0) < MAX_CASH_PAYMENT;
}

/** Campo → clave de i18n, igual que en el frontend. */
export type FieldProblems = Record<string, string>;

/**
 * Lo mismo que `validateInvoice()` en el frontend, y por eso el orden de las
 * comprobaciones es idéntico: si las dos discrepan, la pantalla deja emitir
 * algo que la function rechaza, que es la peor de las dos formas de fallar.
 */
export function validateInvoiceInput(input: {
  recipient?: { name?: string; taxId?: string; address?: string } | null;
  lines?: InvoiceLineInput[] | null;
  paymentMethod?: string | null;
}): FieldProblems {
  const problems: FieldProblems = {};
  const recipient = input?.recipient || {};
  const lines = input?.lines || [];

  if (!recipient.name?.trim()) {
    problems['recipientName'] = 'invoices.problems.recipientNameRequired';
  }
  if (!recipient.taxId?.trim()) {
    problems['recipientTaxId'] = 'invoices.problems.recipientTaxIdRequired';
  }
  if (!recipient.address?.trim()) {
    problems['recipientAddress'] = 'invoices.problems.recipientAddressRequired';
  }

  const conContenido = lines.filter(
    (l) => l?.description?.trim() || Number(l?.quantity) || Number(l?.unitPrice)
  );
  if (!conContenido.length) {
    problems['lines'] = 'invoices.problems.linesRequired';
  }

  conContenido.forEach((line, i) => {
    if (!line.description?.trim()) {
      problems[`lines[${i}].description`] = 'invoices.problems.lineDescriptionRequired';
    }
    if (!(Number(line.quantity) > 0)) {
      problems[`lines[${i}].quantity`] = 'invoices.problems.lineQuantityRequired';
    }
    if (!(Number(line.unitPrice) >= 0)) {
      problems[`lines[${i}].unitPrice`] = 'invoices.problems.linePriceInvalid';
    }
    if (!(Number(line.vatRate) >= 0)) {
      problems[`lines[${i}].vatRate`] = 'invoices.problems.lineVatInvalid';
    }
  });

  if (!input?.paymentMethod) {
    problems['paymentMethod'] = 'invoices.problems.paymentMethodRequired';
  } else if (input.paymentMethod === 'cash') {
    const { total } = calculateInvoiceTotals(conContenido);
    if (!cashAllowedFor(total)) {
      problems['paymentMethod'] = 'invoices.problems.cashLimitExceeded';
    }
  }

  return problems;
}
