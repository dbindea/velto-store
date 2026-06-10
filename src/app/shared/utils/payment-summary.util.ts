/**
 * Payment summary utilities.
 * 
 * Centralizes the logic for calculating reservation payment summary
 * from the payments collection. This is the source of truth -
 * do not trust accumulated fields, always recalculate.
 */

import { Payment, PaymentStatus } from '@shared/models/payment.model';
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

  // Extra charges
  const extraCharges = active.filter(p =>
    p.type === 'extra_charge' ||
    p.type === 'fuel_charge' ||
    p.type === 'cleaning_charge' ||
    p.type === 'extra_km_charge' ||
    p.type === 'penalty' ||
    p.type === 'fine'
  );
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

  const calculatedStatus = calculatePaymentStatus(
    initialPaymentRequired + remainingPaymentRequired,
    initialPaymentPaid + remainingPaymentPaid
  );
  // Map to ReservationPaymentStatus
  const paymentStatus: 'pending' | 'partial' | 'paid' | 'refunded' =
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
    extraChargesTotal,
    refundsTotal,
    totalPaid,
    totalPending,
    balance,
    paymentStatus
  };
}

/** Generate unique internal reference for a payment */
export function generateInternalReference(prefix = 'PMT'): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}