/**
 * Contraste y desbordamiento, medidos en la página que tienes delante.
 *
 * ⚠️ **Es lo que las tres auditorías del repositorio NO pueden ver.**
 * `css:audit` encuentra clases que nadie declara, `spacing:audit` espaciados
 * fuera de la escala y `i18n:audit` claves que faltan — las tres leen ficheros.
 * Ninguna abre un navegador, así que ninguna sabe si un texto **se lee**.
 *
 * Y ahí es donde vivía el fallo del botón «Cancelar reserva»: `#1A1400` sobre
 * `#9A6700`, **3,77:1**, por debajo del mínimo de 4,5:1 que este proyecto se
 * fija. Compilaba, pasaba los tests, pasaba las tres auditorías, y solo se veía
 * calculándolo a mano.
 *
 * No es código de la aplicación y no se compila: vive en `docs/` por lo mismo
 * que `comprobar-reglas-financieras.js`, para que no lo parezca.
 *
 * CÓMO SE USA
 * -----------
 * Se pega en la consola del navegador, con la sesión abierta, en la pantalla
 * que quieras medir. Devuelve y pinta lo que falla.
 *
 *   comprobarPantalla()            // el tema que esté puesto
 *
 * ⚠️ **El contraste depende del TEMA**, así que hay que pasarlo por los dos.
 * El ámbar claro pide texto blanco y el oscuro lo pide negro: una sola pasada
 * da por bueno lo que falla en el otro.
 *
 * ⚠️ **Y el desbordamiento se mide a 390 px**, que es el móvil real del
 * operador. A 1280 px no desborda casi nada.
 */

(function () {
  /** Luminancia relativa (WCAG 2.1). */
  function luminancia(rgb) {
    const canal = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2]);
  }

  function contraste(a, b) {
    const l1 = Math.max(luminancia(a), luminancia(b));
    const l2 = Math.min(luminancia(a), luminancia(b));
    return (l1 + 0.05) / (l2 + 0.05);
  }

  function aRgb(css) {
    const m = String(css).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((n) => parseFloat(n));
    return { rgb: [p[0], p[1], p[2]], alfa: p.length > 3 ? p[3] : 1 };
  }

  /**
   * El fondo que de verdad hay detrás de este texto.
   *
   * ⚠️ **Hay que SUBIR por los padres.** El fondo de un elemento suele ser
   * `rgba(0,0,0,0)`, y quedarse ahí daría negro — con lo que cualquier texto
   * claro parecería perfecto. Se compone cada capa translúcida sobre la de
   * debajo hasta dar con una opaca.
   */
  function fondoEfectivo(el) {
    let capas = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const c = aRgb(getComputedStyle(n).backgroundColor);
      if (c && c.alfa > 0) {
        capas.push(c);
        if (c.alfa >= 1) break;
      }
      n = n.parentElement;
    }
    if (!capas.length || capas[capas.length - 1].alfa < 1) {
      capas.push({ rgb: [255, 255, 255], alfa: 1 });
    }
    // De la más profunda a la más superficial.
    let fondo = capas[capas.length - 1].rgb;
    for (let i = capas.length - 2; i >= 0; i--) {
      const { rgb, alfa } = capas[i];
      fondo = [0, 1, 2].map((k) => rgb[k] * alfa + fondo[k] * (1 - alfa));
    }
    return fondo;
  }

  function visible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** El texto propio del elemento, sin el de sus hijos. */
  function textoPropio(el) {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) t += n.nodeValue;
    }
    return t.trim();
  }

  function minimoExigible(s) {
    const px = parseFloat(s.fontSize);
    const negrita = parseInt(s.fontWeight, 10) >= 700;
    // WCAG: «texto grande» es 24 px, o 18,66 px en negrita.
    return px >= 24 || (negrita && px >= 18.66) ? 3 : 4.5;
  }

  window.comprobarPantalla = function comprobarPantalla() {
    const fallos = [];

    document.querySelectorAll('body *').forEach((el) => {
      const t = textoPropio(el);
      if (!t || !visible(el)) return;
      const s = getComputedStyle(el);
      const color = aRgb(s.color);
      if (!color) return;

      const fondo = fondoEfectivo(el);
      // Un texto translúcido se compone sobre su fondo antes de medir.
      const tinta =
        color.alfa >= 1
          ? color.rgb
          : [0, 1, 2].map((k) => color.rgb[k] * color.alfa + fondo[k] * (1 - color.alfa));

      const ratio = contraste(tinta, fondo);
      const minimo = minimoExigible(s);
      if (ratio + 0.005 < minimo) {
        fallos.push({
          texto: t.slice(0, 45),
          ratio: Math.round(ratio * 100) / 100,
          minimo,
          tamaño: s.fontSize,
          selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : '')
        });
      }
    });

    // Desbordamiento horizontal: el documento entero y cada elemento que se
    // salga por la derecha del viewport.
    const doc = document.documentElement;
    const desbordaDocumento = doc.scrollWidth > doc.clientWidth + 1;
    const culpables = [];
    if (desbordaDocumento) {
      document.querySelectorAll('body *').forEach((el) => {
        if (!visible(el)) return;
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1) {
          culpables.push({
            selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : ''),
            derecha: Math.round(r.right),
            ancho: Math.round(r.width)
          });
        }
      });
    }

    const resultado = {
      ruta: location.pathname,
      ancho: doc.clientWidth,
      contraste: fallos.sort((a, b) => a.ratio - b.ratio),
      desborda: desbordaDocumento,
      scrollWidth: doc.scrollWidth,
      culpables: culpables.slice(0, 10)
    };

    if (!fallos.length && !desbordaDocumento) {
      console.log(`✓ ${location.pathname} (${doc.clientWidth}px) — sin fallos`);
    } else {
      console.warn(`✗ ${location.pathname} (${doc.clientWidth}px)`);
      if (fallos.length) console.table(resultado.contraste);
      if (desbordaDocumento) {
        console.warn(`  desborda: ${doc.scrollWidth} > ${doc.clientWidth}`);
        console.table(resultado.culpables);
      }
    }
    return resultado;
  };

  console.log('Listo. Llama a comprobarPantalla().');
})();
