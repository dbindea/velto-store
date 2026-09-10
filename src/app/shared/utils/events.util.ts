/**
 * Todo lo que hay que hacer próximamente, en una sola lista y ordenado.
 *
 * ⚠️ **Los eventos derivados NO se guardan en ninguna parte.** Una entrega de
 * mañana ya está en la reserva y una ITV en su mantenimiento: copiarlos a una
 * colección de «eventos» crearía una segunda fuente de verdad que se quedaría
 * vieja en cuanto alguien cambiara la fecha de recogida — y entonces habría dos
 * respuestas a la misma pregunta y ninguna forma de saber cuál manda. Aquí se
 * derivan al pintar.
 *
 * Lo único que se guarda son los **recordatorios manuales**, porque no se pueden
 * deducir de nada: «comprar ambientadores» no está en ningún dato.
 */

import { Reminder, ReminderCategory } from '@shared/models/reminder.model';

/** De dónde sale un evento. Decide el icono, el color y a dónde lleva al pulsar. */
export type EventSource =
  | 'pickup'
  | 'return'
  | 'maintenance'
  | 'invoiceDeadline'
  | 'reminder';

export interface UpcomingEvent {
  /** Único dentro de la lista: `origen:id`. */
  key: string;
  source: EventSource;
  /** Cuándo toca. Siempre una fecha de verdad, nunca texto. */
  date: Date;
  title: string;
  /** La línea de debajo: cliente, matrícula, importe… */
  detail?: string;
  /**
   * Algo que exige atención y no puede leerse como una línea más.
   * Un contrato sin firmar el día antes de entregar, una ITV caducada.
   */
  alert?: string;
  /** A dónde se va al pulsar. Vacío si no lleva a ninguna parte. */
  link?: unknown[];
  /** Solo en los recordatorios: se pueden marcar como hechos desde la lista. */
  reminderId?: string;
  category?: ReminderCategory;
  done?: boolean;
}

/** Los horizontes que ofrece la pantalla. `0` = solo hoy. */
export const EVENT_HORIZONS = [0, 7, 30] as const;
export type EventHorizon = (typeof EVENT_HORIZONS)[number];

/** El que se ofrece al abrir, decidido por Dorel: una semana vista. */
export const DEFAULT_EVENT_HORIZON: EventHorizon = 7;

/**
 * El final del día que está a `days` días de hoy.
 *
 * ⚠️ **Inclusivo, y hasta las 23:59.** «A 7 días» tiene que incluir lo que pasa
 * el séptimo día por la tarde; cortando a la hora actual, una entrega de dentro
 * de una semana a las seis desaparece de la lista por haber mirado a las nueve
 * de la mañana. Y con `0` el límite es el final de hoy, que es lo que significa
 * «hoy» — no «hasta ahora mismo».
 */
export function horizonEnd(days: number, now = new Date()): Date {
  const fin = new Date(now);
  fin.setDate(fin.getDate() + days);
  fin.setHours(23, 59, 59, 999);
  return fin;
}

/**
 * ¿Entra este evento en el horizonte?
 *
 * ⚠️ **Lo vencido entra SIEMPRE, mire el horizonte que mire.** Una ITV que
 * caducó hace tres días no deja de importar por haber elegido «hoy»: es lo más
 * urgente que hay. Filtrar por «entre hoy y dentro de N días» lo escondería
 * justo cuando más falta hace verlo.
 */
export function withinHorizon(event: UpcomingEvent, days: number, now = new Date()): boolean {
  if (event.date < now) return true;
  return event.date <= horizonEnd(days, now);
}

/**
 * La lista final: filtrada, ordenada y sin lo ya hecho salvo que se pida.
 *
 * Orden: por fecha, y a igualdad de fecha lo que lleva aviso primero. Dos cosas
 * a las nueve de la mañana no son igual de urgentes si una es «falta la firma».
 */
export function buildEventList(
  events: UpcomingEvent[],
  options: { horizon: number; showDone?: boolean; now?: Date }
): UpcomingEvent[] {
  const now = options.now || new Date();
  return events
    .filter((e) => (options.showDone ? true : !e.done))
    .filter((e) => withinHorizon(e, options.horizon, now))
    .sort((a, b) => {
      const dif = a.date.getTime() - b.date.getTime();
      if (dif !== 0) return dif;
      return Number(!!b.alert) - Number(!!a.alert);
    });
}

/**
 * Cuántos días quedan, en días naturales.
 *
 * ⚠️ **Se compara a medianoche, no hora contra hora.** Con la resta cruda, algo
 * de mañana a las 8:00 mirado hoy a las 20:00 sale a «0 días» y se lee como
 * «hoy». Lo que la gente cuenta son días de calendario.
 */
export function daysUntil(date: Date, now = new Date()): number {
  const a = new Date(now);
  a.setHours(0, 0, 0, 0);
  const b = new Date(date);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Un recordatorio guardado, convertido en evento de la lista. */
export function reminderToEvent(r: Reminder, date: Date): UpcomingEvent {
  return {
    key: `reminder:${r.id}`,
    source: 'reminder',
    date,
    title: r.title,
    detail: r.notes,
    reminderId: r.id,
    category: r.category,
    done: r.done
  };
}
