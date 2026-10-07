/**
 * El calendario de Velto, delante del del navegador.
 *
 * ⚠️ **Existe porque el panel del navegador NO se puede estilar.** Un
 * `datetime-local` se deja vestir por fuera —el recuadro, la tipografía, el
 * icono— pero lo que se abre al pulsarlo lo dibuja el navegador y **no hay
 * ningún selector de CSS que lo alcance**: no es parte de la página. Lo único
 * que se le puede decir es si el fondo es claro u oscuro, con `color-scheme`.
 * Lo pidió Dorel el 29 de septiembre de 2026 enseñando las dos capturas, la del
 * navegador y la del backoffice.
 *
 * ⚠️ **Es un PORT del backoffice, no un módulo compartido.** `web/` es una
 * tercera build y no puede importar de `src/app/`. Lo que se ha portado es la
 * **regla**, no el resultado: las dos diferencias están marcadas abajo y en
 * `fecha-picker.ts`, y las dos son correcciones de fallos que allí siguen vivos.
 *
 * ⚠️ **Y el campo sigue siendo un `datetime-local` de verdad.** Esto solo
 * escribe en él y dispara sus eventos, así que el valor, `min`, `max`, `step`,
 * la validación y el teclado no cambian. Si este panel fallara, la fecha se
 * sigue pudiendo teclear — y quitando la llamada a `montarCalendarios()` todo
 * vuelve a como estaba sin tocar una plantilla.
 */

import {
  type Celda,
  comoValor,
  fueraDeRango,
  horasValidas,
  minutosDelPaso,
  minutosValidos,
  parseFechaHora,
  parseLimite,
  rejillaDelMes,
  sumarMeses,
} from './fecha-picker';

/**
 * ⚠️ **Con el dedo manda el del sistema, y es una decisión, no un olvido.**
 *
 * La hoja a pantalla completa de iOS y Android está pensada para el pulgar:
 * más grande, más familiar y mejor hecha que cualquier cosa que dibujemos. El
 * backoffice fuerza el suyo también en móvil, pero **por un motivo que aquí no
 * existe**: allí el diálogo de fecha de Android no tiene forma de vaciar el
 * campo, y había fechas que no se podían quitar. Estos dos campos son
 * `required` y siempre traen valor, así que no hay nada que vaciar.
 *
 * Es además la misma frontera que el backoffice usa para `base-select`, y por
 * el mismo motivo: **`@supports` contesta si el navegador puede, nunca si
 * conviene.** Cuando la respuesta depende del aparato, hay que preguntar por el
 * aparato.
 */
function mandaElNativo(): boolean {
  /*
   * ⚠️ **Y desde el 7 de octubre de 2026 NUNCA manda: es una REVERSIÓN, por eso
   * se deja escrito todo lo de arriba.**
   *
   * El argumento sigue siendo bueno —la hoja del sistema está pensada para el
   * pulgar— y lo tumbó mirarla: el diálogo de Android es un selector de
   * **ruedas**, así que no se ve el mes. Para saber si el 8 cae en jueves hay
   * que girar el día de uno en uno. Y esta es una web donde lo primero que se
   * hace es elegir unas fechas de alquiler, que es justo la pregunta que un
   * calendario contesta de un vistazo y una rueda no contesta nunca.
   *
   * Lo pidió Dorel ese día —«en el móvil quiero el calendario con vista del
   * mes»— y de paso deja el mismo panel en los dos sitios, que era lo otro que
   * pedía: el backoffice ya forzaba el suyo desde el 24 de septiembre.
   *
   * ⚠️ **Se conserva la función en vez de borrar la rama**, igual que
   * `prefersNativePicker()` en el backoffice: es el punto donde volver el día
   * que el selector del sistema enseñe el mes.
   */
  return false;
}

/**
 * ¿El panel se pega al borde de abajo en vez de colgar del campo?
 *
 * ⚠️ **Colgando del campo, en un teléfono el mes NO se ve entero.** El panel
 * mide unos 550 px, así que `colocar()` lo recorta contra la pantalla y lo que
 * sobra —las últimas semanas y el pie— hay que buscarlo desplazando dentro del
 * propio panel. Y lo primero que se hace en esta web es elegir unas fechas: la
 * pregunta es en qué día de la semana cae el 15, y eso un mes recortado no lo
 * contesta.
 *
 * ⚠️ **Se pregunta por el APARATO, no por el ancho**, que es la misma frontera
 * que decide `base-select` en el backoffice: un teléfono en horizontal mide
 * 844 px de ancho y 390 de alto, así que un corte por ancho le daría el panel
 * de escritorio justo en la orientación donde menos cabe.
 */
function esHoja(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** Los 34 px de la derecha, que es exactamente lo que abre el del navegador. */
const ANCHO_ICONO = 34;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * ⚠️ **Los nombres salen de `Intl`, no de una lista escrita a mano.** Son doce
 * meses y siete días: catorce cadenas que el navegador ya sabe, que nadie
 * tendría que mantener y en las que una errata solo se ve en el mes en que
 * caiga.
 */
const MES_ANO = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const DIA_CORTO = new Intl.DateTimeFormat('es-ES', { weekday: 'short' });

function rotuloMes(d: Date): string {
  const texto = MES_ANO.format(d);
  // ⚠️ Mayúscula solo en la primera letra. `text-transform: capitalize` daría
  // «Septiembre De 2026»: en español la preposición va en minúscula.
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function diasDeLaSemana(): string[] {
  // Un lunes cualquiera del que partir: el 5 de enero de 2026 lo es.
  const lunes = new Date(2026, 0, 5);
  return Array.from({ length: 7 }, (_, i) =>
    DIA_CORTO.format(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i)).replace(
      /\.$/,
      ''
    )
  );
}

interface Panel {
  raiz: HTMLDivElement;
  abrir(campo: HTMLInputElement): void;
  cerrar(): void;
  abiertoEn(): HTMLInputElement | null;
}

/**
 * Un solo panel para toda la página, no uno por campo.
 *
 * Solo puede haber uno abierto a la vez, así que crear uno por campo sería
 * dejar tres copias inertes en el DOM esperando a que alguien las abra.
 */
let panel: Panel | null = null;

function crearPanel(): Panel {
  const raiz = document.createElement('div');
  raiz.className = 'calendario';
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-label', 'Elegir fecha y hora');
  /*
   * ⚠️ **`popover` y no un `z-index` alto**, y esto es lo que decide que se
   * vea. En esta página hay un `<dialog>` abierto con `showModal()` —el de «Que
   * me llamen»—, y contra el top layer **ningún `z-index` sirve**: un elemento
   * fijo a 2.147.483.647 pierde igualmente. Un popover entra en ese mismo top
   * layer, así que convive con el diálogo en vez de pelearse con él.
   *
   * Y de paso regala lo que en el backoffice hubo que escribir a mano: el
   * cierre al pulsar fuera y el `Escape`.
   */
  raiz.popover = 'auto';
  document.body.appendChild(raiz);

  let campoActual: HTMLInputElement | null = null;
  let elegida: Date | null = null;
  let mesVisible = new Date();
  let minLim: Date | null = null;
  let maxLim: Date | null = null;
  let pasos: number[] = [0, 15, 30, 45];

  /**
   * ⚠️ **Escribir el valor NO basta: hay que disparar los eventos.**
   *
   * La portada escucha `change` sobre la recogida para mover la devolución
   * conservando los días elegidos, y para recolocar su `min`. Sin los eventos,
   * elegir la recogida con el panel deja la devolución intacta — y se puede
   * pedir un alquiler que termina antes de empezar, que es justo lo que ese
   * oyente existe para impedir.
   */
  function escribir(d: Date) {
    if (!campoActual) return;
    campoActual.value = comoValor(d);
    campoActual.dispatchEvent(new Event('input', { bubbles: true }));
    campoActual.dispatchEvent(new Event('change', { bubbles: true }));
    /*
     * ⚠️ **Y se RELEE, porque el `change` puede haberlo cambiado.** La portada
     * escucha ese evento y recoloca la devolución —empujándola a recogida + 3
     * días si se queda corta—, así que el campo acaba con un valor que no es el
     * que este panel acaba de escribir. Sin releer, el calendario seguiría
     * resaltando el día que el visitante pulsó mientras el campo dice otro, y
     * los clics siguientes partirían de una fecha que ya no existe.
     */
    elegida = parseFechaHora(campoActual.value);
    if (elegida) mesVisible = new Date(elegida.getFullYear(), elegida.getMonth(), 1);
  }

  function pintar() {
    if (!campoActual) return;
    raiz.replaceChildren();

    // --- Cabecera: ‹ mes ›
    const cabecera = document.createElement('div');
    cabecera.className = 'calendario__cabecera';
    cabecera.append(
      botonNav('‹', 'Mes anterior', () => {
        mesVisible = sumarMeses(mesVisible, -1);
        pintar();
      })
    );
    const rotulo = document.createElement('span');
    rotulo.className = 'calendario__mes';
    rotulo.setAttribute('aria-live', 'polite');
    rotulo.textContent = rotuloMes(mesVisible);
    cabecera.append(rotulo);
    cabecera.append(
      botonNav('›', 'Mes siguiente', () => {
        mesVisible = sumarMeses(mesVisible, 1);
        pintar();
      })
    );
    raiz.append(cabecera);

    // --- Iniciales de la semana
    const semana = document.createElement('div');
    semana.className = 'calendario__semana';
    semana.setAttribute('aria-hidden', 'true');
    for (const d of diasDeLaSemana()) {
      const s = document.createElement('span');
      s.textContent = d;
      semana.append(s);
    }
    raiz.append(semana);

    // --- Las 42 celdas
    const rejilla = document.createElement('div');
    rejilla.className = 'calendario__rejilla';
    for (const c of rejillaDelMes(mesVisible, { elegida, min: minLim, max: maxLim })) {
      rejilla.append(celdaDia(c));
    }
    raiz.append(rejilla);

    // --- Las horas, en punto
    raiz.append(columnasDeHora());

    // --- Pie
    raiz.append(pie());

    centrarHoras();
  }

  function botonNav(glifo: string, etiqueta: string, alPulsar: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'calendario__nav';
    b.textContent = glifo;
    b.setAttribute('aria-label', etiqueta);
    b.addEventListener('click', alPulsar);
    return b;
  }

  function celdaDia(c: Celda) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'calendario__dia';
    if (!c.delMes) b.classList.add('es-de-fuera');
    if (c.hoy) b.classList.add('es-hoy');
    if (c.elegida) b.classList.add('es-elegido');
    b.disabled = c.bloqueada;
    b.setAttribute('aria-selected', String(c.elegida));
    b.textContent = String(c.fecha.getDate());
    b.addEventListener('click', () => {
      // La hora que hubiera puesta se conserva: cambiar de día no es cambiar de
      // hora. Si no había ninguna, se parte de la primera válida de ese día.
      const horas = horasValidas(c.fecha, minLim, maxLim);
      const h = elegida ? elegida.getHours() : (horas[0] ?? 10);
      const mins = minutosValidos(c.fecha, h, pasos, minLim, maxLim);
      const m = elegida ? elegida.getMinutes() : (mins[0] ?? 0);
      elegida = new Date(c.fecha.getFullYear(), c.fecha.getMonth(), c.fecha.getDate(), h, m);
      corregirFueraDeRango();
      escribir(elegida);
      pintar();
    });
    return b;
  }

  /**
   * ⚠️ **Al cambiar de día, la hora que se conserva puede dejar de valer.**
   * Con `min` a las 10:30 de hoy, una recogida elegida para mañana a las 09:00
   * y devuelta a hoy se quedaría en una hora que el campo rechaza. Se empuja al
   * primer hueco válido en vez de dejar el campo inválido.
   */
  function corregirFueraDeRango() {
    if (!elegida) return;
    const horas = horasValidas(elegida, minLim, maxLim);
    if (!horas.includes(elegida.getHours())) {
      elegida.setHours(horas[0] ?? elegida.getHours());
    }
    const mins = minutosValidos(elegida, elegida.getHours(), pasos, minLim, maxLim);
    if (!mins.includes(elegida.getMinutes())) {
      elegida.setMinutes(mins[0] ?? 0);
    }
  }

  /**
   * El día del que cuelgan las dos columnas cuando el campo viene VACÍO.
   *
   * ⚠️ **No vale `new Date()`.** Con un `min` en el futuro —el caso normal de
   * la devolución, que nace apuntando a la recogida— hoy está bloqueado, así
   * que las columnas se calculaban contra un día que el campo rechaza: se
   * ofrecían horas imposibles y elegir una dejaba el formulario inválido. Se
   * parte del primer día que la rejilla sí deja elegir.
   */
  function diaDePartida(): Date {
    if (elegida) return elegida;
    const hoy = new Date();
    if (!fueraDeRango(hoy, minLim, maxLim)) return hoy;
    if (minLim && !fueraDeRango(minLim, minLim, maxLim)) return new Date(minLim);
    const primera = rejillaDelMes(mesVisible, { min: minLim, max: maxLim }).find((c) => !c.bloqueada);
    return primera ? primera.fecha : hoy;
  }

  function columnasDeHora() {
    const caja = document.createElement('div');
    caja.className = 'calendario__hora';

    const dia = diaDePartida();
    const horas = horasValidas(dia, minLim, maxLim);
    /*
     * ⚠️ **Los minutos se filtran con la hora que se va a ESCRIBIR**, no con
     * la hora 0. Con el campo vacío se usaba `elegida?.getHours() ?? 0`, o sea
     * medianoche, que casi nunca es la hora que acabará teniendo el campo: la
     * lista de minutos salía validada contra una hora que no era la suya.
     */
    const horaBase = elegida ? elegida.getHours() : (horas[0] ?? 0);
    const mins = minutosValidos(dia, horaBase, pasos, minLim, maxLim);

    /*
     * ⚠️ **Y la base NO es la medianoche del día.** Con el campo vacío,
     * elegir solo un minuto escribía las 00:xx — una hora que la propia
     * columna de horas se estaba negando a ofrecer.
     */
    const base = () =>
      elegida ??
      new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), horaBase, mins[0] ?? 0);

    /*
     * ⚠️ **La hora se elige EN PUNTO, y aquí había una columna de minutos.**
     * Se quitó el 7 de octubre de 2026, a la vez que la del backoffice y por lo
     * mismo: doce opciones más que recorrer con el pulgar para un negocio que
     * pacta las recogidas en punto. Lo que el visitante elige aquí es una
     * intención; la hora real la cierra la agencia por teléfono.
     *
     * ⚠️ **El minuto se fuerza a 0 aunque el campo trajera otro.** Dejando
     * `b.getMinutes()` —que es lo que hacía—, una fecha que llegara con 10:35
     * se quedaría en 11:35 al tocar la hora, con un minuto que ya no hay forma
     * de cambiar porque la columna no existe.
     */
    caja.append(
      columna('Horas', horas, elegida?.getHours() ?? null, (h) => {
        const b = base();
        elegida = new Date(b.getFullYear(), b.getMonth(), b.getDate(), h, 0);
        corregirFueraDeRango();
        escribir(elegida);
        pintar();
      })
    );
    return caja;
  }

  function columna(
    etiqueta: string,
    valores: number[],
    elegido: number | null,
    alElegir: (v: number) => void
  ) {
    const col = document.createElement('div');
    col.className = 'calendario__columna';
    col.setAttribute('role', 'listbox');
    col.setAttribute('aria-label', etiqueta);
    for (const v of valores) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'calendario__item';
      if (v === elegido) {
        b.classList.add('es-elegido');
        b.dataset.elegido = 'si';
      }
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(v === elegido));
      b.textContent = pad(v);
      b.addEventListener('click', () => alElegir(v));
      col.append(b);
    }
    return col;
  }

  /**
   * ⚠️ **`scrollTop` a mano, no `scrollIntoView()`.** Aquel desplaza **también
   * los antepasados**, así que centrar las 22:00 dentro del panel movía la
   * página entera por debajo — y en el backoffice el desplazamiento de la
   * página es justo lo que cierra el panel: se abría y se cerraba solo.
   */
  function centrarHoras() {
    for (const col of raiz.querySelectorAll<HTMLElement>('.calendario__columna')) {
      const sel = col.querySelector<HTMLElement>('[data-elegido="si"]');
      if (!sel) continue;
      col.scrollTop = sel.offsetTop - col.clientHeight / 2 + sel.offsetHeight / 2;
    }
  }

  function pie() {
    const p = document.createElement('div');
    p.className = 'calendario__pie';

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'calendario__borrar';
    borrar.textContent = 'Borrar';
    borrar.addEventListener('click', () => {
      if (!campoActual) return;
      campoActual.value = '';
      campoActual.dispatchEvent(new Event('input', { bubbles: true }));
      campoActual.dispatchEvent(new Event('change', { bubbles: true }));
      /*
       * ⚠️ **Se relee, igual que al escribir.** La portada repone la devolución
       * en cuanto la ve vacía, así que aquí el campo puede no quedarse vacío —
       * y sin releer, el panel se quedaba sin ningún día marcado mientras el
       * campo tenía fecha. Es la misma discrepancia que arregla `escribir()`.
       */
      elegida = parseFechaHora(campoActual.value);
      pintar();
    });

    const derecha = document.createElement('span');
    derecha.className = 'calendario__pie-derecha';

    /*
     * ⚠️ **«Hoy» lo decide `fueraDeRango()`, la MISMA autoridad que las
     * celdas.** Estuvo decidiéndose con `horasValidas()`, que solo recorta
     * cuando el día coincide con el del límite: con un `min` de otro día
     * devuelve las 24 horas, así que el botón salía **encendido con la celda
     * de hoy deshabilitada en la misma pantalla**. Y no era cosmético:
     * pulsarlo escribía hoy, `corregirFueraDeRango()` solo arregla la hora y
     * el minuto —nunca el día—, y el campo quedaba con `rangeUnderflow`.
     *
     * No es un caso rebuscado: es el estado por defecto. La portada propone la
     * recogida para mañana, así que la devolución nace con `min` en un día
     * futuro y su «Hoy» salía pulsable desde el primer instante.
     */
    const hoyFueraDeRango = fueraDeRango(new Date(), minLim, maxLim);

    const hoy = document.createElement('button');
    hoy.type = 'button';
    hoy.className = 'calendario__hoy';
    hoy.textContent = 'Hoy';
    hoy.disabled = hoyFueraDeRango || horasValidas(new Date(), minLim, maxLim).length === 0;
    hoy.addEventListener('click', () => {
      if (hoy.disabled) return;
      const ahora = new Date();
      mesVisible = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      elegida = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate(),
        ahora.getHours(),
        ahora.getMinutes()
      );
      corregirFueraDeRango();
      escribir(elegida);
      pintar();
    });

    /*
     * ⚠️ **Dice «Seleccionar» y no «Cerrar», y no es solo la palabra.** El panel
     * escribe en el campo en cuanto se toca un día, así que el botón cierra en
     * los dos casos; lo que cambia es lo que el visitante cree que pasa al
     * pulsarlo. «Cerrar» se lee como salir sin guardar, y delante de un
     * formulario de alquiler eso hace dudar de si la fecha ha quedado puesta.
     * Lo pidió Dorel el 7 de octubre de 2026, junto con el del backoffice.
     */
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'calendario__cerrar';
    cerrar.textContent = 'Seleccionar';
    cerrar.addEventListener('click', () => api.cerrar());

    derecha.append(hoy, cerrar);
    p.append(borrar, derecha);
    return p;
  }

  /**
   * Debajo del campo, y por encima si abajo no cabe.
   *
   * ⚠️ **Se mide contra `visualViewport` cuando existe.** En un móvil el
   * teclado no encoge `innerHeight` pero sí el viewport visual, así que un
   * panel «que cabe» puede quedar entero por debajo del teclado. Aquí solo
   * afecta a un portátil con pantalla corta, porque con el dedo manda el
   * nativo, pero la medida correcta cuesta lo mismo.
   */
  function colocar() {
    if (!campoActual) return;

    /*
     * ⚠️ **Como hoja no hay nada que colocar, y esto no es un atajo.** El panel
     * se pega al borde de abajo desde el CSS, y aquí se escriben `top`, `left` y
     * `max-height` **en línea**: eso le gana a cualquier regla de la hoja de
     * estilos. Si esta salida no estuviera, la hoja volvería a colgar del campo
     * sin que nada en el CSS lo explicara.
     *
     * Se limpian además, porque el panel es **uno solo para toda la página**:
     * girar el teléfono con el panel abierto en escritorio dejaría puestos los
     * valores de antes.
     */
    if (esHoja()) {
      raiz.style.removeProperty('top');
      raiz.style.removeProperty('left');
      raiz.style.removeProperty('max-height');
      return;
    }

    const caja = campoActual.getBoundingClientRect();
    const vv = window.visualViewport;
    const altoUtil = vv ? vv.height : window.innerHeight;
    const anchoUtil = vv ? vv.width : window.innerWidth;
    const alto = raiz.offsetHeight;
    const ancho = raiz.offsetWidth;

    const debajo = caja.bottom + 6;
    const encima = caja.top - alto - 6;
    const arriba = debajo + alto <= altoUtil || encima < 0 ? debajo : encima;
    const top = Math.max(8, arriba);

    // Alineado a la izquierda del campo, y traído hacia dentro si se sale.
    const izquierda = Math.max(8, Math.min(caja.left, anchoUtil - ancho - 8));

    raiz.style.top = `${top}px`;
    raiz.style.left = `${izquierda}px`;

    /*
     * ⚠️ **Y se RECORTA contra la pantalla.** El panel mide unos 550 px: en un
     * portátil de pantalla corta no cabe ni arriba ni abajo, y la rama de
     * arriba lo dejaba desbordando por el pie — con «Borrar», «Hoy» y «Cerrar»
     * fuera de la vista y **sin forma de alcanzarlos**, porque es `position:
     * fixed` (la página no se desplaza hasta él) y cualquier desplazamiento lo
     * cierra. Con el tope, lo que sobra se recorre dentro del propio panel.
     */
    raiz.style.maxHeight = `${Math.max(240, altoUtil - top - 8)}px`;
  }

  const alDesplazar = (e: Event) => {
    // ⚠️ El desplazamiento de las columnas de hora NO cuenta. Va en captura
    // —para enterarse de lo que se desplace en cualquier contenedor— así que
    // también caza el de la propia lista al centrarla: sin esto, el panel se
    // cierra a sí mismo nada más abrirse.
    if (e.target instanceof Node && raiz.contains(e.target)) return;
    api.cerrar();
  };

  const alRedimensionar = () => colocar();

  const api: Panel = {
    raiz,
    abiertoEn: () => campoActual,
    abrir(campo) {
      campoActual = campo;
      minLim = parseLimite(campo.min);
      maxLim = parseLimite(campo.max);
      pasos = minutosDelPaso(Number(campo.step));
      elegida = parseFechaHora(campo.value);
      mesVisible = elegida
        ? new Date(elegida.getFullYear(), elegida.getMonth(), 1)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      /*
       * ⚠️ **La superficie del panel la decide el CAMPO, no la página.** El
       * buscador de la portada está sobre una tarjeta que es oscura **en los
       * dos temas**, así que sus campos llevan `color-scheme: dark`. Pintando
       * el panel con el token de la página saldría uno blanco colgando de un
       * campo negro. Y no se puede heredar: el popover vive en el top layer,
       * colgado del `<body>`, fuera de cualquier contenedor.
       */
      raiz.classList.toggle('calendario--oscuro', getComputedStyle(campo).colorScheme === 'dark');
      // Con el dedo, hoja a lo ancho pegada abajo; con el ratón, colgando del
      // campo. La clase es lo único que el CSS necesita saber.
      raiz.classList.toggle('calendario--hoja', esHoja());

      pintar();
      raiz.showPopover();
      colocar();
      /*
       * ⚠️ **Y se centra la hora AQUÍ, no dentro de `pintar()`.** Allí se
       * llamaba ya, y no servía de nada: hasta `showPopover()` el panel sigue
       * en `display: none`, así que `clientHeight` y `offsetTop` valen **0** y
       * el cálculo deja la columna en lo alto. Medido en el buscador de la
       * portada con las 10:00 puestas: la lista se abría enseñando de la 00 a
       * la 05, sin una sola hora marcada a la vista — o sea, el panel se abría
       * diciendo que no había hora elegida.
       *
       * Dentro de `pintar()` sigue haciendo falta: al tocar un día se repinta
       * con el panel ya abierto, y ahí sí mide.
       */
      centrarHoras();

      document.addEventListener('scroll', alDesplazar, true);
      window.addEventListener('resize', alRedimensionar);
      window.visualViewport?.addEventListener('resize', alRedimensionar);
    },
    cerrar() {
      document.removeEventListener('scroll', alDesplazar, true);
      window.removeEventListener('resize', alRedimensionar);
      window.visualViewport?.removeEventListener('resize', alRedimensionar);
      if (raiz.matches(':popover-open')) raiz.hidePopover();
      campoActual = null;
    },
  };

  // Pulsar fuera y `Escape` los resuelve el propio popover; esto solo limpia.
  raiz.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState === 'closed') api.cerrar();
  });

  return api;
}

/**
 * Viste un campo de fecha con el calendario de la casa.
 *
 * ⚠️ **Solo abre la ZONA DEL ICONO**, que es exactamente lo que hace el
 * navegador. Abriéndose con cualquier clic taparía media pantalla cada vez que
 * alguien va a teclear una fecha a mano.
 */
export function montarCalendario(campo: HTMLInputElement): void {
  if (mandaElNativo()) return;
  if (campo.dataset.calendario === 'si') return;
  campo.dataset.calendario = 'si';

  // La clase es la que esconde el indicador del navegador y pinta el nuestro.
  // ⚠️ Va aquí y no en la plantilla: si este módulo no llega a ejecutarse —un
  // error de red, JavaScript desactivado—, el campo se queda con el icono
  // nativo y sigue abriéndose. Puesta en el HTML, el campo se quedaría sin
  // ninguna forma de abrir el calendario, que es el peor de los dos mundos.
  campo.classList.add('picker-propio');

  const enElIcono = (e: MouseEvent) => {
    const caja = campo.getBoundingClientRect();
    return e.clientX >= caja.right - ANCHO_ICONO;
  };

  /*
   * ⚠️ **Se abre en el `click`, NO en el `mousedown`.** Es el fallo que costó
   * más de ver de todos, porque una comprobación a medias decía que funcionaba.
   *
   * El descarte automático de un popover corre en `pointerdown` y `pointerup`.
   * Abriéndolo desde `mousedown` —que va entre los dos—, en el `pointerdown`
   * el popover aún no existía, así que **el `pointerup` del mismo clic lo
   * cierra**: con un ratón de verdad el calendario no llegaba a verse. Y
   * `e.preventDefault()` sobre `mousedown` no lo evita: eso suprime el foco y
   * los eventos de compatibilidad de ratón, nunca el descarte del popover.
   *
   * El `click` va después del `pointerup`, así que ya no hay descarte que
   * temer.
   */
  let estabaAbierto = false;

  campo.addEventListener('pointerdown', (e) => {
    // Se anota ANTES de que el navegador procese el descarte automático: es lo
    // único que distingue «vengo a abrirlo» de «acabo de cerrarlo pulsando el
    // mismo icono». Sin esto, el segundo clic lo cerraría y lo reabriría.
    estabaAbierto = enElIcono(e) && panel?.abiertoEn() === campo;
  });

  campo.addEventListener('mousedown', (e) => {
    // Sin esto el campo toma el foco y la página se desplaza para enseñarlo, y
    // ese desplazamiento llega al oyente que cierra el panel.
    if (enElIcono(e)) e.preventDefault();
  });

  campo.addEventListener('click', (e) => {
    if (!enElIcono(e)) return;
    e.preventDefault();
    if (estabaAbierto) return;
    panel ??= crearPanel();
    panel.cerrar();
    panel.abrir(campo);
  });
}

/** Todos los campos de fecha de la página, de una vez. */
export function montarCalendarios(raiz: ParentNode = document): void {
  raiz
    .querySelectorAll<HTMLInputElement>('input[type="datetime-local"], input[type="date"]')
    .forEach(montarCalendario);
}
