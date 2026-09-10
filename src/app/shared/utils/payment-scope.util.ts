/**
 * Qué cobros ve cada uno en la lista global de Pagos.
 *
 * ⚠️ **La lista de todo lo cobrado desde siempre es la facturación del negocio.**
 * No hace falta que la pantalla sume nada: con las filas delante, sumarlas es
 * cuestión de un rato. Por eso el histórico es de administrador
 * (`viewPaymentHistory`) y un empleado ve **lo que está abierto**, que es con lo
 * que trabaja: lo que falta por cobrar y lo que salió mal.
 *
 * ⚠️ **Esto es interfaz, no seguridad, y conviene no confundirse.** `payments` no
 * se puede cerrar en `firestore.rules` como se cierran `expenses` o `invoices`:
 * la ficha de la reserva y la del cliente necesitan leer los pagos **cobrados**
 * para enseñar su resumen, y una regla no sabe si quien lee llegó desde una
 * reserva o desde una consulta suelta. Lo que impide de verdad reconstruir la
 * cuenta de resultados es que los gastos, las facturas y las comisiones sí sean
 * de administrador en las reglas.
 *
 * Un cobro concreto se sigue viendo en la ficha de su reserva y en la de su
 * cliente. Lo que se retira es el libro entero, no el dato que hace falta para
 * atender a quien está delante.
 */

import { Payment, PaymentStatus } from '@shared/models/payment.model';

/**
 * Los estados en los que **queda algo por hacer**.
 *
 * `failed` entra: un cobro con tarjeta rechazado hay que perseguirlo, y no dice
 * nada de lo que la empresa ingresó. Quedan fuera `paid` y `refunded` —dinero
 * que se movió— y `cancelled`, que ya no es de nadie.
 */
const ABIERTOS: PaymentStatus[] = ['pending', 'partial', 'failed'];

export function isOpenPayment(payment: Payment): boolean {
  return ABIERTOS.includes(payment.status);
}

/**
 * La lista que le toca a quien está mirando.
 *
 * ⚠️ **Se aplica al cargar, no al filtrar.** Recortando en el filtro de la
 * pantalla, cambiar la pestaña volvería a enseñarlo todo: el recorte tiene que
 * estar antes de que ningún filtro pueda tocarlo.
 */
export function visiblePayments(payments: Payment[], canViewHistory: boolean): Payment[] {
  return canViewHistory ? payments : payments.filter(isOpenPayment);
}
