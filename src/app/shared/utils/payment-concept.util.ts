import { Payment, PaymentType, PAYMENT_TYPE_LABELS } from '@shared/models/payment.model';

/**
 * La única autoridad sobre **qué rótulo lleva una fila de cobro**.
 *
 * ⚠️ **`concept` es texto del operador, pero el código lo usó como centinela de
 * «no escribió nada», y por ahí se coló el enumerado en crudo.** La ficha de la
 * reserva mandaba `concept: this.newPayment.concept || this.newPayment.type`
 * con el campo vacío, así que lo que se guardaba era la cadena `rental_payment`;
 * y `settlePendingPayment()` la tomaba por concepto tecleado —comparaba contra
 * el tipo de la fila **destino**, que al repartir un «pago completo» nunca es
 * `rental_payment`— y pisaba el «Señal reserva» sembrado. En producción se
 * escribieron así **6 de 11 filas de cobro** antes de corregirlo.
 *
 * De ahí las dos funciones de este fichero, que son la misma pregunta por los
 * dos lados: al **escribir**, si lo que llega es un enumerado no es texto del
 * operador y no debe pisar nada; al **leer**, si lo guardado es un enumerado se
 * resuelve al rótulo de la fila en vez de pintarse verbatim.
 */

/**
 * ¿Esta cadena es un valor de `PaymentType` en crudo, y por tanto algo que
 * escribió el código con el campo vacío y no una frase del operador?
 *
 * ⚠️ **`hasOwnProperty` y no indexar a pelo.** `PAYMENT_TYPE_LABELS['constructor']`
 * es verdadero por el prototipo, así que un concepto que se llamara así se
 * tomaría por enumerado y desaparecería de la pantalla.
 */
export function isPaymentTypeSentinel(concept: string | undefined | null): boolean {
  const limpio = concept?.trim();
  if (!limpio) return false;
  return Object.prototype.hasOwnProperty.call(PAYMENT_TYPE_LABELS, limpio);
}

/**
 * Lo que hay que pasarle al traductor para titular una fila de cobro.
 *
 * Devuelve **una clave i18n o el texto libre tal cual**, porque `translate()`
 * devuelve lo que no encuentra sin tocarlo: así «Rueda pinchada» sale intacto y
 * `payments.types.remainingPayment` sale traducido, que es lo que ya hacía el
 * pipe y lo que arregla al leer los documentos de `buildRepricedRow()`.
 *
 * ⚠️ **Cuando el concepto es un enumerado se contesta con el tipo de LA FILA,
 * no con el del concepto.** La fila rota vale `{ type: 'initial_payment',
 * concept: 'rental_payment' }` y son 50 € de señal: titularla «Pago completo
 * del alquiler» sería cambiar un rótulo crudo por uno que miente. El «Señal
 * reserva» sembrado ya se perdió al pisarse y no se puede recuperar, pero el
 * tipo sí dice la verdad.
 */
export function paymentConceptKey(payment: Payment | null | undefined): string {
  if (!payment) return '';

  const concepto = payment.concept?.trim();
  if (concepto && !isPaymentTypeSentinel(concepto)) return concepto;

  return PAYMENT_TYPE_LABELS[payment.type as PaymentType] ?? payment.type ?? '';
}
