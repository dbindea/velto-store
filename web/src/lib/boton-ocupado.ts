/**
 * El estado «ocupado» de un botón: apagado, con rueda y diciendo qué hace.
 *
 * ⚠️ **Existe porque un botón apagado NO se veía apagado.** `global.css` no
 * tenía ninguna regla `:disabled` para `.btn`, así que un botón deshabilitado
 * seguía midiendo `opacity: 1`, `cursor: pointer` y su color de marca entero:
 * exactamente igual que uno pulsable. El formulario de pre-reserva sí se
 * protegía —medido el 2 de octubre de 2026, tres clics seguidos dan **una**
 * petición—, pero nada de eso se veía, así que lo que el visitante hace es
 * volver a pulsar. Es el mismo fallo que el backoffice ya documenta como M-46.
 *
 * ⚠️ **Y la rueda no es adorno: es lo único que dice que algo está pasando.**
 * Entre pulsar «Reservar» y recibir la respuesta pasan segundos —la function
 * escribe la solicitud, genera el PDF y manda dos correos—. Sin nada que se
 * mueva, una espera de tres segundos se lee como una aplicación colgada.
 *
 * ⚠️ **Un sitio y no uno por formulario.** Son tres botones que hacen trabajo
 * de red —«Reservar», «Enviar» de contacto y «Buscar» de resultados— y cada uno
 * se apagaba a su manera, o no se apagaba. Lo pidió así Dorel el 2 de octubre
 * de 2026: «esto puede ser un componente para todos los botones, es algo
 * vital».
 */

/**
 * ⚠️ **Es un arco, no un círculo entero.** Un círculo completo girando no se
 * ve girar. `stroke-linecap: round` le quita el corte seco a las puntas.
 */
const RUEDA =
  '<svg class="btn__rueda" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M12 3a9 9 0 1 0 9 9"/></svg>';

export interface Ocupado {
  /** Devuelve el botón a como estaba: mismo contenido, mismo estado. */
  libre: () => void;
}

/**
 * Apaga el botón, le pone la rueda y —si se le da— cambia su rótulo.
 *
 * @param texto Rótulo mientras dura, **literal del código**: se escribe tal
 *   cual en el HTML del botón. Sin él se conserva el que ya tenía.
 *
 * ⚠️ **Guarda y repone el `innerHTML` entero**, no el texto: varios de estos
 * botones llevan un icono dentro —la flecha de «Reservar estas fechas», el
 * símbolo de descarga— y reponiendo solo el texto se perderían.
 */
export function ocupar(el: HTMLElement, texto?: string): Ocupado {
  const antes = el.innerHTML;
  const rotulo = texto ?? el.textContent?.trim() ?? '';
  el.innerHTML = `${RUEDA}<span>${rotulo}</span>`;

  /*
   * ⚠️ **`disabled` para un botón y `aria-disabled` para un enlace.** Un `<a>`
   * no entiende `disabled`: puesto como atributo no hace nada y el enlace
   * sigue navegando. Lo que lo apaga de verdad es el `pointer-events: none`
   * que el CSS cuelga de `aria-disabled`, y de paso lo anuncia a un lector de
   * pantalla, que es la mitad que `pointer-events` no cubre.
   */
  el.setAttribute('aria-busy', 'true');
  if (el instanceof HTMLButtonElement) el.disabled = true;
  else el.setAttribute('aria-disabled', 'true');

  return {
    libre() {
      el.innerHTML = antes;
      el.removeAttribute('aria-busy');
      if (el instanceof HTMLButtonElement) el.disabled = false;
      else el.removeAttribute('aria-disabled');
    },
  };
}

/**
 * Lo mismo, pero durante un rato fijo.
 *
 * ⚠️ **Para lo que NO se puede esperar, y hay que decirlo así.** Abrir el
 * presupuesto en otra pestaña es la única acción de estas que no devuelve una
 * promesa: el navegador se lleva la descarga a otro sitio y esta página no se
 * entera de cuándo termina. Así que esto **no mide nada** —es un acuse de
 * recibo acotado, no una barra de progreso—, y por eso el rótulo dice
 * «Abriendo…», que es lo que de verdad está pasando en esos milisegundos, y no
 * «Descargando…», que sería afirmar algo que no se sabe.
 *
 * Sin él, pulsar no cambia nada en esta pantalla —la pestaña se abre detrás— y
 * lo que se hace es volver a pulsar.
 */
export function ocuparUnRato(el: HTMLElement, ms: number, texto?: string): void {
  const o = ocupar(el, texto);
  setTimeout(() => o.libre(), ms);
}
