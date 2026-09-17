import { describe, it, expect } from 'vitest';
import {
  canEditField,
  canResignContract,
  movedOn,
  initialPaymentProblem,
  redistributeInitialPayment,
  requiresNewContract,
  EditContext
} from './reservation-edit.util';
import type { Reservation, ReservationStatus } from '@shared/models/reservation.model';
import type { Contract, ContractStatus } from '@shared/models/contract.model';
import type { Payment, PaymentType, PaymentStatus } from '@shared/models/payment.model';

function reserva(status: ReservationStatus): Reservation {
  return { id: 'R1', reservationStatus: status } as Reservation;
}

function contrato(status: ContractStatus): Contract {
  return { id: 'C1', status } as Contract;
}

function pago(
  type: PaymentType,
  status: PaymentStatus,
  paidAmount: number,
  refundedAmount?: number
): Payment {
  return { type, status, paidAmount, refundedAmount } as Payment;
}

function ctx(over: Partial<EditContext> = {}): EditContext {
  return {
    reservation: reserva('confirmed'),
    contract: null,
    payments: [],
    canEditPricing: true,
    ...over
  };
}

describe('canEditField — lo terminal no se toca', () => {
  it('deniega todos los campos en una reserva cerrada', () => {
    const c = ctx({ reservation: reserva('closed') });
    for (const campo of [
      'client',
      'pickupDateTime',
      'returnDateTime',
      'agreedPrice',
      'depositAmount',
      'initialPaymentAmount',
      'additionalDrivers'
    ] as const) {
      const d = canEditField(campo, c);
      expect(d.ok, `${campo} debería estar denegado`).toBe(false);
    }
  });

  it('deniega todo en una reserva cancelada, con su propio motivo', () => {
    const d = canEditField('returnDateTime', ctx({ reservation: reserva('cancelled') }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('reservations.edit.denied.cancelled');
  });
});

describe('canEditField — las fechas NO se comportan igual', () => {
  // Es el motivo entero de que la decisión sea por campo.
  it('con el coche entregado, la recogida se bloquea y la devolución NO', () => {
    const c = ctx({ reservation: reserva('delivered') });
    expect(canEditField('pickupDateTime', c).ok).toBe(false);
    expect(canEditField('returnDateTime', c).ok).toBe(true);
  });

  it('una prórroga sigue siendo posible con el coche fuera', () => {
    expect(canEditField('returnDateTime', ctx({ reservation: reserva('delivered') })).ok).toBe(true);
  });

  it('devuelto el coche, la fecha la pone el parte y ya no se mueve', () => {
    const d = canEditField('returnDateTime', ctx({ reservation: reserva('returned') }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('reservations.edit.denied.returned');
  });

  it('antes de entregar, las dos fechas se pueden mover', () => {
    const c = ctx({ reservation: reserva('confirmed') });
    expect(canEditField('pickupDateTime', c).ok).toBe(true);
    expect(canEditField('returnDateTime', c).ok).toBe(true);
  });
});

describe('canEditField — el cliente es quien firma', () => {
  it('con el contrato firmado no se puede cambiar', () => {
    const d = canEditField('client', ctx({ contract: contrato('signed') }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('reservations.edit.denied.contractSigned');
  });

  it('con el contrato generado pero SIN firmar, sí', () => {
    expect(canEditField('client', ctx({ contract: contrato('generated') })).ok).toBe(true);
  });

  it('con el coche entregado, no: a esa persona se le dio el coche', () => {
    expect(canEditField('client', ctx({ reservation: reserva('delivered') })).ok).toBe(false);
  });
});

describe('canEditField — el precio lo gobierna editPricing', () => {
  it('sin el permiso se deniega, aunque la reserva esté recién creada', () => {
    const d = canEditField('agreedPrice', ctx({ canEditPricing: false }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('reservations.edit.denied.noPricingPermission');
  });

  it('con el permiso se permite incluso con el coche fuera: una prórroga cambia el precio', () => {
    expect(
      canEditField('agreedPrice', ctx({ reservation: reserva('delivered'), canEditPricing: true }))
        .ok
    ).toBe(true);
  });
});

describe('canEditField — el dinero se decide mirando los pagos', () => {
  it('la fianza se puede cambiar mientras no se haya movido nada', () => {
    expect(canEditField('depositAmount', ctx({ payments: [] })).ok).toBe(true);
  });

  it('cobrada la fianza, ya no', () => {
    const c = ctx({ payments: [pago('deposit', 'paid', 150)] });
    const d = canEditField('depositAmount', c);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('reservations.edit.denied.depositCollected');
  });

  it('cobrada y DEVUELTA entera tampoco: al cliente se le cobraron 150', () => {
    // El neto es 0, pero el dinero se movió. Con la regla del neto, aquí se
    // habría podido cambiar el importe exigido y la reserva pasaría a decir que
    // pedía otra cosa distinta de la que se cobró y se devolvió.
    const c = ctx({
      payments: [pago('deposit', 'paid', 150), pago('deposit_refund', 'paid', 150)]
    });
    expect(canEditField('depositAmount', c).ok).toBe(false);
  });

  it('una fila de fianza CANCELADA no cuenta como cobro', () => {
    const c = ctx({ payments: [pago('deposit', 'cancelled', 0)] });
    expect(canEditField('depositAmount', c).ok).toBe(true);
  });

  it('la señal se puede cambiar mientras esté pendiente', () => {
    const c = ctx({ payments: [pago('initial_payment', 'pending', 0)] });
    expect(canEditField('initialPaymentAmount', c).ok).toBe(true);
  });

  it('cobrada a medias, la señal ya no es un importe a pactar', () => {
    const c = ctx({ payments: [pago('initial_payment', 'partial', 20)] });
    const d = canEditField('initialPaymentAmount', c);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('reservations.edit.denied.initialCollected');
  });

  it('sin saber los pagos NO se afirma que algo está libre', () => {
    // Es lo contrario de lo que haría `paymentSummary`, que respondería 0.
    const d = canEditField('depositAmount', ctx({ payments: null }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('reservations.edit.denied.paymentsUnknown');
  });
});

describe('movedOn — mide movimiento, no saldo', () => {
  it('una devolución cuenta como movimiento, no se resta', () => {
    // Es lo contrario de `sumPaid()`, y a propósito: allí la pregunta es cuánto
    // entró, aquí si ha pasado algo.
    expect(
      movedOn([pago('deposit', 'paid', 150), pago('deposit_refund', 'paid', 150)], [
        'deposit',
        'deposit_refund'
      ])
    ).toBe(300);
  });

  it('suma varias filas del mismo tipo', () => {
    expect(
      movedOn(
        [pago('initial_payment', 'paid', 30), pago('initial_payment', 'paid', 20)],
        ['initial_payment']
      )
    ).toBe(50);
  });

  it('ignora los tipos que no se le piden', () => {
    expect(movedOn([pago('deposit', 'paid', 150)], ['initial_payment'])).toBe(0);
  });

  it('una fila cancelada no cuenta aunque llevara importe', () => {
    expect(movedOn([pago('deposit', 'cancelled', 150)], ['deposit'])).toBe(0);
  });

  it('sin filas, cero', () => {
    expect(movedOn([], ['deposit'])).toBe(0);
  });
});

describe('requiresNewContract — solo lo que va impreso', () => {
  it('los conductores obligan a volver a firmar', () => {
    expect(requiresNewContract(['additionalDrivers'])).toBe(true);
  });

  it('el cliente, las fechas, el precio y la fianza también', () => {
    for (const f of ['client', 'pickupDateTime', 'returnDateTime', 'agreedPrice', 'depositAmount'] as const) {
      expect(requiresNewContract([f]), f).toBe(true);
    }
  });

  it('la señal NO: el contrato imprime el precio, no el calendario de cobros', () => {
    expect(requiresNewContract(['initialPaymentAmount'])).toBe(false);
  });

  it('sin cambios, no hace falta nada', () => {
    expect(requiresNewContract([])).toBe(false);
  });
});

describe('canResignContract', () => {
  it('permite sustituir un contrato firmado en una reserva viva', () => {
    expect(canResignContract(ctx({ contract: contrato('signed') })).ok).toBe(true);
  });

  it('no hay nada que sustituir si no está firmado', () => {
    const d = canResignContract(ctx({ contract: contrato('generated') }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('reservations.edit.denied.notSigned');
  });

  it('con el coche ya devuelto, no: el alquiler terminó', () => {
    const d = canResignContract(
      ctx({ reservation: reserva('returned'), contract: contrato('signed') })
    );
    expect(d.ok).toBe(false);
  });

  it('sin contrato, lo dice el workflow', () => {
    const d = canResignContract(ctx({ contract: null }));
    expect(d.ok === false && d.reason).toBe('workflow.missingContract');
  });
});

describe('redistributeInitialPayment — el total es invariante', () => {
  it('bajar la señal sube el resto en la misma cantidad', () => {
    // El caso que puso Dorel: 50 → 30, y los 20 van al resto.
    expect(redistributeInitialPayment(363, 30)).toEqual({ initial: 30, remaining: 333 });
  });

  it('una señal de 0 es válida: no se pide señal', () => {
    expect(redistributeInitialPayment(363, 0)).toEqual({ initial: 0, remaining: 363 });
  });

  it('una señal igual al total deja el resto en 0', () => {
    expect(redistributeInitialPayment(363, 363)).toEqual({ initial: 363, remaining: 0 });
  });

  it('nunca pasa del total, aunque se pida de más', () => {
    expect(redistributeInitialPayment(363, 500)).toEqual({ initial: 363, remaining: 0 });
  });

  it('redondea el derivado: 108,9 − 50 no es 58,900000000000006', () => {
    expect(redistributeInitialPayment(108.9, 50)).toEqual({ initial: 50, remaining: 58.9 });
  });

  it('la suma de los dos cuadra al céntimo', () => {
    const { initial, remaining } = redistributeInitialPayment(1234.56, 411.52);
    expect(Math.round((initial + remaining) * 100) / 100).toBe(1234.56);
  });
});

describe('initialPaymentProblem — el hueco no es el cero', () => {
  it('acepta 0: significa que no se pide señal', () => {
    expect(initialPaymentProblem(0, 363)).toBeNull();
  });

  it('rechaza el vacío, que Number() convertiría en 0 sin avisar', () => {
    expect(initialPaymentProblem('', 363)).toBe('reservations.edit.problems.initialRequired');
    expect(initialPaymentProblem(null, 363)).toBe('reservations.edit.problems.initialRequired');
    expect(initialPaymentProblem(undefined, 363)).toBe(
      'reservations.edit.problems.initialRequired'
    );
  });

  it('rechaza lo que no es un número', () => {
    expect(initialPaymentProblem('treinta', 363)).toBe(
      'reservations.edit.problems.initialInvalid'
    );
  });

  it('rechaza un importe negativo', () => {
    expect(initialPaymentProblem(-5, 363)).toBe('reservations.edit.problems.initialNegative');
  });

  it('rechaza una señal mayor que el total', () => {
    expect(initialPaymentProblem(400, 363)).toBe('reservations.edit.problems.initialOverTotal');
  });

  it('acepta una señal exactamente igual al total', () => {
    expect(initialPaymentProblem(363, 363)).toBeNull();
  });
});
