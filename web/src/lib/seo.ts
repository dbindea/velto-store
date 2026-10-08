/**
 * El título y la descripción de una ficha de coche, en un solo sitio.
 *
 * ⚠️ **Existe porque la misma URL llegó a tener DOS títulos.** La ficha se
 * compone en dos momentos —el HTML sale del prerender y el JavaScript lo
 * repinta al cargar— y cada uno escribía el suyo. Medido en producción el 8 de
 * octubre de 2026:
 *
 *     servido:  Volkswagen Tiguan Allspace Advance 2.0 Tdi Dsg de alquiler en Arganda del Rey | Velto   (85)
 *     tras JS:  Volkswagen Tiguan Allspace Advance 2.0 Tdi Dsg | Velto                                  (54)
 *
 * El primero se corta en los resultados de Google y el segundo pierde la
 * palabra que importa. Y los dos juntos son peor que cualquiera de los dos: la
 * misma página dice dos cosas según quién la lea.
 *
 * ⚠️ **Y las dos vías siguen haciendo falta, así que no bastaba con borrar
 * una.** El prerender solo cubre los coches que existían al compilar; un coche
 * dado de alta después **solo** tiene el título que le ponga el JavaScript.
 */

import type { CocheResumen } from './api';
import { cambio, euros, nombreCoche } from './api';

/**
 * Lo que cabe en un `<title>` antes de que Google lo corte.
 *
 * ⚠️ **Es una medida de píxeles disfrazada de caracteres.** Google corta por
 * ancho, no por letras, así que 60 es la convención prudente: un título de
 * mayúsculas anchas se corta antes y uno de minúsculas estrechas aguanta más.
 * Pasarse no penaliza — simplemente lo que sobra no se lee.
 */
export const MAX_TITULO = 60;

/**
 * Y lo que cabe en una meta descripción.
 *
 * ⚠️ **160 es el tope, no el objetivo... salvo que aquí sí lo es.** Lo pidió
 * Dorel el 8 de octubre de 2026 —«amplía la descripción hasta el máximo
 * permitido»— y tiene sentido para este negocio: es el único texto que se lee
 * en el resultado de búsqueda, y media línea desaprovechada es media línea
 * menos para decir «precio final» y «entrega a domicilio».
 */
export const MAX_DESCRIPCION = 160;

/**
 * El sufijo de marca de todos los títulos de la casa.
 *
 * ⚠️ **Se puede caer, y por eso está aparte.** Google lo añade por su cuenta
 * cuando falta, así que entre perder la localidad y perder la marca, se pierde
 * la marca.
 */
const MARCA = ' | Velto';

/**
 * El título de una ficha, lo más completo que quepa en {@link MAX_TITULO}.
 *
 * ⚠️ **El formato es «coche — alquiler de coches en Arganda del Rey», y lo
 * propuso Dorel el 8 de octubre de 2026.** Tiene razón en lo que importa: la
 * frase por la que se busca es **«alquiler de coches en Arganda»**, y
 * «Dacia Duster de alquiler en Arganda» no la contiene — la parte, y pierde la
 * coincidencia exacta.
 *
 * Su propuesta literal era `Dacia Duster - alquiler coches en Arganda del Rey |
 * Velto Mobility`, y cambian dos cosas de ella, las dos medidas:
 *
 * - **Mide 66 caracteres** y Google corta sobre los 60, así que lo que se
 *   perdía era justo el final: «| Velto Mobility». Con «| Velto» cabe en 60
 *   exactos, y el buscador añade el nombre del sitio por su cuenta cuando falta.
 * - **«alquiler de coches», con el «de».** Sin él la frase no es la que se
 *   teclea ni la que se dice, y son dos caracteres.
 *
 * ⚠️ **Es una escalera y se baja un peldaño cada vez, no se trunca de golpe.**
 * Cortar por la letra 60 produce cosas como «…en Argan», que no es que quede
 * feo: es que la palabra por la que se compite queda partida. Lo que se
 * sacrifica va en orden de lo que menos cuesta:
 *
 *   1. la versión del coche —«Advance 2.0 Tdi Dsg»— que nadie busca;
 *   2. la marca, que Google añade sola;
 *   3. «del Rey», que Google entiende igual y los vecinos no dicen;
 *   4. y solo al final se recorta, siempre por palabras enteras.
 */
export function tituloDeCoche(c: CocheResumen): string {
  const completo = nombreCoche(c);
  const corto = [c.brand, c.model].filter(Boolean).join(' ');
  const reclamo = 'alquiler de coches en Arganda del Rey';
  const reclamoCorto = 'alquiler de coches en Arganda';

  const candidatos = [
    `${completo} - ${reclamo}${MARCA}`,
    `${corto} - ${reclamo}${MARCA}`,
    `${corto} - ${reclamo}`,
    `${corto} - ${reclamoCorto}${MARCA}`,
    `${corto} - ${reclamoCorto}`,
  ];

  for (const t of candidatos) if (t.length <= MAX_TITULO) return t;

  // Un nombre que no cabe ni así: se queda sin localidad antes que sin coche.
  return recortaPorPalabras(`${corto} - alquiler de coches`, MAX_TITULO);
}

/**
 * La descripción de una ficha, llenando hasta {@link MAX_DESCRIPCION}.
 *
 * ⚠️ **Se añaden frases enteras mientras quepan, no se corta la última.** Una
 * descripción cortada a mitad de frase se lee como un error en el resultado de
 * búsqueda, y es lo único que el cliente ve de esta página antes de decidir si
 * entra.
 *
 * El orden es el de lo que más vende: primero el coche y su precio, después lo
 * que lo diferencia —precio cerrado, entrega a domicilio— y al final los datos
 * que solo interesan a quien ya está comparando.
 */
export function descripcionDeCoche(c: CocheResumen): string {
  const nombre = nombreCoche(c);
  const desde = c.priceFrom ? `desde ${euros(c.priceFrom.gross)} al día, ` : '';

  const base =
    `Alquila un ${nombre} en Arganda del Rey: ${desde}${c.seats} plazas, ` +
    `${cambio(c.transmission).toLowerCase()} y ${c.luggageCapacity} maletas.`;

  const extras = [
    'Precio final con impuestos incluidos.',
    'Entrega a domicilio.',
    // ⚠️ La etiqueta **solo si consta**: decir que un coche no la tiene cuando
    // sí la tiene es tan falso como lo contrario, y de eso depende si el
    // cliente puede entrar en Madrid.
    c.environmentalLabel ? `Etiqueta ${c.environmentalLabel}.` : '',
    'Reserva en dos minutos.',
  ].filter(Boolean);

  return rellena(base, extras, MAX_DESCRIPCION);
}

/**
 * Añade frases mientras quepan, y para en la primera que no quepa.
 *
 * ⚠️ **Para, no se las salta.** Seguir probando metería una frase corta detrás
 * de haberse saltado una larga, y entonces el orden de importancia que decidió
 * quien escribió la lista deja de respetarse: se leería «…y 2 maletas. Reserva
 * en dos minutos.» sin el precio cerrado, que es lo que de verdad diferencia.
 */
export function rellena(base: string, extras: string[], tope: number): string {
  let salida = base;
  for (const frase of extras) {
    const siguiente = `${salida} ${frase}`;
    if (siguiente.length > tope) break;
    salida = siguiente;
  }
  return salida;
}

/** Recorta sin partir ninguna palabra. Último recurso. */
export function recortaPorPalabras(texto: string, tope: number): string {
  if (texto.length <= tope) return texto;
  const trozos = texto.slice(0, tope).split(' ');
  trozos.pop();
  return trozos.join(' ');
}
