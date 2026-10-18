/**
 * Adoptar la señal ya cobrada de una solicitud al convertirla en reserva.
 *
 * ⚠️ **Existe porque convertir cobraba la señal DOS VECES, y era un fallo
 * vivo.** Desde el 2 de octubre de 2026 el backoffice sabe cobrar la señal de
 * una solicitud: crea un cobro libre atado a ella (`bookingRequestId`) y le
 * manda al cliente el enlace `/pay/:id`. La solicitud guarda su id en
 * `signalPaymentId`… y **no lo leía nadie en el asistente de reservas**
 * —comprobado con grep sobre `src/` y `functions/` el 18 de octubre de 2026—.
 *
 * Así que la secuencia normal del negocio terminaba mal: se cobraban 50 €, se
 * convertía, y `buildInitialPaymentRows()` sembraba una fila de señal nueva
 * pidiendo otros 50 €. La reserva decía deber 50 € que ya estaban en el banco,
 * y el cobro de verdad se quedaba suelto en la lista de Pagos sin dueño.
 *
 * ⚠️ **Se adopta esté PAGADA o no.** Lo que hay que evitar es la fila
 * duplicada, y eso pasa igual con un cobro aún pendiente: el operador manda el
 * enlace, el cliente tarda, y mientras tanto la conversión crearía la segunda
 * petición del mismo dinero. Lo que cambia según el estado es el bloque de la
 * reserva, no si se adopta.
 *
 * ⚠️ **Y esto es un util puro a propósito.** Lo que hay que acertar aquí —qué
 * cobro se puede adoptar y con qué importes— se prueba con datos; lo que no se
 * puede probar así es la escritura, y por eso vive en el servicio. Misma
 * separación que `payment-edit.util.ts` o `receipt-core.ts`.
 */

import { Payment, PaymentType } from '@shared/models/payment.model';
import { WorkflowDecision } from '@shared/utils/reservation-workflow.util';
import { roundMoney } from '@shared/utils/payment-summary.util';

const ALLOW: WorkflowDecision = { ok: true };
function deny(reason: string): WorkflowDecision {
  return { ok: false, reason };
}

/**
 * Lo que hace falta mirar de un cobro para decidir si se adopta.
 *
 * ⚠️ **Todos los campos son opcionales porque el documento llega de Firestore**,
 * no porque dé igual: un `Payment` leído puede no traer lo que nunca se
 * escribió. Lo que NO es opcional es el segundo argumento de
 * `canAdoptSignalPayment()`, y ahí está la diferencia — ver su nota.
 */
export type AdoptableSignal = Pick<
  Payment,
  'id' | 'type' | 'amount' | 'paidAmount' | 'status' | 'reservationId' | 'bookingRequestId'
> & { refundedAmount?: number };

/**
 * ¿Se puede adoptar este cobro como la señal de la reserva que se está creando?
 *
 * ⚠️ **El id viaja por la URL**, igual que el resto de los parámetros de
 * «Convertir». Eso es cómodo y es también por lo que cada una de estas cuatro
 * comprobaciones tiene detrás una consecuencia concreta y no una manía:
 *
 * ⚠️ **`bookingRequestId` se exige y se COMPARA.** Sin comparar, una URL
 * tecleada a mano ataría el cobro de la solicitud de otra persona a esta
 * reserva: el dinero de uno pagando el alquiler de otro, y la solicitud buena
 * quedándose sin su cobro. Es el mismo razonamiento por el que el id del recibo
 * no se deriva del id del pago.
 */
export function canAdoptSignalPayment(
  payment: AdoptableSignal | null | undefined,
  /** La solicitud que se está convirtiendo. Obligatorio: ver la nota de arriba. */
  bookingRequestId: string
): WorkflowDecision {
  if (!payment) return deny('reservations.signal.adopt.notFound');

  /**
   * Ya es de otra reserva. Adoptarlo aquí no lo duplicaría: lo **movería**,
   * dejando a la reserva anterior con su señal cobrada y sin la fila que lo
   * acredita. Un cobro pertenece a un alquiler y solo a uno.
   */
  if (payment.reservationId) return deny('reservations.signal.adopt.alreadyAttached');

  /**
   * Un cobro cancelado no es dinero. Adoptarlo sembraría una señal que la
   * reserva da por pedida y que nadie puede cobrar nunca —el resumen descarta
   * lo cancelado—, así que la reserva se quedaría sin poder cerrarse.
   */
  if (payment.status === 'cancelled') return deny('reservations.signal.adopt.cancelled');

  if (!payment.bookingRequestId || payment.bookingRequestId !== bookingRequestId) {
    return deny('reservations.signal.adopt.otherRequest');
  }

  return ALLOW;
}

/**
 * Lo que de verdad ha entrado por este cobro.
 *
 * ⚠️ **Descuenta lo devuelto, igual que `sumPaid()`.** Un pago parcialmente
 * devuelto sigue en `paid` por el resto —marcarlo `refunded` entero haría que
 * los informes dejaran de contar un dinero que sí se quedó—, así que mirar solo
 * `paidAmount` daría por cobrada una señal que volvió a la tarjeta del cliente.
 */
export function netPaidOf(payment: AdoptableSignal): number {
  const cobrado = Number(payment.paidAmount) || 0;
  const devuelto = Number(payment.refundedAmount) || 0;
  return roundMoney(Math.max(0, cobrado - devuelto));
}

/**
 * ⚠️ **El bloque `initialPayment` NO se construye aquí, y es deliberado.** Lo
 * hace `buildInitialPayment(importe, { paidAmount })`, que ya es la única
 * autoridad sobre cómo se arma esa pieza —y sobre que una señal de 0 nazca
 * `waived` y no pendiente de cero euros—. Una segunda función que armara lo
 * mismo con los datos de un cobro sería la copia que se queda vieja el día que
 * aquella cambie.
 *
 * Lo que sí decide este fichero es **qué importe lleva dentro**: el del cobro,
 * porque es contra esa cifra contra la que el cliente pagó. Quien aplica el
 * tope contra el precio del alquiler es el servicio, que es el único que
 * conoce el total.
 */

/**
 * Los campos que hay que escribirle al cobro para que pase a ser la señal de
 * esta reserva.
 *
 * ⚠️ **`isFreePayment` NO se quita aquí, y no es un olvido.** Quitarlo necesita
 * el centinela `deleteField()`, que es un objeto con propiedades propias: si
 * viajara dentro de este mapa, cualquiera que lo recorriera para limpiarlo lo
 * convertiría en `{}` y Firestore escribiría un mapa vacío en vez de borrar el
 * campo. Lo añade quien escribe, **después** de limpiar. Es la regla de
 * `cleanForFirestore()`, y ya corrompió los timestamps de los contratos una vez.
 *
 * ⚠️ **El `type` pasa a `initial_payment`, y eso tiene consecuencias
 * deliberadas**: desde ese momento `isGovernedByReservation()` impide corregir
 * su importe desde la pantalla de Pagos, porque la señal es un reparto del
 * precio y se toca en la edición de la reserva, que mueve señal y resto a la
 * vez.
 *
 * ⚠️ **Y el concepto se guarda como el TIPO, no como una frase.** Nació con un
 * texto que nombraba la referencia de la solicitud («Señal de la reserva
 * P-4K7M9X»), y esa solicitud deja de ser el sujeto en cuanto hay una reserva.
 * Con el tipo dentro, `PaymentConceptPipe` resuelve la etiqueta traducida — un
 * operador rumano no tiene por qué leer «Señal reserva».
 */
export function adoptedSignalFields(
  reservationId: string,
  reservation: {
    clientId?: string;
    clientSnapshot?: unknown;
    vehicleSnapshot?: unknown;
    pickupDateTime?: unknown;
    returnDateTime?: unknown;
    totalDays?: number;
    pricingSnapshot?: { finalPrice?: number };
  }
): Record<string, unknown> {
  const type: PaymentType = 'initial_payment';
  return {
    reservationId,
    type,
    concept: type,
    clientId: reservation.clientId,
    clientSnapshot: reservation.clientSnapshot,
    vehicleSnapshot: reservation.vehicleSnapshot,
    /**
     * El mismo bloque que llevan las filas sembradas. Sin él, la fila adoptada
     * sería la única de la reserva que no sabe decir de qué alquiler es cuando
     * se mira desde la lista de Pagos.
     */
    reservationSnapshot: {
      pickupDateTime: reservation.pickupDateTime,
      returnDateTime: reservation.returnDateTime,
      totalDays: reservation.totalDays,
      finalPrice: reservation.pricingSnapshot?.finalPrice || 0
    },
    updatedAt: { seconds: Date.now() / 1000 }
  };
}

/**
 * ¿Qué estado de cobro deja este pago adoptado? Solo para que la pantalla pueda
 * explicarlo sin repetir la aritmética.
 */
export function adoptedSignalIsPaid(payment: AdoptableSignal): boolean {
  const required = roundMoney(Math.max(0, Number(payment.amount) || 0));
  return required > 0 && netPaidOf(payment) >= required;
}
