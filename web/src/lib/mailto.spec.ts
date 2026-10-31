import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **La web pública no enlaza el correo con `mailto:`.**
 *
 * Decisión de Dorel del 31 de octubre de 2026: «las personas se contactan
 * conmigo a través de formulario». El razonamiento completo está en
 * `empresa.ts`, junto a la dirección.
 *
 * ⚠️ **Este test existe porque volver a poner uno NO FALLA NADA.** Compila,
 * pasa `astro check`, pasa el build, pasa el despliegue y la página se ve
 * perfectamente, así que lo único que lo impediría es acordarse — que es el
 * mecanismo que este proyecto ya ha visto fallar cuatro veces con
 * `.form-control`.
 *
 * ⚠️ **Y NO es una defensa contra el 404 de Cloudflare, aunque nació
 * creyéndolo.** Medido ese mismo día con el cambio ya desplegado: la ofuscación
 * de correo **fabrica el enlace aunque el fuente solo tenga texto**. El origen
 * sirve `Correo: reservas@veltomobility.com` y el borde entrega
 * `<a href="/cdn-cgi/l/email-protection" class="__cf_email__">`, que da 404. O
 * sea que el enlace roto no lo quita este test ni el commit que lo trajo: lo
 * quita apagar el ajuste en el panel de Cloudflare. Lo que esto sostiene es la
 * decisión de arriba, que es razón suficiente y es otra cosa.
 *
 * ⚠️ **Lo que se prohíbe es el ENLACE, no la dirección.** El correo sigue
 * escrito como texto en el aviso legal y en la política de privacidad, donde es
 * contenido obligatorio (art. 10.1.b de la LSSI) y canal de derechos del RGPD.
 * Si este test salta, la salida no es borrar el dato: es quitarle el `href`.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ⚠️ **Se busca `href=…mailto:`, no `mailto:` a secas.** Lo segundo saldría en
 * los propios comentarios que explican esta decisión —los hay en cinco
 * ficheros— y el test se volvería inútil al primer intento de desactivarlo. Lo
 * que crea el enlace es el atributo, y es lo único que se persigue.
 */
const ENLACE = /href\s*=\s*(?:"|'|\{`)\s*mailto:/i;

function ficherosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return ficherosDe(ruta);
    return /\.(astro|ts|js|mjs)$/.test(nombre) && !nombre.endsWith('.spec.ts') ? [ruta] : [];
  });
}

describe('el correo no va enlazado con mailto:', () => {
  it('no hay ni un href de mailto en toda la web', () => {
    const culpables = ficherosDe(SRC)
      .filter((f) => ENLACE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split('\\').join('/'));

    expect(
      culpables,
      `Estos ficheros enlazan el correo con mailto: ${culpables.join(', ')}.\n` +
        'Cloudflare lo reescribe a /cdn-cgi/l/email-protection, que da 404, y se lleva por ' +
        'delante tambien el texto visible. Deja la direccion como TEXTO, sin href. ' +
        'El motivo completo esta en src/lib/empresa.ts, junto a la direccion.'
    ).toEqual([]);
  });

  /**
   * ⚠️ **El control del test.** Sin él, esto pasaría igual de bien el día que
   * alguien rompa el recorrido de ficheros o la expresión: un test que solo se
   * ha visto pasar no está probado. Es la misma exigencia que el guardia del
   * `dist` y que las cláusulas sin IVA.
   */
  it('y la comprobacion sabe reconocer uno', () => {
    expect(ENLACE.test('<a href={`mailto:${EMPRESA.correo}`}>')).toBe(true);
    expect(ENLACE.test('<a href="mailto:reservas@veltomobility.com">')).toBe(true);
    expect(ENLACE.test("<a href='mailto:x@y.z'>")).toBe(true);
    // Y no confunde la prosa que explica la decision con la decision contraria.
    expect(ENLACE.test('Cloudflare ofusca los `mailto:` y deja un 404')).toBe(false);
    expect(ENLACE.test('<a href={`tel:${EMPRESA.telefono}`}>')).toBe(false);
  });

  /**
   * ⚠️ **Y la direccion tiene que SEGUIR estando donde la ley la pide.** Quitar
   * el enlace y quitar el dato son dos cosas distintas, y la segunda sí es un
   * incumplimiento: el aviso legal necesita un correo (art. 10.1.b de la LSSI) y
   * la política de privacidad, un canal por el que ejercer los derechos.
   */
  it('el aviso legal y la privacidad siguen diciendo el correo', () => {
    for (const pagina of ['aviso-legal', 'privacidad']) {
      const fuente = readFileSync(join(SRC, 'pages', `${pagina}.astro`), 'utf8');
      expect(fuente, `${pagina} ya no nombra el correo de la empresa`).toContain('EMPRESA.correo');
    }
  });
});
