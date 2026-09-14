/**
 * Qué se puede devolver de un cobro con tarjeta, y qué lo impide.
 *
 * ⚠️ **Esto es lo más peligroso que hace la aplicación: saca dinero.** Todo lo
 * demás que toca dinero lo registra —cobra, apunta, liquida— y el peor error
 * posible es una cifra equivocada en una pantalla. Aquí el peor error es que
 * salgan cien euros de la cuenta de la empresa hacia la tarjeta de alguien.
 *
 * Por eso la decisión vive aquí, en una función pura y probada, y no dentro del
 * callable: lo que decide cuánto puede salir tiene que poder examinarse sin
 * levantar Firebase ni hablar con el banco.
 *
 * ⚠️ **El importe NO viaja en la petición: se calcula contra lo cobrado.** Es la
 * misma regla que el recibo de cobro, y aquí importa más: aceptando la cifra que
 * mande la pantalla, un cliente con la consola abierta podría pedir la
 * devolución de un importe que nunca pagó.
 */

/** Lo justo de un pago para decidir si admite devolución. */
export interface RefundablePayment {
  status?: string;
  method?: string;
  /** Lo que de verdad entró. */
  paidAmount?: number;
  /** Lo ya devuelto de este mismo cobro, si hubo devoluciones parciales. */
  refundedAmount?: number;
  redsys?: {
    /** El pedido con el que Redsys reconoce la operación. Sin él no hay nada que devolver. */
    order?: string;
    /** El código de autorización que dio el banco al cobrar. */
    authorizationCode?: string;
    responseCode?: string;
  };
}

/** Redondeo al céntimo. Duplicado a propósito: las functions no comparten módulo con la app. */
export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Cuánto queda por devolver de este cobro.
 *
 * ⚠️ **Descuenta lo ya devuelto.** Sin esto, dos devoluciones parciales de 50 €
 * sobre un cobro de 100 € pasarían las dos y saldrían 100 € en lugar de los 50
 * que se querían devolver la segunda vez.
 */
export function refundableAmount(payment: RefundablePayment | null | undefined): number {
  const cobrado = roundMoney(Number(payment?.paidAmount) || 0);
  const devuelto = roundMoney(Number(payment?.refundedAmount) || 0);
  return roundMoney(Math.max(0, cobrado - devuelto));
}

/**
 * Lo que impide devolver este importe, en clave de i18n, o `null` si se puede.
 *
 * El orden de las comprobaciones va de lo más general a lo más concreto, para
 * que el mensaje que llega sea el que de verdad explica el caso.
 */
export function refundProblem(
  payment: RefundablePayment | null | undefined,
  amount: unknown
): string | null {
  if (!payment) return 'payments.refund.errors.notFound';

  /**
   * ⚠️ **Solo lo que se cobró con tarjeta por la pasarela.** Un cobro en efectivo
   * o por transferencia no tiene nada que devolver en Redsys: devolverlo es
   * sacar el dinero de la caja o hacer una transferencia, y eso lo hace una
   * persona. Ofrecerlo aquí haría creer que el banco lo ha hecho.
   */
  if (payment.method !== 'redsys') {
    return 'payments.refund.errors.notCard';
  }

  /**
   * ⚠️ **Solo lo que de verdad entró.** Un pago pendiente, fallido o cancelado
   * no ha movido dinero: «devolverlo» sería regalar el importe.
   */
  if (payment.status !== 'paid' && payment.status !== 'partial') {
    return 'payments.refund.errors.notCollected';
  }

  /**
   * ⚠️ **Sin el pedido original no hay devolución posible.** Redsys no devuelve
   * «a una tarjeta»: devuelve contra la operación que autorizó, identificada por
   * su `Ds_Merchant_Order`. Sin él, la llamada la rechaza el banco — y es mejor
   * decirlo aquí que enterarse por un código de error.
   */
  if (!payment.redsys?.order) {
    return 'payments.refund.errors.noOrder';
  }

  const disponible = refundableAmount(payment);
  if (disponible <= 0) {
    return 'payments.refund.errors.alreadyRefunded';
  }

  /**
   * ⚠️ **La ausencia se comprueba antes de convertir.** `Number(null)` y
   * `Number('')` son **0**, no `NaN`: sin esto, un importe vacío pasaría como
   * una devolución de 0 € que el banco rechazaría sin que nadie supiera por qué.
   */
  if (amount === null || amount === undefined || amount === '') {
    return 'payments.refund.errors.amountRequired';
  }
  const importe = Number(amount);
  if (!Number.isFinite(importe)) return 'payments.refund.errors.amountRequired';
  if (importe <= 0) return 'payments.refund.errors.amountPositive';

  /**
   * ⚠️ **El tope, que es el cinturón principal.** Se compara al céntimo y con lo
   * ya devuelto descontado: no se puede sacar de la empresa más de lo que ese
   * cobro metió.
   */
  if (roundMoney(importe) > disponible) {
    return 'payments.refund.errors.overRefund';
  }

  return null;
}

/**
 * El importe en céntimos, que es como lo quiere Redsys.
 *
 * ⚠️ **Sin decimales y sin separadores.** 1 € son `100`. Mandar `1.00` o `1,00`
 * hace que el banco lea otra cosa, y lo que se lea de más sale de verdad.
 */
export function toRedsysAmount(amount: number): string {
  return String(Math.round(roundMoney(amount) * 100));
}

/**
 * ¿Ha aceptado Redsys la devolución?
 *
 * ⚠️ **El rango de una devolución NO es el de un cobro.** Una autorización
 * aceptada responde `0000`–`0099`; una **devolución** aceptada responde
 * `0900`–`0999`. Tratando la respuesta con la regla del cobro, una devolución
 * correcta se leería como un error y la aplicación la reintentaría — sacando el
 * dinero dos veces.
 */
export function refundAccepted(responseCode: string | number | undefined): boolean {
  if (responseCode === undefined || responseCode === null || responseCode === '') return false;
  const n = Number(responseCode);
  if (!Number.isFinite(n)) return false;
  return n >= 900 && n <= 999;
}
