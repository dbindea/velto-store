/**
 * La lógica del buscador: los límites de las fechas, la propuesta inicial y el
 * comportamiento de los dos campos entre sí.
 *
 * ⚠️ **Vive aparte del marcado por la misma razón que el marcado vive en un
 * componente:** desde el 30 de septiembre de 2026 el buscador sale en la
 * portada **y** en la página de resultados, y lo que no puede haber son dos
 * copias de estas reglas. La de la portada llevaba tres cosas que la de
 * resultados no tenía —el lugar de recogida, la propuesta de fechas y que la
 * devolución siga a la recogida conservando los días—, así que corregir las
 * fechas en los resultados se comportaba distinto de elegirlas en la portada.
 *
 * ⚠️ **Todo en hora LOCAL, y nada de `toISOString()`.** Un `datetime-local`
 * habla `yyyy-MM-ddTHH:mm` en la hora del que mira; pasar por UTC convierte una
 * recogida a las 00:30 de Madrid en las 22:30 del día anterior.
 *
 * ⚠️ **Y las comparaciones son de CADENAS.** `yyyy-MM-ddTHH:mm` ordena igual
 * alfabéticamente que cronológicamente —para eso es ese formato—, así que no
 * hace falta construir `Date` para decidir si una fecha va antes que otra.
 */

import { montarComboZonas } from './zonas-combo';
import { montarCalendarios } from './fecha-panel';

/** Las 10:00, cuando abre la oficina. Nadie recoge un coche a medianoche. */
export const RECOGIDA_POR_DEFECTO = 10;
export const DIAS_POR_DEFECTO = 3;

/** `yyyy-MM-ddTHH:mm` en hora local, que es lo que lee un `datetime-local`. */
export function comoCampo(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function sumarDias(valor: string, dias: number): string {
  const d = new Date(valor);
  d.setDate(d.getDate() + dias);
  return comoCampo(d);
}

/**
 * Redondea hacia arriba al cuarto de hora.
 *
 * ⚠️ **El `min` tiene que caer en la REJILLA del `step`, y esto costó un botón
 * que no hacía nada.** Con `step="900"` el navegador cuenta los cuartos **desde
 * `min`**, no desde la hora en punto: con `min` a las 16:19 los valores válidos
 * son 16:19, 16:34, 16:49… y unas 10:00 propuestas **no están entre ellos**. El
 * campo queda inválido, el formulario no se envía y pulsar no hace nada. Sin
 * error en consola y sin nada que mirar.
 */
export function alCuarto(d: Date): Date {
  const c = new Date(d);
  c.setSeconds(0, 0);
  c.setMinutes(Math.ceil(c.getMinutes() / 15) * 15);
  return c;
}

/** Mañana a las diez, y tres días. */
export function propuestaInicial(ahora = new Date()): { desde: string; hasta: string } {
  const d = new Date(ahora);
  d.setDate(d.getDate() + 1);
  d.setHours(RECOGIDA_POR_DEFECTO, 0, 0, 0);
  const desde = comoCampo(d);
  return { desde, hasta: sumarDias(desde, DIAS_POR_DEFECTO) };
}

/**
 * Acepta las dos formas que puede traer la URL.
 *
 * ⚠️ **Y eso NO es un parche de compatibilidad.** El buscador manda
 * `yyyy-MM-ddTHH:mm` —una recogida es un instante—, pero por ahí fuera hay
 * enlaces compartidos con el formato anterior, de solo fecha. Con la expresión
 * estricta, el visitante que ya había elegido fechas aterrizaba en un
 * formulario vacío y tenía que repetirlas.
 */
const CON_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function instanteDeLaUrl(v: string | null): string | null {
  if (!v) return null;
  if (CON_HORA.test(v)) return v;
  if (SOLO_FECHA.test(v)) return `${v}T${String(RECOGIDA_POR_DEFECTO).padStart(2, '0')}:00`;
  return null;
}

export interface CamposBuscador {
  lugar: HTMLInputElement | null;
  desde: HTMLInputElement;
  hasta: HTMLInputElement;
  form: HTMLFormElement;
}

export interface OpcionesBuscador {
  /** Lo que traía la URL. Sin esto, se propone mañana a las diez. */
  valores?: { desde?: string | null; hasta?: string | null; lugar?: string | null };
  /**
   * Si se pasa, el envío **no navega**: se intercepta y se llama a esto. Es lo
   * que separa la portada —que salta a `/reservar`— de la página de
   * resultados, que vuelve a consultar sin recargar.
   */
  alBuscar?: (v: { desde: string; hasta: string; lugar: string }) => void;
}

/**
 * Deja el buscador funcionando. Devuelve los campos, que es lo que la página
 * necesita después para leer las fechas al pedir un coche.
 */
export function montarBuscador(opciones: OpcionesBuscador = {}): CamposBuscador | null {
  const form = document.getElementById('buscador') as HTMLFormElement | null;
  const desde = document.getElementById('desde') as HTMLInputElement | null;
  const hasta = document.getElementById('hasta') as HTMLInputElement | null;
  if (!form || !desde || !hasta) return null;

  const lugar = document.getElementById('lugar') as HTMLInputElement | null;
  const aspa = document.getElementById('limpiar-lugar');
  const envoltorio = lugar?.closest('.campo-con-aspa');

  if (lugar && aspa && envoltorio) {
    /*
     * La lista de zonas, con su precio dentro de cada fila. Sustituye al
     * `<datalist>`: su lista la pinta el navegador fuera de la página y ningún
     * CSS la alcanza, y el precio solo cabía en el atributo `label`, que **solo
     * Chrome enseña junto al valor** — en Firefox la lista salía sin un nombre
     * de pueblo y en Safari sin un precio.
     */
    montarComboZonas(lugar);

    if (opciones.valores?.lugar) lugar.value = opciones.valores.lugar;

    /*
     * ⚠️ **Se escucha `input` y además `change`.** `change` solo salta al salir
     * del campo, así que el aspa no aparecería hasta entonces; y elegir del
     * `<datalist>` con el ratón no dispara `input` en todos los navegadores.
     */
    const refrescarAspa = () =>
      envoltorio.classList.toggle('tiene-texto', lugar.value.length > 0);
    lugar.addEventListener('input', refrescarAspa);
    lugar.addEventListener('change', refrescarAspa);

    aspa.addEventListener('click', () => {
      lugar.value = '';
      refrescarAspa();
      // Quien borra es porque va a escribir otra cosa: sin esto hay que volver
      // a tocar el campo, y en un móvil eso es cerrar el teclado y abrirlo.
      lugar.focus();
    });
    refrescarAspa();
  }

  /*
   * ⚠️ **El `min` de un `datetime-local` NECESITA la hora.** Con `yyyy-MM-dd` a
   * secas **ignora el atributo entero y sin avisar**, así que se podrían elegir
   * fechas pasadas y nada fallaría. Medido en la página de resultados el 29 de
   * septiembre de 2026: una recogida de 2020 pasaba `checkValidity()`.
   */
  const ahoraCampo = comoCampo(alCuarto(new Date()));
  desde.min = ahoraCampo;
  hasta.min = ahoraCampo;

  const dadas = opciones.valores?.desde && opciones.valores?.hasta;
  if (dadas) {
    desde.value = opciones.valores!.desde!;
    hasta.value = opciones.valores!.hasta!;
  } else {
    // Quien mira ya tiene algo que corregir en vez de dos campos vacíos que
    // hay que rellenar antes de ver un precio.
    const p = propuestaInicial();
    desde.value = p.desde;
    hasta.value = p.hasta;
  }

  /**
   * ⚠️ **La devolución SIGUE a la recogida, y por eso la mueve.** Sin esto se
   * puede pedir un alquiler que termina antes de empezar: el navegador no
   * relaciona dos campos por su cuenta. Y `min` por sí solo no basta —marca el
   * campo como inválido y deja el valor puesto—, así que además se recoloca
   * conservando los días elegidos: mover la recogida al día siguiente no puede
   * recortarle el alquiler a nadie.
   */
  const ajustarDevolucion = () => {
    if (!desde.value) return;
    hasta.min = desde.value;
    if (!hasta.value || hasta.value <= desde.value) {
      hasta.value = sumarDias(desde.value, DIAS_POR_DEFECTO);
    }
  };

  let anterior = desde.value;
  desde.addEventListener('change', () => {
    if (desde.value && hasta.value && anterior && hasta.value > anterior) {
      const dias = Math.round(
        (new Date(hasta.value).getTime() - new Date(anterior).getTime()) / 86_400_000
      );
      if (dias > 0) hasta.value = sumarDias(desde.value, dias);
    }
    anterior = desde.value;
    ajustarDevolucion();
  });

  hasta.addEventListener('change', ajustarDevolucion);
  ajustarDevolucion();

  /*
   * El calendario de Velto delante del del navegador.
   *
   * ⚠️ **Va DESPUÉS de poner `min` y `value`**, no antes: el panel los lee del
   * campo al abrirse, así que montado primero se quedaría con unos límites que
   * todavía no existían y ofrecería días que el campo rechaza.
   *
   * ⚠️ **Y con el dedo NO se monta**, que lo decide el propio módulo: la hoja
   * del sistema está mejor hecha para el pulgar, y aquí no hay ningún motivo
   * para sustituirla.
   */
  montarCalendarios();

  if (opciones.alBuscar) {
    const alBuscar = opciones.alBuscar;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      alBuscar({ desde: desde.value, hasta: hasta.value, lugar: lugar?.value ?? '' });
    });
  }

  return { form, desde, hasta, lugar };
}
