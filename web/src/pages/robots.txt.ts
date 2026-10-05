import type { APIRoute } from 'astro';
import { SITIO, ES_SITIO_REAL } from '../lib/empresa';

/**
 * El `robots.txt`, generado y no estático.
 *
 * ⚠️ **Era un fichero en `public/`, y por eso salía IGUAL en los dos sitios.**
 * Decía `Allow: /` en `velto-web-dev.web.app`, así que la web de desarrollo se
 * ofrecía entera al índice de Google con un `<link canonical>` apuntando a
 * producción: un duplicado exacto del escaparate, compitiendo con el original
 * justo mientras el original todavía no existe. Lo que hay en `public/` no pasa
 * por el build y no puede saber para qué sitio se está compilando; una ruta, sí.
 *
 * ⚠️ **Y anunciaba un `sitemap.xml` que devolvía 404.** Medido el 25 de
 * septiembre de 2026 contra el sitio de desarrollo. Un sitemap anunciado y
 * ausente no es grave para el posicionamiento, pero es la clase de detalle que
 * hace dudar de todo lo demás: si esto no está, qué más falta.
 *
 * ⚠️ **En desarrollo NO se pone `Disallow: /`, y esa es la parte que se hace al
 * revés por instinto.** Un `Disallow` prohíbe **descargar** la página, así que
 * el rastreador nunca llega a leer el `<meta name="robots" content="noindex">`
 * que `Base.astro` emite — la marca queda inerte y los dos mecanismos, en vez
 * de sumarse, se tapan. Peor aún: Google documenta que una URL bloqueada por
 * `robots.txt` **puede acabar indexada igualmente** si alguien la enlaza, y
 * entonces sale en los resultados como una URL desnuda, sin título ni
 * descripción, que es la peor forma de aparecer. Para sacar algo del índice hay
 * que **dejar que lo lean** y decirles que no lo indexen.
 *
 * Las dos versiones se deciden aquí y no en dos ficheros, para que no puedan
 * divergir.
 *
 * ⚠️ **La cabecera `Cache-Control` no se pone aquí**, aunque un `Response` la
 * admita: el sitio es `output: static`, así que Astro escribe el cuerpo en
 * `dist/robots.txt` y **descarta la respuesta entera**. Lo declarado aquí no
 * llegaría a ningún cliente. Quien gobierna la caché es el bloque `headers` de
 * `firebase.json` — hoy, los 300 s de la regla general.
 */
/**
 * Los rastreadores de los buscadores con IA, nombrados uno a uno **para
 * dejarles pasar**.
 *
 * ⚠️ **Se les permite a propósito, y es una decisión de negocio, no técnica.**
 * Cuando alguien le pregunta a ChatGPT o a Perplexity «dónde alquilo un coche
 * en Arganda», la respuesta sale de lo que esos rastreadores hayan podido
 * leer. Bloquearlos es renunciar a aparecer ahí — y para un negocio local sin
 * presupuesto de publicidad, ese canal vale más que el puesto doce de Google.
 *
 * ⚠️ **Y están ESCRITOS aunque `Allow: /` ya los cubra.** Un `User-agent: *`
 * los deja entrar igual; la diferencia es que así la decisión queda tomada por
 * escrito. El día que alguien quiera cerrarlos, lo que encuentra es una línea
 * que cambiar y el motivo al lado, en vez de tener que averiguar si la
 * ausencia era una decisión o un olvido.
 *
 * ⚠️ **No confundir rastrear con entrenar.** `GPTBot` y `ClaudeBot` recogen
 * contenido que puede acabar en el entrenamiento; `OAI-SearchBot` y
 * `PerplexityBot` son los de **búsqueda**, que es lo que interesa aquí. Se
 * dejan los dos tipos porque lo que hay publicado son precios y condiciones de
 * una empresa, no obra propia que proteger.
 */
const IA = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
];

export const GET: APIRoute = () => {
  const paraIa = IA.map((b) => `User-agent: ${b}\nAllow: /\n`).join('\n');

  const texto = ES_SITIO_REAL
    ? `User-agent: *\nAllow: /\n\n${paraIa}\nSitemap: ${SITIO}/sitemap.xml\n`
    : // Desarrollo: se deja rastrear a propósito, para que el `noindex` del
      // HTML se pueda leer y surta efecto. Y no se anuncia sitemap: el del
      // sitio real ya lo anuncia el sitio real.
      //
      // ⚠️ Y aquí NO se nombra a los de IA: el `noindex` del HTML es lo que
      // los mantiene fuera, y una lista de permisos en el sitio de desarrollo
      // se lee como que se quiere que lo lean.
      `User-agent: *\nAllow: /\n`;

  return new Response(texto, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
