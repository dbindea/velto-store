/**
 * La aritmética del selector de fecha y hora, aparte del dibujo.
 *
 * Vive fuera del componente por el mismo motivo que `qrRects()` o
 * `wrapPreferringCommas()`: así se puede probar sin montar nada. Lo que se
 * equivoca en un calendario no es el CSS, es de qué día empieza la semana y
 * qué pasa en marzo, y eso se comprueba con tests.
 */

/** Lo que el `<input type="date">` guarda y lee: `yyyy-MM-dd`. */
const ISO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Lo del `<input type="time">`: `HH:mm` (puede traer segundos y se ignoran). */
const ISO_HORA = /^(\d{2}):(\d{2})/;

export type PickerMode = 'date' | 'time' | 'datetime';

export interface DayCell {
  date: Date;
  /** Del mes que se está mirando, no del anterior ni del siguiente. */
  inMonth: boolean;
  today: boolean;
  selected: boolean;
  /** Fuera de `min`/`max`: se enseña pero no se puede elegir. */
  disabled: boolean;
}

/**
 * Convierte `yyyy-MM-dd` en una fecha **local**.
 *
 * ⚠️ **`new Date('2026-10-10')` NO vale**, y este es el fallo clásico de todo
 * calendario: esa cadena se interpreta como medianoche **UTC**, así que en
 * cualquier huso al oeste de Greenwich sale el día anterior. Aquí no se notaría
 * —España va por delante de UTC— pero el día que alguien abra la aplicación
 * desde Canarias en invierno, o desde América, el calendario marcaría el 9. Se
 * construye por partes, que siempre es local.
 */
export function parseDateValue(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const m = ISO_FECHA.exec(valor);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** Fecha local → `yyyy-MM-dd`. Sin pasar por UTC, por lo mismo de arriba. */
export function formatDateValue(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** `HH:mm` → minutos desde medianoche. `null` si no lo parece. */
export function parseTimeValue(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const m = ISO_HORA.exec(valor);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTimeValue(minutosDelDia: number): string {
  const h = Math.floor(minutosDelDia / 60);
  const m = minutosDelDia % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * El valor de un `datetime-local`: `yyyy-MM-ddTHH:mm`.
 *
 * ⚠️ **Sin zona horaria, y por eso se llama «local».** Es lo que quiere una
 * reserva: «el día 10 a las 12:00» significa las doce de donde está el coche,
 * no un instante absoluto que cambia al cruzar un huso.
 */
export function parseDateTimeValue(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const [fecha, hora] = valor.split('T');
  const dia = parseDateValue(fecha);
  if (!dia) return null;
  const minutos = parseTimeValue(hora) ?? 0;
  dia.setHours(Math.floor(minutos / 60), minutos % 60, 0, 0);
  return dia;
}

export function formatDateTimeValue(d: Date): string {
  return `${formatDateValue(d)}T${formatTimeValue(d.getHours() * 60 + d.getMinutes())}`;
}

/** Lee el valor de un campo según su tipo. */
export function parseValue(mode: PickerMode, valor: string | null | undefined): Date | null {
  if (mode === 'date') return parseDateValue(valor);
  if (mode === 'datetime') return parseDateTimeValue(valor);
  const minutos = parseTimeValue(valor);
  if (minutos === null) return null;
  const d = new Date();
  d.setHours(Math.floor(minutos / 60), minutos % 60, 0, 0);
  return d;
}

/** Escribe el valor de un campo según su tipo. */
export function formatValue(mode: PickerMode, d: Date): string {
  if (mode === 'date') return formatDateValue(d);
  if (mode === 'datetime') return formatDateTimeValue(d);
  return formatTimeValue(d.getHours() * 60 + d.getMinutes());
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Medianoche del mismo día. Comparar días con horas dentro no funciona. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface GridOptions {
  selected?: Date | null;
  min?: Date | null;
  max?: Date | null;
  today?: Date;
  /** 1 = lunes. Es lo que usan los tres idiomas de esta aplicación. */
  firstDayOfWeek?: number;
}

/**
 * Las 42 casillas del mes: seis semanas completas, siempre.
 *
 * ⚠️ **Siempre 42, aunque el mes quepa en cinco semanas.** Con un número
 * variable de filas el panel cambia de alto al pasar de mes, y lo que estaba
 * debajo del ratón deja de estarlo: se va a pulsar «siguiente» y se acaba
 * eligiendo un día. Febrero de un año no bisiesto que empiece en lunes cabe en
 * cuatro filas; con esto salen igualmente seis.
 */
export function monthGrid(mesVisible: Date, opciones: GridOptions = {}): DayCell[] {
  const { selected, min, max, firstDayOfWeek = 1 } = opciones;
  const hoy = startOfDay(opciones.today ?? new Date());

  const primero = new Date(mesVisible.getFullYear(), mesVisible.getMonth(), 1);
  // Cuántos días hay que retroceder para empezar la rejilla en el día de la
  // semana que toca. El `+ 7` evita el negativo cuando el mes empieza en
  // domingo y la semana empieza en lunes.
  const desplazamiento = (primero.getDay() - firstDayOfWeek + 7) % 7;
  const inicio = new Date(primero.getFullYear(), primero.getMonth(), 1 - desplazamiento);

  const celdas: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const fecha = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    celdas.push({
      date: fecha,
      inMonth: fecha.getMonth() === mesVisible.getMonth(),
      today: isSameDay(fecha, hoy),
      selected: !!selected && isSameDay(fecha, selected),
      disabled: outOfRange(fecha, min, max)
    });
  }
  return celdas;
}

/**
 * Fuera de los límites del campo.
 *
 * Se compara **por días**: `min` en un `input[type=date]` es una fecha sin
 * hora, y el día que la iguala sí vale.
 */
export function outOfRange(fecha: Date, min?: Date | null, max?: Date | null): boolean {
  const d = startOfDay(fecha).getTime();
  if (min && d < startOfDay(min).getTime()) return true;
  if (max && d > startOfDay(max).getTime()) return true;
  return false;
}

/** El mes de al lado, sin que un día 31 se cuele en el siguiente. */
export function addMonths(d: Date, meses: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + meses, 1);
}

/**
 * Las horas que se ofrecen, en saltos.
 *
 * ⚠️ **La lista no sustituye al teclado.** El campo sigue siendo un
 * `input[type=time]` y se puede escribir cualquier minuto; esto es el atajo
 * para los de siempre. Con saltos de cinco minutos salen 12 por hora, que es
 * una lista que se recorre de un vistazo — de uno en uno serían 60 y habría
 * que buscar.
 */
export function minuteSteps(paso = 5): number[] {
  const salida: number[] = [];
  for (let m = 0; m < 60; m += paso) salida.push(m);
  return salida;
}

export const HOURS = Array.from({ length: 24 }, (_, h) => h);
