/**
 * La señal de visita, desde el navegador.
 *
 * ⚠️ **Que esto sea JavaScript es la primera barrera contra los bots**, y la
 * que más filtra. Un rastreador de scraping o de IA baja el HTML y se va: no
 * ejecuta nada, así que no llega a llamar. La lista de agentes del servidor
 * recoge a los pocos que sí ejecutan.
 *
 * ⚠️ **No guarda NADA en el dispositivo.** Ni cookie, ni `localStorage`, ni un
 * identificador. Es lo que permite que la web siga sin banner de cookies: quien
 * decide si dos páginas son del mismo visitante es el servidor, con una huella
 * de IP y navegador que se re-sala cada día. Si algún día alguien añade aquí un
 * identificador «para medir mejor», la página de privacidad pasa a ser falsa.
 */

const RUTA = '/api/visita';

/**
 * ¿Merece la pena mandar la señal?
 *
 * ⚠️ **`navigator.webdriver` lo pone el propio navegador cuando lo gobierna un
 * programa** —Playwright, Selenium, Puppeteer—, así que descarta de un plumazo
 * las pruebas automáticas, incluidas las mías. Sin esto, cada barrido de
 * comprobación se contaría como visitas de verdad y el número dejaría de
 * significar nada.
 *
 * ⚠️ **Y se respeta «no rastrear».** No obliga ninguna ley española hoy, pero
 * quien lo activa ha dicho lo que quiere y no cuesta nada hacerle caso.
 */
function sePuedeMedir(): boolean {
  if (typeof navigator === 'undefined') return false;
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return false;
  const dnt =
    (navigator as Navigator & { doNotTrack?: string }).doNotTrack ??
    (window as Window & { doNotTrack?: string }).doNotTrack;
  if (dnt === '1' || dnt === 'yes') return false;
  return true;
}

function enviar(cuerpo: Record<string, unknown>): void {
  if (!sePuedeMedir()) return;
  const datos = JSON.stringify(cuerpo);
  try {
    /**
     * ⚠️ **`sendBeacon` y no `fetch`.** El navegador se compromete a mandarlo
     * aunque la página se esté cerrando, que es justo cuando se pierde un
     * `fetch`: alguien que entra, mira y se va es una visita igual. Y no
     * bloquea nada — va en cola fuera del hilo de la página.
     */
    if (navigator.sendBeacon) {
      navigator.sendBeacon(RUTA, new Blob([datos], { type: 'application/json' }));
      return;
    }
    void fetch(RUTA, {
      method: 'POST',
      body: datos,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true
    }).catch(() => {});
  } catch {
    // Medir nunca puede romper la página: si falla, no se mide y ya está.
  }
}

/** Una página vista. */
export function medirVista(ruta: string = location.pathname): void {
  enviar({ ruta });
}

/**
 * Un hito del embudo: `precios`, `ficha` o `cotizacion`.
 *
 * ⚠️ **`cotizacion` se manda al ABRIR el formulario de pre-reserva**, no al
 * enviarlo: los que lo envían ya se cuentan solos en `bookingRequests`. Lo que
 * aquí interesa es cuántos llegaron a tener el precio delante y **no**
 * siguieron, que es el escalón donde se pierde gente.
 */
export function medirHito(hito: 'precios' | 'ficha' | 'cotizacion'): void {
  enviar({ hito });
}
