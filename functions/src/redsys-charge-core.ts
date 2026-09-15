/**
 * Las decisiones de dinero del COBRO con tarjeta, aparte y sin dependencias.
 *
 * Es el gemelo de `redsys-refund-core.ts` y existe por lo mismo: lo que decide
 * cuánto se le cobra a una tarjeta y cuánto se apunta como cobrado tiene que
 * poder probarse sin levantar Firestore ni hablar con la pasarela.
 */

/** Un pago, con lo poco que hace falta mirar aquí. */
export interface ChargeablePayment {
  amount?: number;
  paidAmount?: number;
  pendingAmount?: number;
  status?: string;
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Lo que queda por cobrar de este pago, que es lo que hay que llevar a la
 * pasarela.
 *
 * ⚠️ **NO es `amount`, y confundirlos cobra de más.** Hasta el 15 de septiembre
 * de 2026 el enlace de pago llevaba el importe entero: un concepto de 50 € del
 * que el cliente ya había dejado 20 € en efectivo generaba un enlace de **50 €**,
 * así que pagaba 70 € por algo que valía 50. Y el webhook remataba poniendo
 * `paidAmount = amount`, de modo que los 20 € que sí entraron desaparecían del
 * registro: el dinero estaba en el banco y en los libros no.
 *
 * `pendingAmount` es el campo que la aplicación mantiene al día en cada cobro
 * parcial; se respalda restando por si alguna fila vieja no lo llevara.
 */
export function outstandingAmount(payment: ChargeablePayment): number {
  const total = roundMoney(payment.amount ?? 0);
  const pendiente = payment.pendingAmount;
  if (pendiente !== undefined && pendiente !== null && Number.isFinite(Number(pendiente))) {
    return Math.max(0, roundMoney(Number(pendiente)));
  }
  return Math.max(0, roundMoney(total - roundMoney(payment.paidAmount ?? 0)));
}

/**
 * ¿Ha aceptado Redsys el COBRO?
 *
 * ⚠️ **`0000`–`0099`, y ni un código más.** El webhook comprobaba
 * `/^0[0-9][0-9][0-9]$/`, que abarca hasta `0999` — y `0900`–`0999` es el rango
 * de una **devolución** aceptada, no de un cobro (ver `refundAccepted` en
 * `redsys-refund-core.ts`, que ya lo documentaba). Con la regla ancha, el aviso
 * de una devolución aceptada se leía como un cobro aprobado y dejaba el pago en
 * `paid` con 0 pendiente: la devolución se deshacía sola en los libros mientras
 * el dinero ya había salido del banco.
 *
 * El comentario del webhook decía «0000-0099 = approved» y el código decía otra
 * cosa. Aquí solo hay una.
 */
export function chargeAccepted(responseCode: string | number | undefined | null): boolean {
  if (responseCode === undefined || responseCode === null || responseCode === '') return false;
  const n = Number(responseCode);
  if (!Number.isFinite(n)) return false;
  return n >= 0 && n <= 99;
}

/**
 * ¿Este aviso es de una devolución y no de un cobro?
 *
 * `Ds_TransactionType` viaja firmado dentro del aviso: `0` es autorización y
 * `3` es devolución. Se mira **además** del código de respuesta porque son dos
 * hechos distintos —qué operación era y cómo fue— y con los dos no hace falta
 * acertar a la primera con el rango.
 */
export function isRefundNotification(params: Record<string, unknown>): boolean {
  const tipo = String(params?.['Ds_TransactionType'] ?? '').trim();
  return tipo === '3' || tipo === '03';
}

/**
 * Lo cobrado después de aplicar un aviso aprobado.
 *
 * ⚠️ **Se SUMA lo que cobró el banco, no se pisa con el total.** El importe lo
 * dice `Ds_Amount` —en céntimos y dentro de los parámetros firmados, así que es
 * lo que de verdad se cargó y no se puede falsear—, y sumarlo es lo único que
 * deja cuadrar un pago cobrado en dos veces.
 *
 * Sumar es seguro porque el webhook sale antes si el pago ya está `paid`: un
 * reenvío de Redsys sobre un pago cerrado no vuelve a entrar aquí.
 *
 * Si el aviso no trae importe utilizable se cae a lo pendiente, que es lo que
 * se le pidió a la pasarela — nunca al total, que es de donde venía el fallo.
 */
export function appliedPaidAmount(
  payment: ChargeablePayment,
  dsAmountCents: string | number | undefined | null
): number {
  const yaCobrado = roundMoney(payment.paidAmount ?? 0);
  const n = Number(dsAmountCents);
  const cobradoAhora =
    Number.isFinite(n) && n > 0 ? roundMoney(n / 100) : outstandingAmount(payment);
  return roundMoney(yaCobrado + cobradoAhora);
}
