import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FUERA_DEL_SITEMAP, RUTAS } from '../pages/sitemap.xml';

/**
 * ⚠️ **Vive en `lib/` y no al lado de `sitemap.xml.ts`, que sería lo natural.**
 * Astro trata **todo** lo que hay en `src/pages/` como una ruta que construir,
 * así que un `.spec.ts` ahí dentro se intenta compilar como página: el build se
 * cae importando vitest, con un error de `getWorkerState` que no menciona los
 * tests por ninguna parte. Comprobado.
 *
 * ⚠️ **Este test existe porque olvidarse del sitemap NO FALLA NADA.**
 *
 * `RUTAS` está escrita a mano. Al añadir una página, si nadie la apunta ahí la
 * página se publica, se enlaza y **no se ofrece a Google**: no hay error de
 * compilación, ni aviso de `astro check`, ni test que se queje. Solo se ve
 * abriendo `dist/sitemap.xml` y contando, y eso no lo hace nadie.
 *
 * Lo que se comprueba es la correspondencia en los DOS sentidos: que no falte
 * ninguna página y que no sobre ninguna ruta. Una ruta de más es peor que una
 * de menos — le ofrece a Google una URL que devuelve 404.
 */

const PAGINAS = join(dirname(fileURLToPath(import.meta.url)), '..', 'pages');

/** Los nombres de las páginas que producen HTML, sin extensión. */
function paginasDelDisco(): string[] {
  return readdirSync(PAGINAS)
    .filter((f) => f.endsWith('.astro'))
    .map((f) => f.replace(/\.astro$/, ''));
}

/** `''` es la portada (`index.astro`); el resto es `/loquesea`. */
function rutaDe(pagina: string): string {
  return pagina === 'index' ? '' : `/${pagina}`;
}

describe('el sitemap y las paginas dicen lo mismo', () => {
  it('no falta ninguna pagina indexable', () => {
    const faltan = paginasDelDisco()
      .filter((p) => !(p in FUERA_DEL_SITEMAP))
      .map(rutaDe)
      .filter((r) => !RUTAS.includes(r as (typeof RUTAS)[number]));

    expect(
      faltan,
      `Estas paginas existen y no estan en RUTAS de sitemap.xml.ts: ${faltan.join(', ')}. ` +
        'O se anaden ahi, o se declaran en FUERA_DEL_SITEMAP con su motivo.'
    ).toEqual([]);
  });

  it('no sobra ninguna ruta, que seria ofrecer un 404 a Google', () => {
    const paginas = new Set(paginasDelDisco().map(rutaDe));
    const sobran = RUTAS.filter((r) => !paginas.has(r));
    expect(sobran, `Estas rutas del sitemap no tienen pagina: ${sobran.join(', ')}`).toEqual([]);
  });

  it('lo excluido lo esta a proposito, con su motivo escrito', () => {
    for (const [pagina, motivo] of Object.entries(FUERA_DEL_SITEMAP)) {
      expect(paginasDelDisco(), `${pagina} esta excluida y ya no existe`).toContain(pagina);
      expect(motivo.length, `${pagina} esta excluida sin explicar por que`).toBeGreaterThan(20);
    }
  });

  it('la portada va como cadena vacia, no como barra', () => {
    // El layout compone la canonica con `SITIO + ruta`: con '/' saldria
    // «https://veltomobility.com/», que es una URL distinta para Google.
    expect(RUTAS).toContain('');
    expect(RUTAS).not.toContain('/');
  });
});
