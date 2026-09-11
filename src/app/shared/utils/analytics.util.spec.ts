import { describe, expect, it } from 'vitest';
import {
  daysInRange,
  isRevenue,
  monthlyRevenue,
  netFromGross,
  occupancy,
  repeatClientStats,
  revenueByMethod,
  revenueByVehicle,
  revenuePerRentalDay,
  revenuePayments,
  sumPaid,
  topClients,
  vatRateOf,
  yearToDate
} from './analytics.util';
import type { Payment, PaymentMethod, PaymentType } from '@shared/models/payment.model';
import type { Reservation } from '@shared/models/reservation.model';

const cobro = (
  type: PaymentType,
  paidAmount: number,
  iso: string,
  extra: Partial<Payment> = {}
): Payment =>
  ({
    type,
    method: 'cash' as PaymentMethod,
    status: 'paid',
    amount: paidAmount,
    paidAmount,
    paidAt: new Date(iso),
    concept: type,
    ...extra
  }) as unknown as Payment;

const reserva = (extra: Partial<Reservation> = {}): Reservation =>
  ({
    reservationStatus: 'closed',
    totalDays: 3,
    pickupDateTime: new Date('2026-05-10T10:00:00'),
    ...extra
  }) as unknown as Reservation;

const RANGO = { from: new Date('2026-01-01T00:00:00'), to: new Date('2026-12-31T23:59:59') };

describe('qué cuenta como ingreso', () => {
  it('el alquiler y sus plazos, sí', () => {
    expect(isRevenue(cobro('initial_payment', 50, '2026-03-01T10:00:00'))).toBe(true);
    expect(isRevenue(cobro('remaining_payment', 150, '2026-03-05T10:00:00'))).toBe(true);
    expect(isRevenue(cobro('rental_payment', 200, '2026-03-05T10:00:00'))).toBe(true);
  });

  it('los cargos extra también: son dinero de la empresa', () => {
    expect(isRevenue(cobro('extra_fuel', 30, '2026-03-10T10:00:00'))).toBe(true);
    expect(isRevenue(cobro('extra_damage', 145, '2026-03-10T10:00:00'))).toBe(true);
  });

  /**
   * ⚠️ **El fallo que tenía el informe anterior.** Una fianza es dinero del
   * cliente que la empresa custodia y devuelve: no es suyo. Contarla infla los
   * ingresos, y contar además su devolución los infla otra vez — 300 € cobrados
   * y devueltos sumaban 600 € de «facturación».
   */
  it('la FIANZA no, y su devolución tampoco', () => {
    expect(isRevenue(cobro('deposit', 300, '2026-03-01T10:00:00'))).toBe(false);
    expect(isRevenue(cobro('deposit_refund', 300, '2026-03-20T10:00:00'))).toBe(false);
  });

  it('una fianza cobrada y devuelta suma CERO, no 600', () => {
    const pagos = [
      cobro('deposit', 300, '2026-03-01T10:00:00'),
      cobro('deposit_refund', 300, '2026-03-20T10:00:00')
    ];
    expect(sumPaid(revenuePayments(pagos, RANGO))).toBe(0);
  });

  /**
   * ⚠️ Y la RETENCIÓN sí: es la parte de la fianza que se queda la empresa para
   * cubrir un daño, y no vuelve al cliente.
   */
  it('la retención de fianza SÍ es ingreso', () => {
    expect(isRevenue(cobro('deposit_retention', 145, '2026-03-20T10:00:00'))).toBe(true);
  });

  it('lo que no está cobrado no cuenta', () => {
    const p = cobro('rental_payment', 0, '2026-03-01T10:00:00', {
      status: 'pending',
      paidAmount: 0
    } as Partial<Payment>);
    expect(isRevenue(p)).toBe(false);
  });

  it('ni lo cancelado ni lo fallido', () => {
    expect(isRevenue(cobro('rental_payment', 100, '2026-03-01T10:00:00', { status: 'cancelled' } as Partial<Payment>))).toBe(false);
    expect(isRevenue(cobro('rental_payment', 100, '2026-03-01T10:00:00', { status: 'failed' } as Partial<Payment>))).toBe(false);
  });
});

describe('el rango por defecto', () => {
  it('va del 1 de enero de este año hasta hoy, incluido', () => {
    const r = yearToDate(new Date('2026-09-10T14:00:00'));
    expect(r.from.getMonth()).toBe(0);
    expect(r.from.getDate()).toBe(1);
    expect(r.from.getFullYear()).toBe(2026);
    // ⚠️ Hasta el final del día: un cobro de esta tarde tiene que entrar.
    expect(r.to.getHours()).toBe(23);
  });

  it('un cobro de hoy por la tarde entra en el rango', () => {
    const r = yearToDate(new Date('2026-09-10T09:00:00'));
    const p = cobro('rental_payment', 100, '2026-09-10T20:00:00');
    expect(revenuePayments([p], r)).toHaveLength(1);
  });
});

describe('el IVA', () => {
  /**
   * ⚠️ **Se EXTRAE, no se resta un porcentaje.** La base de 121 € al 21 % son
   * 100 €, no 121 menos el 21 % (que daría 95,59). Confundirlo no da un error:
   * da una cifra creíble y equivocada.
   */
  it('la base se extrae del bruto', () => {
    expect(netFromGross(121, 0.21)).toBe(100);
    expect(netFromGross(121, 0.21)).not.toBe(121 * 0.79);
  });

  it('sin IVA, la base es el propio importe', () => {
    expect(netFromGross(100, 0)).toBe(100);
  });

  /** El tipo se lee de la reserva, donde está congelado. */
  it('el tipo sale de la reserva del cobro, no del general', () => {
    const reservas = new Map([['r1', reserva({ pricingSnapshot: { vatRate: 0.1 } } as Partial<Reservation>)]]);
    const p = cobro('rental_payment', 110, '2026-03-01T10:00:00', { reservationId: 'r1' } as Partial<Payment>);
    expect(vatRateOf(p, reservas, 0.21)).toBe(0.1);
  });

  it('un cobro sin reserva usa el general', () => {
    const p = cobro('free_payment', 100, '2026-03-01T10:00:00');
    expect(vatRateOf(p, new Map(), 0.21)).toBe(0.21);
  });
});

describe('la serie mensual', () => {
  /**
   * ⚠️ **Siempre doce meses.** Saltarse los vacíos haría que una línea con un
   * hueco en agosto uniera julio con septiembre en una recta que miente.
   */
  it('devuelve los doce meses aunque estén vacíos', () => {
    const serie = monthlyRevenue([cobro('rental_payment', 100, '2026-03-15T10:00:00')], 2026);
    expect(serie).toHaveLength(12);
    expect(serie[2].amount).toBe(100);
    expect(serie[7].amount).toBe(0);
  });

  it('no mezcla años', () => {
    const pagos = [
      cobro('rental_payment', 100, '2026-03-15T10:00:00'),
      cobro('rental_payment', 500, '2025-03-15T10:00:00')
    ];
    expect(monthlyRevenue(pagos, 2026)[2].amount).toBe(100);
    expect(monthlyRevenue(pagos, 2025)[2].amount).toBe(500);
  });

  it('y las fianzas tampoco entran aquí', () => {
    expect(monthlyRevenue([cobro('deposit', 300, '2026-03-15T10:00:00')], 2026)[2].amount).toBe(0);
  });
});

describe('el reparto por vía de cobro', () => {
  /**
   * ⚠️ Redsys, TPV físico y tarjeta a mano son **tres formas de cobrar con
   * tarjeta**. Separarlas obliga a sumarlas mentalmente cada vez.
   */
  it('agrupa las tres formas de tarjeta en una', () => {
    const pagos = [
      cobro('rental_payment', 100, '2026-03-01T10:00:00', { method: 'redsys' } as Partial<Payment>),
      cobro('rental_payment', 50, '2026-03-02T10:00:00', { method: 'physical_pos' } as Partial<Payment>),
      cobro('rental_payment', 25, '2026-03-03T10:00:00', { method: 'manual_card' } as Partial<Payment>)
    ];
    const r = revenueByMethod(pagos);
    expect(r).toHaveLength(1);
    expect(r[0].family).toBe('card');
    expect(r[0].amount).toBe(175);
    expect(r[0].count).toBe(3);
  });

  it('el efectivo y la transferencia van aparte', () => {
    const pagos = [
      cobro('rental_payment', 100, '2026-03-01T10:00:00', { method: 'cash' } as Partial<Payment>),
      cobro('rental_payment', 200, '2026-03-02T10:00:00', { method: 'bank_transfer' } as Partial<Payment>)
    ];
    expect(revenueByMethod(pagos).map((s) => s.family)).toEqual(['transfer', 'cash']);
  });

  /** Una porción de 0 € tapa a las demás sin decir nada. */
  it('no devuelve familias vacías', () => {
    expect(revenueByMethod([])).toEqual([]);
  });
});

describe('los mejores clientes', () => {
  const pagos = [
    cobro('rental_payment', 300, '2026-05-15T10:00:00', {
      clientId: 'c1',
      clientSnapshot: { fullName: 'Ana' }
    } as Partial<Payment>),
    cobro('rental_payment', 100, '2026-06-15T10:00:00', {
      clientId: 'c2',
      clientSnapshot: { fullName: 'Luis' }
    } as Partial<Payment>)
  ];
  const reservas = [
    reserva({ clientId: 'c1', totalDays: 3, clientSnapshot: { fullName: 'Ana' } } as Partial<Reservation>),
    reserva({ clientId: 'c1', totalDays: 5, clientSnapshot: { fullName: 'Ana' } } as Partial<Reservation>),
    reserva({ clientId: 'c2', totalDays: 10, clientSnapshot: { fullName: 'Luis' } } as Partial<Reservation>)
  ];

  /**
   * ⚠️ **Se ordena por dinero, no por días.** Luis tiene diez días y Ana ocho,
   * pero Ana deja el triple: la pregunta que responde la tabla es a quién
   * cuidar.
   */
  it('ordena por dinero aunque otro tenga más días', () => {
    const t = topClients(pagos, reservas, RANGO);
    expect(t[0].name).toBe('Ana');
    expect(t[0].revenue).toBe(300);
    expect(t[0].days).toBe(8);
    expect(t[1].days).toBe(10);
  });

  /**
   * ⚠️ Los días salen de las RESERVAS. Un cliente que paga en tres plazos no ha
   * alquilado tres veces.
   */
  it('cuenta alquileres, no cobros', () => {
    const conPlazos = [
      ...pagos,
      cobro('remaining_payment', 100, '2026-05-20T10:00:00', { clientId: 'c1' } as Partial<Payment>)
    ];
    expect(topClients(conPlazos, reservas, RANGO)[0].rentals).toBe(2);
  });

  it('una reserva cancelada no suma días', () => {
    const conCancelada = [
      ...reservas,
      reserva({ clientId: 'c2', totalDays: 99, reservationStatus: 'cancelled' } as Partial<Reservation>)
    ];
    const luis = topClients(pagos, conCancelada, RANGO).find((c) => c.name === 'Luis')!;
    expect(luis.days).toBe(10);
  });
});

describe('los coches', () => {
  it('ordena por lo que factura cada uno', () => {
    const pagos = [
      cobro('rental_payment', 100, '2026-05-01T10:00:00', {
        vehicleId: 'v1',
        vehicleSnapshot: { brand: 'Kia', model: 'Ceed', plateNumber: '7777ATM' }
      } as Partial<Payment>),
      cobro('rental_payment', 400, '2026-05-01T10:00:00', {
        vehicleId: 'v2',
        vehicleSnapshot: { brand: 'Mercedes', model: 'Clase C', plateNumber: '0951LTL' }
      } as Partial<Payment>)
    ];
    const r = revenueByVehicle(pagos, [], RANGO);
    expect(r[0].label).toBe('Mercedes Clase C · 0951LTL');
    expect(r[0].revenue).toBe(400);
  });
});

describe('la ocupación', () => {
  /**
   * ⚠️ **El denominador son los coches POR los días.** Con tres coches y treinta
   * días hay noventa días-coche; dividir entre treinta daría un 300 % con la
   * flota llena.
   */
  it('se mide en días-coche, no en días', () => {
    const rango = { from: new Date('2026-05-01T00:00:00'), to: new Date('2026-05-30T23:59:59') };
    const reservas = [reserva({ totalDays: 30, pickupDateTime: new Date('2026-05-01T10:00:00') } as Partial<Reservation>)];
    expect(occupancy(reservas, 3, rango)).toBeCloseTo(1 / 3, 3);
    expect(occupancy(reservas, 1, rango)).toBe(1);
  });

  /**
   * ⚠️ Un alquiler que empieza dentro y acaba fuera aporta todos sus días, así
   * que la cuenta puede pasarse. Enseñar «117 %» haría dudar de toda la
   * pantalla.
   */
  it('nunca pasa del 100 %', () => {
    const rango = { from: new Date('2026-05-01T00:00:00'), to: new Date('2026-05-10T23:59:59') };
    const reservas = [reserva({ totalDays: 60, pickupDateTime: new Date('2026-05-05T10:00:00') } as Partial<Reservation>)];
    expect(occupancy(reservas, 1, rango)).toBe(1);
  });

  it('sin coches no hay ocupación que medir, y no revienta', () => {
    expect(occupancy([reserva()], 0, RANGO)).toBe(0);
  });

  it('los días del rango incluyen los dos extremos', () => {
    expect(daysInRange({ from: new Date('2026-05-01T00:00:00'), to: new Date('2026-05-01T23:59:59') })).toBe(1);
    expect(daysInRange({ from: new Date('2026-05-01T00:00:00'), to: new Date('2026-05-31T23:59:59') })).toBe(31);
  });
});

describe('el ingreso por día alquilado', () => {
  it('divide lo cobrado entre los días', () => {
    expect(revenuePerRentalDay(600, 20)).toBe(30);
  });

  it('sin días alquilados da cero, no infinito', () => {
    expect(revenuePerRentalDay(600, 0)).toBe(0);
  });
});

describe('los clientes que repiten', () => {
  /**
   * ⚠️ **Repetir es más de un ALQUILER.** Un cliente que paga señal y resto ha
   * pagado dos veces y ha alquilado una: contar cobros haría fiel a casi todo el
   * mundo.
   */
  it('cuenta los que tienen más de un alquiler', () => {
    const r = repeatClientStats([
      { clientId: 'c1', name: 'Ana', revenue: 300, days: 8, rentals: 2 },
      { clientId: 'c2', name: 'Luis', revenue: 100, days: 10, rentals: 1 }
    ]);
    expect(r.repeatClients).toBe(1);
    expect(r.totalClients).toBe(2);
    expect(r.revenueShare).toBeCloseTo(0.75, 3);
  });

  it('sin clientes no divide por cero', () => {
    expect(repeatClientStats([]).revenueShare).toBe(0);
  });
});
