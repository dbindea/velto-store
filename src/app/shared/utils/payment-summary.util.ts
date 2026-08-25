/**
 * Payment summary utilities.
 * 
 * Centralizes the logic for calculating reservation payment summary
 * from the payments collection. This is the source of truth -
 * do not trust accumulated fields, always recalculate.
 */

import { Payment, PaymentStatus, PaymentType } from '@shared/models/payment.model';
import { Reservation, ReservationPaymentSummary } from '@shared/models/reservation.model';

const ROUND = 100;

/** Round to 2 decimals */
export function roundMoney(value: number): number {
  return Math.round(value * ROUND) / ROUND;
}

/** Calculate pending amount */
export function calculatePendingAmount(amount: number, paidAmount: number): number {
  return roundMoney(Math.max(0, amount - paidAmount));
}

/** Determine status from paid/amount */
export function calculatePaymentStatus(amount: number, paidAmount: number): PaymentStatus {
  if (paidAmount <= 0) return 'pending';
  if (paidAmount >= amount) return 'paid';
  return 'partial';
}

/**
 * Calculate the complete payment summary for a reservation from its payments.
 * The reservation is used for finalPrice and initial payment config.
 */
export function calculateReservationPaymentSummary(
  payments: Payment[],
  reservation: Reservation
): ReservationPaymentSummary {
  // Filter only active payments (not cancelled)
  const active = payments.filter(p => p.status !== 'cancelled');

  // Initial payment
  const initialPayments = active.filter(p => p.type === 'initial_payment');
  const initialPaymentRequired = reservation.initialPayment?.requiredAmount || 0;
  const initialPaymentPaid = roundMoney(
    initialPayments.reduce((sum, p) => sum + (p.paidAmount || 0), 0)
  );

  // Remaining payment
  const remainingPayments = active.filter(p => p.type === 'remaining_payment');
  const remainingPaymentRequired = reservation.remainingPayment?.requiredAmount || 0;
  const remainingPaymentPaid = roundMoney(
    remainingPayments.reduce((sum, p) => sum + (p.paidAmount || 0), 0)
  );

  // Deposit
  const depositPayments = active.filter(p => p.type === 'deposit');
  const depositRefunds = active.filter(p => p.type === 'deposit_refund');
  const depositRetentions = active.filter(p => p.type === 'deposit_retention');
  const depositRequired = reservation.deposit?.requiredAmount || 0;
  const depositPaid = roundMoney(
    depositPayments.reduce((sum, p) => sum + (p.paidAmount || 0), 0)
  );
  const depositReturned = roundMoney(
    depositRefunds.reduce((sum, p) => sum + (p.paidAmount || 0), 0)
  );
  const depositRetained = roundMoney(
    depositRetentions.reduce((sum, p) => sum + (p.paidAmount || 0), 0)
  );

  // Extra charges (any payment whose concept indicates an add-on collected
  // during or after the rental period).
  const EXTRA_TYPES: Payment['type'][] = [
    'extra_fuel',
    'refuel_penalty',
    'extra_cleaning',
    'extra_km',
    'extra_damage',
    'extra_fine',
    'extra_other'
  ];
  const extraCharges = active.filter(p => EXTRA_TYPES.includes(p.type));
  const extraChargesTotal = roundMoney(
    extraCharges.reduce((sum, p) => sum + (p.paidAmount || 0), 0)
  );

  // Refunds
  const allRefunds = active.filter(p =>
    p.direction === 'refund' || p.type === 'deposit_refund'
  );
  const refundsTotal = roundMoney(
    allRefunds.reduce((sum, p) => sum + (p.paidAmount || 0), 0)
  );

  // Totals
  const rentalTotal = reservation.pricingSnapshot?.finalPrice || 0;
  const totalPaid = roundMoney(initialPaymentPaid + remainingPaymentPaid + extraChargesTotal);
  const totalPending = roundMoney(
    Math.max(0, initialPaymentRequired - initialPaymentPaid) +
    Math.max(0, remainingPaymentRequired - remainingPaymentPaid) +
    extraCharges.reduce((sum, p) => sum + calculatePendingAmount(p.amount, p.paidAmount), 0)
  );

  const balance = roundMoney(totalPaid - refundsTotal);

  // Map to ReservationPaymentStatus. `settled` is reserved for the
  // post-closure state (rental paid + return processed + deposit
  // resolved). It is set by ReservationService.closeReservation, not
  // here.
  const calculatedStatus = calculatePaymentStatus(
    initialPaymentRequired + remainingPaymentRequired,
    initialPaymentPaid + remainingPaymentPaid
  );
  const paymentStatus: 'pending' | 'partial' | 'paid' =
    calculatedStatus === 'paid' ? 'paid' :
    calculatedStatus === 'partial' ? 'partial' :
    'pending';

  return {
    rentalTotal,
    initialPaymentRequired,
    initialPaymentPaid,
    remainingPaymentRequired,
    remainingPaymentPaid,
    depositRequired,
    depositPaid,
    depositReturned,
    depositRetained,
    extrasTotal: extraChargesTotal,
    totalPaid,
    totalPending,
    balance,
    paymentStatus
  };
}

/**
 * Pick the payment row that a manual collection should settle.
 *
 * A reservation is seeded with one `pending` row per expected concept
 * (señal, resto, fianza). Collecting money settles that row instead of
 * creating a duplicate next to it. `partial` rows count as open, so a second
 * collection tops up the same row. `null` means "nothing to settle" — the
 * caller creates a new payment (extras, `rental_payment`, or an extra
 * collection over an already-paid concept).
 *
 * Oldest first, mirroring the query order.
 */
export function selectSettleablePayment(
  payments: Payment[],
  type: PaymentType
): Payment | null {
  return payments.find(p =>
    p.type === type && (p.status === 'pending' || p.status === 'partial')
  ) || null;
}

export interface PaymentSettlement {
  amount: number;
  paidAmount: number;
  pendingAmount: number;
  status: PaymentStatus;
}

/**
 * Apply a collection to an existing payment row. **Accumulates**: registering
 * 250 € over a row already holding 100 € means 250 € more changed hands.
 *
 * Over-collection grows `amount` to match, so the row records what actually
 * happened and `pendingAmount` never goes negative.
 */
export function applySettlement(
  payment: Pick<Payment, 'amount' | 'paidAmount'>,
  addPaidAmount: number
): PaymentSettlement {
  const paidAmount = roundMoney((payment.paidAmount || 0) + addPaidAmount);
  const amount = roundMoney(Math.max(payment.amount || 0, paidAmount));
  return {
    amount,
    paidAmount,
    pendingAmount: calculatePendingAmount(amount, paidAmount),
    status: calculatePaymentStatus(amount, paidAmount)
  };
}

/** Generate unique internal reference for a payment */
export function generateInternalReference(prefix = 'PMT'): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}