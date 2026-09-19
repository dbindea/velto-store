/**
 * El redondeo del dinero, solo.
 *
 * ⚠️ **Existe para romper un ciclo de imports, y merece la pena contarlo.**
 * `roundMoney()` vivía en `payment-summary.util.ts`, y de ahí lo importaban
 * media docena de módulos — entre ellos `pricing.util.ts`. El día que el
 * resumen de pagos necesitó una función de precios (`deliveryFeeBreakdown`, el
 * IVA del servicio a domicilio), los dos ficheros pasaron a importarse
 * mutuamente.
 *
 * Ese ciclo **hoy funcionaría**: las dos llamadas están dentro de cuerpos de
 * función y ningún módulo ejecuta nada del otro al evaluarse. Pero un ciclo
 * solo se nota el día que alguien añade una constante de módulo que sí lo
 * ejecuta, y entonces el fallo es un `undefined` en tiempo de arranque que no
 * señala a nadie. Un primitivo del dinero no tiene por qué depender de nada, y
 * así no depende.
 *
 * ⚠️ **`payment-summary.util.ts` lo sigue reexportando a propósito**, para que
 * los módulos que ya lo importaban de allí no tengan que cambiar: mover una
 * función no es motivo para tocar ocho ficheros, y cada línea tocada es una
 * línea que revisar.
 */

const ROUND = 100;

/**
 * Redondea a céntimos.
 *
 * ⚠️ **Todo importe derivado pasa por aquí antes de enseñarse o escribirse.**
 * `108.9 - 50` es `58.900000000000006` en coma flotante, y el asistente llegó a
 * enseñar eso y a sembrarlo en una fila de pago.
 */
export function roundMoney(value: number): number {
  return Math.round(value * ROUND) / ROUND;
}
