/**
 * Building the deposit block of a new reservation.
 *
 * Not every rental carries a deposit: regular customers are often not asked
 * for one. That is a business decision, and it is NOT the same state as
 * "a deposit that nobody has collected yet" — one is finished, the other is
 * pending. Getting them confused leaves the workflow waiting forever for money
 * no one intends to pay.
 *
 * The distinction already existed in the model (`status: 'waived'` and
 * `waivedReason`) and in the guards: `isDepositSettled()` in
 * `reservation-workflow.util.ts` treats a zero deposit as settled **only when a
 * reason was recorded**. So the reason is not paperwork — without it the
 * reservation can never be closed.
 */

import { ReservationDeposit } from '@shared/models/reservation.model';
import { roundMoney } from '@shared/utils/payment-summary.util';

/** Shortest reason we accept, matching `buildWorkflowException`. */
export const MIN_WAIVED_REASON_LENGTH = 3;

export function isDepositWaived(amount: number | null | undefined): boolean {
  return !amount || !isFinite(amount) || amount <= 0;
}

/**
 * True when the operator still owes us an explanation: the deposit is being
 * waived and no usable reason was given.
 */
export function needsWaivedReason(
  amount: number | null | undefined,
  reason: string | null | undefined
): boolean {
  return isDepositWaived(amount) && (reason ?? '').trim().length < MIN_WAIVED_REASON_LENGTH;
}

/**
 * The deposit block for a brand-new reservation.
 *
 * @throws when the deposit is waived without a reason — the reservation would
 * be created in a state the workflow can never close.
 */
export function buildDeposit(
  requiredAmount: number,
  waivedReason?: string
): ReservationDeposit {
  if (isDepositWaived(requiredAmount)) {
    const reason = (waivedReason ?? '').trim();
    if (reason.length < MIN_WAIVED_REASON_LENGTH) {
      throw new Error(
        'A waived deposit needs a reason: without one the reservation can never be closed'
      );
    }
    return {
      requiredAmount: 0,
      paidAmount: 0,
      returnedAmount: 0,
      retainedAmount: 0,
      waivedReason: reason,
      status: 'waived'
    };
  }

  return {
    requiredAmount: roundMoney(requiredAmount),
    paidAmount: 0,
    returnedAmount: 0,
    retainedAmount: 0,
    status: 'pending'
  };
}

// ---------------------------------------------------------------------------
// Devolver y retener
// ---------------------------------------------------------------------------

/**
 * Lo que queda de la fianza: lo cobrado menos lo ya devuelto y lo ya retenido.
 *
 * ⚠️ **Es el techo de las dos operaciones a la vez**, no de cada una por
 * separado. Devolver 300 y retener 300 de una fianza de 300 son dos operaciones
 * que por separado parecen correctas y juntas entregan el doble de lo que el
 * cliente depositó.
 */
export function depositAvailable(summary: {
  depositPaid?: number;
  depositReturned?: number;
  depositRetained?: number;
}): number {
  const cobrado = Number(summary.depositPaid) || 0;
  const devuelto = Number(summary.depositReturned) || 0;
  const retenido = Number(summary.depositRetained) || 0;
  return roundMoney(Math.max(0, cobrado - devuelto - retenido));
}

/**
 * Lo que impide devolver o retener este importe, si algo lo impide.
 *
 * ⚠️ **No había ninguna comprobación**, ni en la pantalla ni en el servicio:
 * `refundDeposit` y `retainDeposit` escribían el importe que les dieran. Se
 * podía devolver más fianza de la cobrada —regalar dinero— y retener más de la
 * depositada —cobrarle al cliente algo que no dejó—. Y como la devolución **no**
 * cuenta como ingreso en Informes pero el cobro sí, el descuadre no salía por
 * ninguna parte: solo faltaba dinero.
 *
 * Devuelve una clave i18n, nunca una frase: la capa de avisos la traduce.
 */
export function depositMovementProblem(
  amount: number | null | undefined,
  available: number
): string | null {
  const importe = Number(amount);
  if (!isFinite(importe) || importe <= 0) {
    return 'payments.problems.depositAmountRequired';
  }
  // Un céntimo de margen: los importes vienen de restas y `0.1 + 0.2` no es
  // exactamente `0.3`. Rechazar por medio céntimo sería un fallo inventado.
  if (roundMoney(importe) > roundMoney(available) + 0.005) {
    return 'payments.problems.depositExceedsAvailable';
  }
  return null;
}
