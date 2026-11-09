/**
 * ¿Se le ha mandado ya este correo al cliente?
 *
 * Lo pidió Dorel el 9 de noviembre de 2026: un sobre al lado del «firmado»
 * **para no duplicar envíos**. Esa frase es la especificación entera, y de ella
 * salen las dos reglas de abajo.
 *
 * ⚠️ **No usa `toDate()` de `reservation-date.util`**, que ante un valor
 * ilegible **cae a HOY** —hace bien: lo escribieron para que el pipe `date` no
 * tumbe una pantalla—. Aquí eso diría «enviado hoy a las 19:04» de un correo
 * cuya fecha nadie puede leer, que es inventarse el dato más importante de la
 * pantalla. Misma razón por la que `availability-calendar.util.ts` y
 * `public/core.ts` llevan su propio lector estricto.
 *
 * ⚠️ **Y la PRESENCIA decide el sobre; la fecha, solo el rótulo.** Son dos
 * preguntas distintas y es tentador fundirlas en una. Un `emailedAt` guardado
 * pero ilegible significa que el correo **salió**: esconder el sobre diría que
 * no, y lo siguiente es el envío duplicado que esto existe para evitar. Así que
 * ante la duda se enseña el sobre **sin fecha**, que es lo único cierto.
 */

export interface EmailSent {
  /** Si consta que el correo salió. Lo que decide si se pinta el sobre. */
  readonly sent: boolean;
  /** Cuándo, si se puede leer. `null` no significa «no se envió». */
  readonly at: Date | null;
}

export const EMAIL_NOT_SENT: EmailSent = { sent: false, at: null };

/**
 * Las cuatro formas en que una fecha llega de verdad en este proyecto, más los
 * milisegundos. Cualquier otra cosa es `null`, nunca hoy.
 *
 * ⚠️ **`seconds` se comprueba por TIPO y no por verdad.** `{ seconds: 0 }` es
 * el 1 de enero de 1970 —absurdo para un correo y aun así un valor leído—, y un
 * `if (v.seconds)` lo descartaría. Es el mismo descuido que `Number(null)` con
 * `ownerSharePercent`.
 */
export function readInstant(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;

    // Timestamp del SDK, el que escribe el admin SDK con `serverTimestamp()`.
    if (typeof v['toDate'] === 'function') {
      try {
        const d = (v['toDate'] as () => Date)();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
      } catch {
        return null;
      }
    }

    // El mapa plano que escribe `toTimestamp()`, y su variante con guion bajo.
    const seconds = typeof v['seconds'] === 'number'
      ? (v['seconds'] as number)
      : typeof v['_seconds'] === 'number'
        ? (v['_seconds'] as number)
        : null;
    if (seconds !== null) {
      const d = new Date(seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

/**
 * Resuelve el estado a partir de los sitios donde el mismo hecho puede estar
 * guardado, en orden de preferencia.
 *
 * ⚠️ **Hacen falta varios candidatos porque el mismo envío se escribe DOS veces
 * y con formas distintas.** `sendSignedContractEmail` pone `emailedAt` en el
 * contrato como `serverTimestamp()` —o sea un `Timestamp`— y en la reserva como
 * `contractInfo.emailedAt`, que es una **cadena ISO**, en la misma llamada. Una
 * pantalla tiene delante uno, otro o los dos según lo que haya cargado.
 *
 * El primer candidato **presente** manda, aunque su fecha no se pueda leer: lo
 * que se está contestando es «¿salió?», y a eso ya contestó.
 */
export function emailSentOf(...candidates: readonly unknown[]): EmailSent {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    return { sent: true, at: readInstant(candidate) };
  }
  return EMAIL_NOT_SENT;
}
