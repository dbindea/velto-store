/**
 * Cómo se escribe lo que el visitante teclea.
 *
 * ⚠️ **Es la TERCERA copia de la misma regla, y es a propósito.** El original
 * está en `src/app/shared/utils/text-case.util.ts` (el backoffice) y ya había
 * una segunda en `functions/src/public/booking-request-core.ts`, que es la que
 * capitaliza el nombre y la población de lo que llega de esta web. Son tres
 * builds con tres tsconfig y no pueden compartir módulo — como el IVA, como los
 * colores de marca—. Si la regla cambia allí, cambia aquí.
 *
 * ⚠️ **Y lo que se copia es la regla ENTERA, no un resumen.** Cada una de sus
 * tres excepciones nació de un fallo impreso: «madrid-barajas» salía «Madrid-
 * barajas» porque se partía solo por espacios; «Arganda Del Rey» porque las
 * preposiciones internas van en minúscula y es la regla del español; y «2ºA»
 * salía «2ºa» porque se capitalizaba desde el carácter 0 y ahí había un dígito.
 * Una copia recortada vuelve a producirlos.
 */

/**
 * Los separadores que empiezan palabra. Van dentro del patrón para que
 * sobrevivan al `split`: reconstruyendo solo con las palabras se perderían.
 */
const LIMITE_PALABRA = /([\s\-–—/'’.]+)/;

/**
 * Una palabra que ya mezcla mayúsculas y minúsculas la escribió así alguien a
 * propósito —`dCi`, `BlueHDi`— y se deja intacta. Las que van todas en
 * mayúsculas no se libran: domar los gritos es justo para lo que está esto.
 */
function mezclaDeliberada(palabra: string): boolean {
  return /\p{Lu}/u.test(palabra.slice(1)) && /\p{Ll}/u.test(palabra);
}

/**
 * Preposiciones y artículos que van en minúscula **dentro** de un nombre:
 * «Arganda del Rey», no «Arganda Del Rey».
 *
 * ⚠️ **`el` no está, a propósito.** Hay topónimos donde sí lleva mayúscula
 * —«San Lorenzo de El Escorial»— y no se distinguen sin un diccionario. Fuera
 * se equivoca en menos casos que dentro.
 */
const MINUSCULA_DENTRO = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'a', 'al']);

/**
 * Capitaliza un nombre propio respetando guiones, barras y apóstrofos.
 *
 * El resto de cada palabra se pasa a minúscula a propósito: es lo que convierte
 * «ARGANDA DEL REY» o «arganda del rey» en algo que se puede imprimir.
 */
export function capitalizarNombre(valor: string): string {
  if (!valor) return valor;
  let primeraPalabraVista = false;
  return valor
    .split(LIMITE_PALABRA)
    .map((parte) => {
      if (LIMITE_PALABRA.test(parte) || !parte) return parte;

      const esPrimera = !primeraPalabraVista;
      primeraPalabraVista = true;

      if (mezclaDeliberada(parte)) return parte;
      if (!esPrimera && MINUSCULA_DENTRO.has(parte.toLowerCase())) return parte.toLowerCase();

      /*
       * ⚠️ Desde la primera letra **con caja**, no desde el carácter 0: «2ºA»
       * no puede salir «2ºa». Y buscar `\p{L}` no vale, porque el ordinal «º»
       * (U+00BA) ES letra —categoría Lo— y no tiene caja.
       */
      const primera = parte.search(/[\p{Lu}\p{Ll}]/u);
      if (primera < 0) return parte;
      return (
        parte.slice(0, primera) +
        parte.charAt(primera).toUpperCase() +
        parte.slice(primera + 1).toLowerCase()
      );
    })
    .join('');
}

/**
 * Reescribe el campo mientras se teclea **sin perder el cursor**.
 *
 * ⚠️ **Asignar `input.value` manda el cursor al final en cada tecla.** Es el
 * fallo que el backoffice pagó en 27 campos: corregir una letra en medio de
 * «San Fernando» te saltaba al final y la siguiente pulsación caía en el sitio
 * equivocado. En un móvil, donde el cursor se coloca tocando, el campo se
 * siente roto.
 *
 * El cursor nuevo se calcula transformando **el trozo anterior al cursor** y
 * midiéndolo: así sobrevive a transformaciones que quitan caracteres, no solo a
 * las que cambian la caja.
 */
export function transformarCampo(
  campo: HTMLInputElement,
  transformar: (valor: string) => string
): string {
  const previo = campo.value;
  const siguiente = transformar(previo);
  if (siguiente === previo) return siguiente;

  const cursor = campo.selectionStart ?? previo.length;
  const cursorNuevo = transformar(previo.slice(0, cursor)).length;

  campo.value = siguiente;
  // Solo con el foco puesto: fijar el rango en un campo de fondo se lo roba en
  // algunos navegadores.
  if (document.activeElement === campo) campo.setSelectionRange(cursorNuevo, cursorNuevo);
  return siguiente;
}
