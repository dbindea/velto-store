/**
 * Dónde se puede pulsar para vaciar un campo.
 *
 * ⚠️ **Vive fuera de la directiva por la misma razón que `qrRects()` vive
 * fuera del dibujo del QR: un aspa que no se puede pulsar tiene exactamente la
 * misma pinta que una buena.** El aspa se dibuja como fondo del campo, así que
 * el CSS la pinta siempre en su sitio; lo único que puede fallar es esta
 * aritmética, y un signo invertido o un `<` por un `<=` dan un icono
 * perfectamente visible que no hace nada al pulsarlo. Con la cuenta aquí, un
 * test la comprueba sin necesitar un navegador ni un DOM.
 */

/**
 * Cuánto mide la zona, por la derecha del campo.
 *
 * Es el mismo ancho que la zona del calendario en `DatePickerDirective`
 * (`ZONA_ICONO_PX`), y eso no es casualidad: en un campo de fecha las dos
 * conviven, una pegada a la otra, y si midieran distinto una se comería parte
 * del icono de la vecina.
 */
export const ZONA_ASPA_PX = 34;

/**
 * En un campo de fecha u hora el borde derecho ya lo ocupa el calendario, así
 * que el aspa se corre este hueco hacia dentro.
 */
export const DESPLAZAMIENTO_FECHA_PX = ZONA_ASPA_PX;

/**
 * ¿Cae esa abscisa sobre el aspa?
 *
 * En un campo normal la zona es la banda pegada al borde derecho; en uno de
 * fecha es la banda **anterior** a la del calendario. Fuera de ella el clic es
 * un clic normal —coloca el cursor donde se pulsó—, que es lo que cualquiera
 * espera de un campo de texto.
 *
 * ⚠️ **El límite derecho es abierto y el izquierdo cerrado** (`>= desde` y
 * `< hasta`). En un campo de fecha las dos bandas son contiguas, así que un
 * píxel contado dos veces sería un píxel que vacía el campo **y** abre el
 * calendario.
 *
 * ⚠️ **Y la banda se recorta contra el campo.** Restando a secas, en un campo
 * más estrecho que las dos bandas juntas la zona empieza **a la izquierda del
 * borde izquierdo**, y entonces contestaría que sí a abscisas que no están
 * dentro del campo. No debería ocurrir —un campo de fecha tiene que caber
 * «dd/mm/aaaa» más sus dos iconos—, pero la cuenta no tiene por qué fiarse del
 * CSS para ser correcta.
 *
 * @param campo      `getBoundingClientRect()` del campo: basta `left` y `right`.
 * @param clientX    La abscisa del evento, en las mismas coordenadas.
 * @param desplazada `true` en fecha, hora y fecha-hora.
 */
export function enZonaDelAspa(
  campo: { left: number; right: number },
  clientX: number,
  desplazada: boolean
): boolean {
  const hasta = campo.right - (desplazada ? DESPLAZAMIENTO_FECHA_PX : 0);
  const desde = Math.max(campo.left, hasta - ZONA_ASPA_PX);
  return hasta > desde && clientX >= desde && clientX < hasta;
}
