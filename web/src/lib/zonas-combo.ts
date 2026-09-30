/**
 * El desplegable de zonas de recogida.
 *
 * ⚠️ **Sustituye a un `<datalist>`, y el motivo no es estético.** La lista de
 * un `<datalist>` la dibuja el navegador fuera de la página y **no hay ningún
 * CSS que la alcance**: `::picker()` solo acepta `<select>`. Pero al mirarlo de
 * cerca salió algo peor que el aspecto: el precio de cada zona viajaba en el
 * atributo `label`, y **solo Chrome enseña el valor y la etiqueta a la vez**.
 * Firefox sustituye el valor por la etiqueta —o sea que la lista salía sin un
 * solo nombre de pueblo— y Safari ignora la etiqueta, o sea sin un solo precio.
 * La promesa pública de la tarifa no llegaba en dos de los tres navegadores, y
 * nada avisaba porque el único en el que se probó fue el único que la enseña.
 *
 * ⚠️ **Y NO es un `<select>`, que sería lo cómodo.** Un desplegable obliga a
 * elegir de la lista; aquí hace falta lo contrario: las tres zonas que la
 * empresa sirve **y** poder escribir cualquier otra cosa. La empresa va más
 * lejos, solo que el importe se acuerda por teléfono, y un campo que rechazara
 * el texto libre perdería justo al cliente que llama.
 *
 * ⚠️ **No lleva flecha a la derecha, a propósito.** Ese hueco ya lo ocupa el
 * aspa, y dos botones a pocos milímetros —uno que despliega y otro que borra lo
 * escrito— es la trampa que Dorel ya rechazó en los campos de fecha: «con el
 * dedo uno se confunde». La lista se abre al entrar en el campo, que es cuando
 * hace falta.
 */

import { ZONAS, type ZonaRecogida } from './zonas';

const ABIERTO = 'esta-abierto';

export function montarComboZonas(campo: HTMLInputElement): void {
  const contenedor = campo.closest<HTMLElement>('.campo-con-aspa');
  if (!contenedor || campo.dataset.combo === 'si') return;
  campo.dataset.combo = 'si';
  // Una constante propia ya estrechada: TypeScript no conserva el estrechamiento
  // dentro de las funciones de abajo, y ahí se usa media docena de veces.
  const envoltorio: HTMLElement = contenedor;

  /*
   * ⚠️ **El `list` se quita desde JavaScript, no de la plantilla.** Si este
   * módulo no llegara a ejecutarse —un error de red, un navegador antiguo— el
   * campo se queda con su `<datalist>` de siempre, que es imperfecto pero
   * funciona. Quitado del HTML, un fallo aquí dejaría el campo sin ninguna
   * lista y sin ninguna forma de enterarse de que a Barajas son 30 €.
   */
  campo.removeAttribute('list');
  document.getElementById('zonas')?.remove();

  const lista = document.createElement('ul');
  lista.className = 'zonas';
  lista.id = 'zonas-lista';
  lista.setAttribute('role', 'listbox');
  lista.setAttribute('aria-label', 'Zonas de recogida');
  lista.hidden = true;
  envoltorio.append(lista);

  campo.setAttribute('role', 'combobox');
  campo.setAttribute('aria-expanded', 'false');
  campo.setAttribute('aria-controls', 'zonas-lista');
  campo.setAttribute('aria-autocomplete', 'list');

  let activa = -1;
  /**
   * ⚠️ **«Hay una opción marcada» y «el visitante ha navegado» NO son lo
   * mismo**, y confundirlos rompía el buscador. `abrir()` siembra `activa` con
   * la zona que el campo ya trae —para que la primera flecha parta de ahí, que
   * es lo correcto—, así que `activa >= 0` era cierto desde el instante en que
   * la lista se abría. Resultado: escribir «Cuenca» y pulsar Enter **no
   * enviaba el formulario y encima revertía el campo a «Arganda del Rey»**.
   * Solo lo arman las flechas, y lo desarma escribir o cerrar.
   */
  let navegando = false;

  const opciones: HTMLLIElement[] = ZONAS.map((z, i) => opcion(z, i));

  function opcion(z: ZonaRecogida, i: number) {
    const li = document.createElement('li');
    li.className = 'zonas__opcion';
    li.id = `zona-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');

    const nombre = document.createElement('span');
    nombre.className = 'zonas__nombre';
    nombre.textContent = z.nombre;

    const coste = document.createElement('span');
    coste.className = 'zonas__coste';
    coste.textContent = z.coste;

    li.append(nombre, coste);
    li.addEventListener('click', () => elegir(i));
    li.addEventListener('mousemove', () => marcar(i));
    return li;
  }

  function pintar() {
    lista.replaceChildren(...opciones);
    opciones.forEach((li, i) => {
      const puesta = campo.value.trim().toLowerCase() === ZONAS[i].nombre.toLowerCase();
      li.classList.toggle('es-activa', i === activa);
      li.classList.toggle('es-elegida', puesta);
      li.setAttribute('aria-selected', String(puesta));
    });
    if (activa >= 0) campo.setAttribute('aria-activedescendant', `zona-${activa}`);
    else campo.removeAttribute('aria-activedescendant');
  }

  /**
   * Debajo del campo, y **encima si el teclado no deja sitio**.
   *
   * ⚠️ **Se mide contra `visualViewport`, no contra `innerHeight`.** Un teclado
   * de móvil **no encoge `innerHeight`**: lo que encoge es el viewport visual.
   * Midiendo contra el otro, la lista «cabe» y queda entera por debajo del
   * teclado — el visitante toca el campo, se abre el teclado y no ve ninguna
   * zona, que es exactamente la impresión de que el campo está roto. Y es el
   * caso principal, porque esta web se mira desde el móvil.
   *
   * ⚠️ **Y hay que recolocarla cuando el teclado aparece**, no solo al abrir:
   * la lista se despliega con el foco y el teclado sube después.
   */
  function colocar() {
    if (lista.hidden) return;
    const vv = window.visualViewport;
    const alto = vv ? vv.height + vv.offsetTop : window.innerHeight;
    const caja = campo.getBoundingClientRect();
    const necesita = lista.offsetHeight + 8;
    const cabeDebajo = caja.bottom + necesita <= alto;
    // Arriba solo si además cabe: con el campo pegado a la cabecera, volcarlo
    // hacia arriba lo sacaría por el otro lado y sería peor.
    lista.classList.toggle('zonas--arriba', !cabeDebajo && caja.top - necesita >= 0);
  }

  function abrir() {
    if (!lista.hidden) return;
    lista.hidden = false;
    envoltorio.classList.add(ABIERTO);
    campo.setAttribute('aria-expanded', 'true');
    // Al abrir se marca la que ya está puesta, para que las flechas partan de
    // donde está el visitante y no del principio de la lista.
    activa = ZONAS.findIndex((z) => z.nombre.toLowerCase() === campo.value.trim().toLowerCase());
    pintar();
    colocar();
    window.visualViewport?.addEventListener('resize', colocar);
  }

  function cerrar() {
    if (lista.hidden) return;
    window.visualViewport?.removeEventListener('resize', colocar);
    navegando = false;
    lista.hidden = true;
    lista.classList.remove('zonas--arriba');
    envoltorio.classList.remove(ABIERTO);
    campo.setAttribute('aria-expanded', 'false');
    campo.removeAttribute('aria-activedescendant');
    activa = -1;
  }

  function marcar(i: number) {
    activa = i;
    pintar();
  }

  function elegir(i: number) {
    campo.value = ZONAS[i].nombre;
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new Event('change', { bubbles: true }));
    cerrar();
    campo.focus();
  }

  /*
   * ⚠️ **Sin esto, hacer clic en una opción no elige nada.** El `mousedown`
   * sobre la lista saca el foco del campo, el manejador de `blur` la cierra, y
   * para cuando llega el `click` la opción ya no está. El fallo es silencioso y
   * además **intermitente por dispositivo**: con teclado funciona y con ratón
   * no, que es la peor combinación porque se prueba con teclado.
   */
  lista.addEventListener('mousedown', (e) => e.preventDefault());

  /**
   * Al vaciar el campo con el aspa, la lista se cierra.
   *
   * ⚠️ **Lo pidió Dorel el 30 de septiembre de 2026 y tiene su razón de uso:**
   * «al borrar el texto de recogida, bórrame también las sugerencias para que
   * me indique visualmente que puedo escribir». Con la lista abierta encima, el
   * campo vacío no se lee como una invitación a teclear — se lee como que hay
   * que elegir una de las tres.
   *
   * ⚠️ **Y el foco se queda en el campo**, que es lo que hace que esto funcione
   * en un móvil: sin foco se cierra el teclado y hay que volver a tocar. El
   * problema es que `focus` abre la lista, así que hace falta una bandera para
   * saltarse **esa** apertura y solo esa — reentrando después, vuelve a salir,
   * que es lo que él también pidió.
   */
  let saltarLaSiguienteApertura = false;

  /*
   * El aspa la monta `index.astro`, que es quien la tiene en su plantilla; aquí
   * solo se escucha. Se busca dentro del envoltorio y no por `id` para que el
   * día que este campo se repita en otra página siga funcionando.
   */
  envoltorio.querySelector('.aspa')?.addEventListener('click', () => {
    saltarLaSiguienteApertura = true;
    cerrar();
  });

  campo.addEventListener('focus', () => {
    if (saltarLaSiguienteApertura) {
      saltarLaSiguienteApertura = false;
      return;
    }
    abrir();
  });
  campo.addEventListener('click', () => {
    // Un clic DESPUÉS de vaciar sí abre: la bandera solo vale para el foco que
    // el propio aspa devuelve.
    saltarLaSiguienteApertura = false;
    abrir();
  });
  campo.addEventListener('input', () => {
    // Escribir desarma la navegación: a partir de aquí, Enter envía.
    navegando = false;
    saltarLaSiguienteApertura = false;
    abrir();
    pintar();
  });
  campo.addEventListener('blur', cerrar);

  campo.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (lista.hidden) {
        abrir();
        navegando = true;
        return;
      }
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      navegando = true;
      marcar((activa + paso + ZONAS.length) % ZONAS.length);
      return;
    }

    if (e.key === 'Enter') {
      /*
       * ⚠️ **Enter solo elige si el visitante ha NAVEGADO con las flechas.**
       * Con la lista abierta y una zona marcada de salida, interceptarlo a
       * secas convertía el Enter de «ya he escrito, búscame» en un «elige la
       * zona que tenías puesta»: escribir «Cuenca» y pulsar Enter revertía el
       * campo y se comía el envío.
       *
       * Y sigue haciendo falta interceptarlo cuando sí se ha navegado: con el
       * `<datalist>` de antes, escribir «Me» con una zona resaltada y pulsar
       * Enter navegaba a `/reservar?place=Me` — a consultar precios para un
       * lugar llamado «Me».
       */
      if (!lista.hidden && navegando && activa >= 0) {
        e.preventDefault();
        elegir(activa);
      } else {
        // Enter normal: se cierra la lista y el formulario se envía solo.
        cerrar();
      }
      return;
    }

    if (e.key === 'Escape') {
      if (!lista.hidden) {
        e.preventDefault();
        cerrar();
      }
      return;
    }

    if (e.key === 'Tab') cerrar();
  });
}
