import { describe, expect, it } from 'vitest';
import { fleetAvailability } from './vehicle-availability.util';

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
   * ⚠️ En taller se ofrece **y se avisa**: misma regla que la ITV vencida —
   * quien atiende decide, pero no puede no saberlo.
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
