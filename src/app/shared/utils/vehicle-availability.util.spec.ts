import { describe, expect, it } from 'vitest';
import {
  blockingMaintenance,
  fleetAvailability,
  statusAfterReturn,
  type MaintenanceDue
} from './vehicle-availability.util';

// ---------------------------------------------------------------------------
// El estado del coche y la disponibilidad
//
// El fallo que estos tests fijan salió en producción: un coche alquilado hasta
// el 26 se ofrecía como «El vehículo no está disponible en la flota» al pedirlo
// para el 1 de octubre. La disponibilidad es una pregunta sobre un rango de
// fechas; el estado es un hecho de hoy.
// ---------------------------------------------------------------------------

describe('fleetAvailability', () => {
  /** El caso que lo motivó, y el que no puede volver a romperse. */
  it('un coche ALQUILADO ahora se puede reservar para otras fechas', () => {
    expect(fleetAvailability('rented').blocks).toBe(false);
  });

  it('y no lleva aviso: con la flota ocupada, todos lo llevarían y nadie lo leería', () => {
    expect(fleetAvailability('rented').warning).toBeUndefined();
  });

  it('un coche disponible no dice nada', () => {
    expect(fleetAvailability('available')).toEqual({ blocks: false });
  });

  /**
   * ⚠️ En taller se ofrece **y se avisa**: el estado dice dónde está el coche
   * hoy, no si podrá salir el mes que viene. Lo que sí impide alquilarlo es un
   * papel caducado, y eso lo contesta `blockingMaintenance()`.
   */
  it('en mantenimiento se ofrece con aviso, no se esconde', () => {
    const r = fleetAvailability('maintenance');
    expect(r.blocks).toBe(false);
    expect(r.warning).toBe('reservations.availability.inMaintenance');
  });

  /** Esto no es «ocupado ahora», es «este coche no se alquila». */
  it('fuera de servicio sí bloquea', () => {
    expect(fleetAvailability('out_of_service').blocks).toBe(true);
  });

  /**
   * ⚠️ Un coche sin estado guardado no puede desaparecer del buscador: sería
   * flota invisible, y el operador no tendría forma de saber por qué falta.
   */
  it('sin estado no bloquea', () => {
    expect(fleetAvailability(undefined).blocks).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// La ITV y el seguro contra las fechas del alquiler
//
// El caso que lo pidió, con las palabras de Dorel: «Si para un coche pongo
// fecha caducidad itv 10 de octubre… que yo no pueda alquilar el coche pasada
// esta fecha hasta no hacer la itv, que salga el mensaje claro de itv, o seguro
// o cualquier cosa que lo detenga».
// ---------------------------------------------------------------------------

/** Una ITV pendiente que caduca el día que se diga. */
function itv(dia: string, status: MaintenanceDue['status'] = 'scheduled'): MaintenanceDue {
  return { type: 'itv', status, dueDate: new Date(dia) };
}

describe('blockingMaintenance', () => {
  it('con la ITV hasta el 10, un alquiler del 1 al 5 se deja', () => {
    const r = blockingMaintenance([itv('2026-10-10')], new Date('2026-10-05T12:00:00'));
    expect(r).toBeUndefined();
  });

  /** El caso literal del encargo. */
  it('con la ITV hasta el 10, un alquiler del 8 al 12 se BLOQUEA', () => {
    const r = blockingMaintenance([itv('2026-10-10')], new Date('2026-10-12T12:00:00'));
    expect(r?.type).toBe('itv');
    expect(r?.message).toBe('reservations.availability.itvExpired');
  });

  /**
   * ⚠️ El día del vencimiento todavía vale. Comparando instantes —la fecha se
   * guarda a medianoche y la devolución tiene hora— este caso saldría bloqueado
   * por diez horas.
   */
  it('devolver el mismo día del vencimiento no bloquea', () => {
    const r = blockingMaintenance([itv('2026-10-10')], new Date('2026-10-10T10:00:00'));
    expect(r).toBeUndefined();
  });

  it('una ITV ya caducada bloquea cualquier alquiler futuro', () => {
    const r = blockingMaintenance([itv('2026-09-01', 'overdue')], new Date('2027-01-01T12:00:00'));
    expect(r?.type).toBe('itv');
  });

  it('el seguro bloquea igual, y lo dice con su propio mensaje', () => {
    const r = blockingMaintenance(
      [{ type: 'insurance', status: 'pending', dueDate: new Date('2026-10-01') }],
      new Date('2026-10-20T12:00:00')
    );
    expect(r?.message).toBe('reservations.availability.insuranceExpired');
  });

  /**
   * ⚠️ La distinción que sostiene todo esto: sin ITV el coche no puede estar en
   * la calle; con el aceite pasado, sí. Ese sigue avisando y no bloquea.
   */
  it('un cambio de aceite vencido NO bloquea', () => {
    const r = blockingMaintenance(
      [{ type: 'oil_change', status: 'overdue', dueDate: new Date('2026-01-01') }],
      new Date('2026-10-20T12:00:00')
    );
    expect(r).toBeUndefined();
  });

  it('una ITV ya pasada no bloquea nada', () => {
    const r = blockingMaintenance([itv('2026-09-01', 'completed')], new Date('2026-10-20T12:00:00'));
    expect(r).toBeUndefined();
  });

  it('una anulada tampoco', () => {
    const r = blockingMaintenance([itv('2026-09-01', 'cancelled')], new Date('2026-10-20T12:00:00'));
    expect(r).toBeUndefined();
  });

  /** Sin fecha no hay vencimiento: es una tarea apuntada, no un papel caducado. */
  it('un registro sin fecha no bloquea', () => {
    const r = blockingMaintenance(
      [{ type: 'itv', status: 'pending', dueDate: null }],
      new Date('2026-10-20T12:00:00')
    );
    expect(r).toBeUndefined();
  });

  /** Manda el que caduca antes: es el que hay que resolver primero. */
  it('con dos papeles caducados gana el más antiguo', () => {
    const r = blockingMaintenance(
      [
        itv('2026-10-05'),
        { type: 'insurance', status: 'pending', dueDate: new Date('2026-09-20') }
      ],
      new Date('2026-10-20T12:00:00')
    );
    expect(r?.type).toBe('insurance');
  });
});

describe('statusAfterReturn', () => {
  it('un coche alquilado vuelve a estar disponible', () => {
    expect(statusAfterReturn('rented')).toBe('available');
  });

  /**
   * ⚠️ Lo que alguien apartó a propósito no vuelve solo. Un coche que se rompe
   * durante el alquiler se marca fuera de servicio, y terminar el parte de
   * devolución no puede devolverlo a la flota sin que nadie lo decida.
   */
  it('fuera de servicio se queda fuera de servicio', () => {
    expect(statusAfterReturn('out_of_service')).toBe('out_of_service');
  });

  it('y en taller se queda en taller', () => {
    expect(statusAfterReturn('maintenance')).toBe('maintenance');
  });

  it('sin estado guardado, disponible', () => {
    expect(statusAfterReturn(undefined)).toBe('available');
  });
});
