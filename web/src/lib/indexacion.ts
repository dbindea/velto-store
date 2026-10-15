/**
 * Qué `<meta name="robots">` lleva una página, decidido en un solo sitio.
 *
 * ⚠️ **Existe porque son DOS reglas que se solapan y había escrita una sola.**
 * `Base.astro` emitía la marca mirando únicamente si la compilación era la del
 * sitio real, así que no había forma de que una página concreta pidiera quedarse
 * fuera del índice — y hay una que tiene que pedirlo: el respaldo de las fichas
 * de coche (`coche.astro`), que sirve el mismo HTML genérico para cualquier id
 * que no existiera al compilar.
 *
 * ⚠️ **Y se compone UNA sola etiqueta.** Con las dos condiciones escritas por
 * separado en la plantilla, una página del sitio de desarrollo que además
 * pidiera `noindex` emitiría dos `<meta name="robots">`. Google se queda con la
 * más restrictiva y hoy funcionaría, pero dos etiquetas que opinan de lo mismo
 * son la clase de detalle que hace dudar del resto; y el día que alguien añada
 * un `nofollow` a una de las dos, lo que sale depende de cuál lea primero.
 */

export interface QuienLoPregunta {
  /**
   * Si esta compilación es la del sitio de verdad — `ES_SITIO_REAL` en
   * `empresa.ts`, o sea `--mode live`.
   */
  sitioReal: boolean;
  /**
   * Si **esta página** pide quedarse fuera del índice, esté donde esté.
   *
   * No es lo mismo que lo anterior: aquello habla del sitio entero y esto de
   * una página suya.
   */
  sinIndexar?: boolean;
}

/**
 * El contenido de la etiqueta, o `null` si esta página no lleva ninguna.
 *
 * ⚠️ **`null` es el caso NORMAL y el que más importa que siga siéndolo.** Una
 * página del sitio real que no pida nada no emite etiqueta: lo que la deja
 * indexable es la **ausencia**, no un `index, follow` escrito. Por eso el test
 * de al lado comprueba el control —que una página corriente no lleva marca— y
 * no solo los dos casos que sí la llevan. Afirmando únicamente lo que se
 * prohíbe, el día que esto empezara a marcarlo todo no se enteraría nadie.
 *
 * ⚠️ **El sitio de desarrollo lleva además `nofollow` y una página suelta NO.**
 * No es una incoherencia: en desarrollo lo que se persigue es que de ese host no
 * se filtre nada al índice, enlaces incluidos. En el respaldo de una ficha, los
 * enlaces son la navegación de la casa —la flota, el contacto— y a veces son el
 * único HTML que tiene un coche recién publicado: `noindex` lo saca del índice,
 * que es lo que se quiere, mientras que `nofollow` tiraría además caminos de
 * rastreo legítimos sin ganar nada.
 *
 * ⚠️ **Y una página que lleve esta marca NO puede declarar canónica a otra
 * URL.** Son señales contradictorias —Google documenta expresamente que no se
 * combinen— y el riesgo concreto no es que se ignore una: es que el `noindex` se
 * propague a la URL canónica, o sea que saque del índice justo la página buena.
 * De ahí dos consecuencias que conviene no deshacer:
 *
 * - `coche.astro` pasa `ruta={null}`, así que **no declara canónica**, y por eso
 *   puede llevar `noindex` sin riesgo. Si algún día alguien le pone una, hay que
 *   quitarle esta marca en la misma pasada.
 * - El duplicado de `velto-web.web.app` —el escaparate de producción servido
 *   también por el dominio por defecto de Firebase— **no se arregla con un
 *   `noindex`**, y es lo primero que uno intenta: esas páginas **sí** declaran
 *   canónica a `veltomobility.com`, así que marcarlas se podría llevar por
 *   delante el escaparate entero. Allí lo que consolida las dos copias es la
 *   canónica, que ya está puesta y es el mecanismo que Google recomienda para
 *   esto. Tampoco vale redirigir ese host: `CLAUDE.md` lo usa a propósito para
 *   comprobar si un despliegue ha salido, porque es lo único que se ve sin la
 *   caché de Cloudflare delante.
 */
export function marcaRobots({ sitioReal, sinIndexar }: QuienLoPregunta): string | null {
  if (!sitioReal) return 'noindex, nofollow';
  if (sinIndexar) return 'noindex';
  return null;
}
