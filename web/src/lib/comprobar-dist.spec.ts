import { describe, expect, it } from 'vitest';
import { ficheroDeUrl, urlsDelSitemap } from '../../scripts/comprobar-dist.mjs';

const SITIO = 'https://veltomobility.com';

/**
 * El mapeo URL → fichero del guardia que compara el sitemap con `web/dist`.
 *
 * ⚠️ **Se prueba AQUÍ y no con un `dist` delante, que es toda la razón de que
 * la función viva fuera del guion.** Lo que decide si el guardia acierta no es
 * leer ficheros, es esta conversión: el sitemap escribe
 * `encodeURIComponent(id)` y `getStaticPaths()` usa el id **crudo** como nombre
 * de fichero. Son dos transformaciones distintas del mismo dato, y ahí es donde
 * un guardia se vuelve inútil sin que nadie se entere — dando por bueno lo que
 * falta, o fallando sobre lo que está bien.
 *
 * Es el mismo motivo por el que `qrRects()` vive fuera del dibujo del QR: un
 * guardia roto tiene exactamente la misma pinta que uno que funciona.
 */
describe('ficheroDeUrl', () => {
  it('la portada es index.html, con barra y sin ella', () => {
    expect(ficheroDeUrl(SITIO, SITIO)).toBe('index.html');
    expect(ficheroDeUrl(`${SITIO}/`, SITIO)).toBe('index.html');
  });

  it('una página fija es su fichero hermano, por `cleanUrls`', () => {
    expect(ficheroDeUrl(`${SITIO}/flota`, SITIO)).toBe('flota.html');
    expect(ficheroDeUrl(`${SITIO}/entrega-a-domicilio`, SITIO)).toBe('entrega-a-domicilio.html');
  });

  it('una ficha de coche cuelga de su carpeta', () => {
    expect(ficheroDeUrl(`${SITIO}/coche/WEO7vHPU6ZaRBJal9ak2`, SITIO)).toBe(
      'coche/WEO7vHPU6ZaRBJal9ak2.html'
    );
  });

  /**
   * ⚠️ **Este es el caso que justifica el `decodeURIComponent`.** El sitemap
   * escapa el id y el fichero lleva el id crudo; sin decodificar, el guardia
   * buscaría `coche/a%20b.html`, no lo encontraría y **tumbaría un despliegue
   * correcto**. Hoy los ids de Firestore son alfanuméricos y no muerde; el día
   * que alguien use un slug, sí.
   */
  it('decodifica lo que el sitemap escapó', () => {
    expect(ficheroDeUrl(`${SITIO}/coche/a%20b`, SITIO)).toBe('coche/a b.html');
    expect(ficheroDeUrl(`${SITIO}/coche/cami%C3%B3n`, SITIO)).toBe('coche/camión.html');
  });

  it('la barra final no cambia el fichero', () => {
    expect(ficheroDeUrl(`${SITIO}/flota/`, SITIO)).toBe('flota.html');
  });
});

describe('urlsDelSitemap', () => {
  it('saca las URL en orden y sin las etiquetas', () => {
    const xml = `<?xml version="1.0"?>
<urlset>
  <url><loc>${SITIO}</loc></url>
  <url><loc>${SITIO}/flota</loc></url>
  <url><loc>${SITIO}/coche/abc</loc></url>
</urlset>`;
    expect(urlsDelSitemap(xml)).toEqual([SITIO, `${SITIO}/flota`, `${SITIO}/coche/abc`]);
  });

  it('un sitemap sin entradas no revienta', () => {
    expect(urlsDelSitemap('<urlset></urlset>')).toEqual([]);
  });
});
