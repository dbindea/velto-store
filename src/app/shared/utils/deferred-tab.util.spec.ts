import { describe, expect, it } from 'vitest';
import { waitingTabHtml } from './deferred-tab.util';

const base = { titulo: 'Generando el parte…', pista: 'No cierres esta pestaña.', idioma: 'es' };

describe('el cartel de la pestaña de espera', () => {
  it('dice lo que está pasando, y también en el título de la pestaña', () => {
    const html = waitingTabHtml(base);
    // El título importa tanto como el cuerpo: en un móvil con varias pestañas
    // es lo único que se lee sin cambiar a ella.
    expect(html).toContain('<title>Generando el parte…</title>');
    expect(html).toContain('Generando el parte…');
    expect(html).toContain('No cierres esta pestaña.');
  });

  it('declara el idioma de la plataforma', () => {
    expect(waitingTabHtml({ ...base, idioma: 'ro' })).toContain('<html lang="ro"');
  });

  it('no se indexa: es una URL del backoffice con un documento dentro', () => {
    expect(waitingTabHtml(base)).toContain('name="robots" content="noindex,nofollow"');
  });

  it('sigue al tema del sistema en vez de imponer el blanco', () => {
    // Media jornada de una agencia de alquiler es de noche.
    expect(waitingTabHtml(base)).toContain('color-scheme:light dark');
  });

  /**
   * ⚠️ El texto viene del traductor, pero acaba dentro de un HTML concatenado
   * a mano. Hoy los tres idiomas son inofensivos; el día que una traducción
   * lleve comillas o un `<`, sin escapar rompe el documento — y la pestaña se
   * queda en blanco, que es justo lo que esto viene a quitar.
   */
  it('escapa el texto traducido', () => {
    const html = waitingTabHtml({
      titulo: '<script>alert(1)</script>',
      pista: 'Comillas " y \' y & ampersand',
      idioma: 'es"onload="x'
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    expect(html).toContain('&amp;');
    // Y el atributo `lang` no se puede salir de sus comillas.
    expect(html).toContain('<html lang="es&quot;onload=&quot;x"');
  });

  /**
   * ⚠️ Medido en el navegador a 390 px: sin `border-box`, el relleno se suma al
   * `100vh` y salen 804 px de documento en 740 de pantalla — una barra de
   * desplazamiento en un cartel que cabe de sobra.
   */
  it('cabe en la pantalla: el relleno no se suma al alto', () => {
    expect(waitingTabHtml(base)).toContain('box-sizing:border-box');
  });

  it('es un documento completo: sin doctype el móvil entra en modo quirks', () => {
    const html = waitingTabHtml(base);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('width=device-width');
    expect(html).toContain('</body></html>');
  });
});
