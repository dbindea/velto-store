/**
 * Qué cobro se puede corregir, y hasta dónde.
 *
 * Existe porque un importe se teclea mal —«un cobro manual debe poder editarse
 * porque es posible haber tecleado mal el importe y para no hacer otro»— y
 * hasta ahora la única salida era cancelar la fila y crear otra, dejando dos
 * apuntes donde había uno y un «Cancelado» que no significa nada.
 *
 * ⚠️ **Corregir un importe NO es cobrar ni devolver.** Solo cambia lo que se
 * pide; lo ya cobrado no se toca. Por eso lo que decide es el estado y lo que
 * ya entró, no el permiso de devolver.
 */

import { Payment, PaymentType } from '@shared/models/payment.model';
import { WorkflowDecision } from '@shared/utils/reservation-workflow.util';
import { roundMoney } from '@shared/utils/payment-summary.util';

const ALLOW: WorkflowDecision = { ok: true };
function deny(reason: string): WorkflowDecision {
  return { ok: false, reason };
}

/**
 * Los conceptos que **la reserva gobierna**, no la fila.
 *
 * ⚠️ **Estos no se editan desde el pago, y no es una limitación técnica.** La
 * señal, el resto y la fianza son un reparto del precio del alquiler: bajar la
 * señal aquí dejaría la reserva diciendo que pide 50 € y la fila pidiendo 30,
 * sin que nada las volviera a cuadrar. El sitio donde eso se toca es la
 * edición de la reserva, que mueve las dos a la vez y mantiene el total.
 */
const GOBERNADOS_POR_LA_RESERVA: PaymentType[] = [
  'initial_payment',
  'remaining_payment',
  'rental_payment',
  'deposit'
];

export function isGovernedByReservation(type: PaymentType): boolean {
  return GOBERNADOS_POR_LA_RESERVA.includes(type);
}

/**
 * ¿Se puede corregir el importe de este cobro?
 *
 * Devuelve el mismo `WorkflowDecision` que el resto de la aplicación, para que
 * la pantalla pinte el motivo sin traducir nada a mano.
 */
export function canEditAmount(payment: Payment | null | undefined): WorkflowDecision {
  if (!payment) return deny('payments.edit.denied.notFound');

  // Un pago cobrado del todo documenta dinero que entró: cambiarle el importe
  // haría que el recibo que tiene el cliente y la aplicación dijeran cosas
  // distintas. Para mover dinero cobrado están devolver y retener.
  if (payment.status === 'paid') return deny('payments.edit.denied.alreadyPaid');
  if (payment.status === 'cancelled') return deny('payments.edit.denied.cancelled');
  if (payment.status === 'refunded') return deny('payments.edit.denied.refunded');

  // ⚠️ Una devolución o una retención de fianza van en la otra dirección y se
  // deciden en la reserva, con lo que de verdad hay depositado. Aquí un importe
  // a mano abriría la puerta a devolver más de lo cobrado — que es justo lo que
  // `refundDeposit` se cuida de impedir.
  if (payment.direction === 'refund' || payment.direction === 'retention') {
    return deny('payments.edit.denied.notACharge');
  }

  if (isGovernedByReservation(payment.type)) {
    return deny('payments.edit.denied.governedByReservation');
  }

  return ALLOW;
}

/**
 * ¿Vale este importe nuevo?
 *
 * ⚠️ **No puede quedar por debajo de lo ya cobrado.** Con 20 € cobrados de 50,
 * corregir el total a 10 € dejaría un pendiente negativo y un pago que dice
 * haber cobrado el doble de lo que valía. Si lo que hay que hacer es devolver
 * dinero, eso es una devolución y tiene su propio camino.
 *
 * ⚠️ **Y el hueco no es el cero**, como en la fianza y en la señal:
 * `Number('')` es `0`, no `NaN`, así que un campo vacío se guardaría como un
 * cobro de 0 € sin que nadie lo decidiera.
 */
export function amountProblem(value: unknown, payment: Payment): string | null {
  if (value === null || value === undefined || value === '') {
    return 'payments.edit.problems.required';
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return 'payments.edit.problems.invalid';
  if (n <= 0) return 'payments.edit.problems.positive';
  const cobrado = roundMoney(Number(payment.paidAmount) || 0);
  if (roundMoney(n) < cobrado) return 'payments.edit.problems.belowCollected';
  return null;
}
