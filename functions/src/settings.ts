/**
 * Los ajustes de la operación, leídos desde el backend.
 *
 * Mismo documento que edita la pantalla de Ajustes: `settings/operation`. Las
 * functions entran con el admin SDK, así que no pasan por `firestore.rules`.
 *
 * ⚠️ **Los valores por defecto están duplicados a propósito**, igual que el tipo
 * de IVA en `contracts/pdf.ts`: la aplicación y las functions compilan con
 * tsconfigs separados y no pueden compartir módulo. Si cambian, cambian en los
 * dos sitios. La copia de la app está en
 * `src/app/shared/models/settings.model.ts`.
 *
 * ⚠️ **Un fallo leyendo ajustes no puede tumbar un PDF.** Si Firestore no
 * responde se sigue con los valores por defecto y se registra: un presupuesto
 * con siete días de validez en vez de quince es un problema pequeño; no poder
 * emitirlo, uno grande.
 */

import * as functions from 'firebase-functions';
import { firestore } from './admin-guard';

export interface OperationSettings {
  quoteValidityDays: number;
  signingLinkExpiryDays: number;
  /**
   * El IVA general, en **FRACCIÓN** (`0.21`), como `pricingSnapshot.vatRate`.
   *
   * ⚠️ **Faltaba, y el día que se usara habría mentido.** Este fichero leía dos
   * de los cinco ajustes porque los PDF solo necesitaban esos dos; en cuanto
   * algo del backend calcula un precio —la web pública— el tipo tiene que salir
   * de aquí, o se publicaría un 21 % fijo mientras Ajustes dice otra cosa. Es
   * exactamente el fallo que ya tuvo `resolveRentalPrice()` llamada sin su
   * cuarto argumento: se calculaba con un número y se guardaba con otro, y con
   * el general los dos coincidían de casualidad.
   *
   * ⚠️ **Y el 0 es un valor legítimo**, no un hueco: una reserva se puede pactar
   * sin IVA. Por eso el clamp admite desde 0.
   */
  vatRate: number;
}

const DEFAULTS: OperationSettings = {
  quoteValidityDays: 7,
  signingLinkExpiryDays: 7,
  vatRate: 0.21
};

/** Una fracción de IVA creíble. El 0 entra; un 21 (porcentaje) no. */
function clampVatRate(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

function clampDays(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)));
}

/**
 * ⚠️ **Sin caché entre invocaciones, y es deliberado.** Una instancia de Cloud
 * Functions vive minutos u horas; guardar los ajustes en una variable de módulo
 * haría que un cambio en la pantalla tardara un tiempo impredecible en surtir
 * efecto, distinto en cada instancia. Es una lectura de documento por PDF.
 */
export async function operationSettings(): Promise<OperationSettings> {
  try {
    const snap = await firestore().doc('settings/operation').get();
    if (!snap.exists) return { ...DEFAULTS };
    const data = snap.data() as Partial<OperationSettings>;
    return {
      quoteValidityDays: clampDays(data.quoteValidityDays, 1, 365, DEFAULTS.quoteValidityDays),
      signingLinkExpiryDays: clampDays(
        data.signingLinkExpiryDays,
        1,
        90,
        DEFAULTS.signingLinkExpiryDays
      ),
      vatRate: clampVatRate(data.vatRate, DEFAULTS.vatRate)
    };
  } catch (err) {
    functions.logger.warn('No se pudieron leer los ajustes; se usan los valores por defecto', err);
    return { ...DEFAULTS };
  }
}
