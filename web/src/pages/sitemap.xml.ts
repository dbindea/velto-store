import type { APIRoute } from 'astro';
import { SITIO } from '../lib/empresa';

/**
 * El sitemap, que hasta el 25 de septiembre de 2026 el `robots.txt` anunciaba
 * y **no existía** (404 medido contra el sitio de desarrollo).
 *
 * ⚠️ **Solo lleva las páginas que son HTML de verdad desde el primer byte.**
 * Las fichas de coche viven en `/coche/{id}` y las pinta JavaScript a partir de
 * `/api/vehicle`, así que aquí no pueden entrar: el sitemap se compone al
 * compilar y los coches cambian cuando el operador publica uno. Meterlas
 * obligaría a leer la flota durante el build, y eso es exactamente lo que
 * `astro.config.mjs` renuncia a hacer para que publicar un coche se vea al
 * momento sin redesplegar.
 *
 * ⚠️ **La consecuencia hay que decirla, porque no es menor:** un rastreador que
 * no ejecute JavaScript **no descubre ninguna ficha de coche** — ni por aquí ni
 * siguiendo enlaces desde `/flota`, que también se pinta al cargar. Lo que
 * posiciona hoy son las seis páginas de abajo. Si algún día hace falta que las
 * fichas posicionen, la salida no es añadirlas a mano aquí: es renderizarlas en
 * servidor, y entonces esta decisión se vuelve a tomar entera.
 *
 * ⚠️ **`/reservar` entra y el 404 no.** La consulta de fechas es una página con
 * su propio texto y su propio valor de búsqueda; una página de error no se
 * indexa nunca.
 */

/** `changefreq` y `priority` se omiten a propósito: Google los ignora desde 2023. */
const RUTAS = [
  '', // la portada
  '/flota',
  '/reservar',
  '/entrega-a-domicilio',
  '/condiciones',
  '/contacto',
] as const;

export const GET: APIRoute = () => {
  const urls = RUTAS.map(r => `  <url><loc>${SITIO}${r}</loc></url>`).join('\n');
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
