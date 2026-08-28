import { describe, expect, it } from 'vitest';
import type { Payment, PaymentStatus, PaymentType } from '@shared/models/payment.model';
import {
  applySettlement,
  collectedTotalsOf,
  selectSettleablePayment
} from './payment-summary.util';

// ---------------------------------------------------------------------------
// Fixtures
//
// Only `type`, `status` and the two amounts matter here, so the factory builds
// the smallest payment that satisfies the helpers and casts once.
// ---------------------------------------------------------------------------

function makePayment(
  type: PaymentType,
  status: PaymentStatus,
  amount = 100,
  paidAmount = 0,
  id = `${type}-${status}`
): Payment {
  return { id, type, status, amount, paidAmount } as unknown as Payment;
}

describe('selectSettleablePayment', () => {
  it('picks the seeded pending row of the requested type', () => {
    const payments = [
      makePayment('initial_payment', 'pending', 350),
      makePayment('remaining_payment', 'pending', 300),
      makePayment('deposit', 'pending', 150)
    ];
    expect(selectSettleablePayment(payments, 'deposit')?.id).toBe('deposit-pending');
  });

  it('tops up a partially collected row instead of opening a new one', () => {
    const payments = [makePayment('remaining_payment', 'partial', 300, 100)];
    expect(selectSettleablePayment(payments, 'remaining_payment')?.status).toBe('partial');
  });

  it('returns null when the concept is already paid', () => {
    const payments = [makePayment('initial_payment', 'paid', 350, 350)];
    expect(selectSettleablePayment(payments, 'initial_payment')).toBeNull();
  });

  it('returns null for concepts that are never seeded', () => {
    const payments = [makePayment('initial_payment', 'pending', 350)];
    expect(selectSettleablePayment(payments, 'extra_damage')).toBeNull();
  });

  it('ignores cancelled rows', () => {
    const payments = [makePayment('deposit', 'cancelled', 150)];
    expect(selectSettleablePayment(payments, 'deposit')).toBeNull();
  });

  it('takes the oldest open row when the same concept has several', () => {
    const payments = [
      makePayment('deposit', 'pending', 150, 0, 'first'),
      makePayment('deposit', 'pending', 150, 0, 'second')
    ];
    expect(selectSettleablePayment(payments, 'deposit')?.id).toBe('first');
  });
});

describe('applySettlement', () => {
  it('marks a seeded row paid when the full amount comes in', () => {
    expect(applySettlement({ amount: 350, paidAmount: 0 }, 350)).toEqual({
      amount: 350,
      paidAmount: 350,
      pendingAmount: 0,
      status: 'paid'
    });
  });

  it('leaves a short collection as partial', () => {
    expect(applySettlement({ amount: 300, paidAmount: 0 }, 100)).toEqual({
      amount: 300,
      paidAmount: 100,
      pendingAmount: 200,
      status: 'partial'
    });
  });

  it('accumulates rather than replacing, so two collections close the row', () => {
    const first = applySettlement({ amount: 300, paidAmount: 0 }, 100);
    const second = applySettlement(first, 200);
    expect(second.paidAmount).toBe(300);
    expect(second.status).toBe('paid');
    expect(second.pendingAmount).toBe(0);
  });

  it('grows the expected amount on over-collection so nothing goes negative', () => {
    expect(applySettlement({ amount: 350, paidAmount: 0 }, 400)).toEqual({
      amount: 400,
      paidAmount: 400,
      pendingAmount: 0,
      status: 'paid'
    });
  });

  it('rounds to cents instead of dragging floating point noise', () => {
    const result = applySettlement({ amount: 100, paidAmount: 0.1 }, 0.2);
    expect(result.paidAmount).toBe(0.3);
    expect(result.pendingAmount).toBe(99.7);
  });
});

// ---------------------------------------------------------------------------
// Income vs deposit movements (M-15)
//
// The reservation screen used to add up every `paidAmount` on the reservation
// and call it "Total pagado": 693 € on a rental of 350 €, because it counted
// the deposit, the part retained out of it, and the part handed back to the
// customer — money leaving — as income.
// ---------------------------------------------------------------------------

describe('collectedTotalsOf', () => {
  /** The closed reservation from the 21 Aug test run, payment by payment. */
  const closedReservation: Payment[] = [
    makePayment('initial_payment', 'paid', 50, 50, 'signal'),
    makePayment('remaining_payment', 'paid', 300, 300, 'balance'),
    makePayment('deposit', 'paid', 150, 150, 'deposit'),
    makePayment('extra_fuel', 'paid', 18, 18, 'fuel'),
    makePayment('extra_cleaning', 'paid', 25, 25, 'cleaning'),
    makePayment('deposit_retention', 'paid', 43, 43, 'retention'),
    makePayment('deposit_refund', 'paid', 107, 107, 'refund')
  ];

  it('counts the rental and its extras, and nothing else, as income', () => {
    const totals = collectedTotalsOf(closedReservation);
    expect(totals.rental).toBe(350);
    expect(totals.extras).toBe(43);
    expect(totals.income).toBe(393);
  });

  it('never lets a refund inflate what was collected', () => {
    // The old figure. If this ever comes back, it comes back here first.
    const everything = closedReservation.reduce((sum, p) => sum + p.paidAmount, 0);
    expect(everything).toBe(693);
    expect(collectedTotalsOf(closedReservation).income).toBeLessThan(everything);
  });

  it('does not bill the retention twice on top of the charges it covers', () => {
    const totals = collectedTotalsOf(closedReservation);
    expect(totals.depositRetained).toBe(43);
    expect(totals.income).toBe(totals.rental + totals.extras);
  });

  it('reports the deposit as its own movements', () => {
    const totals = collectedTotalsOf(closedReservation);
    expect(totals.depositCollected).toBe(150);
    expect(totals.depositReturned).toBe(107);
    expect(totals.depositHeld).toBe(0);
  });

  it('keeps the deposit still held when nothing has been resolved yet', () => {
    const totals = collectedTotalsOf([makePayment('deposit', 'paid', 150, 150)]);
    expect(totals.depositHeld).toBe(150);
    expect(totals.income).toBe(0);
  });

  it('counts a one-off full rental payment and a free collection as income', () => {
    const totals = collectedTotalsOf([
      makePayment('rental_payment', 'paid', 400, 400, 'full'),
      makePayment('free_payment', 'paid', 20, 20, 'free')
    ]);
    expect(totals.rental).toBe(400);
    expect(totals.other).toBe(20);
    expect(totals.income).toBe(420);
  });

  it('ignores cancelled rows', () => {
    const totals = collectedTotalsOf([
      makePayment('initial_payment', 'paid', 50, 50, 'ok'),
      makePayment('initial_payment', 'cancelled', 50, 50, 'void')
    ]);
    expect(totals.income).toBe(50);
  });
});
