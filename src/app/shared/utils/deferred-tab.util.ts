/**
 * La pestaña que se abre AHORA para un documento que todavía no existe.
 *
 * ## El problema que resuelve, y por qué tiene dos mitades
 *
 * Generar un PDF tarda segundos, y para cuando vuelve la promesa el navegador
 * ya ha dado por caducado el gesto del usuario: un `window.open()` ahí **lo
 * come el bloqueador de emergentes sin decir nada**. La salida conocida es
 * abrir la pestaña con el clic todavía vivo y ponerle la dirección después.
 *
 * ⚠️ **Pero una pestaña abierta y vacía es, en un móvil, exactamente lo que
 * parece: una página rota.** Abrirla la trae a primer plano, así que el único
 * indicador de que algo está pasando —el spinner del botón— se queda en la
 * pestaña que el navegador acaba de mandar al fondo, y lo que el operador
 * mira durante toda la espera es un `about:blank`. Lo contó Dorel el 4 de
 * noviembre de 2026 sobre el parte de entrega: «no abre a la primera, me
 * abrió una página en blanco; con el segundo intento sí». Medido en
 * producción: **9,4 s** la primera vez —arranque en frío de la function que
 * genera y de la que sirve, más un fallo de caché en el borde— y **1,2 s** la
 * segunda, con todo caliente. No había nada roto; no había nada dibujado.
 *
 * Así que las dos mitades son inseparables: abrir pronto **y** escribir algo
 * dentro.
 *
 * ⚠️ **Y sin `noopener` en el `window.open()`**, que es lo que parece de cajón
 * y rompe el arreglo: con él el navegador corta la referencia y `open()`
 * devuelve **null**, así que no habría pestaña a la que ponerle la dirección.
 * Se consigue lo mismo anulando `opener` después.
 */

export interface TextosDeEspera {
  /** «Generando el parte…». Es también el título de la pestaña. */
  titulo: string;
  /** «Se abrirá solo en cuanto esté. No cierres esta pestaña.» */
  pista: string;
  /** El idioma de la plataforma, para el `lang` del documento. */
  idioma: string;
}

/** Escapa lo que entra en un HTML construido a mano. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;'
  );
}

/**
 * El documento que se pinta mientras se genera.
 *
 * Pura y exportada para poder probar lo único que puede salir mal sin que se
 * vea: el escapado. El texto viene del traductor, pero termina dentro de un
 * HTML concatenado a mano.
 */
export function waitingTabHtml(t: TextosDeEspera): string {
  const titulo = esc(t.titulo);
  const pista = esc(t.pista);
  return (
    `<!doctype html><html lang="${esc(t.idioma)}"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${titulo}</title><style>` +
    // ⚠️ `color-scheme` y colores del sistema: esta pestaña no tiene el tema de
    // la aplicación, y un fondo blanco fijo deslumbra a quien trabaja de noche
    // — que es media jornada de una agencia de alquiler.
    `:root{color-scheme:light dark}` +
    // ⚠️ `box-sizing:border-box` o el relleno SE SUMA al `100vh`: medido a
    // 390 px, 804 px de documento en 740 de pantalla, o sea una barra de
    // desplazamiento en una página que cabe de sobra. Ridículo en un cartel de
    // espera, y además delata que algo no está bien montado.
    `body{margin:0;box-sizing:border-box;min-height:100vh;display:flex;flex-direction:column;` +
    `align-items:center;justify-content:center;gap:1rem;` +
    `font:400 16px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:2rem}` +
    `.s{width:34px;height:34px;border:3px solid rgba(127,127,127,.3);border-top-color:#1BA39C;` +
    `border-radius:50%;animation:g .9s linear infinite}` +
    `p{margin:0}.h{opacity:.65;font-size:14px}` +
    `@keyframes g{to{transform:rotate(360deg)}}` +
    `@media(prefers-reduced-motion:reduce){.s{animation-duration:3s}}` +
    `</style></head><body>` +
    `<div class="s"></div><p>${titulo}</p><p class="h">${pista}</p>` +
    `</body></html>`
  );
}

/**
 * Abre la pestaña con el gesto vivo y le pinta el cartel de espera.
 *
 * Devuelve la ventana, o `null` si el navegador no la dejó abrir — y entonces
 * quien llama tiene que intentarlo otra vez al final, que es lo que ya hace
 * `window.open(url, '_blank', 'noopener')` en el camino de respaldo.
 */
export function openDeferredTab(t: TextosDeEspera): Window | null {
  const pestana = window.open('', '_blank');
  if (!pestana) return null;
  pestana.opener = null;
  try {
    pestana.document.write(waitingTabHtml(t));
    pestana.document.close();
  } catch {
    // Si el navegador no deja escribir, la pestaña se queda en blanco: eso es
    // exactamente lo de antes. No vale tumbar la apertura del documento por no
    // poder pintar un cartel.
  }
  return pestana;
}

/**
 * Lleva la pestaña al documento ya generado.
 *
 * ⚠️ **`replace()` y no `href`.** Desde que la pestaña nace con un cartel
 * dentro, `href` apila una entrada de historial: el «Atrás» del navegador
 * devolvería a un «Generando…» que no va a progresar nunca, porque la promesa
 * que lo iba a sustituir terminó hace rato.
 */
export function sendDeferredTab(pestana: Window | null, url: string): void {
  if (pestana) pestana.location.replace(url);
  else window.open(url, '_blank', 'noopener');
}
