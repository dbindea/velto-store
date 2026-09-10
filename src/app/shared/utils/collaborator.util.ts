/**
 * La comisión de un colaborador: cuánto es, cuándo se debe y qué se le adeuda.
 *
 * ⚠️ **Es la única autoridad sobre el importe de una comisión**, igual que
 * `pricing.util.ts` lo es sobre el precio. La pantalla la usa para enseñar la
 * cifra y el servicio la vuelve a usar antes de escribir: si cada uno hiciera su
 * cuenta, el día que discrepen nadie sabría cuál es la buena — y aquí la
 * diferencia se la lleva o se la come una persona.
 */

import {
  Collaborator,
  CollaboratorBalance,
  CollaboratorSale,
  CommissionStatus
} from '@shared/models/collaborator.model';
import { FieldProblems } from '@shared/utils/form-problems.util';
import { roundMoney } from '@shared/utils/payment-summary.util';

/**
 * Más de esto no es una comisión, es un socio.
 *
 * No es una regla legal: es un tope de cordura para que un dedo torpe no
 * convierta un 25 en un 250 y deje una deuda de mil euros por un alquiler de
 * cien. Misma idea que el 30 % máximo del descuento de fidelidad.
 */
export const MAX_COMMISSION_PERCENT = 50;

/**
 * El importe de una comisión.
 *
 * ⚠️ **La base es el NETO, sin IVA.** El IVA no es dinero de la empresa: es
 * dinero de Hacienda que la empresa cobra y entrega. Comisionar sobre el total
 * sería pagarle al colaborador un porcentaje de un impuesto — con un 21 % de IVA
 * y un 25 % de comisión, 5,25 € de más por cada cien euros de alquiler.
 *
 * ⚠️ **Y se redondea.** `100 * 25 / 100` da 25, pero `108.9 * 25 / 100` da
 * 27.224999999999998. Todo importe derivado pasa por `roundMoney()` antes de
 * enseñarse o escribirse; ya pasó con el resto de un pago sembrado.
 */
export function commissionAmount(netAmount: number, commissionPercent: number): number {
  const neto = Number(netAmount) || 0;
  const pct = Number(commissionPercent) || 0;
  return roundMoney((neto * pct) / 100);
}

/**
 * ¿Se puede asignar esta reserva a un colaborador?
 *
 * ⚠️ **Una reserva cancelada no genera comisión, y tampoco se le asigna una.**
 * Lo primero lo resuelve `estadoSegunReserva()`; esto evita crearla ya muerta,
 * que solo sirve para ensuciar la lista.
 */
/**
 * ⚠️ **El campo es `reservationStatus`, no `status`.** La reserva tiene los dos
 * nombres rondando —`status` existe dentro de la fianza y de los tramos de
 * pago—, y escribirlo mal aquí no da error de compilación si el campo es
 * opcional: simplemente **nunca coincide**, y una reserva cancelada pasaría el
 * filtro y generaría comisión. Por eso el tipo es obligatorio y no opcional: sin
 * él, el compilador se calla.
 */
export type ReservationForCommission = {
  reservationStatus: string;
  pricingSnapshot?: { netPrice?: number } | null;
};

export function saleProblem(
  reserva: ReservationForCommission | null | undefined,
  colaborador: Collaborator | null | undefined
): string | null {
  if (!colaborador?.id) return 'collaborators.problems.collaboratorRequired';
  if (!colaborador.active) return 'collaborators.problems.collaboratorInactive';
  if (!reserva) return 'collaborators.problems.reservationRequired';
  if (reserva.reservationStatus === 'cancelled') {
    return 'collaborators.problems.reservationCancelled';
  }
  /**
   * ⚠️ Sin neto no hay base, y una comisión de cero no es una comisión: es una
   * venta mal asignada que después nadie entiende. Mejor no dejar crearla.
   */
  if (!(Number(reserva.pricingSnapshot?.netPrice) > 0)) {
    return 'collaborators.problems.reservationWithoutNet';
  }
  return null;
}

/**
 * El estado que le corresponde a una comisión según cómo esté su reserva.
 *
 * ⚠️ **Una comisión ya PAGADA no se anula sola.** El dinero salió: cancelar la
 * reserva después no lo devuelve, y marcarla como anulada haría cuadrar el
 * balance mintiendo. Si hay que recuperarlo, eso es una conversación con el
 * colaborador, no un cambio de estado automático.
 */
export function estadoSegunReserva(
  actual: CommissionStatus,
  reservationStatus: string | undefined
): CommissionStatus {
  if (actual === 'paid') return 'paid';
  if (reservationStatus === 'cancelled') return 'cancelled';
  // Una anulada que resucita —la reserva deja de estar cancelada— vuelve a deber.
  return 'pending';
}

/**
 * Lo que se le debe a un colaborador.
 *
 * ⚠️ **Lo cancelado se cuenta aparte y no se suma a nada.** Enseñar solo el
 * pendiente y el pagado deja al colaborador preguntando por una venta que él
 * recuerda y que aquí no aparece por ningún lado.
 */
export function balanceOf(sales: CollaboratorSale[]): CollaboratorBalance {
  const suma = (estado: CommissionStatus) =>
    roundMoney(
      sales
        .filter((s) => s.status === estado)
        .reduce((total, s) => total + (Number(s.commissionAmount) || 0), 0)
    );

  return {
    pending: suma('pending'),
    paid: suma('paid'),
    cancelled: suma('cancelled'),
    sales: sales.filter((s) => s.status !== 'cancelled').length
  };
}

/**
 * Todo lo que impide guardar un colaborador, campo a campo.
 *
 * **Una sola función**, la misma que consulta la pantalla y la que ejecuta el
 * servicio antes de escribir. El orden es el de los campos en el formulario,
 * para que el resumen se lea de arriba abajo igual que la pantalla.
 */
export function validateCollaborator(input: Partial<Collaborator> | null): FieldProblems {
  const problems: FieldProblems = {};
  const c = input || {};

  if (!c.name?.trim()) {
    problems['name'] = 'collaborators.problems.nameRequired';
  }

  const pct = Number(c.commissionPercent);
  if (!Number.isFinite(pct) || pct <= 0) {
    problems['commissionPercent'] = 'collaborators.problems.percentRequired';
  } else if (pct > MAX_COMMISSION_PERCENT) {
    problems['commissionPercent'] = 'collaborators.problems.percentTooHigh';
  }

  // El correo solo si lo hay: no es obligatorio, pero uno mal escrito no sirve
  // de nada y solo se descubre el día que hace falta.
  if (c.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) {
    problems['email'] = 'collaborators.problems.emailInvalid';
  }

  return problems;
}
