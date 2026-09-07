import { describe, expect, it } from 'vitest';
import type { Payment, PaymentStatus, PaymentType } from '@shared/models/payment.model';
import type { Reservation } from '@shared/models/reservation.model';
import {
  applySettlement,
  distributeRentalPayment,
  calculateReservationPaymentSummary,
  collectedTotalsOf,
  distributeRetentionAcrossCharges,
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

/**
 * El reparto de la fianza retenida entre los cargos de la devolución.
 *
 * Nace de un fallo real (M-33): los cargos se creaban marcados como pagados
 * «asumiendo» que ya se habían cobrado, así que todo lo que excediera de la
 * fianza desaparecía sin dejar rastro.
 */
describe('distributeRetentionAcrossCharges', () => {
  it('reparte de mayor a menor y deja pendiente lo que no cubre', () => {
    // El caso encontrado en el recorrido del 31 de agosto: 172,50 € de cargos
    // contra 150 € de fianza. Faltan 22,50 € y tienen que quedar a deber.
    const aplicado = distributeRetentionAcrossCharges(
      [
        { id: 'km', amount: 62.5 },
        { id: 'limpieza', amount: 30 },
        { id: 'daños', amount: 80 }
      ],
      150
    );

    expect(aplicado).toEqual([
      { id: 'daños', apply: 80 },
      { id: 'km', apply: 62.5 },
      { id: 'limpieza', apply: 7.5 }
    ]);

    const total = aplicado.reduce((s, a) => s + a.apply, 0);
    expect(total).toBe(150);
  });

  it('con la fianza a 0 no da por cobrado ningún cargo', () => {
    // El caso peor: al cliente conocido no se le pide fianza, así que nada
    // cubre los cargos y todos deben quedar pendientes.
    expect(distributeRetentionAcrossCharges([{ id: 'daños', amount: 200 }], 0)).toEqual([]);
  });

  it('no reparte más de lo retenido aunque sobre fianza', () => {
    const aplicado = distributeRetentionAcrossCharges([{ id: 'km', amount: 20 }], 150);
    expect(aplicado).toEqual([{ id: 'km', apply: 20 }]);
  });

  it('no deja céntimos de coma flotante', () => {
    // 108.9 - 50 es 58.900000000000006 sin redondear.
    const aplicado = distributeRetentionAcrossCharges(
      [{ id: 'a', amount: 108.9 }, { id: 'b', amount: 33.3 }],
      50
    );
    expect(aplicado).toEqual([{ id: 'a', apply: 50 }]);
  });

  it('ignora cargos a cero', () => {
    expect(distributeRetentionAcrossCharges([{ id: 'x', amount: 0 }], 100)).toEqual([]);
  });
});

/**
 * Devengado contra cobrado en los cargos extra.
 *
 * Existe porque la ficha enseñaba `extrasTotal` —lo **cobrado**— bajo la
 * etiqueta «Cargos extra», así que una devolución con 145 € en daños, limpieza
 * y combustible sin cobrar mostraba «0,00 €» con las tres filas justo debajo.
 * Un cero que significa «aún nada cobrado» y otro que significa «no se debe
 * nada» no se pueden pintar igual cuando hay dinero de por medio.
 */
describe('calculateReservationPaymentSummary · cargos extra', () => {
  const reserva = {
    pricingSnapshot: { finalPrice: 1 },
    initialPayment: { requiredAmount: 1 },
    deposit: { requiredAmount: 0, waivedReason: 'Cliente conocido' }
  } as unknown as Reservation;

  it('separa lo devengado de lo cobrado y deja ver la deuda', () => {
    const resumen = calculateReservationPaymentSummary(
      [
        makePayment('initial_payment', 'paid', 1, 1),
        makePayment('extra_fuel', 'pending', 15, 0, 'f'),
        makePayment('extra_cleaning', 'pending', 10, 0, 'c'),
        makePayment('extra_damage', 'pending', 120, 0, 'd')
      ],
      reserva
    );

    expect(resumen.extrasTotal).toBe(0);
    expect(resumen.extrasRequired).toBe(145);
    expect(resumen.extrasPending).toBe(145);
    // Y el alquiler no puede anunciarse como pagado debiendo los cargos.
    expect(resumen.paymentStatus).not.toBe('paid');
  });

  it('baja lo pendiente según se cobra, sin tocar lo devengado', () => {
    const resumen = calculateReservationPaymentSummary(
      [
        makePayment('initial_payment', 'paid', 1, 1),
        makePayment('extra_damage', 'partial', 120, 45, 'd')
      ],
      reserva
    );

    expect(resumen.extrasRequired).toBe(120);
    expect(resumen.extrasTotal).toBe(45);
    expect(resumen.extrasPending).toBe(75);
  });

  it('deja los tres a cero cuando no hubo cargos', () => {
    const resumen = calculateReservationPaymentSummary(
      [makePayment('initial_payment', 'paid', 1, 1)],
      reserva
    );

    expect(resumen.extrasRequired).toBe(0);
    expect(resumen.extrasPending).toBe(0);
    expect(resumen.paymentStatus).toBe('paid');
  });
});

/**
 * «Pago completo del alquiler» (D-5).
 *
 * El concepto existía en el desplegable y era una trampa: creaba una fila
 * propia y dejaba señal y resto pendientes para siempre. El dinero contaba como
 * ingreso pero no para el estado de pago ni para `remainingPaid`, así que la
 * reserva se cobraba entera y **no se podía cerrar nunca**.
 */
describe('distributeRentalPayment', () => {
  const sembradas = () => [
    makePayment('initial_payment', 'pending', 100, 0, 'senal'),
    makePayment('remaining_payment', 'pending', 250, 0, 'resto')
  ];

  it('salda la señal y el resto con un solo cobro', () => {
    const { steps, leftover } = distributeRentalPayment(sembradas(), 350);
    expect(steps).toEqual([
      { paymentId: 'senal', apply: 100 },
      { paymentId: 'resto', apply: 250 }
    ]);
    expect(leftover).toBe(0);
  });

  it('paga primero la señal cuando no llega para las dos', () => {
    // El orden es el del alquiler: lo que entra salda antes lo que se debía
    // antes.
    const { steps, leftover } = distributeRentalPayment(sembradas(), 120);
    expect(steps).toEqual([
      { paymentId: 'senal', apply: 100 },
      { paymentId: 'resto', apply: 20 }
    ]);
    expect(leftover).toBe(0);
  });

  it('no toca lo ya cobrado y completa lo que falta', () => {
    const payments = [
      makePayment('initial_payment', 'paid', 100, 100, 'senal'),
      makePayment('remaining_payment', 'partial', 250, 50, 'resto')
    ];
    const { steps, leftover } = distributeRentalPayment(payments, 200);
    expect(steps).toEqual([{ paymentId: 'resto', apply: 200 }]);
    expect(leftover).toBe(0);
  });

  it('devuelve el sobrante en vez de tragárselo', () => {
    // Es dinero que el cliente ha entregado: el llamante le abre fila propia.
    const { steps, leftover } = distributeRentalPayment(sembradas(), 400);
    expect(steps).toHaveLength(2);
    expect(leftover).toBe(50);
  });

  it('devuelve todo como sobrante si no hay nada que saldar', () => {
    const payments = [
      makePayment('initial_payment', 'paid', 100, 100, 'senal'),
      makePayment('remaining_payment', 'paid', 250, 250, 'resto')
    ];
    const { steps, leftover } = distributeRentalPayment(payments, 80);
    expect(steps).toEqual([]);
    expect(leftover).toBe(80);
  });

  it('ignora las filas canceladas', () => {
    const payments = [
      { ...makePayment('initial_payment', 'cancelled', 100, 0, 'senal') },
      makePayment('remaining_payment', 'pending', 250, 0, 'resto')
    ];
    const { steps } = distributeRentalPayment(payments, 250);
    expect(steps).toEqual([{ paymentId: 'resto', apply: 250 }]);
  });

  it('redondea a céntimos en vez de arrastrar coma flotante', () => {
    const payments = [makePayment('initial_payment', 'pending', 108.9, 50, 'senal')];
    const { steps, leftover } = distributeRentalPayment(payments, 108.9);
    // 108.9 - 50 es 58.900000000000006 sin redondear.
    expect(steps).toEqual([{ paymentId: 'senal', apply: 58.9 }]);
    expect(leftover).toBe(50);
  });

  it('tras repartirlo, la reserva queda pagada y se puede cerrar', () => {
    // La razón de ser del arreglo: el estado depende de las filas sembradas.
    const reserva = {
      pricingSnapshot: { finalPrice: 350 },
      initialPayment: { requiredAmount: 100 },
      remainingPayment: { requiredAmount: 250 },
      deposit: { requiredAmount: 0, waivedReason: 'Conocido' }
    } as unknown as Reservation;

    const resumen = calculateReservationPaymentSummary(
      [
        makePayment('initial_payment', 'paid', 100, 100, 'senal'),
        makePayment('remaining_payment', 'paid', 250, 250, 'resto')
      ],
      reserva
    );

    expect(resumen.paymentStatus).toBe('paid');
    expect(resumen.remainingPaymentPaid).toBe(250);
  });
});
