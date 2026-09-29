/**
 * La tarjeta de un coche, tal y como la define la maqueta.
 *
 * ⚠️ **Un solo sitio, porque sale en tres páginas** —portada, flota y
 * disponibilidad— y en las tres tiene que ser la misma. Tres copias de este
 * marcado acabarían con tres tarjetas distintas, que es como la aplicación llegó
 * a tener cuatro nombres para la misma casilla.
 */

import {
  CocheResumen,
  CocheDisponible,
  euros,
  nombreCoche,
  cambio,
  categoria,
  marcadoFoto
} from './api';

/** Escapar lo que venga de la API: entra en `innerHTML`. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

const ICONO = {
  plazas: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
  maletas: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  cambio: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 4v16M12 4v16M19 4v16M5 10h14"/></svg>',
  coche: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 17h14M3 13l1.6-4.3A2 2 0 0 1 6.5 7h11a2 2 0 0 1 1.9 1.7L21 13v4H3Z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/></svg>',
};

/**
 * ⚠️ **El precio grande es el BRUTO.** En el backoffice se negocia el neto —el
 * número redondo— y el IVA se suma; aquí manda lo contrario, porque quien mira
 * una web de alquiler compara lo que va a pagar. Y va en `.num`, que usa la
 * fuente del sistema: **Gotham no tiene el símbolo `€`** y compondría la cifra
 * con dos fuentes distintas.
 */
export function tarjetaCoche(c: CocheResumen | CocheDisponible): string {
  const nombre = esc(nombreCoche(c));
  const disponible = 'price' in c ? (c as CocheDisponible) : null;

  const foto = c.photo
    ? /*
       * `sizes` describe el hueco REAL de la tarjeta, no el de la ventana: la
       * rejilla es de `minmax(280px, 1fr)`, así que en móvil ocupa casi todo el
       * ancho y en escritorio una de tres columnas de un contenedor de 1200.
       * Sin esto el navegador supondría el ancho completo y bajaría siempre la
       * variante más grande, con lo que el `srcset` no serviría de nada.
       */
      marcadoFoto(c.photo, {
        alt: nombre,
        sizes: '(min-width: 1000px) 380px, (min-width: 640px) 45vw, 92vw',
      })
    : `<div class="coche__sinfoto">${ICONO.coche}<span>Foto del vehículo</span></div>`;

  const precio = disponible
    ? `<p class="coche__precio num"><strong>${euros(disponible.price.gross)}</strong></p>
       <p class="coche__detalle num">${disponible.totalDays} ${disponible.totalDays === 1 ? 'día' : 'días'} · todo incluido, IVA incluido</p>`
    : c.priceFrom
      ? /*
         * ⚠️ **El «desde» no es adorno: ese precio es el del tramo MÁS BARATO**,
         * o sea el de un alquiler largo (`lowestPricePerDay` en `public/core.ts`).
         * Sin él, la tarjeta prometía una cifra que casi ningún alquiler paga
         * —dos días cuestan más— y el «Todo incluido» de debajo la remataba como
         * si fuera final. La ficha del coche sí lo rotulaba bien, así que el
         * listado y el detalle decían dos cosas distintas del mismo coche.
         *
         * Cuando hay fechas elegidas esto no aparece: ahí se enseña el precio
         * de verdad del alquiler, que es exacto y no necesita «desde».
         */
        /*
         * ⚠️ **El «desde» dice DESDE CUÁNTOS DÍAS, y sin eso engaña.** Ese
         * precio sale del tramo más barato, que con las tarifas normales de la
         * casa es el del alquiler más largo: quien leía «desde 25 €/día» y
         * pedía tres días se encontraba otra cifra al elegir fechas. El número
         * es el del tramo real de ESE coche, no un 31 escrito a mano: las
         * reglas se editan coche a coche.
         *
         * ⚠️ **Y ya no pone «IVA incluido»**, que lo pidió Dorel porque se ve
         * después, al calcular el precio con fechas. El importe **sigue siendo
         * el bruto**: lo que se quita es la coletilla, no el impuesto.
         */
        `<p class="coche__precio num"><span>desde</span> <strong>${euros(c.priceFrom.gross)}</strong> <span>/día</span></p>
         ${
           c.priceFrom.fromDays
             ? `<p class="coche__detalle">en alquileres de ${c.priceFrom.fromDays} días o más</p>`
             : ''
         }`
      : `<p class="coche__precio coche__precio--consultar">Consultar precio</p>`;

  /**
   * «Que me llamen», y **solo con fechas elegidas**.
   *
   * ⚠️ Sin fechas no hay nada que pedir: el precio del catálogo es un «desde» y
   * la disponibilidad no se ha mirado. Ofrecerlo ahí sería mandar al operador
   * una solicitud sin fechas ni precio, que es justo lo que esto viene a evitar.
   *
   * ⚠️ **Va FUERA del `<a>` que envuelve la tarjeta**, no dentro. Un botón
   * dentro de un enlace no es HTML válido y, peor, el clic haría las dos cosas:
   * abrir la ficha y abrir el formulario. Es el mismo fallo que el menú «Más»
   * del backoffice metido dentro de su propio botón.
   */
  const llamada = disponible
    ? `<button type="button" class="btn btn--brand coche__llamada"
         data-solicitar
         data-id="${esc(c.id)}"
         data-nombre="${esc(nombre)}"
         data-dias="${disponible.totalDays}"
         data-precio="${euros(disponible.price.gross)}">
         Que me llamen
       </button>`
    : '';

  return `
    <article class="card coche">
      <a class="coche__link" href="/coche/${encodeURIComponent(c.id)}">
        <div class="coche__foto">${foto}</div>
        <div class="coche__cuerpo">
          <p class="overline">${esc(categoria(c.category))}</p>
          <h3 class="coche__nombre">${nombre}</h3>
          <ul class="coche__specs">
            <li>${ICONO.plazas}<span>${c.seats} plazas</span></li>
            <li>${ICONO.maletas}<span>${c.luggageCapacity} maletas</span></li>
            <li>${ICONO.cambio}<span>${esc(cambio(c.transmission))}</span></li>
          </ul>
          ${precio}
          <span class="btn btn--ink coche__btn">
            Calcular precio
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
          </span>
        </div>
      </a>
      ${llamada}
    </article>`;
}
