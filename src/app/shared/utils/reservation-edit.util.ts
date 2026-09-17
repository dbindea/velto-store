/**
 * Qué se puede cambiar de una reserva ya creada, y cuándo.
 *
 * Hasta el 15 de septiembre de 2026 **no se podía cambiar nada**: creada una
 * reserva, el cliente, las fechas y los importes quedaban fijos, y el único
 * arreglo de un dato mal tecleado era cancelarla y crearla otra vez —perdiendo
 * su número, sus notas y su histórico de cobros—. Los servicios tenían un
 * `updateReservation()` genérico **que no llamaba nadie** y que no comprobaba
 * nada: habría dejado mover el precio de una reserva cerrada.
 *
 * ⚠️ **Esta es la única autoridad sobre qué es editable**, igual que
 * `reservation-workflow.util.ts` lo es sobre qué pasos se pueden dar. La
 * pantalla la usa para apagar o explicar cada campo y el servicio la invoca
 * antes de escribir (defensa en profundidad). No dupliques estas reglas en un
 * componente: la primera vez que discrepen, nadie sabrá cuál manda.
 *
 * ⚠️ **La decisión es POR CAMPO, y no es burocracia.** Las restricciones no se
 * parecen entre sí: la fecha de **devolución** se puede mover con el coche ya
 * entregado —una prórroga es el caso más normal del negocio— y la de
 * **recogida** no, porque el coche ya salió y la fecha real está en el parte de
 * entrega. Un único «¿se puede editar esta reserva?» tendría que contestar lo
 * más restrictivo para todos, y entonces no se podría prorrogar nada.
 *
 * ⚠️ **Lo que ya se cobró manda sobre lo que dice la reserva.** Las decisiones
 * sobre dinero se toman mirando la colección `payments`, nunca
 * `reservation.paymentSummary`: ese resumen es una COPIA que se queda vieja y
 * **no falla cuando está desfasada, responde `0`**. Con la copia vieja, una
 * fianza ya cobrada parecería editable.
 */

import { Reservation, ReservationStatus } from '@shared/models/reservation.model';
import { Contract } from '@shared/models/contract.model';
import { Payment, PaymentType } from '@shared/models/payment.model';
import { WorkflowDecision } from '@shared/utils/reservation-workflow.util';
// El redondeo del dinero derivado se importa, no se copia: dos versiones de la
// misma aritmética son dos sitios donde un céntimo puede empezar a diferir.
import { roundMoney } from '@shared/utils/payment-summary.util';

/**
 * Los campos que se pueden pedir cambiar. Es una lista cerrada a propósito: un
 * `Partial<Reservation>` abierto —lo que aceptaba `updateReservation()`— deja
 * mover `pricingSnapshot`, `reservationStatus` o `contractInfo` desde
 * cualquier llamada, que es justo lo que las reglas de Firestore intentan
 * impedir por el otro lado.
 */
export type EditableField =
  | 'client'
  | 'pickupDateTime'
  | 'returnDateTime'
  | 'agreedPrice'
  | 'depositAmount'
  | 'initialPaymentAmount'
  | 'additionalDrivers';

export interface EditContext {
  reservation: Reservation;
  /** El contrato vigente de la reserva, si lo hay. */
  contract?: Contract | null;
  /**
   * Las filas de pago de la reserva. **Fuente de verdad del dinero.**
   * Sin ellas, las decisiones sobre importes se deniegan: no se puede afirmar
   * que algo no está cobrado sin haber mirado.
   */
  payments?: Payment[] | null;
  /** `permissions.can('editPricing')` del operador que está mirando. */
  canEditPricing?: boolean;
}

const ALLOW: WorkflowDecision = { ok: true };
function deny(reason: string): WorkflowDecision {
  return { ok: false, reason };
}

function isTerminal(s: ReservationStatus): boolean {
  return s === 'closed' || s === 'cancelled';
}

/** El coche ya salió: hay hechos físicos que la reserva ya no puede reescribir. */
function isOut(s: ReservationStatus): boolean {
  return s === 'delivered' || s === 'returned' || s === 'closed';
}

/**
 * Cuánto dinero se ha **movido** en las filas de estos tipos.
 *
 * ⚠️ **Se suma en bruto, sin mirar la dirección ni restar lo devuelto**, y es
 * deliberado: la pregunta que contesta no es «¿cuánto se tiene?» sino «¿ha
 * pasado ya algo con este concepto?». Una fianza de 150 € cobrada y devuelta
 * entera deja un neto de 0, pero al cliente se le cobraron 150: cambiar
 * después el importe exigido dejaría la reserva diciendo que pedía 200 cuando
 * se le cobraron y se le devolvieron 150.
 *
 * ⚠️ **Y por eso NO sirve `sumPaid()` del resumen de pagos**, que sí resta:
 * aquel contesta cuánto entró, que es otra pregunta. Sumar una devolución como
 * si fuera un cobro es el error que infló la facturación en Informes; aquí lo
 * que importa es justo lo contrario, que la devolución también cuenta como
 * movimiento.
 *
 * Lo `cancelled` no cuenta: una fila cancelada es una fila que no llegó a
 * cobrarse.
 */
export function movedOn(payments: Payment[], types: PaymentType[]): number {
  return payments
    .filter((p) => types.includes(p.type))
    .filter((p) => p.status !== 'cancelled')
    .reduce((total, p) => total + Math.abs(Number(p.paidAmount) || 0), 0);
}

/**
 * ¿Se puede cambiar este campo ahora mismo?
 *
 * Devuelve el mismo `WorkflowDecision` que los guards del workflow —a
 * propósito: la pantalla ya sabe pintar un motivo `ok: false`, y una segunda
 * forma de decir «no, porque» solo serviría para tener dos.
 */
export function canEditField(field: EditableField, ctx: EditContext): WorkflowDecision {
  const r = ctx.reservation;

  // Una reserva cerrada es historia, y una cancelada no va a ninguna parte.
  // Cambiar el precio de un alquiler cerrado movería un ingreso ya contado en
  // Informes y, si se facturó, dejaría la factura —que es inmutable— diciendo
  // otra cosa que la reserva.
  if (r.reservationStatus === 'closed') return deny('reservations.edit.denied.closed');
  if (r.reservationStatus === 'cancelled') return deny('reservations.edit.denied.cancelled');

  switch (field) {
    /**
     * El arrendatario es **quien firma**. Con el contrato firmado, cambiarlo
     * dejaría un PDF sellado a nombre de una persona y una reserva a nombre de
     * otra; y con el coche fuera, el cliente al que se le entregó es un hecho,
     * no un campo. Para eso está volver a firmar (ver `canResignContract`).
     */
    case 'client':
      if (ctx.contract?.status === 'signed') return deny('reservations.edit.denied.contractSigned');
      if (isOut(r.reservationStatus)) return deny('reservations.edit.denied.vehicleOut');
      return ALLOW;

    /**
     * La recogida ya ocurrió: la fecha real está en el parte de entrega, con
     * sus fotos y su kilometraje. Moverla aquí haría que el contrato y el parte
     * dijeran cosas distintas sobre el mismo momento.
     */
    case 'pickupDateTime':
      if (isOut(r.reservationStatus)) return deny('reservations.edit.denied.vehicleOut');
      return ALLOW;

    /**
     * ⚠️ **Esta SÍ se puede mover con el coche fuera, y es el motivo de que las
     * decisiones sean por campo.** Una prórroga —el cliente llama y se queda el
     * coche dos días más— es el caso más corriente del negocio. Lo que cierra
     * la puerta es la devolución: a partir de ahí la fecha real la pone el
     * parte, igual que la de recogida.
     */
    case 'returnDateTime':
      if (r.reservationStatus === 'returned') return deny('reservations.edit.denied.returned');
      return ALLOW;

    /**
     * El precio lo gobierna `editPricing`, y las reglas de Firestore dicen lo
     * mismo por el otro lado: un no-administrador no puede mover
     * `pricingSnapshot` en un `update`. Si solo lo comprobara la pantalla,
     * bastaría la API REST para saltárselo.
     */
    case 'agreedPrice':
      if (!ctx.canEditPricing) return deny('reservations.edit.denied.noPricingPermission');
      return ALLOW;

    /**
     * La fianza se puede cambiar mientras **no se haya tocado dinero**. Una vez
     * cobrada, bajarla no devuelve nada y subirla no cobra nada: lo único que
     * haría es que la reserva dijera que se debe algo distinto de lo que hay.
     * Para mover fianza cobrada están «Devolver» y «Retener».
     */
    case 'depositAmount': {
      if (!ctx.payments) return deny('reservations.edit.denied.paymentsUnknown');
      const movido = movedOn(ctx.payments, ['deposit', 'deposit_refund', 'deposit_retention']);
      if (movido > 0) return deny('reservations.edit.denied.depositCollected');
      return ALLOW;
    }

    /**
     * La señal es **lo que queda por cobrar de entrada**, así que solo se puede
     * cambiar mientras no se haya cobrado nada de ella. Cobrada a medias, ya no
     * es un importe a pactar: es una deuda parcial, y lo que toca es cobrar el
     * resto o devolverlo.
     */
    case 'initialPaymentAmount': {
      if (!ctx.payments) return deny('reservations.edit.denied.paymentsUnknown');
      const cobrado = movedOn(ctx.payments, ['initial_payment']);
      if (cobrado > 0) return deny('reservations.edit.denied.initialCollected');
      return ALLOW;
    }

    /**
     * Los conductores se pueden tocar siempre que la reserva siga viva. Con el
     * contrato firmado hace falta volver a firmarlo —la cláusula 2 dice que
     * solo conducen los declarados nominalmente—, y de eso decide
     * `canResignContract`; aquí no se deniega, porque el operador sí puede
     * cambiarlos: lo que cambia es lo que hay que hacer después.
     */
    case 'additionalDrivers':
      return ALLOW;
  }
}

/**
 * ¿Hay que volver a firmar el contrato después de este cambio?
 *
 * ⚠️ **Un contrato firmado que ya no dice la verdad es peor que no tenerlo**:
 * es el documento con el que se cobra un cargo o se discute un daño, y si
 * nombra a otro conductor o otras fechas, la parte que lo enseñe pierde.
 *
 * Solo lo pide lo que **está impreso en el PDF**. El importe de la señal no lo
 * está —el contrato imprime el precio y la fianza, no el calendario de
 * cobros—, así que cambiarla no invalida nada.
 */
export function requiresNewContract(fields: EditableField[]): boolean {
  const impresos: EditableField[] = [
    'client',
    'pickupDateTime',
    'returnDateTime',
    'agreedPrice',
    'depositAmount',
    'additionalDrivers'
  ];
  return fields.some((f) => impresos.includes(f));
}

/**
 * ¿Se puede sustituir el contrato firmado por uno nuevo?
 *
 * ⚠️ **Sustituir no es borrar.** El firmado se queda archivado con su PDF, su
 * huella y su código de verificación: quien tenga la copia en papel la sigue
 * pudiendo comprobar en `/v/:codigo`. Es la misma regla que la factura
 * rectificativa —un error no se borra, se corrige con un documento nuevo— y la
 * única compatible con `firestore.rules`, que deniega `delete` en `contracts`
 * incluso al administrador.
 *
 * ⚠️ **Con el coche ya devuelto, no.** El alquiler terminó: volver a firmar
 * ahora sería firmar sobre algo que ya pasó, y lo que corresponde es un anexo.
 */
export function canResignContract(ctx: EditContext): WorkflowDecision {
  const r = ctx.reservation;
  if (isTerminal(r.reservationStatus)) return deny('reservations.edit.denied.closed');
  if (r.reservationStatus === 'returned') return deny('reservations.edit.denied.returned');
  if (!ctx.contract) return deny('workflow.missingContract');
  if (ctx.contract.status !== 'signed') return deny('reservations.edit.denied.notSigned');
  return ALLOW;
}

/**
 * Reparte un cambio en la señal sin tocar el total.
 *
 * Es literalmente lo que pidió Dorel: «en vez de cobrar señal 50 € poder cobrar
 * 30 € y sumar la cantidad pendiente a la cantidad restante». Los 20 € no
 * desaparecen, se mueven al resto.
 *
 * ⚠️ **El total es invariante, y por eso esto existe en vez de dos campos
 * sueltos.** Bajando la señal a mano y olvidando subir el resto, la reserva
 * pasaría a deber 20 € menos de lo que vale el alquiler — y se podría cerrar
 * cobrando de menos sin que nada avisara.
 *
 * Devuelve los dos importes nuevos, redondeados: `108.9 - 50` es
 * `58.900000000000006`, y eso no se enseña ni se escribe.
 */
export function redistributeInitialPayment(
  totalDue: number,
  newInitial: number
): { initial: number; remaining: number } {
  const total = roundMoney(totalDue);
  const initial = roundMoney(Math.max(0, Math.min(newInitial, total)));
  return { initial, remaining: roundMoney(total - initial) };
}

/**
 * ⚠️ **Una señal de 0 es válida y significa «no se pide señal»**, igual que una
 * fianza de 0 significa que no se pide fianza. Es el caso que puso Dorel: un
 * conocido que alquila con seguro a todo riesgo. Y como en la fianza, el hueco
 * NO es lo mismo que el cero: `Number(null)` y `Number('')` son **0**, no
 * `NaN`, así que la ausencia se comprueba antes de convertir o un campo vacío
 * se guardaría como «no se pide señal» sin que nadie lo decidiera.
 */
export function initialPaymentProblem(value: unknown, totalDue: number): string | null {
  if (value === null || value === undefined || value === '') {
    return 'reservations.edit.problems.initialRequired';
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return 'reservations.edit.problems.initialInvalid';
  if (n < 0) return 'reservations.edit.problems.initialNegative';
  if (roundMoney(n) > roundMoney(totalDue)) {
    return 'reservations.edit.problems.initialOverTotal';
  }
  return null;
}
