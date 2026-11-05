import { BLOCKING_STATUSES, Reservation } from '@shared/models/reservation.model';

/**
 * Elegir un rango de días sobre el calendario de UN coche, con los días que ya
 * tiene ocupados delante.
 *
 * ⚠️ **Aparte de la pantalla y con tests, por lo mismo que el QR del contrato y
 * el aspa: un calendario mal calculado tiene exactamente la misma pinta que uno
 * bueno.** Y lo que se rompe en silencio aquí es peor que un dibujo feo:
 * ofrecer un día ocupado, o dejar cerrar un rango que salta por encima de una
 * reserva. Las dos cosas acaban en un cliente que se planta a por un coche que
 * no está.
 *
 * ⚠️ **Es un GEMELO de `web/src/lib/calendario-coche.ts`**, duplicado por lo
 * mismo que la aritmética del IVA y la curva de precios: la web es una tercera
 * build con su propio `package.json` y no comparte módulo con la app. Si cambia
 * la regla allí, cambia aquí — y los dos tests afirman los mismos casos.
 *
 * ## La diferencia que SÍ es deliberada: el día de preparación
 *
 * ⚠️ **La web bloquea el día siguiente a una devolución y el backoffice NO**,
 * y está decidido así en `functions/src/public/core.ts` (`disponibleDesde`):
 * aquí hay un operador delante que sabe si el coche está listo —puede haberlo
 * limpiado en media hora— y en la web no hay nadie. Por eso este calendario
 * marca exactamente los días que la reserva ocupa, ni uno más: tiene que decir
 * lo mismo que `searchAvailability()`, que es quien después deja crear la
 * reserva. Un calendario más estricto que el buscador pintaría de rojo días que
 * el asistente acepta, y entonces no se usaría.
 */

/** `yyyy-MM-dd` en hora LOCAL. Nunca `toISOString()`, que pasa a UTC. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface DateRange {
  desde: Date | null;
  hasta: Date | null;
}

export const EMPTY_RANGE: DateRange = { desde: null, hasta: null };

/**
 * Lee una fecha guardada, y devuelve `null` si no se puede.
 *
 * ⚠️ **NO se usa `toDate()` de `reservation-date.util`, y la diferencia decide
 * qué días se pintan de rojo.** Aquel, ante un valor ilegible, **cae a HOY**
 * —hace bien: lo escribieron para que el pipe `date` de una pantalla no tumbe
 * la vista entera—. Aquí eso marcaría el día de hoy como ocupado por una
 * reserva cuyas fechas nadie puede leer: un día bloqueado al azar, sin nada que
 * lo explique. Es la misma razón por la que `public/core.ts` tiene su propio
 * `toDate()` que devuelve `null`.
 */
function fechaEstricta(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  const seconds = value?.seconds ?? value?._seconds;
  if (typeof seconds === 'number') {
    const d = new Date(seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Los días que este coche tiene ocupados, como claves `yyyy-MM-dd`.
 *
 * ⚠️ **Quién bloquea lo dice `BLOCKING_STATUSES`, que es la única autoridad**
 * —`reserved`, `confirmed` y `delivered`—, la misma que usa
 * `checkVehicleAvailability()` antes de guardar. Copiar aquí la lista de
 * estados haría que el calendario y el guardado discreparan el día que cambie.
 *
 * ⚠️ **Y se marcan las dos puntas.** Un alquiler del 18 al 19 se cobra como UN
 * día pero ocupa DOS casillas: el coche sale el 18 y no vuelve hasta el 19.
 *
 * ⚠️ **Una reserva con fechas ilegibles se SALTA, y eso es una decisión.** No
 * se puede saber qué días ocupa, así que marcarla sería pintar de rojo un día
 * inventado. Aquí se puede: el calendario propone y quien decide de verdad es
 * `searchAvailability()`, que vuelve a cruzar las reservas antes de dejar
 * crear nada — en la web pública, sin nadie delante, la regla es la contraria
 * («ante la duda no publicar»). `excluirId` deja fuera la reserva que se está
 * editando, para que no se bloquee a sí misma.
 */
export function occupiedDays(reservations: Reservation[], excluirId?: string): Set<string> {
  const ocupados = new Set<string>();

  for (const r of reservations || []) {
    if (excluirId && r.id === excluirId) continue;
    if (!BLOCKING_STATUSES.includes(r.reservationStatus)) continue;

    const desde = fechaEstricta(r.pickupDateTime);
    const hasta = fechaEstricta(r.returnDateTime);
    if (!desde || !hasta) continue;

    const a = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
    const b = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
    if (b < a) continue;

    // Tope de seguridad: una reserva con una fecha disparatada no puede dejar
    // el bucle dando vueltas con el navegador colgado.
    for (let i = 0, d = new Date(a); d <= b && i < 1000; d.setDate(d.getDate() + 1), i++) {
      ocupados.add(dayKey(d));
    }
  }

  return ocupados;
}

/**
 * ¿Hay algún día ocupado entre estos dos, **ambos incluidos**?
 *
 * Recorre de extremo a extremo a propósito: un rango de una sola casilla tiene
 * que mirar ese día, y contar «días de alquiler» devolvería cero.
 */
export function hasOccupiedBetween(desde: Date, hasta: Date, ocupados: Set<string>): boolean {
  const a = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const b = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  for (let i = 0, d = new Date(a); d <= b && i < 1000; d.setDate(d.getDate() + 1), i++) {
    if (ocupados.has(dayKey(d))) return true;
  }
  return false;
}

/**
 * Qué pasa al pulsar un día. Cuatro situaciones, cada una con su motivo:
 *
 * 1. **Nada elegido** → empieza el rango.
 * 2. **Hay recogida y se pulsa un día posterior sin ocupados en medio** → se
 *    cierra el rango.
 * 3. **Se pulsa un día ANTERIOR a la recogida** → se empieza de nuevo ahí, que
 *    es lo que la gente espera: corregir la primera fecha, no que no pase nada.
 * 4. ⚠️ **Se pulsa un día posterior con una reserva en medio** → se empieza de
 *    nuevo ahí. **No se cierra el rango saltándose la reserva**, que es el
 *    fallo que este módulo existe para impedir: la selección se vería perfecta
 *    y el coche está alquilado en medio.
 *
 * ⚠️ **Y un rango ya cerrado vuelve a empezar.** Con los dos extremos puestos,
 * el siguiente clic es «quiero otras fechas»; extenderlo obligaría a adivinar
 * por cuál de los dos lados.
 */
export function pickDay(rango: DateRange, dia: Date, ocupados: Set<string>): DateRange {
  if (ocupados.has(dayKey(dia))) return rango;

  const empezar: DateRange = { desde: dia, hasta: null };
  if (!rango.desde || rango.hasta) return empezar;
  if (dia < rango.desde) return empezar;
  /*
   * ⚠️ **El mismo día dos veces NO cierra el rango.** Serían cero días: un
   * alquiler que empieza y acaba a la misma hora. El más corto posible son dos
   * casillas —recojo el 18, devuelvo el 19—, porque lo que se cobra son bloques
   * de 24 horas.
   */
  if (dayKey(dia) === dayKey(rango.desde)) return rango;
  if (hasOccupiedBetween(rango.desde, dia, ocupados)) return empezar;
  return { desde: rango.desde, hasta: dia };
}

export type DayState = 'libre' | 'ocupado' | 'pasado';

/**
 * En qué estado está un día.
 *
 * ⚠️ **Aquí no hay «fuera de horizonte», al revés que en la web.** Aquella mira
 * 180 días porque el backend público solo comprueba eso; el backoffice lee las
 * reservas del coche enteras, así que un día lejano sin reserva está libre de
 * verdad y no «sin comprobar».
 */
export function dayState(dia: Date, ocupados: Set<string>, hoy: Date): DayState {
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (dia < inicioHoy) return 'pasado';
  return ocupados.has(dayKey(dia)) ? 'ocupado' : 'libre';
}

/** Dónde cae un día respecto al rango elegido, para pintarlo. */
export type RangePosition = 'fuera' | 'inicio' | 'medio' | 'fin' | 'unico';

export function rangePosition(dia: Date, rango: DateRange): RangePosition {
  if (!rango.desde) return 'fuera';
  const iso = dayKey(dia);
  const desde = dayKey(rango.desde);
  const hasta = rango.hasta ? dayKey(rango.hasta) : desde;
  if (iso < desde || iso > hasta) return 'fuera';
  if (desde === hasta) return 'unico';
  if (iso === desde) return 'inicio';
  if (iso === hasta) return 'fin';
  return 'medio';
}

/**
 * Las horas con las que se sale del calendario hacia los campos del asistente.
 *
 * ⚠️ **El calendario elige DÍAS, así que la hora la pone esto y el operador la
 * corrige.** Dejarla en 00:00 mandaría una recogida de madrugada al campo —el
 * mismo fallo que ya se corrigió en las solicitudes de la web, donde la ventana
 * ensanchada a días completos llegaba al asistente como las 00:00 y las 23:59.
 *
 * Las 10:00 y las 10:00: es la hora de apertura y la que usa el calendario de
 * la web pública, para que las dos pantallas propongan lo mismo.
 */
export const PICKUP_HOUR = 10;
export const RETURN_HOUR = 10;

/** `yyyy-MM-ddTHH:mm`, que es justo lo que lee un `datetime-local`. */
export function asDateTimeInput(dia: Date, hora: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dia.getFullYear()}-${p(dia.getMonth() + 1)}-${p(dia.getDate())}T${p(hora)}:00`;
}

/**
 * Los días de alquiler de una selección: **del 1 al 4 son TRES**.
 *
 * Son bloques de 24 horas, no casillas pintadas: recoger el 1 a las 10:00 y
 * devolver el 4 a las 10:00 son 72 horas. Es lo que cobra `calculateCalendarDays()`
 * y lo que tiene que decir la pantalla mientras se elige, o el operador lee un
 * número aquí y otro en el resumen.
 */
export function rentalDays(rango: DateRange): number {
  if (!rango.desde || !rango.hasta) return 0;
  const a = new Date(rango.desde.getFullYear(), rango.desde.getMonth(), rango.desde.getDate()).getTime();
  const b = new Date(rango.hasta.getFullYear(), rango.hasta.getMonth(), rango.hasta.getDate()).getTime();
  if (b <= a) return 0;
  return Math.round((b - a) / 86_400_000);
}
