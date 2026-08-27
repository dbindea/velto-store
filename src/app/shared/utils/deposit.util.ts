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
