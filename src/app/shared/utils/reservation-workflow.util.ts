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
import { ClientTrustLevel } from '@shared/models/client.model';

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
// Context-aware resolvers.
//
// `WorkflowContext` lets a caller pass `depositSettled` / `initialPaid` /
// `remainingPaid` already derived from the payments collection, which is
// the source of truth for money. Always read those flags through these
// resolvers: reading the reservation directly makes the guards disagree
// with the timeline, so the operator would see a step marked done while
// the matching button stays disabled.
// ---------------------------------------------------------------------------

function depositSettledOf(ctx: WorkflowContext): boolean {
  return ctx.depositSettled ?? isDepositSettled(ctx.reservation);
}

function initialPaidOf(ctx: WorkflowContext): boolean {
  return ctx.initialPaid ?? isInitialPaid(ctx.reservation);
}

function remainingPaidOf(ctx: WorkflowContext): boolean {
  return ctx.remainingPaid ?? isRemainingPaid(ctx.reservation);
}

// ---------------------------------------------------------------------------
// Guards for every action in the workflow.
// ---------------------------------------------------------------------------

/**
 * Whether a reservation may be created for a customer at this trust level.
 *
 * `blocked` means "do not rent to this person", and until now it meant nothing
 * at all: the level was painted in colour and the workflow ignored it, so the
 * whole point of marking somebody was lost at the one moment it mattered.
 *
 * There is deliberately **no exception mechanism** here, unlike the rest of the
 * workflow. Skipping a step is an operational shortcut; renting to a customer
 * you have blocked is a decision about that customer, and it belongs in their
 * file. The way through is to change their trust level, which is recorded.
 *
 * `risk` does not block — see `clientTrustWarning()`.
 */
export function canCreateReservationForClient(
  trustLevel: ClientTrustLevel | undefined
): WorkflowDecision {
  return trustLevel === 'blocked' ? deny('workflow.clientBlocked') : ALLOW;
}

/**
 * An i18n key warning about the customer, or '' when there is nothing to say.
 *
 * Separate from the guard on purpose: a warning is shown and stepped over, a
 * denial is not. Merging them would mean either blocking `risk` (too strict) or
 * letting `blocked` through with a note (which is what happens today).
 */
export function clientTrustWarning(trustLevel: ClientTrustLevel | undefined): string {
  if (trustLevel === 'blocked') return 'workflow.clientBlocked';
  if (trustLevel === 'risk') return 'workflow.clientRisk';
  return '';
}

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
  if (!depositSettledOf(ctx)) return deny('workflow.unsettledDeposit');
  if ((ctx.reservation.deposit?.paidAmount || 0) <= 0) {
    return deny('workflow.unsettledDeposit');
  }
  return ALLOW;
}

/** Retain all or part of the deposit to cover charges. */
export function canRetainDeposit(ctx: WorkflowContext): WorkflowDecision {
  if (!ctx.reservation) return deny('workflow.missingReservation');
  if (!depositSettledOf(ctx)) return deny('workflow.unsettledDeposit');
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
  if (!initialPaidOf(ctx)) {
    return deny('workflow.missingInitialPayment');
  }
  if (!remainingPaidOf(ctx)) {
    return deny('workflow.missingRemainingPayment');
  }
  if (!depositSettledOf(ctx)) {
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
  if (!remainingPaidOf(ctx)) return deny('workflow.missingRemainingPayment');
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
/**
 * The single thing the operator should do next, as an i18n key.
 *
 * Walks the canonical order and stops at the first step that is NOT already
 * done: if that step is allowed it names the action ("Iniciar entrega"), and if
 * it is blocked it explains what is missing ("Falta cobrar la fianza").
 *
 * The `done` check matters. A previous version just returned the reason of the
 * first guard that said no, but a guard also says no when the step is already
 * finished — so a fully paid, signed reservation ready for pickup reported
 * "El contrato ya está firmado", pointing the operator backwards instead of
 * forwards.
 */
export function getReservationNextRequiredAction(ctx: WorkflowContext): string {
  const r = ctx.reservation;

  const steps: Array<{ done: boolean; decide: () => WorkflowDecision; action: string }> = [
    {
      done: !!ctx.contract,
      decide: () => canGenerateContract(ctx),
      action: 'workflow.generateContract'
    },
    {
      done: ctx.contract?.status === 'signed',
      decide: () => canGenerateSigningLink(ctx),
      action: 'workflow.generateSigningLink'
    },
    {
      done: ctx.pickupInspection?.status === 'completed',
      decide: () => canStartPickup(ctx),
      action: 'workflow.startPickup'
    },
    {
      done: ctx.returnInspection?.status === 'completed',
      decide: () => canStartReturn(ctx),
      action: 'workflow.startReturn'
    },
    {
      done: r?.reservationStatus === 'closed',
      decide: () => canCloseReservation(ctx),
      action: 'workflow.closeReservation'
    }
  ];

  for (const step of steps) {
    if (step.done) continue;
    const decision = step.decide();
    return decision.ok ? step.action : decision.reason;
  }

  return 'workflow.completed';
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
  getReservationTimelineSteps,
  // Exposed for convenience to service code.
  isDepositSettled,
  isInitialPaid,
  isRemainingPaid
};

export type { ReservationContractStatus };

// ---------------------------------------------------------------------------
// Timeline — visual representation of the 10 logical steps of a rental.
// Pure / dependency-free: takes a WorkflowContext (which the parent
// component builds) and returns a typed list of TimelineStep ready
// to render.  The reservation-detail page uses this to power the
// <app-reservation-timeline> component.
// ---------------------------------------------------------------------------

export type TimelineStepKey =
  | 'reservationCreated'
  | 'initialPaymentPaid'
  | 'contractGenerated'
  | 'contractSigned'
  | 'remainingPaymentPaid'
  | 'depositPaid'
  | 'pickupCompleted'
  | 'returnCompleted'
  | 'depositSettled'
  | 'reservationClosed';

export type TimelineStepState =
  | 'completed'
  | 'current'
  | 'pending'
  | 'blocked'
  | 'skipped_by_exception';

export interface TimelineStep {
  key: TimelineStepKey;
  labelKey: string;
  state: TimelineStepState;
  /** Optional i18n key explaining why the step is blocked. */
  blockedReasonKey?: string;
  /** Optional action the operator can take to advance this step. */
  action?:
    | 'pay_initial'
    | 'generate_contract'
    | 'create_signing_link'
    | 'pay_remaining'
    | 'pay_deposit'
    | 'start_pickup'
    | 'start_return'
    | 'settle_deposit'
    | 'close_reservation';
  /** True when the step is associated with a workflow exception. */
  skipped?: boolean;
}

const TIMELINE_ORDER: TimelineStepKey[] = [
  'reservationCreated',
  'initialPaymentPaid',
  'contractGenerated',
  'contractSigned',
  'remainingPaymentPaid',
  'depositPaid',
  'pickupCompleted',
  'returnCompleted',
  'depositSettled',
  'reservationClosed'
];

/**
 * Compute the full timeline for a reservation.
 *
 * The function is tolerant of partial contexts (dashboard mini-cards
 * may not have inspections loaded) — it falls back to the
 * reservation status + contract status to decide completed/pending.
 */
export function getReservationTimelineSteps(ctx: WorkflowContext): TimelineStep[] {
  const r = ctx.reservation;
  const contract = ctx.contract;
  const cancelled = r.reservationStatus === 'cancelled';
  const closed = r.reservationStatus === 'closed';

  const initialPaid = initialPaidOf(ctx);
  const remainingPaid = remainingPaidOf(ctx);
  const depositSettled = depositSettledOf(ctx);

  const pickupDone = !!ctx.pickupInspection;
  const returnDone = !!ctx.returnInspection;

  const contractGenerated = !!contract && contract.status !== 'cancelled' && contract.status !== 'expired';
  const contractSigned = contract?.status === 'signed';

  // ----- Pre-compute next-required-action so we can mark exactly
  // one step as "current" (and the rest as "pending").
  const nextActionKey = getReservationNextRequiredAction(ctx);

  return TIMELINE_ORDER.map((key) => {
    let state: TimelineStepState = 'pending';
    let action: TimelineStep['action'];
    let blockedReasonKey: string | undefined;
    let skipped = false;

    // Step 1 — Reservation created (always completed by virtue of
    // the doc existing).
    if (key === 'reservationCreated') {
      state = 'completed';
    }

    // Step 2 — Initial payment paid.
    if (key === 'initialPaymentPaid') {
      if (initialPaid) state = 'completed';
      else if (nextActionKey === 'workflow.payInitial') {
        state = 'current';
        action = 'pay_initial';
      }
    }

    // Step 3 — Contract generated.
    if (key === 'contractGenerated') {
      if (contractGenerated) state = 'completed';
      else if (nextActionKey === 'workflow.generateContract') {
        state = 'current';
        action = 'generate_contract';
      }
    }

    // Step 4 — Contract signed.
    if (key === 'contractSigned') {
      if (contractSigned) state = 'completed';
      else if (nextActionKey === 'workflow.generateSigningLink' || nextActionKey === 'workflow.contractPending') {
        state = 'current';
        action = 'create_signing_link';
      } else if (contractGenerated && !contractSigned) {
        state = 'pending';
      }
    }

    // Step 5 — Remaining payment paid.
    if (key === 'remainingPaymentPaid') {
      if (remainingPaid) state = 'completed';
      else if (nextActionKey === 'workflow.payRemaining') {
        state = 'current';
        action = 'pay_remaining';
      }
    }

    // Step 6 — Deposit paid.
    if (key === 'depositPaid') {
      if (depositSettled) state = 'completed';
      else if (nextActionKey === 'workflow.payDeposit') {
        state = 'current';
        action = 'pay_deposit';
      }
    }

    // Step 7 — Pickup completed.
    if (key === 'pickupCompleted') {
      if (pickupDone || r.reservationStatus === 'delivered' || closed) {
        state = 'completed';
      } else if (nextActionKey === 'workflow.startPickup') {
        state = 'current';
        action = 'start_pickup';
      } else if (contractSigned && remainingPaid && depositSettled) {
        // Ready but not started yet — pending.
        state = 'pending';
      } else {
        state = 'blocked';
        blockedReasonKey = 'workflow.blockedPickup';
      }
    }

    // Step 8 — Return completed.
    if (key === 'returnCompleted') {
      if (returnDone || closed) {
        state = 'completed';
      } else if (nextActionKey === 'workflow.startReturn') {
        state = 'current';
        action = 'start_return';
      } else if (r.reservationStatus === 'delivered') {
        state = 'pending';
      } else {
        state = 'blocked';
        blockedReasonKey = 'workflow.blockedReturn';
      }
    }

    // Step 9 — Deposit settled (refunded or retained).
    if (key === 'depositSettled') {
      if (depositSettled && (returnDone || closed)) state = 'completed';
      else if (nextActionKey === 'workflow.settleDeposit') {
        state = 'current';
        action = 'settle_deposit';
      } else if (returnDone) {
        state = 'pending';
      } else {
        state = 'blocked';
        blockedReasonKey = 'workflow.blockedSettleDeposit';
      }
    }

    // Step 10 — Reservation closed.
    if (key === 'reservationClosed') {
      if (closed) state = 'completed';
      else if (nextActionKey === 'workflow.closeReservation') {
        state = 'current';
        action = 'close_reservation';
      } else {
        state = 'blocked';
        blockedReasonKey = 'workflow.blockedClose';
      }
    }

    // Mark cancelled reservation steps as "skipped" so the UI
    // can render them as struck-through.  Closed reservations are
    // fully completed.
    if (cancelled && state === 'pending') {
      state = 'skipped_by_exception';
      skipped = true;
    }

    return {
      key,
      // Composed key: every TimelineStepKey must have a matching leaf under
      // reservations.timeline.* in the three locale files.
      labelKey: `reservations.timeline.${key}`,
      state,
      action,
      blockedReasonKey,
      skipped
    };
  });
}
