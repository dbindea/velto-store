import { describe, expect, it } from 'vitest';
import {
  blockingMaintenance,
  fleetAvailability,
  maintenanceDueSoon,
  maintenanceOverdue,
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

/**
 * Vencido por fecha O por kilómetros.
 *
 * ⚠️ **El «o» es lo que fallaba, y no daba ningún error.** El panel comparaba
 * solo la fecha y descartaba de entrada todo registro que no la llevara, así que
 * un cambio de aceite con «Km del recordatorio» puesto y la fecha vacía no
 * aparecía en ninguna de las dos tarjetas de mantenimiento: ni en vencidos ni en
 * próximos. La cifra decía «Vencidos · 2 ítems» habiendo cinco.
 */
describe('maintenanceOverdue', () => {
  const HOY = new Date('2026-09-28T12:00:00');

  it('vence por fecha pasada', () => {
    expect(
      maintenanceOverdue({ status: 'scheduled', dueDate: new Date('2026-09-20') }, HOY)
    ).toBe(true);
  });

  it('EL CASO DEL PANEL: vence por kilómetros aunque no lleve fecha', () => {
    expect(
      maintenanceOverdue({ status: 'scheduled', dueDate: null, dueKm: 100000, currentKm: 112000 }, HOY)
    ).toBe(true);
  });

  it('y por kilómetros aunque su fecha sea futura', () => {
    // Es el registro que salía «Vencido» en la ficha del coche y «Próximo a
    // vencer» en el panel: el mismo dato con dos verdades opuestas.
    const m = {
      status: 'scheduled' as const,
      dueDate: new Date('2026-10-18'),
      dueKm: 100000,
      currentKm: 112000
    };
    expect(maintenanceOverdue(m, HOY)).toBe(true);
    expect(maintenanceDueSoon(m, HOY, 30)).toBe(false);
  });

  it('el día justo del umbral ya cuenta', () => {
    expect(
      maintenanceOverdue({ status: 'scheduled', dueDate: null, dueKm: 100000, currentKm: 100000 }, HOY)
    ).toBe(true);
  });

  it('sin kilómetros del coche no se puede decidir por kilómetros', () => {
    expect(
      maintenanceOverdue({ status: 'scheduled', dueDate: null, dueKm: 100000 }, HOY)
    ).toBe(false);
  });

  it.each(['completed', 'cancelled'] as const)('un registro %s no vence', (status) => {
    expect(
      maintenanceOverdue({ status, dueDate: new Date('2020-01-01'), dueKm: 1, currentKm: 999999 }, HOY)
    ).toBe(false);
  });

  it('una fecha ilegible no lo da por vencido', () => {
    expect(maintenanceOverdue({ status: 'scheduled', dueDate: new Date('vacío') }, HOY)).toBe(false);
  });
});

describe('maintenanceDueSoon', () => {
  const HOY = new Date('2026-09-28T12:00:00');

  it('dentro del plazo', () => {
    expect(
      maintenanceDueSoon({ status: 'scheduled', dueDate: new Date('2026-10-18') }, HOY, 30)
    ).toBe(true);
  });

  it('fuera del plazo, no', () => {
    expect(
      maintenanceDueSoon({ status: 'scheduled', dueDate: new Date('2026-12-01') }, HOY, 30)
    ).toBe(false);
  });

  it('lo YA vencido no es «próximo a vencer»', () => {
    expect(
      maintenanceDueSoon({ status: 'scheduled', dueDate: new Date('2026-09-20') }, HOY, 30)
    ).toBe(false);
  });

  it('sin fecha no hay nada que anunciar, aunque venza por kilómetros', () => {
    // Ese entra en la tarjeta de vencidos, que es donde le toca.
    expect(
      maintenanceDueSoon({ status: 'scheduled', dueDate: null, dueKm: 1, currentKm: 9 }, HOY, 30)
    ).toBe(false);
  });
});

/**
 * El día del vencimiento, y la ventana que se comía lo de hoy.
 *
 * ⚠️ Los dos casos salieron de una revisión adversarial del propio arreglo: con
 * la comparación por instantes, un papel válido «hasta el 10» salía vencido el
 * día 10 por la mañana —y Eventos habría prohibido alquilar un coche que el
 * buscador sí ofrece, porque aquel cuenta días—; y al pasar a días, un registro
 * que vence HOY se caía de las dos tarjetas a la vez.
 */
describe('el día del vencimiento', () => {
  const HOY = new Date('2026-09-28T09:00:00');

  it('el día en que vence todavía NO está vencido', () => {
    expect(
      maintenanceOverdue({ status: 'scheduled', dueDate: new Date('2026-09-28T00:00:00') }, HOY)
    ).toBe(false);
  });

  it('el día siguiente sí', () => {
    expect(
      maintenanceOverdue({ status: 'scheduled', dueDate: new Date('2026-09-27T00:00:00') }, HOY)
    ).toBe(true);
  });

  it('y lo que vence hoy entra en «próximos», no se cae de las dos', () => {
    expect(
      maintenanceDueSoon({ status: 'scheduled', dueDate: new Date('2026-09-28T00:00:00') }, HOY, 30)
    ).toBe(true);
  });

  it('caduca el mismo día que para la regla de bloqueo', () => {
    // `blockingMaintenance` ya contaba días: las dos tienen que coincidir, o el
    // aviso y el bloqueo se contradicen durante 24 horas.
    const dueDate = new Date('2026-09-28T00:00:00');
    const bloquea = blockingMaintenance(
      [{ type: 'itv', status: 'scheduled', dueDate }],
      new Date('2026-09-28T23:00:00')
    );
    expect(bloquea).toBeUndefined();
    expect(maintenanceOverdue({ status: 'scheduled', dueDate }, HOY)).toBe(false);
  });
});
