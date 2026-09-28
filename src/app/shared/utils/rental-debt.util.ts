/**
 * Qué se le debe a la agencia por el alquiler, y CÓMO se llama eso.
 *
 * ⚠️ **Existe porque la cifra y su rótulo se decidían en sitios distintos.** El
 * panel amplió su tarjeta para sumar la señal pendiente **y** el resto del
 * alquiler —sin eso, una entrega a crédito desaparecía del panel justo el día
 * en que empieza la deuda— y el rótulo se quedó diciendo «Señal pendiente».
 *
 * El resultado se vio en producción el 28 de septiembre de 2026: **«SEÑAL
 * PENDIENTE — 650,00 €» sobre una reserva a la que no se le pidió ninguna
 * señal**. El número era correcto; lo que mentía era la palabra. Es el fallo
 * que CLAUDE.md llama «la frase y el hecho se deciden juntos», y por eso las
 * dos cosas salen de aquí a la vez: quien pida el importe se lleva obligado el
 * nombre de lo que ha pedido.
 */

import type { Reservation } from '@shared/models/reservation.model';
import { roundMoney } from './money.util';

/**
 * Qué es el dinero.
 *
 * ⚠️ **`waived` y `paid` NO dan el mismo nombre, y por eso son tres y no dos.**
 * Con la señal **cobrada**, lo que queda vivo es de verdad el resto. Con la
 * señal **renunciada** no hay resto de nada: el precio completo del alquiler
 * vive en ese campo, y llamarlo «resto» manda a buscar una primera parte que
 * nunca se pidió. Es además lo que ya dice la ficha de la reserva —«No se pide
 * señal: el importe completo queda en el resto del alquiler»—, así que las dos
 * pantallas tienen que contar lo mismo de la misma reserva.
 */
export type DebtScope = 'signal' | 'remaining' | 'rental';

/**
 * Dónde está el coche, que es lo que decide qué se le puede pedir al operador.
 *
 * ⚠️ **No es cosmética: una instrucción imposible rebaja el aviso más grave.**
 * «Cobrar antes de confirmar la entrega» es cierto mientras el coche esté en la
 * agencia y falso en cuanto sale — justo en el caso que esta cifra existe para
 * vigilar, la entrega a crédito, donde el operador se saltó el cobro a
 * propósito con su motivo escrito. Y un paso más allá, con el coche ya
 * devuelto, lo que hay que decir es otra cosa: que la reserva **no se puede
 * cerrar** hasta cobrar, que es lo que de verdad le va a pasar al operador.
 */
export type DebtMoment = 'before_pickup' | 'delivered' | 'returned';

export interface RentalDebt {
  /** Lo que falta por cobrar del alquiler, redondeado. Siempre > 0. */
  amount: number;
  scope: DebtScope;
  moment: DebtMoment;
}

/**
 * La deuda del alquiler de una reserva, o `null` si no hay ninguna.
 *
 * ⚠️ **Se mira `status`, no la resta de importes.** Quien decide si una señal
 * se cobra es `initialPaymentStatus()`, que distingue tres casos donde una
 * resta solo ve dos: `waived` —no se pide, y es una decisión del operador—,
 * `paid` y `pending`. Con la resta, una señal renunciada y una cobrada dan lo
 * mismo por casualidad, y el día que dejen de darlo la pantalla vuelve a
 * mentir.
 *
 * ⚠️ **Sale de `initialPayment` y `remainingPayment`, NUNCA de
 * `paymentSummary`.** Aquella es la copia desnormalizada que existe para pintar
 * rápido y que **se queda vieja respondiendo `0` en vez de fallar**; estos dos
 * los mantienen al día la creación y la edición, en el mismo `writeBatch` que
 * mueve el dinero.
 *
 * ⚠️ **Lo cerrado y lo cancelado no tienen deuda que avisar.** Una reserva
 * cerrada con dinero fuera es una decisión ya tomada —con su excepción escrita,
 * su motivo y su autor—, no un pendiente; y una cancelada no se cobra.
 */
export function rentalDebtOf(r: Reservation): RentalDebt | null {
  if (r.reservationStatus === 'closed' || r.reservationStatus === 'cancelled') return null;

  const señalViva =
    r.initialPayment?.status === 'pending'
      ? Math.max(0, (r.initialPayment.requiredAmount || 0) - (r.initialPayment.paidAmount || 0))
      : 0;

  const restoVivo =
    r.remainingPayment?.status === 'pending'
      ? Math.max(0, (r.remainingPayment.requiredAmount || 0) - (r.remainingPayment.paidAmount || 0))
      : 0;

  const amount = roundMoney(señalViva + restoVivo);
  if (amount <= 0) return null;

  return { amount, scope: scopeOf(r, señalViva, restoVivo), moment: momentOf(r) };
}

/** Cómo se llama lo que suma `amount`. */
function scopeOf(r: Reservation, señalViva: number, restoVivo: number): DebtScope {
  if (señalViva > 0 && restoVivo > 0) return 'rental';
  if (señalViva > 0) return 'signal';

  // Solo el resto. Si nunca se pidió señal, ese importe ES el alquiler entero.
  const señalRenunciada =
    r.initialPayment?.status === 'waived' || !(r.initialPayment?.requiredAmount > 0);
  return señalRenunciada ? 'rental' : 'remaining';
}

/**
 * Dónde está el coche.
 *
 * `delivered` y `returned` son los dos estados que produce una entrega a
 * crédito; cualquier otro —`reserved`, `confirmed`— es el coche todavía en la
 * agencia. `closed` y `cancelled` no llegan aquí: `rentalDebtOf()` sale antes.
 */
function momentOf(r: Reservation): DebtMoment {
  if (r.reservationStatus === 'returned') return 'returned';
  if (r.reservationStatus === 'delivered') return 'delivered';
  return 'before_pickup';
}

/**
 * La clave i18n del rótulo, y la del subtexto.
 *
 * ⚠️ **Viven aquí y no en la plantilla a propósito.** Repartidas en `@if` del
 * HTML, añadir un estado obliga a acordarse de tocar los dos sitios — que es
 * exactamente cómo el rótulo se quedó atrás cuando la cifra cambió. Aquí el
 * compilador obliga: los `Record` están tipados por la unión completa.
 */
export const DEBT_SCOPE_LABELS: Record<DebtScope, string> = {
  signal: 'dashboard.pendingPayment.scope.signal',
  remaining: 'dashboard.pendingPayment.scope.remaining',
  rental: 'dashboard.pendingPayment.scope.rental'
};

export const DEBT_MOMENT_HINTS: Record<DebtMoment, string> = {
  before_pickup: 'dashboard.pendingPayment.moment.beforePickup',
  delivered: 'dashboard.pendingPayment.moment.delivered',
  returned: 'dashboard.pendingPayment.moment.returned'
};
