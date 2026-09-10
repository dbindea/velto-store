import { describe, expect, it } from 'vitest';
import {
  ALL_TIME,
  balanceOf,
  commissionAmount,
  estadoSegunReserva,
  MAX_COMMISSION_PERCENT,
  periodSummary,
  saleDate,
  saleProblem,
  settlements,
  validateCollaborator,
  yearlyTotals
} from './collaborator.util';
import type { CollaboratorSale, Collaborator } from '@shared/models/collaborator.model';

const colaborador = (extra: Partial<Collaborator> = {}): Collaborator => ({
  id: 'c1',
  name: 'Comercial Pruebas',
  commissionPercent: 25,
  active: true,
  ...extra
});

const venta = (extra: Partial<CollaboratorSale> = {}): CollaboratorSale =>
  ({
    collaboratorId: 'c1',
    collaboratorName: 'Comercial Pruebas',
    reservationId: 'r1',
    reservationSnapshot: { clientName: 'X', vehicle: 'Y', pickupDate: null },
    netAmount: 100,
    commissionPercent: 25,
    commissionAmount: 25,
    status: 'pending',
    ...extra
  }) as CollaboratorSale;

describe('el importe de la comisión', () => {
  /** El ejemplo de Dorel: 100 € + IVA, 25 % → 25 €. */
  it('es el porcentaje del NETO', () => {
    expect(commissionAmount(100, 25)).toBe(25);
  });

  /**
   * ⚠️ **La prueba que importa.** El IVA no es dinero de la empresa: es dinero
   * de Hacienda que la empresa cobra y entrega. Comisionar sobre los 121 € en
   * vez de sobre los 100 sería pagarle al colaborador un porcentaje de un
   * impuesto — 5,25 € de más por cada cien euros de alquiler.
   */
  it('NO se calcula sobre el total con IVA', () => {
    expect(commissionAmount(100, 25)).toBe(25);
    expect(commissionAmount(121, 25)).toBe(30.25); // lo que NO debe salir de 100 € + IVA
    expect(commissionAmount(100, 25)).not.toBe(commissionAmount(121, 25));
  });

  /**
   * ⚠️ **Sin redondear, el importe sale con doce decimales.** `333.33 * 15 / 100`
   * da 49.99950000000001 en coma flotante, y eso acaba escrito en Firestore y
   * enseñado en pantalla — es lo que ya pasó con el resto de un pago sembrado.
   *
   * Y el medio céntimo sube: 108,9 al 25 % son 27,225, que se cobran como 27,23.
   */
  it('redondea al céntimo, y el medio céntimo hacia arriba', () => {
    expect(commissionAmount(333.33, 15)).toBe(50);
    expect(commissionAmount(108.9, 25)).toBe(27.23);
  });

  it('un porcentaje o un neto ausentes dan cero, no NaN', () => {
    expect(commissionAmount(undefined as unknown as number, 25)).toBe(0);
    expect(commissionAmount(100, undefined as unknown as number)).toBe(0);
  });
});

describe('cuándo se puede asignar una venta', () => {
  const reserva = { reservationStatus: 'confirmed', pricingSnapshot: { netPrice: 100 } };

  it('una reserva normal con neto, sí', () => {
    expect(saleProblem(reserva, colaborador())).toBeNull();
  });

  /** Una cancelada no devenga nada: crearla ya muerta solo ensucia la lista. */
  it('una reserva cancelada, no', () => {
    expect(saleProblem({ ...reserva, reservationStatus: 'cancelled' }, colaborador())).toBe(
      'collaborators.problems.reservationCancelled'
    );
  });

  it('un colaborador dado de baja, tampoco', () => {
    expect(saleProblem(reserva, colaborador({ active: false }))).toBe(
      'collaborators.problems.collaboratorInactive'
    );
  });

  /**
   * ⚠️ Sin neto no hay base, y una comisión de cero no es una comisión: es una
   * venta mal asignada que después nadie sabe explicar.
   */
  it('una reserva sin neto, tampoco', () => {
    expect(saleProblem({ reservationStatus: 'confirmed', pricingSnapshot: {} }, colaborador())).toBe(
      'collaborators.problems.reservationWithoutNet'
    );
  });
});

describe('qué pasa con la comisión cuando la reserva cambia', () => {
  it('si la reserva se cancela, la comisión se anula', () => {
    expect(estadoSegunReserva('pending', 'cancelled')).toBe('cancelled');
  });

  /**
   * ⚠️ **Una comisión ya PAGADA no se anula sola.** El dinero salió; cancelar la
   * reserva después no lo devuelve, y marcarla como anulada haría cuadrar el
   * balance mintiendo.
   */
  it('pero una ya pagada NO se anula: el dinero ya salió', () => {
    expect(estadoSegunReserva('paid', 'cancelled')).toBe('paid');
  });

  it('y una anulada vuelve a deberse si la reserva deja de estar cancelada', () => {
    expect(estadoSegunReserva('cancelled', 'confirmed')).toBe('pending');
  });
});

describe('lo que se le debe a un colaborador', () => {
  it('suma lo pendiente y lo pagado por separado', () => {
    const b = balanceOf([
      venta({ commissionAmount: 25 }),
      venta({ commissionAmount: 30, status: 'paid' }),
      venta({ commissionAmount: 12.5 })
    ]);
    expect(b.pending).toBe(37.5);
    expect(b.paid).toBe(30);
    expect(b.sales).toBe(3);
  });

  /**
   * ⚠️ **Lo cancelado se cuenta aparte y no se suma a nada.** Si desapareciera,
   * el colaborador preguntaría por una venta que él recuerda y que aquí no sale
   * por ningún lado.
   */
  it('lo cancelado va aparte y no cuenta como venta', () => {
    const b = balanceOf([
      venta({ commissionAmount: 25 }),
      venta({ commissionAmount: 40, status: 'cancelled' })
    ]);
    expect(b.pending).toBe(25);
    expect(b.cancelled).toBe(40);
    expect(b.sales).toBe(1);
  });

  it('sin ventas, todo a cero', () => {
    expect(balanceOf([])).toEqual({ pending: 0, paid: 0, cancelled: 0, sales: 0 });
  });

  /** Sumar céntimos en coma flotante da 0.30000000000000004 sin redondear. */
  it('la suma se redondea al céntimo', () => {
    const b = balanceOf([venta({ commissionAmount: 0.1 }), venta({ commissionAmount: 0.2 })]);
    expect(b.pending).toBe(0.3);
  });
});

describe('la ficha del colaborador', () => {
  it('el nombre es obligatorio', () => {
    expect(validateCollaborator({ commissionPercent: 25 })['name']).toBe(
      'collaborators.problems.nameRequired'
    );
  });

  it('y un porcentaje que valga algo', () => {
    expect(validateCollaborator({ name: 'X', commissionPercent: 0 })['commissionPercent']).toBe(
      'collaborators.problems.percentRequired'
    );
  });

  /**
   * ⚠️ El tope no es una regla legal: evita que un dedo torpe convierta un 25 en
   * un 250 y deje una deuda de mil euros por un alquiler de cien.
   */
  it('con un tope de cordura', () => {
    expect(
      validateCollaborator({ name: 'X', commissionPercent: MAX_COMMISSION_PERCENT + 1 })[
        'commissionPercent'
      ]
    ).toBe('collaborators.problems.percentTooHigh');
    expect(
      validateCollaborator({ name: 'X', commissionPercent: MAX_COMMISSION_PERCENT })[
        'commissionPercent'
      ]
    ).toBeUndefined();
  });

  it('el correo no es obligatorio, pero uno mal escrito no pasa', () => {
    expect(validateCollaborator({ name: 'X', commissionPercent: 25 })['email']).toBeUndefined();
    expect(
      validateCollaborator({ name: 'X', commissionPercent: 25, email: 'esto-no-es-un-correo' })[
        'email'
      ]
    ).toBe('collaborators.problems.emailInvalid');
  });

  it('una ficha correcta no da problemas', () => {
    expect(validateCollaborator(colaborador())).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Análisis por periodo
// ---------------------------------------------------------------------------

const ventaEn = (iso: string, extra: Partial<CollaboratorSale> = {}) =>
  venta({
    reservationSnapshot: { clientName: 'X', vehicle: 'Y', pickupDate: new Date(iso) },
    ...extra
  });

describe('la fecha por la que se filtra una comisión', () => {
  /**
   * ⚠️ **Es la del ALQUILER, no la de cuando se apuntó la venta.** «¿Cuánto me
   * trajo Juan en 2026?» se responde con cuándo ocurrió el alquiler, que es lo
   * que los dos recuerdan.
   */
  it('es la de recogida de la reserva', () => {
    expect(saleDate(ventaEn('2026-03-15T10:00:00'))?.getMonth()).toBe(2);
  });

  it('sin fecha de recogida, no hay fecha que valga', () => {
    expect(saleDate(venta())).toBeNull();
  });
});

describe('el resumen de un periodo', () => {
  const datos = [
    ventaEn('2026-03-15T10:00:00', { commissionAmount: 50 }),
    ventaEn('2026-09-01T10:00:00', { commissionAmount: 30, status: 'paid' }),
    ventaEn('2025-11-20T10:00:00', { commissionAmount: 25, status: 'paid' }),
    ventaEn('2026-05-05T10:00:00', { commissionAmount: 99, status: 'cancelled' })
  ];

  it('sin periodo, cuenta todo', () => {
    const r = periodSummary(datos, ALL_TIME);
    expect(r.generated).toBe(105);
    expect(r.paid).toBe(55);
    expect(r.pending).toBe(50);
    expect(r.cancelled).toBe(99);
  });

  it('por año', () => {
    const r = periodSummary(datos, { year: 2025, from: null, to: null });
    expect(r.generated).toBe(25);
    expect(r.paid).toBe(25);
    expect(r.sales).toBe(1);
  });

  /**
   * ⚠️ Mismo cuidado que en el filtro de facturas: un `<input type="date">` da
   * la medianoche, y comparar contra eso deja fuera todo lo de ese día.
   */
  it('«hasta el 1 de septiembre» incluye el 1 entero', () => {
    const r = periodSummary(datos, {
      year: null,
      from: null,
      to: new Date('2026-09-01T00:00:00')
    });
    expect(r.paid).toBe(55); // la de las 10:00 del día 1 entra
  });

  /**
   * ⚠️ **La distinción que sostiene la pantalla.** `pending` aquí es lo
   * pendiente DE ESE PERIODO. Lo que se le debe en total no depende del año que
   * se mire, y confundirlos haría leer «pendiente: 0» en 2025 como «no le debo
   * nada» cuando lo de 2026 sigue sin pagar.
   */
  it('lo pendiente del periodo NO es lo que se le debe en total', () => {
    expect(periodSummary(datos, { year: 2025, from: null, to: null }).pending).toBe(0);
    expect(balanceOf(datos).pending).toBe(50);
  });

  it('una venta sin fecha de alquiler queda fuera de cualquier periodo', () => {
    const conSinFecha = [...datos, venta({ commissionAmount: 10 })];
    expect(periodSummary(conSinFecha, { year: 2026, from: null, to: null }).generated).toBe(80);
    // Pero sigue contando en lo que se le debe: lo que se debe se debe.
    expect(balanceOf(conSinFecha).pending).toBe(60);
  });
});

describe('lo acumulado año a año', () => {
  it('sale un año por cada ejercicio con ventas, del más reciente al más antiguo', () => {
    const años = yearlyTotals([
      ventaEn('2026-03-15T10:00:00', { commissionAmount: 50 }),
      ventaEn('2025-11-20T10:00:00', { commissionAmount: 25, status: 'paid' })
    ]);
    expect(años.map((a) => a.year)).toEqual([2026, 2025]);
    expect(años[0].pending).toBe(50);
    expect(años[1].paid).toBe(25);
  });

  it('sin ventas con fecha, no hay años que enseñar', () => {
    expect(yearlyTotals([venta()])).toEqual([]);
  });
});

describe('el histórico de pagos', () => {
  const pagada = (importe: number, cuando: string, metodo: 'cash' | 'transfer') =>
    venta({
      commissionAmount: importe,
      status: 'paid',
      paidAt: new Date(cuando),
      paidMethod: metodo
    });

  /**
   * ⚠️ **Se agrupa por día y forma de pago, que es como se paga de verdad**: una
   * transferencia por varias comisiones a la vez. Y no hay colección de
   * liquidaciones — sería una segunda fuente de verdad para el mismo euro.
   */
  it('junta en un solo pago lo liquidado el mismo día y por la misma vía', () => {
    const s = settlements([
      pagada(50, '2026-10-03T12:00:00', 'transfer'),
      pagada(30, '2026-10-03T12:00:01', 'transfer'),
      pagada(20, '2026-10-03T18:00:00', 'cash')
    ]);
    expect(s).toHaveLength(2);
    const transferencia = s.find((x) => x.method === 'transfer')!;
    expect(transferencia.amount).toBe(80);
    expect(transferencia.count).toBe(2);
  });

  it('va del pago más reciente al más antiguo', () => {
    const s = settlements([
      pagada(10, '2026-01-05T12:00:00', 'cash'),
      pagada(20, '2026-06-05T12:00:00', 'cash')
    ]);
    expect(s[0].amount).toBe(20);
  });

  it('lo que no está pagado no aparece', () => {
    expect(settlements([venta({ commissionAmount: 50 })])).toEqual([]);
  });
});
