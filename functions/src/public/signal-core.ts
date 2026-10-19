/**
 * Quién puede pagar la señal desde fuera, y cuánto.
 *
 * ⚠️ **Es la única autoridad de este camino, y está separada del endpoint a
 * propósito.** Lo que decide aquí es si un desconocido con un enlace puede
 * lanzar un cobro con tarjeta: eso tiene que poder probarse sin levantar
 * Firestore, sin red y sin pasarela. Misma razón que `receipt-core.ts` y
 * `booking-request-core.ts`.
 *
 * ⚠️ **No escribe nada ni sabe de Firestore.** Recibe lo que ya se leyó y
 * contesta. Quien escribe es `createSignalPayment`.
 */

/**
 * La señal normal y la de un alquiler barato.
 *
 * ⚠️ **Duplicadas de `APP_DEFAULTS` a propósito**, como el IVA está duplicado
 * en `contracts/pdf.ts`: la app y las functions compilan con tsconfigs
 * separados y no pueden compartir módulo. Si cambian allí, cambian aquí — y hay
 * un test que fija los dos números para que el cambio no pase en silencio.
 *
 * ⚠️ **Dos cifras y ningún porcentaje**, decisión de Dorel del 2 de octubre de
 * 2026: «50 €, y si el alquiler es menos de 50 € entonces 25 €; para no
 * complicarme con porcentajes ni cálculos complejos».
 */
export const SENAL_NORMAL = 50;
export const SENAL_REDUCIDA = 25;

/**
 * Lo que se pide de señal para un presupuesto de `bruto` euros.
 *
 * ⚠️ **Copia exacta de `suggestInitialPayment()`**, el mismo cálculo que hace
 * el botón del backoffice. Si las dos contestaran distinto, el cliente que paga
 * desde la web pagaría una señal y el que paga por el enlace que manda Dorel
 * otra — por el mismo alquiler.
 *
 * ⚠️ **El `min` final no sobra aunque lo parezca.** Protege el tramo entre 25 y
 * 50 €: un alquiler de 30 € cae en la rama reducida y pide 25, pero uno de 20 €
 * pediría 25 de los 20 que vale. Es el mismo fallo que tenía la regla antigua,
 * un escalón más abajo.
 */
export function importeSenal(bruto: number): number {
  if (!isFinite(bruto) || bruto <= 0) return 0;
  const propuesta = bruto < SENAL_NORMAL ? SENAL_REDUCIDA : SENAL_NORMAL;
  return Math.round(Math.min(propuesta, bruto) * 100) / 100;
}

/** Lo que hace falta saber de la solicitud. Nada más, para poder probarlo. */
export interface SolicitudParaCobrar {
  status?: string;
  quoteSnapshot?: { gross?: number } | null;
  /** Cuándo caduca el precio prometido. Lo que Firestore devuelva. */
  priceGuaranteedUntil?: unknown;
  /** El cobro que ya se creó para esta solicitud, si lo hay. */
  signalPaymentId?: string;
}

export type MotivoSinSenal =
  /** El entorno no ofrece pago desde la web. */
  | 'disabled'
  /** No existe esa solicitud. */
  | 'not-found'
  /** Ya se convirtió en reserva, o se descartó. */
  | 'closed'
  /** El precio prometido ha caducado. */
  | 'expired'
  /** El presupuesto no da un importe con el que cobrar. */
  | 'no-amount';

export type DecisionSenal =
  | { ok: true; importe: number; yaCreado?: string }
  | { ok: false; motivo: MotivoSinSenal };

/**
 * Convierte a fecha lo que Firestore devuelva.
 *
 * ⚠️ **Ante algo ilegible contesta `null`, y quien llama lo trata como
 * CADUCADO.** Es la regla de toda la web pública (`public/core.ts`): aquí
 * pasarse de prudente le pide al cliente que llame, y el respaldo contrario
 * —darlo por vigente— cobraría un precio que ya no se sostiene.
 */
function aFecha(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['toDate'] === 'function') {
      const d = (o as { toDate(): Date }).toDate();
      return isNaN(d.getTime()) ? null : d;
    }
    const s = o['seconds'] ?? o['_seconds'];
    if (typeof s === 'number') return new Date(s * 1000);
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * ¿Puede este visitante pagar la señal de esta solicitud?
 *
 * El orden de las comprobaciones importa, y cada una contesta una cosa
 * distinta al cliente:
 *
 * 1. **`disabled`** — el entorno no lo ofrece. Va primero porque es lo único
 *    que no depende de la solicitud, y porque con la bandera apagada no se
 *    debe ni mirar nada más.
 * 2. **`closed`** — convertida o descartada. Una convertida ya tiene su reserva
 *    con sus propios cobros: pagar aquí sembraría un cobro suelto que nadie
 *    espera. Una descartada es un «no» que ya se dio.
 * 3. **`expired`** — el precio prometido venció. Aquí NO se cobra: el importe
 *    sale de un presupuesto que ya no sostenemos. Se le pide que llame.
 * 4. **`no-amount`** — sin presupuesto no hay señal que pedir.
 *
 * ⚠️ **Y lo que NO se comprueba es la DISPONIBILIDAD del coche.** Es una
 * decisión expresa de Dorel: *«no te preocupes por la no disponibilidad porque
 * si no está el coche reservado, como tengo varios coches en la flota, puedo
 * negociar verbalmente con el cliente para darle otro de mejor categoría»*.
 *
 * Es seguro **porque lo que se promete es una categoría y no una matrícula** —
 * la misma razón por la que los textos dicen «la reserva se cierra» y nunca «el
 * coche queda reservado»—. Si algún día la web prometiera un coche concreto,
 * esta omisión pasaría a ser un cargo por algo que no se puede entregar.
 *
 * ⚠️ **`yaCreado` NO es un error.** Una solicitud con cobro ya creado es el
 * caso normal: el cliente pulsó, se fue a la pasarela y volvió sin pagar, o
 * Dorel le mandó el enlace desde el panel. Lo que no puede pasar es crear un
 * **segundo** cobro — dos filas de 50 € para la misma señal, y el cliente
 * pagando la que le llegue. Quien llama devuelve ese mismo enlace.
 */
export function puedePagarSenal(
  s: SolicitudParaCobrar | null | undefined,
  ahora: Date,
  habilitado: boolean
): DecisionSenal {
  if (!habilitado) return { ok: false, motivo: 'disabled' };
  if (!s) return { ok: false, motivo: 'not-found' };

  if (s.status === 'converted' || s.status === 'discarded') {
    return { ok: false, motivo: 'closed' };
  }

  const hasta = aFecha(s.priceGuaranteedUntil);
  if (!hasta || hasta.getTime() <= ahora.getTime()) {
    return { ok: false, motivo: 'expired' };
  }

  const importe = importeSenal(Number(s.quoteSnapshot?.gross ?? 0));
  if (importe <= 0) return { ok: false, motivo: 'no-amount' };

  const yaCreado = String(s.signalPaymentId || '').trim();
  return yaCreado ? { ok: true, importe, yaCreado } : { ok: true, importe };
}
