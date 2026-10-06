/**
 * La curva de descuento por duración — **copia de la app**.
 *
 * ⚠️ **Está duplicada a propósito y no por descuido**, igual que la aritmética
 * del IVA: la app y las Cloud Functions compilan con tsconfigs separados y no
 * pueden compartir módulo (ver `rootDir` en `functions/tsconfig.json`). El
 * original, con el razonamiento completo, es
 * `src/app/shared/utils/rental-curve.util.ts`.
 *
 * ⚠️ **Si se mueve un punto allí, se mueve aquí.** Lo que falla si no es lo
 * peor que puede pasar con un precio: la web pública ofrece una cifra, el
 * cliente la acepta, y el backoffice cobra otra. El cliente ya ha visto la
 * primera y tiene razón.
 */

export interface CurvePoint {
  dias: number;
  multiplicador: number;
}

/** Los mismos seis puntos que la app. Para base 50: 50 · 135 · 280 · 455 · 609 · 750. */
export const DEFAULT_CURVE_POINTS: readonly CurvePoint[] = [
  { dias: 1, multiplicador: 1 },
  { dias: 3, multiplicador: 2.7 },
  { dias: 7, multiplicador: 5.6 },
  { dias: 14, multiplicador: 9.1 },
  { dias: 21, multiplicador: 12.18 },
  { dias: 30, multiplicador: 15 }
];

export const LONG_STAY_FROM_DAYS = 31;
export const LONG_STAY_RATE_FACTOR = 0.5;

export function curveMultiplier(
  dias: number,
  puntos: readonly CurvePoint[] = DEFAULT_CURVE_POINTS
): number {
  if (!(dias > 0) || !puntos.length) return 0;
  if (dias >= LONG_STAY_FROM_DAYS) return dias * LONG_STAY_RATE_FACTOR;

  const primero = puntos[0];
  if (!primero) return 0;
  if (dias <= primero.dias) return primero.multiplicador;

  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i];
    const b = puntos[i + 1];
    if (!a || !b) continue;
    if (dias >= a.dias && dias <= b.dias) {
      const avance = (dias - a.dias) / (b.dias - a.dias);
      return a.multiplicador + avance * (b.multiplicador - a.multiplicador);
    }
  }

  const ultimo = puntos[puntos.length - 1];
  if (!ultimo) return 0;
  return ultimo.multiplicador + (dias - ultimo.dias) * LONG_STAY_RATE_FACTOR;
}

/** El total del alquiler, sin IVA. Se redondea una sola vez, al final. */
export function curveTotal(
  baseRate: number,
  dias: number,
  puntos: readonly CurvePoint[] = DEFAULT_CURVE_POINTS
): number {
  if (!(baseRate > 0) || !(dias > 0)) return 0;
  return Math.round(baseRate * curveMultiplier(dias, puntos) * 100) / 100;
}
