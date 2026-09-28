import { ReservationPaymentSummary } from '@shared/models/reservation.model';

/**
 * Si la copia desnormalizada del resumen se ha quedado vieja.
 *
 * ⚠️ **Existe porque `reservation.paymentSummary` es una COPIA**, y la fuente de
 * verdad del dinero es la colección `payments`. La copia se escribe en ciertos
 * momentos y **no falla cuando está desfasada**: contesta un número creíble y
 * equivocado, que es la peor clase de fallo con dinero.
 *
 * La usa el reconciliador de la ficha de la reserva, que corre en cada emisión
 * de los pagos: si esto dice que difieren, se recalcula la copia. O sea que esta
 * función es **lo único que separa un desfase de un momento de uno permanente**.
 *
 * ⚠️ **Y por eso compara el resumen ENTERO, campo a campo, en vez de una lista
 * escrita a mano.** La lista a mano ya falló, y falló justo donde más duele: el
 * 26 de septiembre de 2026, en producción, comparaba lo **pagado** y el
 * **total pendiente**, pero no lo **exigido**. Bajar la señal de 50 a 0 sube el
 * resto de 600 a 650 —`redistributeInitialPayment()` no mueve el total, por
 * diseño—, así que `totalPending` valía 650 antes y después y `paymentStatus`
 * seguía en `pending`: **la única señal que se miraba era precisamente la que
 * ese cambio no puede mover**. La reserva se podía abrir mil veces y la copia no
 * se arreglaba nunca; el panel pedía cobrar una señal que ya no existía.
 *
 * Recorriendo las claves del propio objeto, un campo nuevo en el resumen entra
 * solo. El comentario que había en la lista a mano —«al añadir un campo al
 * resumen hay que venir aquí, o la copia no se pone al día nunca»— describía
 * exactamente el mecanismo que acabó fallando: acordarse.
 */

/**
 * El margen: dos céntimos de medio. Los importes derivados pasan por
 * `roundMoney()`, pero una resta de flotantes puede dejar `58.900000000000006`,
 * y sin margen eso sería un bucle de recálculos que nunca cuadra.
 */
const EPSILON = 0.005;

/**
 * Lo que NO es un número y por tanto se compara por igualdad estricta.
 * Hoy solo `paymentStatus`, pero se resuelve en tiempo de ejecución para que un
 * campo de texto nuevo no se compare como si fuera dinero.
 */
function difiereValor(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    return Math.abs(Number(a ?? 0) - Number(b ?? 0)) > EPSILON;
  }
  return (a ?? null) !== (b ?? null);
}

/**
 * `true` si hay que reescribir la copia.
 *
 * Una copia **ausente** cuenta como desincronizada: es una reserva anterior al
 * resumen, o una a la que le falta, y en los dos casos hay que escribirlo.
 */
export function summaryNeedsSync(
  fresco: ReservationPaymentSummary,
  guardado: ReservationPaymentSummary | undefined | null
): boolean {
  if (!guardado) return true;

  // Las claves salen del objeto RECIÉN DERIVADO, que es el que está completo.
  // Tomarlas del guardado dejaría fuera justo los campos que a una copia vieja
  // le faltan, que son los que hay que detectar.
  for (const clave of Object.keys(fresco) as Array<keyof ReservationPaymentSummary>) {
    if (difiereValor(fresco[clave], guardado[clave])) return true;
  }
  return false;
}
