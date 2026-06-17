/**
 * Reservation workflow util.
 *
 * Pure functions that encode the rental workflow guardrails.
 * Both UI components (to disable buttons) and services (to refuse
 * state transitions) must use these functions so the rules are
 * never bypassed.
 *
 * The workflow is intentionally minimal:
 *
 *   reserved
 *     -> confirm initial payment        -> confirmed
 *     -> generate contract              (no status change yet)
 *     -> sign contract                  (contractStatus=signed)
 *     -> pay remaining + deposit        (no status change yet)
 *     -> start pickup inspection        -> delivered
 *     -> start return inspection        -> returned
 *     -> settle deposit + close         -> closed
 *
 * At any moment before `delivered` the reservation can be cancelled.
 * After `delivered`, the only path forward is the inspection flow.
 *
 * The util is dependency-free: it takes plain data and returns
 * booleans or short strings. The translation of those strings to
 * UI messages happens in the components, using the `workflow.*` i18n
 * keys.
 */

import {
  Reservation,
  ReservationStatus,
  ReservationContractStatus
} from '@shared/models/reservation.model';
import { Inspection } from '@shared/models/inspection.model';
import { Contract } from '@shared/models/contract.model';

// ---------------------------------------------------------------------------
// Inputs that capture everything the workflow needs to decide.
// Components pass already-loaded data; services load what they need.
// ---------------------------------------------------------------------------

export interface WorkflowContext {
  reservation: Reservation;
  /** Latest pickup inspection for this reservation, if any. */
  pickupInspection?: Inspection | null;
  /** Latest return inspection for this reservation, if any. */
  returnInspection?: Inspection | null;
  /** Latest contract document for this reservation, if any. */
  contract?: Contract | null;
  /** True if the deposit is fully paid OR waived with a reason. */
  depositSettled?: boolean;
  /** True if the initial payment is fully paid. */
  initialPaid?: boolean;
  /** True if the remaining rental payment is fully paid. */
  remainingPaid?: boolean;
}

// ---------------------------------------------------------------------------
// Result type. `ok: true` means the action may proceed. `ok: false` returns
// an i18n key in `reason` that the UI renders verbatim.
// ---------------------------------------------------------------------------

export type WorkflowDecision = { ok: true; reason?: undefined } | { ok: false; reason: string };

const ALLOW: WorkflowDecision = { ok: true };
function deny(reason: string): WorkflowDecision {
  return { ok: false, reason };
}

/** Convenience: return the reason or '' if allowed. Useful in templates. */
export function reasonOf(decision: WorkflowDecision): string {
  return decision.ok ? '' : decision.reason;
}

function isTerminalStatus(s: ReservationStatus): boolean {
  return s === 'closed' || s === 'cancelled';
}

function isDepositSettled(reservation: Reservation): boolean {
  const d = reservation.deposit;
  if (!d) return false;
  if ((d.requiredAmount || 0) === 0 && (d.paidAmount || 0) === 0) {
    // Waived: only "settled" if the operator recorded a reason.
    return !!d.waivedReason && d.waivedReason.trim().length > 0;
  }
  return (d.paidAmount || 0) >= (d.requiredAmount || 0);
}

function isInitialPaid(reservation: Reservation): boolean {
  return (reservation.initialPayment?.paidAmount || 0) >=
    (reservation.initialPayment?.requiredAmount || 0);
}

function isRemainingPaid(reservation: Reservation): boolean {
  return (reservation.remainingPayment?.paidAmount || 0) >=
    (reservation.remainingPayment?.requiredAmount || 0);
}

// ---------------------------------------------------------------------------
// Guards for every action in the workflow.
// ---------------------------------------------------------------------------

/** Generate the original PDF contract from the reservation. */
export function canGenerateContract(ctx: WorkflowContext): WorkflowDecision {
  if (!ctx.reservation) return deny('workflow.missingReservation');
  if (isTerminalStatus(ctx.reservation.reservationStatus)) {
    return deny('workflow.cancelled');
  }
  if (ctx.contract?.status === 'signed') {
    return deny('workflow.contractAlreadySigned');
  }
  return ALLOW;
}

/** Create a one-time signing link for the customer. */
export function canGenerateSigningLink(ctx: WorkflowContext): WorkflowDecision {
  if (!ctx.contract) return deny('workflow.missingContract');
  if (ctx.contract.status === 'cancelled') return deny('workflow.contractCancelled');
  if (ctx.contract.status === 'signed') return deny('workflow.contractAlreadySigned');
  // Only allow once the PDF exists. `pending_signature` already has a live link.
  if (ctx.contract.status !== 'generated' && ctx.contract.status !== 'pending_signature') {
    return deny('workflow.missingContract');
  }
  return ALLOW;
}

/** Record a rental payment (signal / remaining / deposit / extras). */
export function canRegisterPayment(ctx: WorkflowContext): WorkflowDecision {
  if (!ctx.reservation) return deny('workflow.missingReservation');
  if (isTerminalStatus(ctx.reservation.reservationStatus)) {
    return deny('workflow.cancelled');
  }
  return ALLOW;
}

/** Refund all or part of the deposit to the customer. */
export function canRefundDeposit(ctx: WorkflowContext): WorkflowDecision {
  if (!ctx.reservation) return deny('workflow.missingReservation');
  if (!isDepositSettled(ctx.reservation)) return deny('workflow.unsettledDeposit');
  if ((ctx.reservation.deposit?.paidAmount || 0) <= 0) {
    return deny('workflow.unsettledDeposit');
  }
  return ALLOW;
}

/** Retain all or part of the deposit to cover charges. */
export function canRetainDeposit(ctx: WorkflowContext): WorkflowDecision {
  if (!ctx.reservation) return deny('workflow.missingReservation');
  if (!isDepositSettled(ctx.reservation)) return deny('workflow.unsettledDeposit');
  if ((ctx.reservation.deposit?.paidAmount || 0) <= 0) {
    return deny('workflow.unsettledDeposit');
  }
  return ALLOW;
}

/** Begin the pickup inspection. */
export function canStartPickup(ctx: WorkflowContext): WorkflowDecision {
  const r = ctx.reservation;
  if (!r) return deny('workflow.missingReservation');
  if (r.reservationStatus === 'cancelled') return deny('workflow.cancelled');
  if (r.reservationStatus === 'closed') return deny('workflow.cancelled');
  if (ctx.pickupInspection?.status === 'completed') {
    return deny('workflow.pickupAlreadyCompleted');
  }
  if (!['reserved', 'confirmed'].includes(r.reservationStatus)) {
    return deny('workflow.cannotDeliver');
  }
  if (!ctx.contract || ctx.contract.status !== 'signed') {
    return deny('workflow.missingSignature');
  }
  if (!isInitialPaid(r)) {
    return deny('workflow.missingInitialPayment');
  }
  if (!isRemainingPaid(r)) {
    return deny('workflow.missingRemainingPayment');
  }
  if (!isDepositSettled(r)) {
    return deny('workflow.missingDeposit');
  }
  return ALLOW;
}

/** Begin the return inspection. */
export function canStartReturn(ctx: WorkflowContext): WorkflowDecision {
  const r = ctx.reservation;
  if (!r) return deny('workflow.missingReservation');
  if (r.reservationStatus !== 'delivered') return deny('workflow.cannotReturn');
  if (ctx.pickupInspection?.status !== 'completed') {
    return deny('workflow.missingPickupInspection');
  }
  if (ctx.returnInspection?.status === 'completed') {
    return deny('workflow.returnAlreadyCompleted');
  }
  return ALLOW;
}

/** Close the reservation (deposit settled, extras settled, return done). */
export function canCloseReservation(ctx: WorkflowContext): WorkflowDecision {
  const r = ctx.reservation;
  if (!r) return deny('workflow.missingReservation');
  if (r.reservationStatus !== 'returned') return deny('workflow.cannotClose');
  if (ctx.returnInspection?.status !== 'completed') {
    return deny('workflow.missingReturnInspection');
  }
  if (!isRemainingPaid(r)) return deny('workflow.missingRemainingPayment');
  // Deposit must be either refunded or explicitly retained; the
  // current values come from the payments collection.
  const d = r.deposit;
  if (!d) return deny('workflow.unsettledDeposit');
  if ((d.requiredAmount || 0) === 0 && !d.waivedReason) {
    return deny('workflow.unsettledDeposit');
  }
  if (
    (d.requiredAmount || 0) > 0 &&
    (d.returnedAmount || 0) + (d.retainedAmount || 0) < (d.requiredAmount || 0)
  ) {
    return deny('workflow.unsettledDeposit');
  }
  return ALLOW;
}

/** Cancel the reservation (only before delivery). */
export function canCancelReservation(ctx: WorkflowContext): WorkflowDecision {
  const r = ctx.reservation;
  if (!r) return deny('workflow.missingReservation');
  if (['delivered', 'returned', 'closed'].includes(r.reservationStatus)) {
    return deny('workflow.cannotCancel');
  }
  if (r.reservationStatus === 'cancelled') return deny('workflow.cancelled');
  return ALLOW;
}

// ---------------------------------------------------------------------------
// Computed helpers used by both UI and services.
// ---------------------------------------------------------------------------

/** Convenience: status used by the UI to decide whether to highlight "danger". */
export function isReserved(status: ReservationStatus): boolean {
  return status === 'reserved';
}

/** Convenience: status used to confirm the booking financially. */
export function isConfirmed(status: ReservationStatus): boolean {
  return status === 'confirmed';
}

/** Convenience: status used to track live rentals. */
export function isDelivered(status: ReservationStatus): boolean {
  return status === 'delivered';
}

/** Convenience: status used to track post-return pending close. */
export function isReturned(status: ReservationStatus): boolean {
  return status === 'returned';
}

/** Convenience: terminal status. */
export function isClosed(status: ReservationStatus): boolean {
  return status === 'closed' || status === 'cancelled';
}

/**
 * Return the first blocking reason found in the workflow chain, or 'completed'
 * if everything is done. Used by the dashboard and reservation header to
 * display a one-line "next required action".
 */
export function getReservationNextRequiredAction(ctx: WorkflowContext): string {
  const checks: Array<() => WorkflowDecision> = [
    () => canGenerateContract(ctx),
    () => canGenerateSigningLink(ctx),
    () => canStartPickup(ctx),
    () => canStartReturn(ctx),
    () => canCloseReservation(ctx)
  ];
  for (const check of checks) {
    const d = check();
    if (!d.ok) return d.reason;
  }
  return 'completed';
}

/** True if at least one `workflowExceptions[]` entry exists for the action. */
export function hasWorkflowException(
  ctx: WorkflowContext,
  action: string
): boolean {
  return !!ctx.reservation?.workflowExceptions?.some(e => e.action === action);
}

/**
 * Compose a `WorkflowException` and append it to the reservation. Returns
 * the updated exceptions array; the caller is responsible for writing it.
 */
export function buildWorkflowException(
  action: string,
  reason: string,
  createdBy?: string
): import('@shared/models/reservation.model').WorkflowException {
  if (!reason || reason.trim().length < 3) {
    throw new Error('Motivo de excepción obligatorio (mínimo 3 caracteres)');
  }
  return {
    action,
    reason: reason.trim(),
    createdAt: { seconds: Date.now() / 1000 },
    createdBy
  };
}

/**
 * Resolve a workflow guard, allowing a documented exception when present.
 * Service-layer callers can use this to honour `workflowExceptions`.
 */
export function canWithException(
  decision: WorkflowDecision,
  ctx: WorkflowContext,
  action: string
): WorkflowDecision {
  if (decision.ok) return decision;
  if (hasWorkflowException(ctx, action)) return ALLOW;
  return decision;
}

// ---------------------------------------------------------------------------
// Lightweight re-exports so callers can do `Workflow.canStartPickup(...)`.
// ---------------------------------------------------------------------------

export const Workflow = {
  canGenerateContract,
  canGenerateSigningLink,
  canRegisterPayment,
  canRefundDeposit,
  canRetainDeposit,
  canStartPickup,
  canStartReturn,
  canCloseReservation,
  canCancelReservation,
  getReservationNextRequiredAction,
  canWithException,
  hasWorkflowException,
  buildWorkflowException,
  // Exposed for convenience to service code.
  isDepositSettled,
  isInitialPaid,
  isRemainingPaid
};

export type { ReservationContractStatus };
