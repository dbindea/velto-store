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
 * ⚠️ **Y si la API falla, el build NO se rompe.** Devuelve una lista vacía y la
 * página queda exactamente como estaba antes: «Cargando la flota…» y el
 * JavaScript haciendo su trabajo. Una web que no se puede compilar porque una
 * function está reiniciándose es mucho peor que una página sin HTML previo.
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
const TOPE_MS = 15000;

export async function flotaEnBuild(): Promise<CocheResumen[]> {
  try {
    const r = await fetch(API, { signal: AbortSignal.timeout(TOPE_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const datos = (await r.json()) as { vehicles?: CocheResumen[] };
    const coches = datos.vehicles ?? [];
    console.log(`[prerender] ${coches.length} coche(s) con HTML propio`);
    return coches;
  } catch (e) {
    /*
     * ⚠️ **Un aviso bien visible y seguir.** Sin él, un build que no alcanzó la
     * API produce un sitio sin fichas y nadie se entera hasta que alguien mira
     * el posicionamiento tres semanas después.
     */
    console.warn(
      `[prerender] ⚠️  No se pudo leer la flota (${e instanceof Error ? e.message : e}). ` +
        'El sitio se compila igual y las fichas las pintará el JavaScript, pero ' +
        'ESTE DESPLIEGUE SALE SIN HTML DE COCHES para los rastreadores.'
    );
    return [];
  }
}
