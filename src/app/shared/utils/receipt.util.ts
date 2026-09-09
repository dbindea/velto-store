/**
 * Qué cobro admite recibo.
 *
 * Un recibo dice **«hemos recibido este dinero»**, y es la única frase que hay
 * dentro. Por eso la regla no mira el estado del alquiler: mira si el dinero
 * entró y en qué dirección. Un papel que afirme un cobro que no existe es la
 * misma clase de fallo que el presupuesto que decía llevar el IVA incluido.
 *
 * ⚠️ **Está duplicada a propósito en `functions/src/invoices/receipt-core.ts`**,
 * igual que la aritmética del IVA lo está en `contracts/pdf.ts`: la aplicación
 * y las Cloud Functions compilan con tsconfigs separados y no pueden compartir
 * módulo. Aquí decide si el botón aparece; allí decide si el PDF se emite, que
 * es lo que de verdad protege el documento. **Si cambia una, cambia la otra**,
 * y las dos tienen su test con la misma tabla de casos.
 */

/** Lo que hace falta saber de un pago para decidir si admite recibo. */
export interface ReceiptablePayment {
  direction?: string;
  status?: string;
  paidAmount?: number;
}

/** Claves i18n, no frases: el motivo se le enseña al operador en su idioma. */
export type ReceiptProblem =
  | 'payments.receipt.problems.cancelled'
  | 'payments.receipt.problems.notIncoming'
  | 'payments.receipt.problems.nothingCollected';

/**
 * El motivo por el que este pago no admite recibo, o `null` si lo admite.
 *
 * El orden de las comprobaciones es el orden en que se explican: un pago
 * cancelado con 0 € cobrados cumple dos condiciones a la vez, y «este cobro
 * está cancelado» dice más que «no se ha cobrado nada».
 */
export function receiptProblem(payment: ReceiptablePayment): ReceiptProblem | null {
  const status = payment.status || '';
  if (status === 'cancelled' || status === 'failed') {
    return 'payments.receipt.problems.cancelled';
  }

  // ⚠️ Una devolución de fianza mueve el dinero en la dirección contraria: un
  // «recibido de …» sería lo contrario de lo que pasó, y además lleva importe,
  // así que la comprobación de abajo no lo cazaría.
  const direction = payment.direction || '';
  if (direction !== 'income' && direction !== 'charge') {
    return 'payments.receipt.problems.notIncoming';
  }

  const collected = Math.round((Number(payment.paidAmount) || 0) * 100) / 100;
  if (collected <= 0) {
    return 'payments.receipt.problems.nothingCollected';
  }

  return null;
}

/** Atajo legible para las plantillas. */
export function canIssueReceipt(payment: ReceiptablePayment): boolean {
  return receiptProblem(payment) === null;
}
