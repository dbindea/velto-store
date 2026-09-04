/**
 * Qué impide guardar un formulario, campo a campo.
 *
 * La forma es siempre la misma en toda la aplicación: **nombre del campo →
 * clave de i18n**. Eso es lo que permite dos cosas a la vez con una sola
 * comprobación:
 *
 * - marcar en rojo el campo concreto y explicarlo debajo;
 * - resumir todo junto al botón, que es lo único que sirve en un formulario
 *   largo, donde el campo que falta puede estar a tres pantallas de scroll.
 *
 * ⚠️ **Una sola función por formulario, no dos.** La misma que consulta la
 * pantalla la llama el servicio antes de escribir. Tener una para pintar y otra
 * para validar es la manera segura de que acaben discrepando, y entonces la
 * pantalla deja guardar algo que el servicio rechaza — o al revés, que es peor.
 */

/** Campo → clave de i18n. Un campo sin problema simplemente no está. */
export type FieldProblems = Record<string, string>;

/** ¿Hay algo que impida guardar? */
export function hasProblems(problems: FieldProblems): boolean {
  return Object.keys(problems).length > 0;
}

/**
 * Las claves, en el orden en que se declararon.
 *
 * El orden importa: es el de los campos en la pantalla, así que el resumen se
 * lee de arriba abajo igual que el formulario.
 */
export function problemKeys(problems: FieldProblems): string[] {
  return Object.values(problems);
}

/** El primero, para el mensaje único de un servicio que lanza. */
export function firstProblem(problems: FieldProblems): string | null {
  const keys = problemKeys(problems);
  return keys.length ? keys[0] : null;
}
