/**
 * Date utilities for reservation calculations.
 * 
 * Calendar days calculation:
 * - Any pickup and return within 24 hours = 1 day
 * - Any excess hour beyond 24h rounds up to next day
 * - Minimum is 1 day if return > pickup
 */


/**
 * Calculate calendar days between two datetimes.
 * 
 * Rules:
 * - If return <= pickup, returns 0 (invalid)
 * - Counts full 24h blocks
 * - Any remaining time >= 1 hour rounds up to next day
 * 
 * @example
 * - 10 June 12:00 → 11 June 12:00 = 1 day
 * - 10 June 12:00 → 11 June 13:00 = 2 days
 * - 10 June 12:00 → 10 June 18:00 = 1 day
 * - 10 June 12:00 → 17 June 12:00 = 7 days
 */
export function calculateCalendarDays(pickupDateTime: Date, returnDateTime: Date): number {
  if (returnDateTime <= pickupDateTime) {
    return 0;
  }

  const diffMs = returnDateTime.getTime() - pickupDateTime.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  // Calculate full 24h blocks
  const fullDays = Math.floor(diffHours / 24);
  
  // Check remaining hours - round up if >= 1 hour
  const remainingHours = diffHours % 24;
  const extraDays = remainingHours >= 1 ? 1 : 0;
  
  return fullDays + extraDays;
}

/**
 * Convert a date to Firestore Timestamp.
 */
export function toTimestamp(date: Date): any {
  return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 };
}

/**
 * Convert Firestore Timestamp or Date to Date.
 */
export function toDate(timestampOrDate: any): Date {
  if (!timestampOrDate) return new Date();

  if (timestampOrDate instanceof Date) {
    return timestampOrDate;
  }

  if (typeof timestampOrDate?.toDate === 'function') {
    return timestampOrDate.toDate();
  }

  // Firestore Timestamps arrive as `seconds` from the web SDK and `_seconds`
  // from documents written through the admin SDK.
  const seconds = timestampOrDate?.seconds ?? timestampOrDate?._seconds;
  if (typeof seconds === 'number') {
    return new Date(seconds * 1000);
  }

  // Last resort. `new Date({})` yields an Invalid Date, which the Angular date
  // pipe rejects with a runtime error that blanks the whole view — some stored
  // contracts have `createdAt` as an empty map, so this really happens.
  // Falling back to the current date keeps the view alive; callers that care
  // about a missing value should check for it before calling.
  const parsed = new Date(timestampOrDate);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Check if two date ranges overlap.
 * Used for availability checking.
 */
export function dateRangesOverlap(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): boolean {
  return start1 < end2 && end1 > start2;
}

/**
 * Get default pickup datetime (today at noon).
 */
export function getDefaultPickupDateTime(): Date {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return now;
}

/**
 * Get default return datetime (tomorrow at noon).
 */
export function getDefaultReturnDateTime(): Date {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);
  return tomorrow;
}

/**
 * Format date for display.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/**
 * Format time for display.
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format datetime for display.
 */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/**
 * Get date part as YYYY-MM-DD string (for date inputs).
 */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get time part as HH:MM string (for time inputs).
 */
export function toTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Combine date and time strings into a Date object.
 */
export function combineDateAndTime(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

/**
 * Una fecha con su hora → el valor que espera un `input[type=datetime-local]`,
 * que es `yyyy-MM-ddTHH:mm`.
 *
 * ⚠️ **Nada de `toISOString()`, y no es un detalle.** Aquel pasa a UTC, así que
 * una recogida a las 00:30 de Madrid saldría escrita como las 22:30 del día
 * anterior y el operador vería otra hora en el campo. El navegador interpreta
 * el valor de un `datetime-local` en **hora local**, así que hay que
 * componerlo en local.
 *
 * Vivía copiada dentro de `reservation-edit.component.ts`; desde que el
 * asistente usa el mismo tipo de campo, la aritmética es una sola.
 */
export function toDateTimeInput(date: Date): string {
  return `${toDateString(date)}T${toTimeString(date)}`;
}

/**
 * Lo contrario: lo que devuelve un `input[type=datetime-local]` → `Date`.
 *
 * ⚠️ **`new Date('2026-09-24T12:00')` ya lo interpreta en hora local** —es la
 * forma sin zona— así que no hace falta trocear la cadena. Se hace igualmente
 * a mano para que no dependa de esa sutileza del estándar, que es justo la que
 * cambia entre `'2026-09-24'` (UTC) y `'2026-09-24T12:00'` (local) y ya costó
 * un disgusto con las fechas del mantenimiento.
 *
 * Devuelve una fecha inválida si la cadena está vacía o a medias, que es lo que
 * pasa mientras el operador teclea: quien llama decide qué hacer con eso.
 */
export function parseDateTimeInput(value: string): Date {
  const [fecha, hora] = (value || '').split('T');
  if (!fecha || !hora) return new Date(NaN);
  return combineDateAndTime(fecha, hora);
}