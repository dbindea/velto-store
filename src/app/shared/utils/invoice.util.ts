/**
 * La aritmética y las reglas de la factura, en un solo sitio.
 *
 * Igual que `pricing.util.ts` es la única autoridad sobre el precio de un
 * alquiler, esto lo es sobre lo que dice una factura. No dupliques estos
 * cálculos en un componente: el mismo `calculateInvoiceTotals()` que pinta la
 * pantalla lo vuelve a ejecutar la Cloud Function antes de emitir, porque lo
 * que se congela en un documento fiscal no puede fiarse de la cifra que enseñó
 * la UI.
 *
 * Ver `docs/facturacion.md` para el porqué legal de cada regla.
 */

import {
  Invoice,
  InvoiceLine,
  InvoicePaymentMethod,
  InvoiceRecipient,
  InvoiceTotals,
  MAX_CASH_PAYMENT,
  VatSubtotal
} from '@shared/models/invoice.model';
import { FieldProblems } from '@shared/utils/form-problems.util';
import { roundMoney } from '@shared/utils/payment-summary.util';

/** Ancho del contador: `2026/0001`. Cuatro dígitos dan para 9.999 al año. */
export const INVOICE_NUMBER_PADDING = 4;

/** Prefijo de la serie de rectificativas, que la ley obliga a separar. */
export const RECTIFYING_SERIES_PREFIX = 'R';

/**
 * `2026` para una factura de 2026, `R2026` para su rectificativa.
 *
 * La serie es el ejercicio **de expedición**, no el de la operación: una
 * factura emitida en febrero de 2027 por un alquiler de noviembre de 2026 va en
 * la serie `2027`. La fecha de operación es la que dice cuándo se prestó el
 * servicio; la serie solo ordena cuándo se emitió.
 */
export function invoiceSeriesFor(date: Date, rectifying = false): string {
  const year = date.getFullYear();
  return rectifying ? `${RECTIFYING_SERIES_PREFIX}${year}` : String(year);
}

/** `2026` + `1` → `2026/0001`. */
export function formatInvoiceNumber(series: string, number: number): string {
  return `${series}/${String(number).padStart(INVOICE_NUMBER_PADDING, '0')}`;
}

/**
 * Los totales de una factura, con el desglose por tipo impositivo.
 *
 * ⚠️ **El IVA se SUMA al precio de línea**, que es neto — la misma dirección que
 * en `pricing.util.ts` y la contraria que en `expense.util.ts`, donde se extrae
 * de un bruto. Confundirlas no da un error: da una cifra creíble y equivocada.
 *
 * ⚠️ **Cada línea se redondea antes de sumar**, no después. Sumando en crudo y
 * redondeando al final, la base impresa y la suma de las líneas impresas pueden
 * diferir en un céntimo — y en una factura eso es un descuadre que hay que
 * explicar. Redondeando por línea, lo que se ve es lo que suma.
 */
export function calculateInvoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  const porTipo = new Map<number, VatSubtotal>();

  for (const line of lines || []) {
    const cantidad = Number(line.quantity) || 0;
    const precio = Number(line.unitPrice) || 0;
    const tipo = Number(line.vatRate) || 0;
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

  // De mayor a menor tipo: el 21 % primero, que es el caso normal y el que el
  // ojo busca.
  const byVatRate = [...porTipo.values()].sort((a, b) => b.vatRate - a.vatRate);
  const base = roundMoney(byVatRate.reduce((s, x) => s + x.base, 0));
  const vat = roundMoney(byVatRate.reduce((s, x) => s + x.vat, 0));

  return { base, vat, total: roundMoney(base + vat), byVatRate };
}

/** El importe de una línea, sin IVA. Lo que se pinta en la columna «BASE». */
export function lineBase(line: InvoiceLine): number {
  return roundMoney((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
}

/**
 * ¿Se puede cobrar esto en efectivo?
 *
 * ⚠️ Mira el **total de la operación**, no lo que quede pendiente. La ley
 * prohíbe fraccionar: un alquiler de 1.400 € no se puede cobrar en dos entregas
 * de 700 € en efectivo, así que si el total llega a 1.000 € el efectivo queda
 * descartado **aunque el saldo pendiente sea menor**.
 */
export function cashAllowedFor(total: number): boolean {
  return (Number(total) || 0) < MAX_CASH_PAYMENT;
}

/**
 * La forma de pago que la aplicación propone sola.
 *
 * Si no queda nada por cobrar, la factura sale **pagada** y sin datos
 * bancarios: no hay nada que pedirle al cliente. Si queda saldo, la propuesta
 * es transferencia, que es lo que Dorel usa hoy; el operador puede cambiarla.
 */
export function suggestPaymentMethod(total: number, alreadyPaid: number): InvoicePaymentMethod {
  const pendiente = roundMoney((Number(total) || 0) - (Number(alreadyPaid) || 0));
  return pendiente <= 0 ? 'paid' : 'transfer';
}

/**
 * Todo lo que impide emitir, campo a campo.
 *
 * **Una sola función**, la misma que consulta la pantalla y la que ejecuta la
 * Cloud Function antes de escribir. El orden de las comprobaciones es el de los
 * campos en el formulario, para que el resumen se lea de arriba abajo igual que
 * la pantalla.
 */
export function validateInvoice(input: {
  recipient?: Partial<InvoiceRecipient> | null;
  lines?: InvoiceLine[] | null;
  paymentMethod?: InvoicePaymentMethod | null;
}): FieldProblems {
  const problems: FieldProblems = {};
  const recipient = input.recipient || {};
  const lines = input.lines || [];

  // --- Destinatario. Los tres son obligatorios en toda factura (art. 6.1) ---
  if (!recipient.name?.trim()) {
    problems['recipientName'] = 'invoices.problems.recipientNameRequired';
  }
  if (!recipient.taxId?.trim()) {
    problems['recipientTaxId'] = 'invoices.problems.recipientTaxIdRequired';
  }
  if (!recipient.address?.trim()) {
    problems['recipientAddress'] = 'invoices.problems.recipientAddressRequired';
  }

  // --- Líneas ---
  const conContenido = lines.filter(
    (l) => l.description?.trim() || Number(l.quantity) || Number(l.unitPrice)
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
    // Cero está permitido —un concepto a coste cero es una línea legítima— pero
    // un negativo en una factura ordinaria no: eso es una rectificativa.
    if (!(Number(line.unitPrice) >= 0)) {
      problems[`lines[${i}].unitPrice`] = 'invoices.problems.linePriceInvalid';
    }
    if (!(Number(line.vatRate) >= 0)) {
      problems[`lines[${i}].vatRate`] = 'invoices.problems.lineVatInvalid';
    }
  });

  // --- Forma de pago ---
  if (!input.paymentMethod) {
    problems['paymentMethod'] = 'invoices.problems.paymentMethodRequired';
  } else if (input.paymentMethod === 'cash') {
    const { total } = calculateInvoiceTotals(conContenido);
    if (!cashAllowedFor(total)) {
      problems['paymentMethod'] = 'invoices.problems.cashLimitExceeded';
    }
  }

  return problems;
}

/**
 * Las líneas que **propone** una reserva, en el idioma del operador.
 *
 * Solo una propuesta: a partir de aquí la factura vive por su cuenta y el
 * importe se puede subir o bajar. Por eso esto devuelve líneas sueltas y no
 * escribe nada.
 */
export function linesFromReservation(input: {
  description: string;
  netPrice: number;
  vatRate: number;
}): InvoiceLine[] {
  return [
    {
      description: input.description,
      quantity: 1,
      unitPrice: roundMoney(Number(input.netPrice) || 0),
      vatRate: Number(input.vatRate) || 0
    }
  ];
}

/**
 * ¿El importe facturado se ha separado del de la reserva de origen?
 *
 * No bloquea nada —facturar otro importe es legítimo— pero se anota con autor
 * en la factura, igual que el descuento de fidelidad o una excepción de
 * workflow. Un descuadre entre Facturas y Pagos es información correcta; lo que
 * no puede pasar es tener que reconstruirlo de memoria un año después.
 */
export function differsFromReservation(
  invoiceTotal: number,
  reservationTotal: number | null | undefined
): boolean {
  if (reservationTotal === null || reservationTotal === undefined) return false;
  return roundMoney(invoiceTotal) !== roundMoney(reservationTotal);
}

/**
 * La fecha de operación solo se imprime **si difiere** de la de expedición.
 *
 * El art. 6.1.f) la exige en ese caso y solo en ese caso; ponerla siempre
 * repetiría la misma fecha dos veces en la cabecera.
 */
export function needsOperationDate(issueDate: Date, operationDate?: Date | null): boolean {
  if (!operationDate) return false;
  return issueDate.toDateString() !== operationDate.toDateString();
}

/**
 * ¿Se ha pasado el plazo de expedición?
 *
 * Cuando el destinatario es empresario o profesional, la factura debe expedirse
 * **antes del día 16 del mes siguiente** al devengo (art. 11 RD 1619/2012). A un
 * particular se le entrega cuando la pida, así que ahí no hay plazo que vigilar.
 *
 * No bloquea: **avisa**. La sanción por emitir tarde es del 2 % del importe, y
 * desde 2027 las fechas quedan registradas en la AEAT, así que llegar tarde pasa
 * de invisible a comprobable.
 */
export function invoiceDeadlineFor(operationDate: Date): Date {
  return new Date(operationDate.getFullYear(), operationDate.getMonth() + 1, 16);
}

export function isInvoiceOverdue(input: {
  recipientType: InvoiceRecipient['type'];
  operationDate: Date;
  now?: Date;
}): boolean {
  if (input.recipientType !== 'company') return false;
  const now = input.now || new Date();
  return now >= invoiceDeadlineFor(input.operationDate);
}

/** ¿Está emitida, y por tanto es intocable? */
export function isIssued(invoice: Pick<Invoice, 'status'>): boolean {
  return invoice.status !== 'draft';
}
