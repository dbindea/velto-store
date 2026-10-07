/**
 * La curva de descuento por duración: cuánto vale un alquiler de `d` días.
 *
 * ⚠️ **Sustituye a «tarifa del tramo × días», y no es un ajuste: es otra forma
 * de cobrar.** Con tramos, el precio de un día salta de golpe al cruzar un
 * límite, y eso producía dos cosas que Dorel pidió quitar el 6 de octubre de
 * 2026: que un alquiler **más largo pudiera costar menos en total** —7 días a
 * 80 son 560 y 8 días a 75 son 600, pero con otros números se cruza al revés—
 * y que el precio medio por día subiera al alargar.
 *
 * Aquí el total se **interpola** entre puntos de referencia, así que:
 *
 * - cada día de más **siempre** sube el total;
 * - el precio medio por día **nunca** sube al alargar;
 * - y la misma curva vale para un coche de 50, de 60 o de 90 €, porque lo que
 *   se interpola es un **multiplicador** de la tarifa base.
 *
 * ⚠️ **`B` es lo que vale UN día**, no una tarifa inventada aparte: el primer
 * punto es `(1, 1)`, así que `curveTotal(B, 1) === B` por construcción. Eso es
 * lo que permite seguir leyendo la tarifa base de la tabla de tramos del coche
 * sin añadir un campo nuevo que pudiera discrepar de ella.
 */

/** Un punto de la curva: a `dias` días, el total vale `B × multiplicador`. */
export interface CurvePoint {
  dias: number;
  multiplicador: number;
}

/**
 * Los puntos de referencia, que son una decisión **comercial** de Dorel.
 *
 * ⚠️ **Son configurables a propósito** —`curveTotal()` acepta otros— pero el
 * valor por defecto vive aquí y en un solo sitio: duplicarlos sería tener dos
 * tarifas para el mismo coche. La copia de las Cloud Functions existe solo
 * porque app y functions no pueden compartir módulo, y lleva su propia nota.
 *
 * Para una tarifa base de 50 € dan 50 · 135 · 280 · 455 · 609 · 750.
 */
export const DEFAULT_CURVE_POINTS: readonly CurvePoint[] = [
  { dias: 1, multiplicador: 1 },
  { dias: 3, multiplicador: 2.7 },
  { dias: 7, multiplicador: 5.6 },
  { dias: 14, multiplicador: 9.1 },
  { dias: 21, multiplicador: 12.18 },
  { dias: 30, multiplicador: 15 }
];

/**
 * A partir de este día la tarifa pasa a ser lineal, al 50 % de la base.
 *
 * ⚠️ **Y enlaza sin salto porque el último punto lo hace coincidir**: a 30 días
 * el multiplicador es 15, o sea 0,5 × 30. Si alguien mueve ese punto sin mover
 * este factor, el día 31 daría un total **menor** que el día 30 — justo lo que
 * esta curva existe para impedir. Lo comprueba `curvePointsProblem()`.
 */
export const LONG_STAY_FROM_DAYS = 31;
export const LONG_STAY_RATE_FACTOR = 0.5;

/** El multiplicador del total para esa duración. */
export function curveMultiplier(
  dias: number,
  puntos: readonly CurvePoint[] = DEFAULT_CURVE_POINTS
): number {
  if (!(dias > 0) || !puntos.length) return 0;

  if (dias >= LONG_STAY_FROM_DAYS) return dias * LONG_STAY_RATE_FACTOR;

  const primero = puntos[0];
  // Por debajo del primer punto no se extrapola: se cobra el primer punto. Hoy
  // ese punto es el día 1, así que esta rama solo existe para una curva editada.
  if (dias <= primero.dias) return primero.multiplicador;

  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i];
    const b = puntos[i + 1];
    if (dias >= a.dias && dias <= b.dias) {
      const avance = (dias - a.dias) / (b.dias - a.dias);
      return a.multiplicador + avance * (b.multiplicador - a.multiplicador);
    }
  }

  /*
   * Entre el último punto y el día de larga estancia. Con los puntos de hoy
   * —último en 30, larga estancia en 31— este hueco no existe, pero una curva
   * editada puede dejarlo y devolver 0 aquí haría el coche gratis.
   */
  const ultimo = puntos[puntos.length - 1];
  return ultimo.multiplicador + (dias - ultimo.dias) * LONG_STAY_RATE_FACTOR;
}

/**
 * El total del alquiler, **sin IVA** y redondeado a dos decimales.
 *
 * ⚠️ **Se redondea SOLO aquí, al final.** El multiplicador es decimal y
 * encadenar redondeos intermedios descuadraría el total contra la media diaria
 * que se le enseña al cliente. Es la misma regla que el IVA, que se calcula por
 * resta para que base + cuota cuadre al céntimo.
 */
export function curveTotal(
  baseRate: number,
  dias: number,
  puntos: readonly CurvePoint[] = DEFAULT_CURVE_POINTS
): number {
  if (!(baseRate > 0) || !(dias > 0)) return 0;
  return Math.round(baseRate * curveMultiplier(dias, puntos) * 100) / 100;
}

/**
 * El precio medio por día, para enseñarlo.
 *
 * ⚠️ **Es INFORMATIVO y no se puede usar para recalcular el total.** Redondeado
 * a dos decimales y multiplicado por los días da otra cifra: con 8 días a
 * 38,125 €, enseñar 38,13 y multiplicar daría 305,04 en vez de 305. El total
 * manda; esto solo explica.
 */
export function curveAveragePerDay(total: number, dias: number): number {
  if (!(dias > 0)) return 0;
  return Math.round((total / dias) * 100) / 100;
}

/** El salto de la escalera de precios que se le propone al operador. */
export const RATE_STEP = 5;

/**
 * Lleva un importe al múltiplo de 5 más cercano, **y en un empate baja**.
 *
 * ⚠️ **Es para lo que se PROPONE, no para lo que se cobra.** Lo pidió Dorel el
 * 8 de octubre de 2026 —«que no me recomiende 32,5 tampoco 44; mejor 30 y 45»—
 * y lo que lleva detrás es que una tarifa es un número que se dice por teléfono:
 * «treinta euros al día» se negocia, «treinta y dos cincuenta» se discute. El
 * total del alquiler lo sigue decidiendo la curva al céntimo.
 *
 * ⚠️ **El empate baja a propósito**, que es el caso de su ejemplo: 32,50 está a
 * la misma distancia de 30 que de 35 y él quiere ver 30. Y es la dirección
 * segura de las dos — subir el precio propuesto es subirle el precio a un
 * cliente sin que nadie lo haya decidido; bajarlo lo ve el operador en la misma
 * pantalla y lo corrige tecleando.
 *
 * ⚠️ **`Math.round()` NO vale**: en JavaScript redondea los empates **hacia
 * arriba** —`Math.round(6.5)` es 7—, así que 32,50 saldría 35. Negando dos veces
 * se aprovecha que los negativos empatan al revés (`Math.round(-6.5)` es −6).
 */
export function roundToRateStep(importe: number, paso: number = RATE_STEP): number {
  if (!(importe > 0) || !(paso > 0)) return 0;
  return -Math.round(-importe / paso) * paso;
}

/**
 * ¿Hay algo mal en estos puntos? Devuelve el motivo, o `null` si valen.
 *
 * ⚠️ **Las dos condiciones que se comprueban son las que dan sentido a todo
 * esto**, y hay que comprobarlas al EDITAR los puntos porque después ya no hay
 * dónde: un cliente con una reserva de 8 días más barata que la de 7 tiene
 * razón, y la cifra ya se le ha enseñado.
 */
export function curvePointsProblem(puntos: readonly CurvePoint[]): string | null {
  if (puntos.length < 2) return 'pricing.curve.errors.toofew';

  for (let i = 0; i < puntos.length; i++) {
    const p = puntos[i];
    if (!Number.isFinite(p.dias) || p.dias < 1) return 'pricing.curve.errors.days';
    if (!Number.isFinite(p.multiplicador) || p.multiplicador <= 0) {
      return 'pricing.curve.errors.multiplier';
    }
    if (i > 0 && p.dias <= puntos[i - 1].dias) return 'pricing.curve.errors.order';
  }

  /*
   * Se recorren los días uno a uno hasta pasado el salto de larga estancia, que
   * es donde están los dos bordes peligrosos: el último punto y el día 31.
   * Comprobar solo los puntos dejaría fuera justo los tramos interpolados.
   */
  const hasta = Math.max(puntos[puntos.length - 1].dias, LONG_STAY_FROM_DAYS) + 5;
  let totalPrevio = 0;
  let mediaPrevia = Number.POSITIVE_INFINITY;
  for (let d = 1; d <= hasta; d++) {
    const total = curveMultiplier(d, puntos);
    const media = total / d;
    if (total <= totalPrevio) return 'pricing.curve.errors.totalNotIncreasing';
    // Con un margen, que esto son flotantes.
    if (media > mediaPrevia + 1e-9) return 'pricing.curve.errors.averageIncreasing';
    totalPrevio = total;
    mediaPrevia = media;
  }

  return null;
}
