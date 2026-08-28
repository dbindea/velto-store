import { describe, expect, it } from 'vitest';
import type { Reservation } from '@shared/models/reservation.model';
import type { Contract } from '@shared/models/contract.model';
import type { Inspection } from '@shared/models/inspection.model';
import {
  buildWorkflowException,
  canCloseReservation,
  canCreateReservationForClient,
  clientTrustWarning,
  canGenerateSigningLink,
  canRefundDeposit,
  canStartPickup,
  canStartReturn,
  canWithException,
  getReservationNextRequiredAction,
  getReservationTimelineSteps,
  reasonOf,
  type WorkflowContext
} from './reservation-workflow.util';

// ---------------------------------------------------------------------------
// Fixtures
//
// The guards only read a handful of fields, so the factories below build the
// smallest reservation that satisfies them and cast once at the boundary.
// ---------------------------------------------------------------------------

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    reservationStatus: 'reserved',
    contractStatus: 'pending',
    paymentStatus: 'pending',
    initialPayment: { requiredAmount: 100, paidAmount: 100 },
    remainingPayment: { requiredAmount: 400, paidAmount: 400 },
    deposit: { requiredAmount: 300, paidAmount: 300, returnedAmount: 0, retainedAmount: 0 },
    ...overrides
  } as unknown as Reservation;
}

const signedContract = { status: 'signed' } as unknown as Contract;
const completedInspection = { status: 'completed' } as unknown as Inspection;

/** A reservation that satisfies every precondition for pickup. */
function readyForPickup(): WorkflowContext {
  return { reservation: makeReservation(), contract: signedContract };
}

describe('canStartPickup', () => {
  it('allows pickup once contract is signed and money is in', () => {
    expect(canStartPickup(readyForPickup()).ok).toBe(true);
  });

  it('blocks pickup while the contract is unsigned', () => {
    const ctx: WorkflowContext = {
      reservation: makeReservation(),
      contract: { status: 'generated' } as unknown as Contract
    };
    expect(reasonOf(canStartPickup(ctx))).toBe('workflow.missingSignature');
  });

  it('blocks pickup when the initial payment is short', () => {
    const ctx = readyForPickup();
    ctx.reservation = makeReservation({
      initialPayment: { requiredAmount: 100, paidAmount: 40 }
    } as Partial<Reservation>);
    ctx.contract = signedContract;
    expect(reasonOf(canStartPickup(ctx))).toBe('workflow.missingInitialPayment');
  });

  it('blocks pickup when the deposit is unpaid', () => {
    const ctx = readyForPickup();
    ctx.reservation = makeReservation({
      deposit: { requiredAmount: 300, paidAmount: 0, returnedAmount: 0, retainedAmount: 0 }
    } as Partial<Reservation>);
    ctx.contract = signedContract;
    expect(reasonOf(canStartPickup(ctx))).toBe('workflow.missingDeposit');
  });

  it('refuses to repeat a completed pickup', () => {
    const ctx = readyForPickup();
    ctx.pickupInspection = completedInspection;
    expect(reasonOf(canStartPickup(ctx))).toBe('workflow.pickupAlreadyCompleted');
  });

  it('treats a waived deposit as settled only when a reason was recorded', () => {
    const waivedNoReason = readyForPickup();
    waivedNoReason.reservation = makeReservation({
      deposit: { requiredAmount: 0, paidAmount: 0, returnedAmount: 0, retainedAmount: 0 }
    } as Partial<Reservation>);
    waivedNoReason.contract = signedContract;
    expect(reasonOf(canStartPickup(waivedNoReason))).toBe('workflow.missingDeposit');

    const waivedWithReason = readyForPickup();
    waivedWithReason.reservation = makeReservation({
      deposit: {
        requiredAmount: 0,
        paidAmount: 0,
        returnedAmount: 0,
        retainedAmount: 0,
        waivedReason: 'Cliente corporativo'
      }
    } as Partial<Reservation>);
    waivedWithReason.contract = signedContract;
    expect(canStartPickup(waivedWithReason).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: the payment overrides on WorkflowContext.
//
// `getReservationTimelineSteps` honoured ctx.initialPaid / ctx.remainingPaid /
// ctx.depositSettled while the guards recomputed them from the reservation and
// ignored the overrides. That let the timeline show a step as done while the
// matching button stayed disabled. Both sides must now agree.
// ---------------------------------------------------------------------------

describe('WorkflowContext payment overrides', () => {
  it('lets an override unblock pickup when the reservation looks unpaid', () => {
    const reservation = makeReservation({
      initialPayment: { requiredAmount: 100, paidAmount: 0 },
      remainingPayment: { requiredAmount: 400, paidAmount: 0 }
    } as Partial<Reservation>);

    expect(canStartPickup({ reservation, contract: signedContract }).ok).toBe(false);

    const withOverrides: WorkflowContext = {
      reservation,
      contract: signedContract,
      initialPaid: true,
      remainingPaid: true
    };
    expect(canStartPickup(withOverrides).ok).toBe(true);
  });

  it('lets an override block pickup when the reservation looks paid', () => {
    const ctx = readyForPickup();
    ctx.initialPaid = false;
    expect(reasonOf(canStartPickup(ctx))).toBe('workflow.missingInitialPayment');
  });

  it('applies the deposit override to canRefundDeposit', () => {
    const reservation = makeReservation({
      deposit: { requiredAmount: 300, paidAmount: 10, returnedAmount: 0, retainedAmount: 0 }
    } as Partial<Reservation>);
    expect(canRefundDeposit({ reservation }).ok).toBe(false);
    expect(canRefundDeposit({ reservation, depositSettled: true }).ok).toBe(true);
  });

  it('keeps the timeline and the guards consistent under the same overrides', () => {
    const ctx: WorkflowContext = {
      reservation: makeReservation({
        initialPayment: { requiredAmount: 100, paidAmount: 0 },
        remainingPayment: { requiredAmount: 400, paidAmount: 0 }
      } as Partial<Reservation>),
      contract: signedContract,
      initialPaid: true,
      remainingPaid: true
    };

    const steps = getReservationTimelineSteps(ctx);
    const initialStep = steps.find(s => s.key === 'initialPaymentPaid');
    const remainingStep = steps.find(s => s.key === 'remainingPaymentPaid');

    // The timeline reads both payment steps as done, so the guard must agree.
    expect(initialStep?.state).toBe('completed');
    expect(remainingStep?.state).toBe('completed');
    expect(canStartPickup(ctx).ok).toBe(true);
  });
});

describe('canStartReturn', () => {
  it('requires the reservation to be delivered', () => {
    const ctx: WorkflowContext = { reservation: makeReservation({ reservationStatus: 'reserved' }) };
    expect(reasonOf(canStartReturn(ctx))).toBe('workflow.cannotReturn');
  });

  it('requires a completed pickup inspection', () => {
    const ctx: WorkflowContext = {
      reservation: makeReservation({ reservationStatus: 'delivered' })
    };
    expect(reasonOf(canStartReturn(ctx))).toBe('workflow.missingPickupInspection');
  });

  it('allows return after a completed pickup', () => {
    const ctx: WorkflowContext = {
      reservation: makeReservation({ reservationStatus: 'delivered' }),
      pickupInspection: completedInspection
    };
    expect(canStartReturn(ctx).ok).toBe(true);
  });
});

describe('canCloseReservation', () => {
  function returned(depositOverrides: Record<string, unknown> = {}): WorkflowContext {
    return {
      reservation: makeReservation({
        reservationStatus: 'returned',
        deposit: {
          requiredAmount: 300,
          paidAmount: 300,
          returnedAmount: 300,
          retainedAmount: 0,
          ...depositOverrides
        }
      } as Partial<Reservation>),
      returnInspection: completedInspection
    };
  }

  it('closes once the deposit is fully resolved', () => {
    expect(canCloseReservation(returned()).ok).toBe(true);
  });

  it('accepts a deposit split between returned and retained', () => {
    expect(canCloseReservation(returned({ returnedAmount: 200, retainedAmount: 100 })).ok).toBe(true);
  });

  it('blocks closing while part of the deposit is unresolved', () => {
    const ctx = returned({ returnedAmount: 100, retainedAmount: 0 });
    expect(reasonOf(canCloseReservation(ctx))).toBe('workflow.unsettledDeposit');
  });

  it('blocks closing without a completed return inspection', () => {
    const ctx = returned();
    ctx.returnInspection = null;
    expect(reasonOf(canCloseReservation(ctx))).toBe('workflow.missingReturnInspection');
  });
});

describe('canGenerateSigningLink', () => {
  it('refuses when there is no contract yet', () => {
    expect(reasonOf(canGenerateSigningLink({ reservation: makeReservation() })))
      .toBe('workflow.missingContract');
  });

  it('refuses to re-issue a link for a signed contract', () => {
    const ctx: WorkflowContext = { reservation: makeReservation(), contract: signedContract };
    expect(reasonOf(canGenerateSigningLink(ctx))).toBe('workflow.contractAlreadySigned');
  });

  it('allows re-issuing while the contract is pending signature', () => {
    const ctx: WorkflowContext = {
      reservation: makeReservation(),
      contract: { status: 'pending_signature' } as unknown as Contract
    };
    expect(canGenerateSigningLink(ctx).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: the "next action" chip pointed backwards.
//
// The first version returned the reason of the first guard that said no. A
// guard also says no when its step is already finished, so a fully paid and
// signed reservation waiting for pickup announced "El contrato ya está
// firmado" instead of "Iniciar entrega".
// ---------------------------------------------------------------------------

describe('getReservationNextRequiredAction', () => {
  it('asks for the contract when there is none', () => {
    expect(getReservationNextRequiredAction({ reservation: makeReservation() }))
      .toBe('workflow.generateContract');
  });

  it('asks for the signing link once the contract exists but is unsigned', () => {
    const ctx: WorkflowContext = {
      reservation: makeReservation(),
      contract: { status: 'generated' } as unknown as Contract
    };
    expect(getReservationNextRequiredAction(ctx)).toBe('workflow.generateSigningLink');
  });

  it('asks for the pickup once signed and fully paid', () => {
    expect(getReservationNextRequiredAction(readyForPickup())).toBe('workflow.startPickup');
  });

  it('explains what is missing instead of naming the action when blocked', () => {
    const ctx = readyForPickup();
    ctx.reservation = makeReservation({
      deposit: { requiredAmount: 300, paidAmount: 0, returnedAmount: 0, retainedAmount: 0 }
    } as Partial<Reservation>);
    ctx.contract = signedContract;
    expect(getReservationNextRequiredAction(ctx)).toBe('workflow.missingDeposit');
  });

  it('asks for the return once the pickup is done', () => {
    const ctx: WorkflowContext = {
      reservation: makeReservation({ reservationStatus: 'delivered' }),
      contract: signedContract,
      pickupInspection: completedInspection
    };
    expect(getReservationNextRequiredAction(ctx)).toBe('workflow.startReturn');
  });

  it('reports completion for a closed reservation', () => {
    const ctx: WorkflowContext = {
      reservation: makeReservation({ reservationStatus: 'closed' }),
      contract: signedContract,
      pickupInspection: completedInspection,
      returnInspection: completedInspection
    };
    expect(getReservationNextRequiredAction(ctx)).toBe('workflow.completed');
  });
});

describe('buildWorkflowException', () => {
  it('requires a reason of at least 3 characters', () => {
    expect(() => buildWorkflowException('startPickup', 'ok')).toThrow();
    expect(() => buildWorkflowException('startPickup', '   ')).toThrow();
  });

  it('trims the stored reason', () => {
    expect(buildWorkflowException('startPickup', '  cliente VIP  ').reason).toBe('cliente VIP');
  });

  it('unblocks a denied guard once recorded on the reservation', () => {
    const denied: WorkflowContext = {
      reservation: makeReservation(),
      contract: { status: 'generated' } as unknown as Contract
    };
    expect(canStartPickup(denied).ok).toBe(false);

    const exception = buildWorkflowException('startPickup', 'Firma en papel');
    const withException: WorkflowContext = {
      ...denied,
      reservation: makeReservation({ workflowExceptions: [exception] } as Partial<Reservation>)
    };
    withException.contract = denied.contract;

    expect(canWithException(canStartPickup(withException), withException, 'startPickup').ok).toBe(true);
  });

  it('does not unblock a different action', () => {
    const exception = buildWorkflowException('startReturn', 'Motivo válido');
    const ctx: WorkflowContext = {
      reservation: makeReservation({ workflowExceptions: [exception] } as Partial<Reservation>),
      contract: { status: 'generated' } as unknown as Contract
    };
    expect(canWithException(canStartPickup(ctx), ctx, 'startPickup').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Customer trust level (M-1)
//
// `blocked` used to mean nothing: it was painted in the client's file and the
// workflow ignored it, so a customer marked "do not rent" could be handed a
// car. These pin down that `blocked` denies and `risk` only warns.
// ---------------------------------------------------------------------------

describe('canCreateReservationForClient', () => {
  it('refuses a blocked customer', () => {
    const decision = canCreateReservationForClient('blocked');
    expect(decision.ok).toBe(false);
    expect(reasonOf(decision)).toBe('workflow.clientBlocked');
  });

  it('allows every other level, including risk', () => {
    for (const level of ['new', 'known', 'regular', 'risk'] as const) {
      expect(canCreateReservationForClient(level).ok).toBe(true);
    }
  });

  it('allows a customer with no level recorded', () => {
    expect(canCreateReservationForClient(undefined).ok).toBe(true);
  });
});

describe('clientTrustWarning', () => {
  it('warns about a risk customer without blocking them', () => {
    expect(clientTrustWarning('risk')).toBe('workflow.clientRisk');
    expect(canCreateReservationForClient('risk').ok).toBe(true);
  });

  it('also has something to say about a blocked one', () => {
    expect(clientTrustWarning('blocked')).toBe('workflow.clientBlocked');
  });

  it('says nothing about an ordinary customer', () => {
    expect(clientTrustWarning('known')).toBe('');
    expect(clientTrustWarning(undefined)).toBe('');
  });
});
