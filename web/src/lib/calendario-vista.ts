/**
 * El calendario de disponibilidad de la ficha de un coche.
 *
 * ⚠️ **Dibuja, y nada más.** Qué día se puede elegir, qué pasa al pulsarlo y
 * cuántos días salen lo decide `calendario-coche.ts`, que es puro y tiene sus
 * 27 tests. Aquí solo hay DOM: es la misma separación que el panel de fechas
 * del buscador y que el QR del contrato, y existe porque un calendario mal
 * calculado tiene la misma pinta que uno bueno.
 *
 * ⚠️ **Y NO es el panel del buscador.** Aquel (`fecha-panel.ts`) es un popover
 * pegado a un `<input>` que devuelve UNA fecha con su hora; este va metido en
 * la página, enseña dos meses, pinta los días ocupados y devuelve un RANGO. Lo
 * único que comparten es la rejilla del mes (`rejillaDelMes`), que sí se
 * reutiliza.
 */

import { rejillaDelMes, sumarMeses } from './fecha-picker';
import {
  RANGO_VACIO,
  diaIso,
  elegirDia,
  estadoDelDia,
  posicionEnRango,
  previsualizar,
  type Rango,
} from './calendario-coche';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/**
 * Cuántos meses se pintan a la vez.
 *
 * ⚠️ **Dos, y el segundo se esconde por CSS en móvil.** A 390 px no caben dos
 * rejillas de siete columnas sin que los números queden a 9 px; y esconderlo
 * no oculta nada, porque se llega con la flecha. Es la excepción razonada a
 * «recolocar, nunca ocultar»: aquí no hay ninguna opción que desaparezca, solo
 * un mes que se mira después.
 */
const MESES_VISIBLES = 2;

export interface OpcionesCalendario {
  contenedor: HTMLElement;
  /** Los días `yyyy-MM-dd` que no se pueden coger. */
  ocupados: Set<string>;
  /** El último día que el backend ha mirado. */
  horizonte: Date | null;
  alCambiar: (rango: Rango) => void;
}

export interface Calendario {
  /** Vuelve a pintar con el rango vacío. Lo usa el botón de «Quitar fechas». */
  limpiar: () => void;
}

export function montarCalendario(opciones: OpcionesCalendario): Calendario {
  const { contenedor, ocupados, horizonte, alCambiar } = opciones;
  const hoy = new Date();

  let rango: Rango = RANGO_VACIO;
  let señalado: Date | null = null;
  let mes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const primerMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const ultimoMes = horizonte
    ? new Date(horizonte.getFullYear(), horizonte.getMonth(), 1)
    : null;

  /** El último mes que se puede dejar como PRIMERO de los dos que se pintan. */
  const topeMes = ultimoMes ? sumarMeses(ultimoMes, -(MESES_VISIBLES - 1)) : null;

  /**
   * Pone las clases de estado en los días **que ya están en el DOM**.
   *
   * ⚠️ **Existe porque repintar entero en cada movimiento del ratón rompe el
   * clic.** La primera versión llamaba a `construir()` desde el `mouseover`:
   * los 84 botones se destruían y se recreaban con cada píxel de movimiento,
   * así que un clic real —`mousedown` en un nodo, `mouseup` en el que lo
   * sustituyó— **no dispara ningún `click`**, porque el navegador exige el
   * mismo destino en los dos. Lo cazó Playwright al intentar pulsar un día:
   * «element was detached from the DOM, retrying». Con el ratón de verdad
   * pasa igual en cuanto se mueve un poco al pulsar.
   *
   * Y de paso: sin recrear nodos no se pierde el foco del teclado ni se
   * recarga ninguna imagen.
   */
  function refrescarEstados(): void {
    const vista = previsualizar(rango, señalado, ocupados);
    contenedor.querySelectorAll<HTMLElement>('[data-dia]').forEach((b) => {
      const iso = b.dataset.dia!;
      const [a, m, d] = iso.split('-').map(Number);
      const fecha = new Date(a, m - 1, d);
      const pos = posicionEnRango(fecha, vista);
      for (const c of ['inicio', 'medio', 'fin', 'unico']) {
        b.classList.toggle(`cal__dia--${c}`, pos === c);
      }
    });
  }

  function construir(): void {
    const vista = previsualizar(rango, señalado, ocupados);

    const meses = Array.from({ length: MESES_VISIBLES }, (_, i) => {
      const m = sumarMeses(mes, i);
      const celdas = rejillaDelMes(m)
        .map((c) => {
          if (!c.delMes) return '<span class="cal__hueco" aria-hidden="true"></span>';

          const estado = estadoDelDia(c.fecha, ocupados, hoy, horizonte);
          const pos = posicionEnRango(c.fecha, vista);
          const iso = diaIso(c.fecha);
          const elegible = estado === 'libre';

          /*
           * ⚠️ **El día ocupado se enseña y NO se puede pulsar.** Esconderlo
           * dejaría un hueco que se lee como «no existe»; sin marcarlo, el
           * visitante lo elige y la web le dice que no. Lo que hace útil este
           * calendario es justo lo que NO está libre — que es para lo que lo
           * pidió Dorel: «por un día ocupado no salga en la búsqueda, la idea
           * sería que renunciando a un día lo pueda coger».
           */
          const clases = [
            'cal__dia',
            `cal__dia--${estado}`,
            pos !== 'fuera' ? `cal__dia--${pos}` : '',
            c.hoy ? 'cal__dia--hoy' : '',
          ]
            .filter(Boolean)
            .join(' ');

          const comoSeLlama =
            `${c.fecha.getDate()} de ${MESES[c.fecha.getMonth()]}, ` +
            `${DIAS_LARGOS[(c.fecha.getDay() + 6) % 7]}` +
            (estado === 'ocupado' ? ' · ocupado' : '');

          return (
            `<button type="button" class="${clases}" data-dia="${iso}"` +
            `${elegible ? '' : ' disabled'} aria-label="${comoSeLlama}">` +
            `${c.fecha.getDate()}</button>`
          );
        })
        .join('');

      return `
        <div class="cal__mes">
          <p class="cal__rotulo">${MESES[m.getMonth()]} <span>${m.getFullYear()}</span></p>
          <div class="cal__semana" aria-hidden="true">
            ${DIAS_SEMANA.map((d) => `<span>${d}</span>`).join('')}
          </div>
          <div class="cal__rejilla">${celdas}</div>
        </div>`;
    }).join('');

    const atrasBloqueado = mes <= primerMes;
    const adelanteBloqueado = !!topeMes && mes >= topeMes;

    contenedor.innerHTML = `
      <div class="cal__cabecera">
        <button type="button" class="cal__nav" data-mover="-1" ${atrasBloqueado ? 'disabled' : ''}
                aria-label="Mes anterior">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button type="button" class="cal__nav" data-mover="1" ${adelanteBloqueado ? 'disabled' : ''}
                aria-label="Mes siguiente">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
      <div class="cal__meses">${meses}</div>
      ${/*
         * ⚠️ **La leyenda enseña un día de verdad, no un cuadradito de
         * color.** Con dos muestras de color no se entendía nada: la de
         * «libre» era el fondo de la propia tarjeta, así que salía invisible,
         * y la de «ocupado» un gris que tampoco decía qué le pasa a ese día.
         * Lo que distingue a un día ocupado en esta rejilla es que está
         * **tachado**, así que la leyenda tiene que enseñar eso mismo.
         */ ''}
      <p class="cal__leyenda">
        <span class="cal__dia cal__dia--libre" aria-hidden="true">12</span> Libre
        <span class="cal__dia cal__dia--ocupado" aria-hidden="true">12</span> Ocupado
      </p>`;
  }

  /*
   * ⚠️ **Delegado en el contenedor, no un oyente por día.** Son 84 botones que
   * se repintan en cada clic y en cada movimiento del ratón: los oyentes
   * puestos uno a uno se quedarían colgando de nodos que ya no existen.
   */
  contenedor.addEventListener('click', (e) => {
    const destino = e.target as HTMLElement;

    const nav = destino.closest<HTMLElement>('[data-mover]');
    if (nav) {
      mes = sumarMeses(mes, Number(nav.dataset.mover));
      construir();
      return;
    }

    const dia = destino.closest<HTMLElement>('[data-dia]');
    if (!dia || !dia.dataset.dia) return;
    const [a, m, d] = dia.dataset.dia.split('-').map(Number);
    rango = elegirDia(rango, new Date(a, m - 1, d), ocupados);
    señalado = null;
    refrescarEstados();
    alCambiar(rango);
  });

  /*
   * ⚠️ **La previsualización solo con ratón.** Con el dedo no hay «pasar por
   * encima»: el primer toque se queda en estado hover en muchos móviles, así
   * que el tramo se pintaría y se quedaría pintado sin que nadie lo haya
   * elegido. Es la misma frontera que decide el hover de las tarjetas.
   */
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    contenedor.addEventListener('mouseover', (e) => {
      const dia = (e.target as HTMLElement).closest<HTMLElement>('[data-dia]');
      if (!dia?.dataset.dia || !rango.desde || rango.hasta) return;
      const [a, m, d] = dia.dataset.dia.split('-').map(Number);
      const nuevo = new Date(a, m - 1, d);
      if (señalado && diaIso(señalado) === diaIso(nuevo)) return;
      señalado = nuevo;
      refrescarEstados();
    });

    contenedor.addEventListener('mouseleave', () => {
      if (!señalado) return;
      señalado = null;
      refrescarEstados();
    });
  }

  construir();

  return {
    limpiar() {
      rango = RANGO_VACIO;
      señalado = null;
      refrescarEstados();
      alCambiar(rango);
    },
  };
}
