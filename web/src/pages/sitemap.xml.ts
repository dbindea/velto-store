import type { APIRoute } from 'astro';
import { SITIO } from '../lib/empresa';
import { flotaEnBuild } from '../lib/flota-build';

/**
 * El sitemap, que hasta el 25 de septiembre de 2026 el `robots.txt` anunciaba
 * y **no existía** (404 medido contra el sitio de desarrollo).
 *
 * ⚠️ **Lleva las páginas fijas Y las fichas de coche, desde el 2 de octubre de
 * 2026.** Aquí ponía que las fichas «no pueden entrar» porque las pinta
 * JavaScript y el sitemap se compone al compilar. Dejó de ser cierto el día que
 * `/coche/[id].astro` empezó a generarlas en el build: cada coche tiene su
 * fichero HTML, y una URL que existe y no se ofrece a Google es una página que
 * nadie encuentra.
 *
 * ⚠️ **Y la decisión que protegía aquella nota sigue intacta.** Lo que
 * `astro.config.mjs` defiende es que **publicar un coche se vea al momento**, y
 * eso lo conserva el respaldo: el rewrite `/coche/**` sigue sirviendo
 * `coche.html` para un coche que no existía al compilar. Lo que cambia es que
 * los que sí existían tienen además su HTML.
 *
 * ⚠️ **El motivo de todo esto fue una medición:** `/flota` servía **61
 * palabras** —la última, «Cargando la flota…»— y una ficha, 118, que eran el
 * formulario de pre-reserva. Google ejecuta JavaScript; los rastreadores de los
 * buscadores con IA, en general no. El catálogo de la empresa no existía para
 * ellos.
 *
 * ⚠️ **`/reservar` entra y el 404 no.** La consulta de fechas es una página con
 * su propio texto y su propio valor de búsqueda; una página de error no se
 * indexa nunca.
 */

/**
 * `changefreq` y `priority` se omiten a propósito: Google los ignora desde 2023.
 *
 * ⚠️ **Esta lista está escrita a mano, y olvidarse de una página NO FALLA
 * NADA**: ni el build, ni `astro check`, ni los tests. La página simplemente no
 * se ofrece a Google, y eso solo se ve abriendo `dist/sitemap.xml` y contando
 * — que es lo que nadie hace. Por eso hay un test al lado
 * (`sitemap.spec.ts`) que recorre `src/pages/` y exige que cada página
 * indexable esté aquí: si añades una y no la apuntas, el test lo dice.
 */
export const RUTAS = [
  '', // la portada
  '/flota',
  '/reservar',
  '/entrega-a-domicilio',
  '/pon-tu-coche-en-alquiler',
  '/preguntas-frecuentes',
  '/condiciones',
  '/contacto',
  '/devoluciones',
  '/aviso-legal',
  '/privacidad',
] as const;

/**
 * Las que NO entran, cada una con su motivo. Existe para que el test pueda
 * distinguir «se ha olvidado» de «se ha decidido».
 */
export const FUERA_DEL_SITEMAP: Record<string, string> = {
  '404': 'una página de error no se indexa nunca',
  coche: 'la ficha vive en /coche/{id} y la pinta JavaScript: no hay una URL que listar',
};

export const GET: APIRoute = async () => {
  /**
   * ⚠️ **Las fichas de coche SÍ entran, desde el 2 de octubre de 2026.** La
   * nota de arriba decía que no podían —«las pinta JavaScript, no hay una URL
   * que listar»— y dejó de ser cierta el día que `/coche/[id].astro` empezó a
   * generarlas en el build: ahora cada coche tiene su fichero HTML, con su
   * título, su foto y sus datos estructurados. Una URL que existe como HTML y
   * no se ofrece a Google es una página que nadie va a encontrar.
   *
   * ⚠️ **Se leen de la MISMA fuente que las genera.** Una segunda llamada o
   * una lista escrita a mano daría un sitemap que anuncia coches sin página —o
   * peor, que se calla los que sí la tienen—. Si la API falló al compilar, el
   * sitemap sale con las once páginas fijas y ninguna ficha, que es
   * exactamente lo que hay en el `dist` de ese build.
   */
  const coches = await flotaEnBuild();
  const fichas = coches.map((c) => `/coche/${encodeURIComponent(c.id)}`);

  const urls = [...RUTAS, ...fichas]
    .map(r => `  <url><loc>${SITIO}${r}</loc></url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  /*
   * ⚠️ **Sin `Cache-Control` a propósito.** El sitio es `output: static`: Astro
   * escribe este cuerpo en `dist/sitemap.xml` y **descarta la respuesta**, así
   * que una cabecera declarada aquí no llega a nadie — quedaría como código que
   * parece gobernar algo y no gobierna nada. La caché la pone el bloque
   * `headers` de `firebase.json`.
   */
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
