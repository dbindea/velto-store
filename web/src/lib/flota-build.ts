/**
 * La flota, leída **en el build** para que exista HTML antes del JavaScript.
 *
 * ⚠️ **Medido el 2 de octubre de 2026, y es el agujero de SEO de esta web:**
 * `/flota` servía **61 palabras** y la última decía «Cargando la flota…». Una
 * ficha de coche servía 118, y lo que había dentro era el formulario de
 * pre-reserva. O sea que para cualquiera que no ejecute JavaScript, el catálogo
 * de esta empresa **está vacío**.
 *
 * Google sí ejecuta JavaScript, con retraso y menos fiabilidad. **Los
 * rastreadores de los buscadores con IA, en general no**: GPTBot, ClaudeBot y
 * PerplexityBot leen el HTML tal cual llega. Así que la pregunta «¿dónde
 * alquilo un coche en Arganda?» se contestaba sin un solo coche de Velto
 * dentro.
 *
 * ⚠️ **Esto NO revoca la decisión de no renderizar en servidor: la
 * complementa.** `astro.config.mjs` dice que la web es estática para que
 * **publicar un coche se vea al momento**, y eso sigue intacto:
 *
 * - los coches que existían al compilar salen con su HTML de verdad;
 * - el navegador **vuelve a pedir** la flota al abrir la página y repinta, así
 *   que lo que se ve siempre es lo de ahora, no lo del build;
 * - un coche publicado después del despliegue aparece igual que hoy —lo trae
 *   el JavaScript— y además gana su HTML en el siguiente despliegue.
 *
 * ⚠️ **Y si la API falla, el build no se rompe… salvo en el SITIO REAL.** Aquí
 * ponía que no se rompía nunca, con un argumento que sigue siendo bueno donde
 * sigue aplicándose: una web que no se puede compilar porque una function está
 * reiniciándose es peor que una página sin HTML previo, y en desarrollo y en los
 * PR eso se mantiene —devuelve lista vacía y lo pinta el JavaScript—.
 *
 * ⚠️ **En `--mode live` dejó de ser cierto el 31 de octubre de 2026**, y el
 * motivo es que desde entonces hay un **despliegue nocturno sin nadie
 * delante**. Lo que antes era «este build sale sin HTML de coches» hoy es
 * «este despliegue RETIRA del índice las fichas que ya estaban publicadas»:
 *
 * - sin coches no se genera ninguna ficha, así que `/coche/renault-megane`
 *   vuelve a caer en el respaldo `coche.html`, que es `noindex`;
 * - el sitemap sale sin ellas, coherente y vacío;
 * - y `comprobar-dist.mjs` **da el visto bueno**, con razón: su trabajo es que
 *   la promesa y la mercancía coincidan, y cero y cero coinciden.
 *
 * O sea que el único aviso era un `console.warn` en el log de un workflow
 * programado a las 4 de la madrugada. Eso no es un aviso, es un mensaje en una
 * botella — y el fallo que arreglaría es exactamente el que Dorel encontró en
 * Search Console tres semanas tarde.
 *
 * Así que en el sitio real **se lanza**. El despliegue se queda rojo, no se
 * publica nada y lo que sigue sirviendo es el build anterior, que tenía sus
 * fichas. Es la decisión correcta de las dos: no hacer nada conserva lo bueno,
 * publicar lo destruye.
 */

import type { CocheResumen } from './api';
import { ES_SITIO_REAL } from './empresa';

/**
 * ⚠️ **Cada sitio prerrenderiza SU PROPIA flota, y aquí ponía lo contrario.**
 *
 * Esta constante valía siempre `velto-web-dev` bajo un comentario que decía
 * «se lee del sitio REAL aunque se esté compilando el de desarrollo»: decía una
 * cosa y hacía la otra, y el razonamiento de debajo —«los datos públicos son
 * los mismos»— es sencillamente falso. Son dos proyectos de Firebase con dos
 * flotas distintas.
 *
 * Lo que produjo, visto en producción el 5 de octubre de 2026: `veltomobility.com`
 * anunciaba **tres coches de desarrollo con sus precios** —dos de ellos llamados
 * `demo-…`—, con su ficha completa en `/coche/…` y **metidos en el sitemap**, o
 * sea ofrecidos a Google para indexar. Un cliente podía llamar pidiendo un
 * Peugeot 3008 que la empresa no tiene.
 *
 * El riesgo de equivocarse aquí es asimétrico y por eso se elige así: en
 * desarrollo, prerrenderizar de más es inocuo —la web es `noindex`—; en
 * producción, prerrenderizar coches ajenos es publicidad falsa.
 *
 * ⚠️ **Se apunta al `.web.app` y no al dominio propio**, por lo mismo que dice
 * CLAUDE.md: aquel es lo que hay publicado y el otro es eso más Cloudflare
 * delante. Un build no puede depender de un DNS que alguien esté moviendo —
 * `veltomobility.com` estuvo dando 525 hasta esta misma mañana.
 */
const API = ES_SITIO_REAL
  ? 'https://velto-web.web.app/api/fleet'
  : 'https://velto-web-dev.web.app/api/fleet';

/** Que un build no se quede colgado esperando a una function en frío. */
const TOPE_MS = 20000;

/**
 * Cuántas veces se pide antes de rendirse.
 *
 * ⚠️ **Existe porque la PRIMERA llamada paga el arranque en frío**, y era justo
 * la que generaba las fichas. Ver abajo.
 */
const INTENTOS = 3;

/**
 * La lectura del build, **una sola para todo el build**.
 *
 * ⚠️ **Esta memoización no es una optimización: es lo que impide que el sitemap
 * anuncie páginas que no existen.** Pasó en producción el 30 de octubre de 2026
 * y estuvo roto desde el 2 de octubre, que es cuando las fichas entraron en el
 * sitemap. `flotaEnBuild()` la llaman **cuatro** sitios —`getStaticPaths()` de
 * `/coche/[id].astro`, la portada, `/flota` y `/sitemap.xml`— y cada uno hacía
 * **su propio `fetch`**, así que cada uno podía contestar algo distinto. El log
 * del despliegue lo enseña tal cual:
 *
 * ```
 * [prerender] ⚠️  No se pudo leer la flota (The operation was aborted due to timeout).
 * [prerender] 3 coche(s) con HTML propio      ← /flota
 * [prerender] 3 coche(s) con HTML propio      ← /index
 * [prerender] 3 coche(s) con HTML propio      ← /sitemap.xml
 * ```
 *
 * La que falló es la **primera**, la de `getStaticPaths()`: Astro resuelve las
 * rutas antes de pintar nada, así que es siempre ella la que se come el arranque
 * en frío de la function; las tres de después encuentran la instancia caliente y
 * responden al momento. Resultado: **cero fichas generadas y tres en el
 * sitemap**. El rewrite `/coche/**` las servía con el respaldo `coche.html`, que
 * desde el 15 de octubre lleva `noindex` — o sea que la web le ofrecía a Google
 * tres páginas y acto seguido le pedía que no las indexara.
 *
 * ⚠️ **Y no lo cazó nadie**: ni el build, ni los tests, ni el guardia de
 * indexado del CI —que comprueba *qué* lleva `noindex`, no si el sitemap
 * corresponde con lo que hay—. Solo se ve en Search Console tres semanas
 * después, que es donde lo vio Dorel.
 *
 * El comentario de `sitemap.xml.ts` decía «se leen de la MISMA fuente que las
 * genera»: era cierto como *función* y falso como *dato*. Ahora es cierto como
 * dato — **una lectura, un resultado, el mismo para todos**. Si falla, falla
 * para todos a la vez: el sitemap sale sin fichas y tampoco se genera ninguna,
 * que es coherente y no engaña a nadie.
 */
let lectura: Promise<CocheResumen[]> | null = null;

export function flotaEnBuild(): Promise<CocheResumen[]> {
  lectura ??= leerFlota();
  return lectura;
}

async function leerFlota(): Promise<CocheResumen[]> {
  let ultimoFallo = '';

  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const r = await fetch(API, { signal: AbortSignal.timeout(TOPE_MS) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const datos = (await r.json()) as { vehicles?: CocheResumen[] };
      const coches = datos.vehicles ?? [];
      console.log(`[prerender] ${coches.length} coche(s) con HTML propio`);
      return coches;
    } catch (e) {
      ultimoFallo = e instanceof Error ? e.message : String(e);
      if (intento < INTENTOS) {
        /*
         * ⚠️ **Se reintenta porque el primer intento ARRANCA la function.** Aun
         * agotando su tope, la petición ha dejado la instancia levantándose, así
         * que el siguiente la encuentra caliente — que es exactamente lo que le
         * pasaba a las tres llamadas de después. Una espera corta entre medias
         * le da tiempo a terminar de arrancar.
         */
        console.warn(
          `[prerender] intento ${intento}/${INTENTOS} sin respuesta (${ultimoFallo}); ` +
            'reintentando — la primera llamada suele pagar el arranque en frío.'
        );
        await new Promise((r) => setTimeout(r, intento * 2000));
      }
    }
  }

  /*
   * ⚠️ **En el sitio real esto PARA el despliegue.** Ver la cabecera del
   * fichero: publicar sin coches no deja el sitio «como estaba», lo deja peor
   * que estaba — retira del índice unas fichas que ya tenían su HTML, su título
   * y su canónica. Y con el barrido nocturno no hay nadie leyendo el log.
   *
   * El mensaje dice qué hacer, porque quien se lo encuentre va a ser Dorel
   * delante de un correo de GitHub a las nueve de la mañana: casi siempre es la
   * function en frío o un minuto malo, y basta con relanzar el workflow.
   */
  if (ES_SITIO_REAL) {
    throw new Error(
      `No se pudo leer la flota en ${INTENTOS} intentos (${ultimoFallo}).\n` +
        '    El despliegue se PARA a propósito: sin coches no se generan sus fichas, y publicar\n' +
        '    así dejaría /coche/<slug> servido por el respaldo coche.html, que es noindex —\n' +
        '    o sea retirando de Google unas páginas que ahora mismo están bien.\n' +
        '    Lo que sigue publicado es el despliegue anterior, que sí las tiene.\n' +
        `    Casi siempre es ${API} arrancando en frío: vuelve a lanzar el workflow.`
    );
  }

  /*
   * ⚠️ **Fuera del sitio real, un aviso bien visible y seguir.** Aquí el
   * artefacto no se publica de cara a nadie y tumbar un PR porque una function
   * de desarrollo está reiniciándose sería ruido.
   *
   * ⚠️ **Y lo que sale es COHERENTE**, que es lo que de verdad importa: sin
   * fichas generadas, el sitemap tampoco las lista. Antes este mismo aviso
   * salía mientras el sitemap sí las anunciaba.
   */
  console.warn(
    `[prerender] ⚠️  No se pudo leer la flota en ${INTENTOS} intentos (${ultimoFallo}). ` +
      'El sitio se compila igual y las fichas las pintará el JavaScript, pero ' +
      'ESTE BUILD SALE SIN HTML DE COCHES para los rastreadores — y, por lo ' +
      'mismo, sin ellas en el sitemap.'
  );
  return [];
}
