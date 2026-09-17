import { describe, it, expect } from 'vitest';
import { amountProblem, canEditAmount, isGovernedByReservation } from './payment-edit.util';
import type {
  Payment,
  PaymentDirection,
  PaymentStatus,
  PaymentType
} from '@shared/models/payment.model';

function pago(over: Partial<Payment> = {}): Payment {
  return {
    type: 'free_payment' as PaymentType,
    direction: 'income' as PaymentDirection,
    status: 'pending' as PaymentStatus,
    amount: 50,
    paidAmount: 0,
    pendingAmount: 50,
    ...over
  } as Payment;
}

describe('canEditAmount — lo cobrado no se reescribe', () => {
  it('un cobro libre pendiente se puede corregir', () => {
    expect(canEditAmount(pago()).ok).toBe(true);
  });

  it('un cobro libre a medias también: lo que cambia es lo que falta', () => {
    expect(canEditAmount(pago({ status: 'partial', paidAmount: 20, pendingAmount: 30 })).ok).toBe(
      true
    );
  });

  it('uno fallido se puede corregir antes de reintentar', () => {
    expect(canEditAmount(pago({ status: 'failed' })).ok).toBe(true);
  });

  it('uno YA cobrado, no', () => {
    const d = canEditAmount(pago({ status: 'paid', paidAmount: 50, pendingAmount: 0 }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('payments.edit.denied.alreadyPaid');
  });

  it('uno cancelado, no', () => {
    expect(canEditAmount(pago({ status: 'cancelled' })).ok).toBe(false);
  });

  it('uno devuelto, no', () => {
    expect(canEditAmount(pago({ status: 'refunded' })).ok).toBe(false);
  });

  it('sin pago, se dice y no se revienta', () => {
    expect(canEditAmount(null).ok).toBe(false);
    expect(canEditAmount(undefined).ok).toBe(false);
  });
});

describe('canEditAmount — lo que va en la otra dirección', () => {
  it('una devolución de fianza no es un cobro que se corrija aquí', () => {
    const d = canEditAmount(
      pago({ type: 'deposit_refund' as PaymentType, direction: 'refund' as PaymentDirection })
    );
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('payments.edit.denied.notACharge');
  });

  it('una retención tampoco', () => {
    expect(
      canEditAmount(
        pago({
          type: 'deposit_retention' as PaymentType,
          direction: 'retention' as PaymentDirection
        })
      ).ok
    ).toBe(false);
  });
});

describe('canEditAmount — lo que gobierna la reserva', () => {
  // Bajar la señal aquí dejaría la reserva pidiendo 50 y la fila 30.
  it('la señal, el resto, el alquiler completo y la fianza se editan en la reserva', () => {
    for (const t of [
      'initial_payment',
      'remaining_payment',
      'rental_payment',
      'deposit'
    ] as PaymentType[]) {
      const d = canEditAmount(pago({ type: t }));
      expect(d.ok, t).toBe(false);
      expect(d.ok === false && d.reason).toBe('payments.edit.denied.governedByReservation');
    }
  });

  it('un cargo extra NO lo gobierna la reserva: se corrige aquí', () => {
    for (const t of ['extra_damage', 'extra_fuel', 'extra_cleaning'] as PaymentType[]) {
      expect(canEditAmount(pago({ type: t, direction: 'charge' as PaymentDirection })).ok, t).toBe(
        true
      );
    }
  });

  it('isGovernedByReservation los separa igual', () => {
    expect(isGovernedByReservation('deposit' as PaymentType)).toBe(true);
    expect(isGovernedByReservation('free_payment' as PaymentType)).toBe(false);
    expect(isGovernedByReservation('extra_km' as PaymentType)).toBe(false);
  });
});

describe('amountProblem — el hueco no es el cero', () => {
  it('acepta un importe normal', () => {
    expect(amountProblem(35, pago())).toBeNull();
  });

  it('rechaza el vacío, que Number() convertiría en 0', () => {
    expect(amountProblem('', pago())).toBe('payments.edit.problems.required');
    expect(amountProblem(null, pago())).toBe('payments.edit.problems.required');
    expect(amountProblem(undefined, pago())).toBe('payments.edit.problems.required');
  });

  it('rechaza lo que no es número', () => {
    expect(amountProblem('treinta', pago())).toBe('payments.edit.problems.invalid');
  });

  it('rechaza 0 y los negativos: un cobro de 0 € no es un cobro', () => {
    expect(amountProblem(0, pago())).toBe('payments.edit.problems.positive');
    expect(amountProblem(-5, pago())).toBe('payments.edit.problems.positive');
  });

  it('rechaza bajar por debajo de lo ya cobrado', () => {
    // 20 cobrados de 50: corregir a 10 dejaría un pendiente negativo.
    const p = pago({ status: 'partial', paidAmount: 20, pendingAmount: 30 });
    expect(amountProblem(10, p)).toBe('payments.edit.problems.belowCollected');
  });

  it('acepta justo lo ya cobrado: eso cierra el pago', () => {
    const p = pago({ status: 'partial', paidAmount: 20, pendingAmount: 30 });
    expect(amountProblem(20, p)).toBeNull();
  });

  it('acepta subirlo por encima de lo cobrado', () => {
    const p = pago({ status: 'partial', paidAmount: 20, pendingAmount: 30 });
    expect(amountProblem(80, p)).toBeNull();
  });
});
