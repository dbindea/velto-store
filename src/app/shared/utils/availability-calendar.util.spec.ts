import { describe, expect, it } from 'vitest';
import { Reservation } from '@shared/models/reservation.model';
import {
  EMPTY_RANGE,
  asDateTimeInput,
  dayKey,
  dayState,
  hasOccupiedBetween,
  occupiedDays,
  pickDay,
  rangePosition,
  rentalDays
} from './availability-calendar.util';

const d = (iso: string) => {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
};

const reserva = (
  desde: string,
  hasta: string,
  reservationStatus: Reservation['reservationStatus'] = 'confirmed',
  id = 'r1'
): Reservation =>
  ({
    id,
    reservationStatus,
    pickupDateTime: { seconds: d(desde).getTime() / 1000 },
    returnDateTime: { seconds: d(hasta).getTime() / 1000 }
  }) as unknown as Reservation;

describe('dayKey — la clave del día', () => {
  /**
   * ⚠️ El fallo clásico de todo calendario: `toISOString()` pasa a UTC, así que
   * en cualquier huso al oeste de Greenwich el día se corre uno.
   */
  it('es la fecha LOCAL, no la UTC', () => {
    // 1 de enero a las 00:30 en hora local: en UTC sería el 31 de diciembre.
    expect(dayKey(new Date(2027, 0, 1, 0, 30))).toBe('2027-01-01');
    expect(dayKey(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
  });
});

describe('qué días ocupa una reserva', () => {
  it('marca las DOS puntas: el coche sale un día y vuelve otro', () => {
    // Un alquiler del 18 al 19 se cobra como UN día y ocupa DOS casillas.
    const ocupados = occupiedDays([reserva('2026-11-18', '2026-11-19')]);
    expect([...ocupados].sort()).toEqual(['2026-11-18', '2026-11-19']);
  });

  it('marca todos los días de en medio', () => {
    const ocupados = occupiedDays([reserva('2026-11-01', '2026-11-04')]);
    expect([...ocupados].sort()).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04'
    ]);
  });

  /**
   * ⚠️ Lo decide `BLOCKING_STATUSES`, que es la misma lista que usa
   * `checkVehicleAvailability()` antes de guardar: el calendario no puede ser
   * más estricto que el buscador ni al revés.
   */
  it('solo bloquean reserved, confirmed y delivered', () => {
    expect(occupiedDays([reserva('2026-11-01', '2026-11-02', 'reserved')]).size).toBe(2);
    expect(occupiedDays([reserva('2026-11-01', '2026-11-02', 'confirmed')]).size).toBe(2);
    expect(occupiedDays([reserva('2026-11-01', '2026-11-02', 'delivered')]).size).toBe(2);
    // Y estos NO: el coche ya volvió, o nunca salió.
    expect(occupiedDays([reserva('2026-11-01', '2026-11-02', 'returned')]).size).toBe(0);
    expect(occupiedDays([reserva('2026-11-01', '2026-11-02', 'closed')]).size).toBe(0);
    expect(occupiedDays([reserva('2026-11-01', '2026-11-02', 'cancelled')]).size).toBe(0);
  });

  /**
   * ⚠️ **NO se aplica el día de preparación**, al revés que la web pública, y
   * es deliberado (`disponibleDesde` en `functions/src/public/core.ts`): aquí
   * hay un operador que sabe si el coche está listo. Un calendario más estricto
   * que el buscador pintaría de rojo días que el asistente acepta.
   */
  it('el día siguiente a una devolución queda LIBRE', () => {
    const ocupados = occupiedDays([reserva('2026-11-01', '2026-11-04')]);
    expect(ocupados.has('2026-11-05')).toBe(false);
  });

  it('la reserva que se está editando no se bloquea a sí misma', () => {
    const r = [reserva('2026-11-01', '2026-11-04', 'confirmed', 'la-mia')];
    expect(occupiedDays(r).size).toBe(4);
    expect(occupiedDays(r, 'la-mia').size).toBe(0);
  });

  it('una reserva ilegible o invertida no cuelga el navegador', () => {
    expect(occupiedDays([{ reservationStatus: 'confirmed' } as Reservation]).size).toBe(0);
    expect(occupiedDays([reserva('2026-11-10', '2026-11-01')]).size).toBe(0);
    expect(occupiedDays([]).size).toBe(0);
    expect(occupiedDays(undefined as unknown as Reservation[]).size).toBe(0);
  });
});

describe('elegir un rango', () => {
  const libre = new Set<string>();
  const conReserva = new Set(['2026-11-10', '2026-11-11']);

  it('el primer clic empieza el rango', () => {
    expect(pickDay(EMPTY_RANGE, d('2026-11-05'), libre)).toEqual({
      desde: d('2026-11-05'),
      hasta: null
    });
  });

  it('el segundo clic en un día posterior lo cierra', () => {
    const r = pickDay({ desde: d('2026-11-05'), hasta: null }, d('2026-11-08'), libre);
    expect(r.desde).toEqual(d('2026-11-05'));
    expect(r.hasta).toEqual(d('2026-11-08'));
  });

  it('un día ocupado no hace nada', () => {
    const r = { desde: d('2026-11-05'), hasta: null };
    expect(pickDay(r, d('2026-11-10'), conReserva)).toBe(r);
  });

  /**
   * ⚠️ **El caso que este módulo existe para impedir.** Sin esto, la selección
   * se vería perfecta y el coche está alquilado en medio.
   */
  it('NO cierra un rango que salta por encima de una reserva: empieza de nuevo', () => {
    const r = pickDay({ desde: d('2026-11-08'), hasta: null }, d('2026-11-14'), conReserva);
    expect(r).toEqual({ desde: d('2026-11-14'), hasta: null });
  });

  it('pulsar antes de la recogida empieza de nuevo ahí', () => {
    const r = pickDay({ desde: d('2026-11-08'), hasta: null }, d('2026-11-03'), libre);
    expect(r).toEqual({ desde: d('2026-11-03'), hasta: null });
  });

  it('el mismo día dos veces no cierra nada: serían cero días', () => {
    const r = { desde: d('2026-11-05'), hasta: null };
    expect(pickDay(r, d('2026-11-05'), libre)).toBe(r);
  });

  it('con el rango cerrado, el siguiente clic empieza otro', () => {
    const cerrado = { desde: d('2026-11-05'), hasta: d('2026-11-08') };
    expect(pickDay(cerrado, d('2026-11-20'), libre)).toEqual({
      desde: d('2026-11-20'),
      hasta: null
    });
  });
});

describe('hasOccupiedBetween', () => {
  it('mira los dos extremos, no solo el medio', () => {
    const ocupados = new Set(['2026-11-05']);
    expect(hasOccupiedBetween(d('2026-11-05'), d('2026-11-05'), ocupados)).toBe(true);
    expect(hasOccupiedBetween(d('2026-11-05'), d('2026-11-09'), ocupados)).toBe(true);
    expect(hasOccupiedBetween(d('2026-11-01'), d('2026-11-05'), ocupados)).toBe(true);
    expect(hasOccupiedBetween(d('2026-11-06'), d('2026-11-09'), ocupados)).toBe(false);
  });
});

describe('cómo se pinta cada día', () => {
  const hoy = new Date(2026, 10, 5);

  it('distingue pasado, ocupado y libre', () => {
    const ocupados = new Set(['2026-11-10']);
    expect(dayState(d('2026-11-04'), ocupados, hoy)).toBe('pasado');
    expect(dayState(d('2026-11-05'), ocupados, hoy)).toBe('libre');
    expect(dayState(d('2026-11-10'), ocupados, hoy)).toBe('ocupado');
  });

  it('hoy NO es pasado', () => {
    expect(dayState(d('2026-11-05'), new Set(), new Date(2026, 10, 5, 23, 0))).toBe('libre');
  });

  it('coloca cada día dentro del rango', () => {
    const r = { desde: d('2026-11-05'), hasta: d('2026-11-08') };
    expect(rangePosition(d('2026-11-04'), r)).toBe('fuera');
    expect(rangePosition(d('2026-11-05'), r)).toBe('inicio');
    expect(rangePosition(d('2026-11-06'), r)).toBe('medio');
    expect(rangePosition(d('2026-11-08'), r)).toBe('fin');
    expect(rangePosition(d('2026-11-09'), r)).toBe('fuera');
    // A medio elegir, el único día puesto se pinta como «único».
    expect(rangePosition(d('2026-11-05'), { desde: d('2026-11-05'), hasta: null })).toBe('unico');
    expect(rangePosition(d('2026-11-05'), EMPTY_RANGE)).toBe('fuera');
  });
});

describe('lo que sale hacia el asistente', () => {
  /**
   * ⚠️ El formato tiene que ser EXACTAMENTE el de un `datetime-local`, que es
   * lo que leen los campos del asistente. Y con hora: 00:00 mandaría una
   * recogida de madrugada, el mismo fallo que ya tuvieron las solicitudes web.
   */
  it('es `yyyy-MM-ddTHH:mm`, con la hora de apertura', () => {
    expect(asDateTimeInput(d('2026-11-05'), 10)).toBe('2026-11-05T10:00');
    expect(asDateTimeInput(d('2026-01-09'), 9)).toBe('2026-01-09T09:00');
  });

  it('ordena igual alfabéticamente que cronológicamente', () => {
    // Es lo que permite al asistente comparar las dos cadenas para el guard de
    // «la devolución no puede ir antes».
    expect(asDateTimeInput(d('2026-11-05'), 10) < asDateTimeInput(d('2026-11-06'), 10)).toBe(true);
  });

  /** Del 1 al 4 son TRES días: bloques de 24 horas, no casillas pintadas. */
  it('cuenta los días como los cobra el asistente', () => {
    expect(rentalDays({ desde: d('2026-11-01'), hasta: d('2026-11-04') })).toBe(3);
    expect(rentalDays({ desde: d('2026-11-18'), hasta: d('2026-11-19') })).toBe(1);
    expect(rentalDays({ desde: d('2026-11-05'), hasta: d('2026-11-05') })).toBe(0);
    expect(rentalDays(EMPTY_RANGE)).toBe(0);
    expect(rentalDays({ desde: d('2026-11-05'), hasta: null })).toBe(0);
  });
});
