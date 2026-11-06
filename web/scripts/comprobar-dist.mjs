/**
 * ¿Lo que el sitemap PROMETE existe de verdad en `web/dist`?
 *
 * ⚠️ **Y no lleva `#!/usr/bin/env node`, aunque sea un guion.** Lo llevó hasta
 * el 6 de noviembre de 2026, y con él `comprobar-dist.spec.ts` **no cargaba en
 * esta máquina**: el import del spec reventaba con `SyntaxError: Invalid or
 * unexpected token` señalando su propia línea 2, que es un error que manda a
 * buscar el fallo en el fichero equivocado. Pasa con Node 24 y no con el 22 que
 * usa el CI, así que la suite de la web salía **verde en GitHub y roja en el
 * portátil** — y una suite que siempre tiene un fichero en rojo es una suite que
 * se deja de mirar. Nada lo ejecuta como `./comprobar-dist.mjs`: los tres
 * workflows lo llaman `node web/scripts/comprobar-dist.mjs`, así que la línea
 * solo decoraba.
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
 * La clave bajo la que el `<head>` guarda el adelanto de un vehículo, si lo hay.
 *
 * Es lo único que decide si ese adelanto sirve para algo: `ficha()` en
 * `api.ts` consulta `__veltoVehicle:<id>`, y una clave distinta deja la
 * promesa ahí colgada sin que nadie la lea. Ver (D).
 */
export function claveAdelantoDe(html) {
  const m = /window\["(__veltoVehicle:[^"]+)"\]\s*=/.exec(html);
  return m ? m[1] : null;
}

/** ¿Adelanta la flota? Es lo que corresponde al respaldo, que no sabe el id. */
export function adelantaFlota(html) {
  return /window\.__veltoFleet\s*=/.test(html);
}

/** El id que la ficha generada lleva dentro, que es el que le pedirá a la API. */
export function idIncrustadoDe(html) {
  const m = /data-coche-id="([^"]*)"/.exec(html);
  return m && m[1] ? m[1] : null;
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

  /*
   * (D) El adelanto del `<head>` tiene que guardarse bajo la clave que la
   * página va a consultar.
   *
   * ⚠️ **Nace de un fallo que duró seis días sin romper nada** (M-50, 6 de
   * noviembre de 2026). El 31 de octubre la dirección de una ficha pasó de ser
   * el id a ser un slug; `FichaCoche.astro` se adaptó y el adelanto de
   * `Base.astro` **no**, así que pedía `?id=renault-clio` —**404 por visita**,
   * dos errores en consola— y guardaba la promesa bajo `__veltoVehicle:<slug>`
   * mientras `ficha()` la buscaba por `__veltoVehicle:<id>`. O sea que el medio
   * segundo que ese bloque existe para ahorrar se perdía entero, **y en
   * silencio**: la página cargaba bien, solo que más tarde.
   *
   * ⚠️ **Nada podía cazarlo antes de aquí.** No es un error de tipos —el
   * adelanto es una cadena de JavaScript compuesta en el build—, ningún test de
   * fuente conoce los ids —los decide una llamada de red— y la página funciona
   * igual. Solo se ve con el artefacto delante, que es lo que este guion tiene.
   *
   * Y vale en los dos sentidos: la ficha generada tiene que adelantar **su**
   * id, y el respaldo —que sirve cualquier dirección y no puede saber de qué
   * coche se trata— **no puede adivinarlo**; ése adelanta la flota.
   */
  for (const f of fichasEnDisco(dist)) {
    const rel = `coche/${f}`;
    const html = readFileSync(join(dist, rel), 'utf8');
    const id = idIncrustadoDe(html);
    const clave = claveAdelantoDe(html);

    if (!id) {
      errores.push(
        `${rel} no lleva data-coche-id: la ficha tendrá que resolver su propio slug contra la flota,\n` +
          `    que es una petición de más en cada visita. ¿Se le dejó de pasar cocheId a FichaCoche?`
      );
      continue;
    }
    const esperada = `__veltoVehicle:${id}`;
    if (!clave) {
      errores.push(
        `${rel} no adelanta su vehículo desde el <head>: se pierden ~570 ms en cada visita.\n` +
          `    ¿Se le dejó de pasar precarga="coche" o cocheId a Base.astro?`
      );
    } else if (clave !== esperada) {
      errores.push(
        `${rel} adelanta bajo «${clave}» y la página pedirá «${esperada}»: ese adelanto no lo lee nadie.\n` +
          `    Es el fallo de M-50: la clave se compuso con algo que no es el id (el slug del path, típicamente).`
      );
    }
  }

  /* (D bis) Y el respaldo no puede adivinar un id que no conoce. */
  const respaldo = join(dist, 'coche.html');
  if (existsSync(respaldo)) {
    const html = readFileSync(respaldo, 'utf8');
    const clave = claveAdelantoDe(html);
    if (clave) {
      errores.push(
        `coche.html adelanta «${clave}», y ese respaldo sirve CUALQUIER dirección: ese id está adivinado\n` +
          `    desde el path, así que será un slug y dará 404. Tiene que adelantar la flota, que es lo que\n` +
          `    de verdad va a pedir para traducirlo.`
      );
    } else if (!adelantaFlota(html)) {
      errores.push(
        `coche.html no adelanta la flota, y la necesita sí o sí para traducir el slug a un id (idDelCoche()).`
      );
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
