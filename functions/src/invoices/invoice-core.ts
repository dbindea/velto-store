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

// Sin ciclo: `verifactu.ts` solo importa de `hash.ts`. La regla de qué
// identificadores llevan el país dentro vive allí porque es la misma que decide
// dónde va cada uno en el registro; tenerla dos veces sería tener dos opiniones.
import { identificadorLlevaPais } from './verifactu';

/** ⚠️ 1.000 €, y la ley dice «igual o superior», así que el máximo es 999,99. */
export const MAX_CASH_PAYMENT = 1000;

export const INVOICE_NUMBER_PADDING = 4;
export const RECTIFYING_SERIES_PREFIX = 'R';

/**
 * El régimen de IVA de una línea. Ver la nota larga en `invoice.model.ts`.
 *
 * ⚠️ Un coche que estuvo afecto a la actividad de alquiler **no puede venderse
 * en REBU**: se compró deduciendo su IVA, así que su venta va en régimen
 * general al 21 % sobre el precio total.
 */
export type TaxRegime =
  | 'standard'
  | 'rebu'
  | 'exempt_eu'
  | 'exempt_export'
  | 'reverse_charge'
  | 'exempt_other';

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  /** Precio unitario **sin IVA**, salvo en REBU, donde es el precio de venta. */
  unitPrice: number;
  /** ⚠️ Fracción (`0.21`), no porcentaje. */
  vatRate: number;
  taxRegime?: TaxRegime;
  /** Solo REBU: precio de compra, **IVA incluido**. La base es el margen. */
  purchasePrice?: number;
  /** Solo `exempt_other`: la norma que ampara la exención (art. 6.1.j). */
  exemptionNote?: string;
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
  exemptTotal?: number;
  rebuTotal?: number;
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
 *
 * Tres comportamientos según el régimen:
 *
 * - **general**: el impuesto se suma encima del importe.
 * - **REBU**: la base es el **margen** —`(venta − compra) × 100 / (100 + tipo)`,
 *   los dos precios con IVA dentro— y el importe entra entero en el total **sin
 *   sumarle la cuota**, que ya va incluida. Sumarla cobraría el IVA dos veces.
 * - **exentas e inversión del sujeto pasivo**: importe al total, cuota cero, y
 *   **fuera del desglose por tipo** — no son un 0 %, son otra cosa, y la
 *   factura tiene que decir por qué lo son.
 */
export function calculateInvoiceTotals(lines: InvoiceLineInput[] | undefined | null): InvoiceTotals {
  const porTipo = new Map<number, VatSubtotal>();
  let exento = 0;
  let rebuTotal = 0;
  // Aparte del desglose por tipo, que mezcla el general con el margen REBU.
  let totalGeneral = 0;
  let vatGeneral = 0;

  for (const line of lines || []) {
    const cantidad = Number(line?.quantity) || 0;
    const precio = Number(line?.unitPrice) || 0;
    const tipo = Number(line?.vatRate) || 0;
    const regimen = (line?.taxRegime || 'standard') as TaxRegime;
    if (!cantidad || !precio) continue;

    const importe = roundMoney(cantidad * precio);

    if (regimen !== 'standard' && regimen !== 'rebu') {
      exento = roundMoney(exento + importe);
      continue;
    }

    if (regimen === 'rebu') {
      rebuTotal = roundMoney(rebuTotal + importe);
      const compra = roundMoney((Number(line?.purchasePrice) || 0) * cantidad);
      const margen = Math.max(0, roundMoney(importe - compra));
      const baseMargen = roundMoney((margen * 100) / (100 + tipo * 100));
      const cuotaMargen = roundMoney(margen - baseMargen);
      const acumuladoRebu = porTipo.get(tipo);
      if (acumuladoRebu) {
        acumuladoRebu.base = roundMoney(acumuladoRebu.base + baseMargen);
        acumuladoRebu.vat = roundMoney(acumuladoRebu.vat + cuotaMargen);
      } else {
        porTipo.set(tipo, { vatRate: tipo, base: baseMargen, vat: cuotaMargen });
      }
      continue;
    }

    const cuota = roundMoney(importe * tipo);
    totalGeneral = roundMoney(totalGeneral + importe);
    vatGeneral = roundMoney(vatGeneral + cuota);
    const acumulado = porTipo.get(tipo);
    if (acumulado) {
      acumulado.base = roundMoney(acumulado.base + importe);
      acumulado.vat = roundMoney(acumulado.vat + cuota);
    } else {
      porTipo.set(tipo, { vatRate: tipo, base: importe, vat: cuota });
    }
  }

  const byVatRate = [...porTipo.values()].sort((a, b) => b.vatRate - a.vatRate);
  const base = roundMoney(byVatRate.reduce((s, x) => s + x.base, 0));
  const vat = roundMoney(byVatRate.reduce((s, x) => s + x.vat, 0));

  return {
    base,
    vat,
    // ⚠️ La cuota del margen REBU NO entra: ese importe ya lleva el impuesto
    // dentro, y sumarla cobraría el IVA dos veces.
    total: roundMoney(totalGeneral + vatGeneral + exento + rebuTotal),
    byVatRate,
    exemptTotal: exento,
    rebuTotal
  };
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
  recipient?: { name?: string; taxId?: string; address?: string; countryCode?: string } | null;
  lines?: InvoiceLineInput[] | null;
  paymentMethod?: string | null;
  /**
   * ⚠️ Una rectificativa **por diferencias** declara el ajuste con su signo, y
   * ese signo puede ser negativo: es como se anula una factura entera. En una
   * factura ordinaria un negativo sigue estando mal.
   */
  allowNegative?: boolean;
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

  /**
   * El país del destinatario, **cuando su identificador no dice de dónde es**.
   *
   * ⚠️ **Esto se comprueba aquí, antes de consumir número de factura, porque
   * después no tiene arreglo.** La AEAT rechaza el registro con el `1111` —«El
   * campo CodigoPais es obligatorio cuando IDType es distinto de NIF-IVA
   * (02)»— y una factura emitida no se puede editar: quedaría una factura
   * válida que no se puede remitir nunca. Un NIF español y un NIF-IVA europeo
   * llevan el país dentro; un pasaporte, no. Y el pasaporte es el caso normal
   * aquí: un turista alquilando un coche.
   */
  const nif = (recipient.taxId || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (nif && !identificadorLlevaPais(nif) && !/^[A-Z]{2}$/.test(recipient.countryCode || '')) {
    problems['recipientCountry'] = 'invoices.problems.recipientCountryRequired';
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
    if (!(Math.abs(Number(line.quantity)) > 0)) {
      problems[`lines[${i}].quantity`] = 'invoices.problems.lineQuantityRequired';
    }
    if (!input.allowNegative && !(Number(line.unitPrice) >= 0)) {
      problems[`lines[${i}].unitPrice`] = 'invoices.problems.linePriceInvalid';
    }
    if (!(Number(line.vatRate) >= 0)) {
      problems[`lines[${i}].vatRate`] = 'invoices.problems.lineVatInvalid';
    }

    const regimen = (line.taxRegime || 'standard') as TaxRegime;
    if (regimen === 'rebu' && !(Number(line.purchasePrice) > 0)) {
      problems[`lines[${i}].purchasePrice`] = 'invoices.problems.rebuPurchasePriceRequired';
    }
    if (regimen === 'exempt_other' && !line.exemptionNote?.trim()) {
      problems[`lines[${i}].exemptionNote`] = 'invoices.problems.exemptionNoteRequired';
    }
  });

  // Una entrega intracomunitaria exenta necesita el NIF-IVA del comprador: es
  // lo que sostiene la exención del art. 25.
  if (conContenido.some((l) => l.taxRegime === 'exempt_eu')) {
    const nif = (recipient.taxId || '').trim().toUpperCase();
    if (!/^[A-Z]{2}/.test(nif) || nif.startsWith('ES')) {
      problems['recipientTaxId'] = 'invoices.problems.euVatIdRequired';
    }
  }

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

/** El texto exacto que el art. 6.1 obliga a imprimir en cada régimen. */
export const TAX_REGIME_MENTIONS: Record<TaxRegime, string> = {
  standard: '',
  rebu: 'invoices.mentions.rebu',
  exempt_eu: 'invoices.mentions.exemptEu',
  exempt_export: 'invoices.mentions.exemptExport',
  reverse_charge: 'invoices.mentions.reverseCharge',
  exempt_other: 'invoices.mentions.exemptOther'
};

/** Las menciones que esta factura tiene que llevar, sin repetir. */
export function requiredMentionKeys(lines: InvoiceLineInput[] | undefined | null): string[] {
  const claves = new Set<string>();
  for (const line of lines || []) {
    const m = TAX_REGIME_MENTIONS[(line?.taxRegime || 'standard') as TaxRegime];
    if (m) claves.add(m);
  }
  return [...claves];
}
