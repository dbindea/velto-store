import { describe, expect, it } from 'vitest';
import {
  balanceOf,
  commissionAmount,
  estadoSegunReserva,
  MAX_COMMISSION_PERCENT,
  saleProblem,
  validateCollaborator
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
