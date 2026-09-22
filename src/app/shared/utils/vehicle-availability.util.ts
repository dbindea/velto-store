/**
 * Qué dice del alquiler lo que le pasa al COCHE: su estado y sus papeles.
 *
 * Dos preguntas distintas y las dos viven aquí porque se contestan en el mismo
 * sitio —el buscador de disponibilidad y el servicio que crea la reserva—:
 * `fleetAvailability()` mira el estado y `blockingMaintenance()` mira la ITV y
 * el seguro contra las fechas que se piden.
 *
 * ⚠️ **La disponibilidad es una pregunta sobre un RANGO DE FECHAS, y el estado
 * es un hecho de hoy.** Confundirlos costó un fallo concreto en producción el 21
 * de septiembre de 2026: un coche alquilado hasta el 26 se ofrecía como «El
 * vehículo no está disponible en la flota» al pedirlo para el 1 de octubre, con
 * las fechas sin solaparse por cinco días. Quien contesta de verdad es el cruce
 * con las reservas que bloquean; esto solo aparta lo que no se alquila nunca.
 *
 * ⚠️ **El estado SÍ se mueve solo, y por eso el fallo se veía tanto.** Lo pone
 * `rented` el parte de entrega y lo devuelve el de devolución
 * (`inspection.service.ts`), además de la ficha del coche. Es decir: durante
 * todo un alquiler el coche está en `rented`, y mientras el estado decidiera la
 * disponibilidad no se le podía reservar ninguna fecha futura — que es
 * exactamente lo que pasó.
 *
 * ⚠️ **Existe como función propia porque las dos autoridades discrepaban.**
 * `searchAvailability()` miraba el estado y `checkVehicleAvailability()` —el que
 * de verdad guarda la creación— no lo miraba nunca: el asistente escondía un
 * coche que el servicio habría dejado reservar. Con la regla en un solo sitio y
 * con nombre, el siguiente que necesite preguntarlo no escribe su propia
 * versión.
 */

import { VehicleStatus } from '@shared/models/vehicle.model';
import { MaintenanceStatus, MaintenanceType } from '@shared/models/vehicle-maintenance.model';

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

// ---------------------------------------------------------------------------
// Los papeles del coche: ITV y seguro
// ---------------------------------------------------------------------------

/**
 * Los mantenimientos que **impiden circular**, no los que convendría hacer.
 *
 * ⚠️ **La distinción es de negocio y hay que mantenerla.** Sin ITV en vigor el
 * coche no puede estar en la vía pública, y sin seguro tampoco: entregarlo es
 * una infracción del arrendador y un siniestro sin cobertura. Un cambio de
 * aceite vencido es otra cosa —conviene hacerlo, y el coche circula—, así que
 * **avisa y no bloquea**, como hasta ahora.
 *
 * Si algún día hay que bloquear por otro concepto, se añade aquí y se le pone
 * su mensaje en `BLOCKING_MESSAGES`: el compilador obliga a escribir los dos.
 */
export const BLOCKING_MAINTENANCE_TYPES = ['itv', 'insurance'] as const;

export type BlockingMaintenanceType = (typeof BLOCKING_MAINTENANCE_TYPES)[number];

/**
 * Qué se le dice al operador, **nombrando el papel que falta**.
 *
 * ⚠️ Una clave por tipo, y no una genérica con el concepto interpolado. «No se
 * puede alquilar: mantenimiento pendiente» no dice qué hay que hacer, y lo que
 * Dorel pidió es exactamente eso: *«que salga el mensaje claro de itv, o seguro
 * o cualquier cosa que lo detenga»*.
 */
const BLOCKING_MESSAGES: Record<BlockingMaintenanceType, string> = {
  itv: 'reservations.availability.itvExpired',
  insurance: 'reservations.availability.insuranceExpired'
};

/** Un mantenimiento sigue pendiente mientras no se haya hecho ni anulado. */
const OPEN_STATUSES: MaintenanceStatus[] = ['pending', 'scheduled', 'overdue'];

/** Lo único que hace falta de un `VehicleMaintenance` para decidir. */
export interface MaintenanceDue {
  type: MaintenanceType;
  status: MaintenanceStatus;
  /** `nextDueDate` ya convertida. `null` si el registro no lleva fecha. */
  dueDate: Date | null;
}

export interface MaintenanceBlock {
  type: BlockingMaintenanceType;
  /** El día en que caduca, para poder enseñarlo al lado del motivo. */
  dueDate: Date;
  /** Clave i18n que nombra el papel. */
  message: string;
}

/** Medianoche local, que es la unidad en la que caduca un papel. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * El papel caducado que impide este alquiler, si lo hay.
 *
 * ⚠️ **Se compara contra la fecha de DEVOLUCIÓN, no contra hoy.** Es lo que
 * pidió Dorel y es lo correcto: con la ITV caducando el 10 de octubre, alquilar
 * del 1 al 5 es legal y alquilar del 8 al 12 no, porque los días 11 y 12 el
 * coche estaría circulando sin ella. Mirando solo el día de hoy, el segundo
 * alquiler se aceptaría sin que nada avisara.
 *
 * ⚠️ **Y se compara por DÍAS.** Las fechas de vencimiento se guardan a
 * medianoche y la devolución tiene hora: con una comparación de instantes, un
 * coche con la ITV hasta el 10 devuelto el día 10 a las diez de la mañana
 * saldría bloqueado, y ese día el papel todavía vale.
 *
 * ⚠️ **Esto BLOQUEA, y es un cambio de criterio deliberado** (21 de septiembre
 * de 2026). Hasta hoy la ITV vencida solo avisaba, con el argumento de que quien
 * está en el mostrador tiene que poder decidir. Dorel lo revocó: *«que yo no
 * pueda alquilar el coche pasada esta fecha hasta no hacer la itv»*. El
 * argumento de entonces sigue valiendo para lo que no impide circular —un aceite
 * vencido sigue avisando—, pero no para un coche que no puede salir a la calle.
 */
export function blockingMaintenance(
  registros: MaintenanceDue[],
  returnDateTime: Date
): MaintenanceBlock | undefined {
  const devolucion = startOfDay(returnDateTime);
  let peor: MaintenanceBlock | undefined;

  for (const r of registros) {
    if (!r.dueDate || isNaN(r.dueDate.getTime())) continue;
    if (!OPEN_STATUSES.includes(r.status)) continue;
    if (!(BLOCKING_MAINTENANCE_TYPES as readonly MaintenanceType[]).includes(r.type)) continue;
    // El día del vencimiento todavía vale; el siguiente ya no.
    if (startOfDay(r.dueDate) >= devolucion) continue;

    const tipo = r.type as BlockingMaintenanceType;
    // El que caduca antes: es el que hay que resolver primero y el que explica
    // mejor por qué el coche no sale.
    if (!peor || r.dueDate < peor.dueDate) {
      peor = { type: tipo, dueDate: r.dueDate, message: BLOCKING_MESSAGES[tipo] };
    }
  }

  return peor;
}

/**
 * El estado del coche después de una devolución.
 *
 * ⚠️ **No resucita un coche que alguien apartó a propósito.** La devolución
 * ponía `available` a secas, así que un coche marcado «Fuera de servicio»
 * mientras estaba alquilado —se rompió durante el alquiler, que es cuando pasa—
 * volvía a la flota solo por terminar el parte, y nadie se enteraba. Lo que la
 * devolución sabe es que el coche ya no está fuera; que vuelva a alquilarse es
 * otra decisión, y la tomó quien cambió el estado.
 */
export function statusAfterReturn(current: VehicleStatus | undefined): VehicleStatus {
  if (current === 'maintenance' || current === 'out_of_service') return current;
  return 'available';
}
