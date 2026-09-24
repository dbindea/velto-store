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
 * ⚠️ **44 px, y el número no es estético: es el tamaño de un dedo.** Estuvo en
 * 34 —el ancho del icono del calendario, copiado de `DatePickerDirective`— y
 * Dorel lo dijo usándolo: «demasiado pequeña, hay que hacerla más grande para
 * que sea fácil de clicar». 34 px es lo que mide un icono, no lo que mide una
 * yema; las guías de Apple y de Android piden 44 y 48 px de lado para
 * cualquier cosa que se toque, y WCAG 2.5.8 pone el suelo en 24.
 *
 * El icono sigue dibujándose pequeño —una cruz de 18 px, que a 44 gritaría—:
 * **lo que crece es la zona, no el dibujo**. Es lo normal en un control táctil
 * y es invisible hasta que se acierta a la primera.
 */
export const ZONA_ASPA_PX = 44;

/**
 * ¿Cae esa abscisa sobre el aspa?
 *
 * La zona es la banda pegada al borde derecho del campo. Fuera de ella el clic
 * es un clic normal —coloca el cursor donde se pulsó—, que es lo que cualquiera
 * espera de un campo de texto.
 *
 * ⚠️ **El límite derecho es abierto y el izquierdo cerrado** (`>= desde` y
 * `< hasta`), que es la convención de todo intervalo y evita discutir a quién
 * pertenece el píxel del borde.
 *
 * ⚠️ **Y la banda se recorta contra el campo.** Restando a secas, en un campo
 * más estrecho que la banda la zona empieza **a la izquierda del borde
 * izquierdo**, y entonces contestaría que sí a abscisas que no están dentro del
 * campo. La cuenta no tiene por qué fiarse del CSS para ser correcta.
 *
 * @param campo   `getBoundingClientRect()` del campo: basta `left` y `right`.
 * @param clientX La abscisa del evento, en las mismas coordenadas.
 */
export function enZonaDelAspa(campo: { left: number; right: number }, clientX: number): boolean {
  const desde = Math.max(campo.left, campo.right - ZONA_ASPA_PX);
  return campo.right > desde && clientX >= desde && clientX < campo.right;
}
