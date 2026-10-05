/**
 * La zona del negocio, y la aritmética para entrar y salir de ella.
 *
 * ⚠️ **Existe porque las Cloud Functions corren en UTC y el negocio está en
 * Madrid**, y eso descuadró una pre-reserva real de punta a punta el 5 de
 * octubre de 2026: el visitante pidió las **10:00**, el correo le dijo
 * **00:00** y el presupuesto en PDF **12:00**. Tres cifras para el mismo
 * instante, y ninguna era la que tecleó.
 *
 * La causa era que `new Date(y, m, d, h, min)` construye la fecha en la zona
 * **del proceso** —UTC en el contenedor—, así que «10:00» entraba como 10:00
 * UTC, o sea las 12:00 de Madrid. Luego el PDF lo pintaba en Madrid (12:00) y
 * el correo con `getHours()`, que vuelve a ser UTC (10:00, y 00:00 para la
 * ventana de disponibilidad). Cada pieza decía la verdad sobre un instante que
 * ya era el equivocado.
 *
 * ⚠️ **Y no vale sumar una hora fija.** Madrid es `+01:00` en invierno y
 * `+02:00` en verano, y el cambio cae justo en el fin de semana que más se
 * alquila. Hay que preguntarle a `Intl` por el desfase **de ese instante**.
 */

/** Una sola constante para toda la aplicación. */
export const ZONA_NEGOCIO = process.env.VELTO_TIME_ZONE || 'Europe/Madrid';

/**
 * El desfase de una zona respecto a UTC, en minutos, **en un instante dado**.
 *
 * Hace falta el instante porque el desfase cambia: Madrid es `+01:00` en
 * invierno y `+02:00` en verano.
 */
export function offsetMinutos(instante: Date, timeZone = ZONA_NEGOCIO): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(instante);
  const nombre = partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nombre);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * El instante UTC que corresponde a una hora de pared en esa zona.
 *
 * O sea: «las 10:00 del 24 de octubre **en Madrid**» → el `Date` correcto.
 *
 * ⚠️ **Se calcula dos veces a propósito.** El desfase depende del instante, y
 * el instante es justo lo que estamos buscando: se parte de tratar la hora
 * como si fuera UTC, se mira qué desfase había ahí y se corrige. En los dos
 * domingos del año en que cambia la hora, la primera respuesta cae al otro
 * lado del cambio, así que se vuelve a preguntar con el resultado. Sin esa
 * segunda vuelta, dos días al año las fechas entran con una hora de más o de
 * menos — y una de esas madrugadas mueve el día entero.
 */
export function instanteEnZona(
  anno: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
  timeZone = ZONA_NEGOCIO
): Date {
  const comoSiFueraUtc = Date.UTC(anno, mes - 1, dia, hora, minuto, 0, 0);
  const primera = new Date(
    comoSiFueraUtc - offsetMinutos(new Date(comoSiFueraUtc), timeZone) * 60000
  );
  return new Date(comoSiFueraUtc - offsetMinutos(primera, timeZone) * 60000);
}

/**
 * `dd/MM/yyyy a las HH:mm` en la zona del negocio.
 *
 * ⚠️ **Nunca con `getDate()` ni `getHours()`.** Esos leen la zona del proceso
 * —UTC—, y es exactamente lo que hacía que el correo al cliente dijera una
 * hora distinta de la del PDF, que sí fija la zona. Si una pieza nueva imprime
 * una fecha para una persona, se imprime desde aquí.
 */
export function fechaHoraEnZona(d: Date, timeZone = ZONA_NEGOCIO): string {
  const p = new Intl.DateTimeFormat('es-ES', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('day')}/${v('month')}/${v('year')} a las ${v('hour')}:${v('minute')}`;
}
