#!/usr/bin/env node
/**
 * ¿Lo que el sitemap PROMETE existe de verdad en `web/dist`?
 *
 * ⚠️ **Nace de un fallo que estuvo vivo veintiocho días y no lo vio nadie.** El
 * 30 de octubre de 2026 Dorel trajo una captura de Search Console: quince
 * páginas «descubiertas y nunca rastreadas». Tres de ellas eran las fichas de
 * coche, y lo que pasaba es que el sitemap las anunciaba y **no existían**: el
 * rewrite `/coche/**` las servía con el respaldo `coche.html`, que lleva
 * `noindex`. O sea que la web le ofrecía a Google tres URL y acto seguido le
 * pedía que no las indexara.
 *
 * La causa está corregida en `flota-build.ts` —`flotaEnBuild()` hacía un `fetch`
 * por llamador y la primera, la de `getStaticPaths()`, pagaba el arranque en
 * frío—, pero este guion sigue haciendo falta, y **no por disciplina**:
 *
 * ⚠️ **El sitemap y el nombre del fichero son DOS TRANSFORMACIONES distintas
 * del mismo id.** El sitemap escribe `encodeURIComponent(c.id)` y
 * `getStaticPaths()` usa el id **crudo** como `params.id`, o sea como nombre de
 * fichero. Ponerse de acuerdo en el DATO —que es lo que arregló la
 * memoización— no implica ponerse de acuerdo en el MAPEO. Ese hueco no se
 * cierra solo, y es el que esto vigila.
 *
 * ⚠️ **Y mira el ARTEFACTO, no el repositorio.** `sitemap.spec.ts` compara
 * fuente contra fuente —`RUTAS` contra `src/pages/`— y eso está bien donde
 * está: esas dos existen siempre. Las fichas **no son fuente**: no hay nada en
 * `src/` que diga cuántas hay, las decide una llamada de red en tiempo de
 * build. Ningún test que solo lea el repositorio puede afirmarlo.
 *
 * Por eso esto corre **después de compilar y antes de publicar**, que es el
 * único momento en que las dos cosas existen a la vez.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIST = join(AQUI, '..', 'dist');

/**
 * La URL que anuncia el sitemap → el fichero que Firebase servirá.
 *
 * El mapeo lo fijan dos cosas de la configuración, y si alguna cambia hay que
 * cambiarlo aquí: `build.format: 'file'` de Astro —que escribe `x.html` y no
 * `x/index.html`— y `cleanUrls: true` de `firebase.json`, que resuelve `/x` a
 * `x.html`.
 *
 * ⚠️ **Se DECODIFICA cada segmento.** El sitemap escribe
 * `encodeURIComponent(id)` y el fichero lleva el id crudo, así que un id con un
 * carácter que haya que escapar divergiría — y el guardia daría un fallo falso
 * justo cuando todo está bien. Hoy los ids de Firestore son alfanuméricos y no
 * muerde; el día que alguien use un slug con acentos, sí.
 *
 * Es una función pura y aparte **para poder probarla sin un `dist` delante**,
 * por el mismo motivo que `qrRects()` vive fuera del dibujo del QR.
 */
export function ficheroDeUrl(url, sitio) {
  const ruta = url.startsWith(sitio) ? url.slice(sitio.length) : url;
  if (ruta === '' || ruta === '/') return 'index.html';
  const limpia = ruta.replace(/^\//, '').replace(/\/$/, '');
  const segmentos = limpia.split('/').map((s) => decodeURIComponent(s));
  return `${segmentos.join('/')}.html`;
}

/** Las URL que el sitemap anuncia, en orden. */
export function urlsDelSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/** El sitio que el sitemap declara, deducido de su primera entrada. */
function sitioDe(urls) {
  const primera = urls[0] ?? '';
  const m = /^(https?:\/\/[^/]+)/.exec(primera);
  return m ? m[1] : '';
}

function fichasEnDisco(dist) {
  const dir = join(dist, 'coche');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.html'));
}

/**
 * ¿Es un artefacto del SITIO de desarrollo?
 *
 * ⚠️ **Hace falta para no gritar catorce veces lo mismo.** Desarrollo marca
 * **todas** las páginas con `noindex, nofollow`, así que la comprobación (B)
 * —«lo anunciado no puede llevar marca»— saltaría en todas y taparía el
 * mensaje que de verdad importa. Las otras dos son agnósticas al modo y siguen
 * corriendo: un sitemap que promete lo que no existe está igual de roto en
 * desarrollo, y ahí es donde conviene verlo antes de que llegue a `master`.
 *
 * La marca es la del propio `indexacion.ts`: el sitio real usa `noindex` a
 * secas y solo en dos páginas; desarrollo, `noindex, nofollow` en todas.
 */
function esArtefactoDeDesarrollo(dist) {
  const portada = join(dist, 'index.html');
  if (!existsSync(portada)) return false;
  return /content="noindex, nofollow"/.test(readFileSync(portada, 'utf8'));
}

export function comprobar(dist) {
  const errores = [];
  const sitemap = join(dist, 'sitemap.xml');

  if (!existsSync(sitemap)) {
    return [`no existe ${sitemap}: ¿se ha compilado la web?`];
  }

  const urls = urlsDelSitemap(readFileSync(sitemap, 'utf8'));
  if (!urls.length) return ['el sitemap no anuncia ni una sola URL'];

  const desarrollo = esArtefactoDeDesarrollo(dist);
  if (desarrollo) {
    console.log(
      'Artefacto de DESARROLLO (todas las páginas con «noindex, nofollow»): se comprueba ' +
        'que lo anunciado existe y que toda ficha está anunciada, y se omite la marca.'
    );
  }

  const sitio = sitioDe(urls);
  const anunciados = new Set();

  for (const url of urls) {
    const rel = ficheroDeUrl(url, sitio);
    anunciados.add(rel);
    const abs = join(dist, rel);

    // (A) Lo prometido tiene que existir. Es la condición que caza la avería.
    if (!existsSync(abs)) {
      errores.push(
        `el sitemap anuncia ${url} y no existe ${rel}\n` +
          `    Google rastrearía esa URL y el rewrite /coche/** le daría el respaldo coche.html, que es noindex.\n` +
          `    Causa típica: la lectura de la flota del build falló para getStaticPaths y no para el sitemap.\n` +
          `    Mira el log de la compilación: todas sus líneas [prerender] tienen que decir el MISMO número.`
      );
      continue;
    }

    /*
     * (B) Y lo prometido no puede estar marcado como no indexable.
     *
     * ⚠️ **No es redundante con (A): es lo que sostiene esto el día que cambie
     * `format` o `cleanUrls` y el mapeo de arriba se quede viejo.** Y es además
     * el síntoma tal y como lo cuenta Search Console.
     *
     * ⚠️ **Va DESPUÉS de las comprobaciones de modo del workflow.** Contra un
     * artefacto de desarrollo saltaría en todas las URL —allí todas llevan
     * `noindex, nofollow`— y taparía el mensaje bueno, que es «esto es un build
     * de desarrollo».
     */
    if (!desarrollo && /<meta[^>]*name="robots"/.test(readFileSync(abs, 'utf8'))) {
      errores.push(`el sitemap anuncia ${url} y su ${rel} lleva <meta name="robots">`);
    }
  }

  /*
   * (C) Y al revés: una ficha generada que nadie anuncia.
   *
   * Es el fallo simétrico y no rompe nada visible — el catálogo simplemente se
   * queda fuera del índice—, así que es de los que duran meses.
   */
  for (const f of fichasEnDisco(dist)) {
    const rel = `coche/${f}`;
    if (!anunciados.has(rel)) {
      errores.push(`existe ${rel} y el sitemap NO lo anuncia: esa ficha no la va a encontrar nadie`);
    }
  }

  return errores;
}

// Solo al ejecutarlo, no al importarlo desde un test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = process.argv[2] ? process.argv[2] : DIST;
  const errores = comprobar(dist);
  for (const e of errores) console.error(`::error::${e}`);
  if (errores.length) {
    console.error(`\n${errores.length} problema(s): el sitemap y ${dist} no dicen lo mismo.`);
    process.exit(1);
  }
  console.log('OK: todo lo que el sitemap anuncia existe, es indexable, y toda ficha está anunciada.');
}
