/**
 * La aritmética del calendario, aparte del dibujo.
 *
 * Vive fuera del panel por el mismo motivo que `qrRects()` en las functions del
 * backoffice: así se puede probar sin montar nada. Lo que se equivoca en un
 * calendario no es el CSS, es de qué día empieza la semana y qué pasa en marzo.
 *
 * ⚠️ **Es una COPIA de `src/app/shared/utils/date-picker.util.ts`, no un
 * módulo compartido**, y no se puede hacer de otra forma: `web/` es una tercera
 * build con su propio `package.json` y su propio `tsconfig`, como `functions/`.
 * Es la misma razón por la que el IVA está duplicado en las Cloud Functions. Si
 * cambia la regla, cambia en los dos sitios.
 *
 * ⚠️ **Pero NO es una copia literal, y las dos diferencias son correcciones.**
 * Están marcadas abajo una por una: el original no sabe leer el `min` de un
 * `datetime-local` y sus minutos van fijos de cinco en cinco. Las dos cosas
 * rompen estos campos.
 */

/** Lo que guarda un `input[type=date]`: `yyyy-MM-dd`. */
const ISO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Lo que guarda un `datetime-local`: `yyyy-MM-ddTHH:mm` (los segundos sobran). */
const ISO_FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

export interface Celda {
  fecha: Date;
  /** Del mes que se está mirando, no del anterior ni del siguiente. */
  delMes: boolean;
  hoy: boolean;
  elegida: boolean;
  /** Fuera de `min`/`max`: se enseña pero no se puede elegir. */
  bloqueada: boolean;
}

/**
 * `yyyy-MM-dd` → fecha **local**.
 *
 * ⚠️ **`new Date('2026-10-10')` NO vale**, y este es el fallo clásico de todo
 * calendario: esa cadena se interpreta como medianoche **UTC**, así que en
 * cualquier huso al oeste de Greenwich sale el día anterior. Aquí no se notaría
 * —España va por delante de UTC— pero el día que alguien abra la web desde
 * Canarias en invierno, o desde América, el calendario marcaría el 9. Se
 * construye por partes, que siempre es local.
 */
export function parseFecha(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const m = ISO_FECHA.exec(valor);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * `yyyy-MM-ddTHH:mm` → fecha local, con su hora.
 *
 * ⚠️ **Sin zona horaria, y por eso el campo se llama «local».** Es lo que
 * quiere un alquiler: «el día 10 a las 12:00» son las doce de donde está el
 * coche, no un instante absoluto que cambia al cruzar un huso.
 */
export function parseFechaHora(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const m = ISO_FECHA_HORA.exec(valor);
  if (!m) return null;
  const h = Number(m[4]);
  const min = Number(m[5]);
  if (h > 23 || min > 59) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Un límite (`min` o `max`) escrito de **cualquiera de las dos formas**.
 *
 * ⚠️ **Esta función nació como corrección sobre el backoffice, y allí ya está
 * aplicada.** `DatePickerPanelComponent` leía sus límites con
 * `parseValue('date', …)`, cuyo `ISO_FECHA` va **anclado** (`^…$`): un
 * `min="2026-09-29T10:00"` no casa, devuelve `null`, y el panel **no
 * deshabilitaba ni un solo día**. O sea que en un `datetime-local` —que es lo
 * que son los cuatro campos de esta web y los dos del asistente de reservas— el
 * calendario ofrecía días que el propio campo rechaza después con
 * `rangeUnderflow`, y el formulario se negaba a enviarse sin decir por qué.
 * Allí lo arregla `parseLimitValue()` desde el 7 de octubre de 2026.
 *
 * ⚠️ **Lo que sigue siendo distinto es que aquí la HORA del límite se
 * conserva.** El backoffice compara por días y deja la hora al campo; esta web
 * la necesita, porque `horasValidas()` y `minutosValidos()` recortan las horas
 * del primer día del rango.
 *
 * Aquí se acepta el día suelto y el día con hora, y se conserva la hora cuando
 * viene: hace falta para el primer día del rango, donde no todas las horas
 * valen.
 */
export function parseLimite(valor: string | null | undefined): Date | null {
  return parseFechaHora(valor) ?? parseFecha(valor);
}

/** Fecha local → `yyyy-MM-dd`. Sin pasar por UTC, por lo mismo de arriba. */
export function comoFecha(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function comoHora(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Fecha local → `yyyy-MM-ddTHH:mm`, que es lo que lee un `datetime-local`. */
export function comoValor(d: Date): string {
  return `${comoFecha(d)}T${comoHora(d)}`;
}

export function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Medianoche del mismo día. Comparar días con horas dentro no funciona. */
export function inicioDelDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Fuera de los límites del campo.
 *
 * Se compara **por días**: al visitante se le bloquea el día entero, y la hora
 * la resuelve después `horasValidas()`. Si se comparara por instantes, el
 * primer día del rango saldría bloqueado entero solo porque su medianoche es
 * anterior al `min`, y no se podría alquilar hoy por la tarde.
 */
export function fueraDeRango(fecha: Date, min?: Date | null, max?: Date | null): boolean {
  const d = inicioDelDia(fecha).getTime();
  if (min && d < inicioDelDia(min).getTime()) return true;
  if (max && d > inicioDelDia(max).getTime()) return true;
  return false;
}

/** El mes de al lado, sin que un día 31 se cuele en el siguiente. */
export function sumarMeses(d: Date, meses: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + meses, 1);
}

export interface OpcionesRejilla {
  elegida?: Date | null;
  min?: Date | null;
  max?: Date | null;
  hoy?: Date;
}

/**
 * Las 42 casillas del mes: seis semanas completas, siempre.
 *
 * ⚠️ **Siempre 42, aunque el mes quepa en cinco semanas.** Con un número
 * variable de filas el panel cambia de alto al pasar de mes, y lo que estaba
 * debajo del ratón deja de estarlo: se va a pulsar «siguiente» y se acaba
 * eligiendo un día. Febrero de un año no bisiesto que empiece en lunes cabe en
 * cuatro filas; con esto salen igualmente seis.
 *
 * La semana empieza en **lunes**, que es lo que usa el español.
 */
export function rejillaDelMes(mesVisible: Date, opciones: OpcionesRejilla = {}): Celda[] {
  const { elegida, min, max } = opciones;
  const hoy = inicioDelDia(opciones.hoy ?? new Date());

  const primero = new Date(mesVisible.getFullYear(), mesVisible.getMonth(), 1);
  // Cuántos días hay que retroceder para empezar en lunes. El `+ 6` y el `% 7`
  // convierten el domingo de JavaScript (0) en el último día de la semana (6).
  const desplazamiento = (primero.getDay() + 6) % 7;
  const inicio = new Date(primero.getFullYear(), primero.getMonth(), 1 - desplazamiento);

  const celdas: Celda[] = [];
  for (let i = 0; i < 42; i++) {
    const fecha = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    celdas.push({
      fecha,
      delMes: fecha.getMonth() === mesVisible.getMonth(),
      hoy: mismoDia(fecha, hoy),
      elegida: !!elegida && mismoDia(fecha, elegida),
      bloqueada: fueraDeRango(fecha, min, max),
    });
  }
  return celdas;
}

/**
 * Los minutos que se ofrecen, derivados del `step` del campo.
 *
 * ⚠️ **Esta es la segunda corrección sobre el backoffice, y sin ella el
 * buscador deja de funcionar sin dar un solo error.** Allí los minutos iban
 * fijos de cinco en cinco (`minuteSteps(5)`), y estos campos llevan
 * `step="900"` — cuartos de hora. El panel escribiría «10:05», el navegador lo
 * marcaría `stepMismatch`, el formulario no se enviaría y **pulsar «Ver
 * precios» no haría absolutamente nada**, sin nada en consola.
 *
 * ⚠️ **Y sigue haciendo falta aunque ya no haya columna de minutos** (7 de
 * octubre de 2026): la hora se elige en punto, pero `minutosValidos()` empuja
 * el minuto al primer hueco bueno cuando el `min` del campo cae a y media, y
 * ese hueco tiene que caer en la rejilla del `step`.
 *
 * Es el mismo fallo que ya costó un rato por el otro extremo, cuando el `min`
 * cayó fuera de la rejilla del `step`: con `step=900` el navegador cuenta los
 * cuartos **desde `min`**, no desde la hora en punto.
 *
 * Un `step` que no divida la hora —o que pase de una hora— se trata como «sin
 * saltos»: se ofrecen los cuartos de siempre, que es lo que alguien elige, y el
 * teclado sigue admitiendo cualquier minuto.
 */
export function minutosDelPaso(stepSegundos: number | null | undefined): number[] {
  const paso = Number(stepSegundos);
  if (!isFinite(paso) || paso <= 0) return [0, 15, 30, 45];

  const minutos = paso / 60;
  // Con saltos de menos de un minuto o que no encajan en una hora, la lista
  // deja de tener sentido: 30 filas de segundos no las recorre nadie.
  if (!Number.isInteger(minutos) || minutos < 1 || minutos > 30 || 60 % minutos !== 0) {
    return [0, 15, 30, 45];
  }

  const salida: number[] = [];
  for (let m = 0; m < 60; m += minutos) salida.push(m);
  return salida;
}

export const HORAS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Qué horas se pueden elegir del día que está elegido.
 *
 * ⚠️ **El `min` de estos campos es «ahora», así que HOY no vale cualquier
 * hora.** Sin esto, el panel ofrece las 24 horas del día en curso, el visitante
 * elige una que ya pasó y el campo la rechaza con `rangeUnderflow`: el botón
 * deja de funcionar y no hay nada en pantalla que lo explique. Solo afecta al
 * primer y al último día del rango; en los de en medio valen las 24.
 */
export function horasValidas(dia: Date, min?: Date | null, max?: Date | null): number[] {
  return HORAS.filter((h) => {
    if (min && mismoDia(dia, min) && h < min.getHours()) return false;
    if (max && mismoDia(dia, max) && h > max.getHours()) return false;
    return true;
  });
}

/**
 * Lo mismo para los minutos, dentro de una hora ya elegida.
 *
 * Solo recorta en la hora exacta del límite: a las 10:30 de `min`, las 10:00 y
 * las 10:15 no valen y las 10:45 sí.
 */
export function minutosValidos(
  dia: Date,
  hora: number,
  paso: number[],
  min?: Date | null,
  max?: Date | null
): number[] {
  return paso.filter((m) => {
    if (min && mismoDia(dia, min) && hora === min.getHours() && m < min.getMinutes()) return false;
    if (max && mismoDia(dia, max) && hora === max.getHours() && m > max.getMinutes()) return false;
    return true;
  });
}
