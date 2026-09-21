/**
 * Qué dice el ESTADO de un coche sobre si se puede alquilar en unas fechas.
 *
 * ⚠️ **La disponibilidad es una pregunta sobre un RANGO DE FECHAS, y el estado
 * es un hecho de hoy.** Confundirlos costó un fallo concreto en producción el 21
 * de septiembre de 2026: un coche alquilado hasta el 26 se ofrecía como «El
 * vehículo no está disponible en la flota» al pedirlo para el 1 de octubre, con
 * las fechas sin solaparse por cinco días. Quien contesta de verdad es el cruce
 * con las reservas que bloquean; esto solo aparta lo que no se alquila nunca.
 *
 * ⚠️ **Y se notaba poco porque el estado solo se cambia A MANO**, desde la ficha
 * del coche: nada en el flujo de alquiler lo mueve. Un coche marcado «En
 * alquiler» se quedaba así hasta que alguien se acordara de devolverlo a
 * «Disponible» — y mientras tanto no se podía reservar para ninguna fecha.
 *
 * ⚠️ **Existe como función propia porque las dos autoridades discrepaban.**
 * `searchAvailability()` miraba el estado y `checkVehicleAvailability()` —el que
 * de verdad guarda la creación— no lo miraba nunca: el asistente escondía un
 * coche que el servicio habría dejado reservar. Con la regla en un solo sitio y
 * con nombre, el siguiente que necesite preguntarlo no escribe su propia
 * versión.
 */

import { VehicleStatus } from '@shared/models/vehicle.model';

export interface FleetAvailability {
  /** Verdadero solo si el coche no se puede alquilar en ninguna fecha. */
  blocks: boolean;
  /**
   * Clave i18n de un aviso que **no impide** reservar.
   *
   * Misma idea que la ITV vencida: quien está en el mostrador con el cliente
   * delante tiene que poder decidir, y lo que no puede es **no saberlo**.
   */
  warning?: string;
}

/**
 * Lo que el estado del coche permite.
 *
 * - `available` — nada que decir.
 * - `rented` — está fuera **ahora**, no en las fechas que se piden. Lo decide el
 *   cruce de fechas; aquí no se bloquea ni se avisa, o toda la flota ocupada
 *   saldría con un aviso que nadie leería.
 * - `maintenance` — se ofrece, pero diciéndolo: puede seguir en el taller.
 * - `out_of_service` — eso no es «ocupado ahora», es «este coche no se alquila».
 */
export function fleetAvailability(status: VehicleStatus | undefined): FleetAvailability {
  if (status === 'out_of_service') {
    return { blocks: true, warning: undefined };
  }
  if (status === 'maintenance') {
    return { blocks: false, warning: 'reservations.availability.inMaintenance' };
  }
  return { blocks: false };
}
