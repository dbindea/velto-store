/**
 * Qué se puede justificar con un recibo, y qué no.
 *
 * Un recibo dice **«hemos recibido este dinero»**. Es la única frase que hay
 * dentro, y por eso las reglas son de aritmética y de dirección, no de estado
 * del alquiler: si el dinero no ha entrado, o ha salido en vez de entrar, el
 * documento estaría afirmando algo falso — la misma clase de fallo que el
 * presupuesto que decía llevar el IVA incluido o el contrato que anunciaba una
 * firma digital que no tenía.
 *
 * Vive separado del PDF y de la function para que se pueda probar sin montar
 * nada: es una regla sobre dinero.
 */

/** Lo que hace falta saber de un pago para decidir si admite recibo. */
export interface ReceiptablePayment {
  direction?: string;
  status?: string;
  paidAmount?: number;
}

/**
 * Claves i18n, no frases. El frontend las pinta con su pipe, y así el operador
 * lee el motivo en su idioma en vez de un mensaje del backend en español.
 */
export type ReceiptProblem =
  | 'payments.receipt.problems.cancelled'
  | 'payments.receipt.problems.notIncoming'
  | 'payments.receipt.problems.nothingCollected';

/**
 * El motivo por el que este pago no admite recibo, o `null` si lo admite.
 *
 * El orden de las comprobaciones es el orden en que se explican: primero lo que
 * invalida la fila entera, después la dirección del dinero y por último el
 * importe. Un pago cancelado con 0 € cobrados cumple dos condiciones a la vez,
 * y «este cobro está cancelado» dice más que «no se ha cobrado nada».
 */
export function receiptProblem(payment: ReceiptablePayment): ReceiptProblem | null {
  const status = payment.status || '';
  if (status === 'cancelled' || status === 'failed') {
    return 'payments.receipt.problems.cancelled';
  }

  /**
   * ⚠️ **Una devolución de fianza no es un cobro.** El dinero va de la empresa
   * al cliente, así que un papel que diga «recibido de …» sería exactamente lo
   * contrario de lo que pasó. Lo mismo con una retención, que además ya queda
   * documentada con su motivo en la propia reserva.
   *
   * Un justificante de devolución es otro documento, con otro verbo, y no está
   * pedido.
   */
  const direction = payment.direction || '';
  if (direction !== 'income' && direction !== 'charge') {
    return 'payments.receipt.problems.notIncoming';
  }

  // Redondeo antes de comparar: un `paidAmount` derivado puede llegar como
  // 0.000000000000004 y no es dinero.
  const collected = Math.round((Number(payment.paidAmount) || 0) * 100) / 100;
  if (collected <= 0) {
    return 'payments.receipt.problems.nothingCollected';
  }

  return null;
}

/** Atajo legible para las plantillas y para los guards del servicio. */
export function canIssueReceipt(payment: ReceiptablePayment): boolean {
  return receiptProblem(payment) === null;
}
