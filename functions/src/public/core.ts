/**
 * La aritmética de la web pública: fechas, solapes y precio.
 *
 * ⚠️ **Todo esto está DUPLICADO a conciencia de `src/app/shared/utils/`**, igual
 * que el IVA ya lo está en `contracts/pdf.ts`. La app y las functions compilan
 * con tsconfigs separados y `rootDir` explícito: no pueden compartir módulo, y
 * el día que un fichero de entrada quede fuera de `src/` la salida se mueve en
 * silencio. No es pereza, es la única forma.
 *
 * Y como está duplicado, **está probado**: `core.spec.ts` compara contra los
 * mismos casos que el original. Una copia sin tests es una copia que diverge.
 *
 * ⚠️ **Pero NO es una copia literal, y esa es la parte importante.** Tres
 * funciones cambian de comportamiento a propósito, porque lo que en el
 * backoffice es inocuo aquí publica algo:
 *
 * | | En la app | Aquí |
 * |---|---|---|
 * | `toDate()` con una fecha ilegible | devuelve **hoy** | devuelve **null** |
 * | Un estado de reserva desconocido | no bloquea | **bloquea** |
 * | Un coche sin tarifa para esos días | precio 0 | **no se ofrece** |
 *
 * Las tres siguen la misma regla: **ante la duda, no publicar**. En una pantalla
 * con un operador delante, equivocarse de más se ve y se corrige; en una web,
 * ofrecer un coche que está alquilado es una reserva que alguien atenderá.
 */

import { VehiclePricingRule } from './types';

/** El tipo general. Duplicado de `pricing.util.ts`; si cambia allí, cambia aquí. */
export const DEFAULT_VAT_RATE = 0.21;

/** Redondeo a céntimos. `108.9 - 50` es `58.900000000000006` sin esto. */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Una fecha de Firestore, en las cuatro formas en que llega.
 *
 * ⚠️ **Devuelve `null` cuando no sabe leerla, y ESA es la diferencia con la
 * versión de la app**, que devuelve `new Date()`. Allí el respaldo es cómodo: lo
 * peor que pasa es que una pantalla enseñe la fecha de hoy y alguien lo vea.
 * Aquí ese mismo respaldo hace que **una reserva con la fecha ilegible deje de
 * bloquear**, porque su ventana pasa a ser «ahora mismo» y no solapa con nada —
 * y entonces la web ofrece un coche que está alquilado.
 *
 * ⚠️ **`_seconds` no es un capricho.** El SDK web escribe `seconds` y el admin
 * SDK —que es el que corre aquí— devuelve `_seconds` en algunos caminos. Esta
 * aplicación además **no guarda `Timestamp` de verdad**: `toTimestamp()` escribe
 * un mapa `{ seconds, nanoseconds }` normal, y olvidarlo es lo que dejó el
 * calendario vacío en producción.
 */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  const seconds = typeof v.seconds === 'number' ? v.seconds : v._seconds;
  if (typeof seconds === 'number' && isFinite(seconds)) return new Date(seconds * 1000);

  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Días de alquiler entre dos instantes.
 *
 * Bloques de 24 h, **redondeando al alza a partir de una hora de resto**: es
 * como cobra el mostrador y tiene que ser el mismo número, o la web cotiza una
 * cosa y el contrato dice otra. Copiado de `reservation-date.util.ts`.
 */
export function calculateCalendarDays(pickup: Date, ret: Date): number {
  if (ret <= pickup) return 0;
  const diffHours = (ret.getTime() - pickup.getTime()) / (1000 * 60 * 60);
  const fullDays = Math.floor(diffHours / 24);
  const remaining = diffHours % 24;
  return remaining >= 1 ? fullDays + 1 : fullDays;
}

/** ¿Se pisan dos alquileres? La misma condición que usa el backoffice. */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Los estados de reserva que **no** bloquean un coche.
 *
 * ⚠️ **La lista está INVERTIDA respecto al backoffice, y es deliberado.** Allí
 * se enumeran los tres que bloquean (`reserved`, `confirmed`, `delivered`); aquí
 * se enumeran los que no, y **todo lo demás bloquea**. La diferencia aparece el
 * día que alguien añada un estado —el ejemplo real es una prórroga, que
 * CLAUDE.md llama «el caso más normal del negocio»—: con la lista del
 * backoffice, ese estado nuevo no estaría entre los bloqueantes y la web
 * ofrecería el coche; con esta, bloquea hasta que alguien decida lo contrario.
 *
 * Es la misma lección que `collectedTotalsOf()` frente a `analytics.util.ts`:
 * una lista blanca deja de contar en silencio, una lista negra se equivoca de
 * más y se ve.
 */
export const PUBLIC_NON_BLOCKING_STATUSES = ['returned', 'closed', 'cancelled'] as const;

export function blocksAvailability(status: unknown): boolean {
  if (typeof status !== 'string') return true;
  return !(PUBLIC_NON_BLOCKING_STATUSES as readonly string[]).includes(status);
}

/**
 * Los estados de vehículo que no se ofrecen nunca.
 *
 * ⚠️ **`rented` NO está**, y es el fallo de producción del 21 de septiembre de
 * 2026: el estado es un hecho de **hoy** y la disponibilidad es una pregunta
 * sobre un **rango**. Un coche alquilado hasta el 26 se reserva perfectamente
 * para el 1 de octubre, y darlo por no disponible lo hacía inalquilable durante
 * todo un alquiler. Quien contesta es el cruce con las reservas.
 *
 * ⚠️ **`maintenance` SÍ está, al revés que en el backoffice.** Allí un coche en
 * taller se ofrece con un aviso, porque hay un operador delante que puede
 * decidir con el cliente al teléfono. Aquí no hay nadie: un cliente que reserva
 * por la web un coche que está en el taller se entera cuando viene a por él.
 */
export const PUBLIC_UNAVAILABLE_STATUSES = ['maintenance', 'out_of_service'] as const;

export function vehicleIsPublishable(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  return !(PUBLIC_UNAVAILABLE_STATUSES as readonly string[]).includes(status);
}

/** Ordena por día mínimo, como `sortPricingRules()`. */
function sorted(rules: VehiclePricingRule[]): VehiclePricingRule[] {
  return [...rules].sort((a, b) => a.minDays - b.minDays);
}

/** El tramo que cubre esos días, o `null` si ninguno lo hace. */
export function findPricingRuleByDays(
  rules: VehiclePricingRule[] | undefined,
  totalDays: number
): VehiclePricingRule | null {
  if (!rules?.length || totalDays < 1) return null;
  for (const rule of sorted(rules)) {
    if (totalDays >= rule.minDays && (rule.maxDays === null || totalDays <= rule.maxDays)) {
      return rule;
    }
  }
  return null;
}

/**
 * El precio de tarifa, **neto**, o `null` si no hay tramo que cubra esos días.
 *
 * ⚠️ **Devuelve `null` y no `0`, y esa es la otra diferencia con la app.**
 * `calculateBasePrice()` contesta `basePrice: 0` cuando ningún tramo aplica, y
 * eso —con un hueco entre tramos o un último tramo con techo— **alquilaba el
 * coche gratis** sin que fallara nada. En el backoffice ya se cerró por tres
 * capas; aquí la única capa es esta, así que un coche sin precio para esos días
 * **no se ofrece**, en vez de ofrecerse a cero.
 */
export function tariffNetPrice(
  rules: VehiclePricingRule[] | undefined,
  totalDays: number
): number | null {
  const rule = findPricingRuleByDays(rules, totalDays);
  if (!rule || !(rule.pricePerDay > 0)) return null;
  return roundMoney(totalDays * rule.pricePerDay);
}

/**
 * El precio por día más barato de la tabla, para el «desde X €/día».
 *
 * ⚠️ **Se publica ESTO y no la tabla entera.** La tabla completa es la curva de
 * descuento del negocio: dice el suelo de precio, a partir de cuántos días se
 * baja y cuánto, o sea la posición de negociación de Velto publicada para
 * cualquiera. El «desde» es lo único que el cliente necesita para comparar.
 */
export function lowestPricePerDay(rules: VehiclePricingRule[] | undefined): number | null {
  if (!rules?.length) return null;
  const precios = rules.map(r => r.pricePerDay).filter(p => typeof p === 'number' && p > 0);
  return precios.length ? Math.min(...precios) : null;
}

/**
 * El IVA se **SUMA** al neto: 30 € son 36,30 €.
 *
 * Es lo contrario de un gasto, donde se extrae del total. Duplicado de
 * `pricing.util.ts`; el tipo llega de Ajustes y **no se da por supuesto el
 * 21 %** — `resolveVatRate()` respeta un 0 guardado, que es una reserva pactada
 * sin IVA.
 */
export function addVat(net: number, vatRate: number): { net: number; gross: number; vatRate: number } {
  const rate = typeof vatRate === 'number' && vatRate >= 0 ? vatRate : DEFAULT_VAT_RATE;
  const base = roundMoney(net);
  return { net: base, gross: roundMoney(base * (1 + rate)), vatRate: rate };
}

/**
 * Ensancha la ventana pedida a **días completos**.
 *
 * ⚠️ **Es lo que impide reconstruir el calendario de ocupación al minuto.** Sin
 * esto, quien consulta puede ir estrechando la ventana hora a hora hasta dar con
 * el instante exacto en que un coche se libera — y con eso sabe a qué hora
 * devuelve un cliente concreto. Con granularidad de día, lo más fino que se
 * puede averiguar es «ese día está ocupado», que es justo lo que la web tiene
 * que contestar para ser útil.
 *
 * No resuelve el problema entero —consultando día a día se sigue sabiendo qué
 * días hay coches libres—, y eso es información que cualquier escaparate revela
 * por definición. Lo que se quita es la precisión que no hace falta.
 */
export function widenToFullDays(from: Date, to: Date): { from: Date; to: Date } {
  const inicio = new Date(from);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(to);
  if (fin.getHours() || fin.getMinutes() || fin.getSeconds() || fin.getMilliseconds()) {
    fin.setDate(fin.getDate() + 1);
  }
  fin.setHours(0, 0, 0, 0);
  return { from: inicio, to: fin };
}
