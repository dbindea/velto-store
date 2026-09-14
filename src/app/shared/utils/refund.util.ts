/**
 * Si se puede devolver un cobro a la tarjeta, y cuánto.
 *
 * ⚠️ **Está DUPLICADO en `functions/src/redsys-refund-core.ts`, a propósito.**
 * La app y las functions compilan con tsconfigs separados y no pueden compartir
 * módulo (ver CLAUDE.md, la nota de `rootDir`). Es la misma decisión que con
 * `receipt.util.ts` / `receipt-core.ts` y con la aritmética del IVA: la copia de
 * aquí decide **si el botón aparece**, la de allí decide **si sale el dinero**.
 *
 * ⚠️ **La que manda es la del backend.** Esta puede quedarse corta sin que pase
 * nada grave —un botón de más que el servidor rechaza—; al revés sería un botón
 * que no hace nada. Si se cambia una regla, se cambian las dos, y los dos tests
 * llevan la misma tabla de casos.
 */

import { Payment } from '@shared/models/payment.model';
import { roundMoney } from '@shared/utils/payment-summary.util';

/** Lo que queda por devolver de este cobro, descontando lo ya devuelto. */
export function refundableAmount(payment: Payment | null | undefined): number {
  const cobrado = roundMoney(Number(payment?.paidAmount) || 0);
  const devuelto = roundMoney(Number(payment?.refundedAmount) || 0);
  return roundMoney(Math.max(0, cobrado - devuelto));
}

/**
 * ¿Se le puede ofrecer al operador el botón de devolver?
 *
 * ⚠️ **Solo lo cobrado por la pasarela.** Un cobro en efectivo o por
 * transferencia no tiene nada que devolver en Redsys: ese dinero lo devuelve una
 * persona, y ofrecer el botón haría creer que lo ha hecho el banco.
 */
export function canRefund(payment: Payment | null | undefined): boolean {
  if (!payment) return false;
  if (payment.method !== 'redsys') return false;
  if (payment.status !== 'paid' && payment.status !== 'partial') return false;
  if (!payment.redsys?.order) return false;
  if (payment.redsys?.refundInProgress) return false;
  return refundableAmount(payment) > 0;
}

/**
 * Lo que impide devolver **este importe**, en clave de i18n.
 *
 * Misma tabla que el backend, y en el mismo orden: de lo general a lo concreto,
 * para que el mensaje que se lee sea el que explica el caso.
 */
export function refundProblem(
  payment: Payment | null | undefined,
  amount: unknown
): string | null {
  if (!payment) return 'payments.refund.errors.notFound';
  if (payment.method !== 'redsys') return 'payments.refund.errors.notCard';
  if (payment.status !== 'paid' && payment.status !== 'partial') {
    return 'payments.refund.errors.notCollected';
  }
  if (!payment.redsys?.order) return 'payments.refund.errors.noOrder';

  const disponible = refundableAmount(payment);
  if (disponible <= 0) return 'payments.refund.errors.alreadyRefunded';

  /**
   * ⚠️ La ausencia se comprueba **antes** de convertir: `Number(null)` y
   * `Number('')` son 0, no `NaN`, así que un campo vacío pasaría como una
   * devolución de cero.
   */
  if (amount === null || amount === undefined || (amount as unknown) === '') {
    return 'payments.refund.errors.amountRequired';
  }
  const importe = Number(amount);
  if (!Number.isFinite(importe)) return 'payments.refund.errors.amountRequired';
  if (importe <= 0) return 'payments.refund.errors.amountPositive';
  if (roundMoney(importe) > disponible) return 'payments.refund.errors.overRefund';

  return null;
}

/** Lo devuelto hasta ahora, para enseñarlo en la ficha. */
export function refundedSoFar(payment: Payment | null | undefined): number {
  return roundMoney(Number(payment?.refundedAmount) || 0);
}
