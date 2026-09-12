/**
 * El reparto con el dueño de un coche que no es de VELTO.
 *
 * Velto alquila el coche al cliente, cobra el total y emite **su** factura por
 * el importe completo. Lo que hay aquí es lo otro: lo que Velto le debe al
 * propietario por haberle cedido el vehículo.
 *
 * ⚠️ **No confundir con la comisión por traer un cliente.** Son dos cosas que
 * se pagan a la misma clase de persona y por motivos distintos: una es por el
 * coche y otra por el cliente. Un mismo colaborador puede cobrar las dos por la
 * misma reserva —trae el cliente Y pone el coche— y entonces son **dos apuntes**,
 * no uno mayor. Por eso `CollaboratorSale` lleva `kind`: sin él, sumar «lo que
 * se le debe a Juan» mezclaría dos conceptos que se liquidan y se justifican
 * distinto.
 */

import { roundMoney } from '@shared/utils/payment-summary.util';

/** Lo que se lleva el propietario por defecto si nadie dice otra cosa. */
export const DEFAULT_OWNER_SHARE_PERCENT = 75;

export interface OwnerShareSnapshot {
  collaboratorId: string;
  collaboratorName: string;
  /**
   * Lo que se lleva **el propietario**, en porcentaje (`75` = 75 %).
   *
   * ⚠️ Se guarda el del propietario y no el de Velto, aunque sean el mismo
   * dato: es el que se liquida, el que se le dice en voz alta y el que aparece
   * en su justificante. Guardar el complementario obligaría a restar cada vez
   * que hay que explicar una cifra, y en algún sitio saldría al revés.
   *
   * ⚠️ **Porcentaje, no fracción**, igual que `commissionPercent` y
   * `loyaltyDiscountPercent`. El `vatRate` sí es fracción; los nombres son
   * explícitos para que nadie los mezcle.
   */
  sharePercent: number;
}

/**
 * Lo que se le debe al propietario por una reserva.
 *
 * ⚠️ **La base es el alquiler SIN IVA, y solo el alquiler.** Tres exclusiones,
 * y las tres tienen su motivo:
 *
 * - **El IVA no es dinero de la empresa**, es de Hacienda. Repartirlo sería
 *   pagarle al propietario un porcentaje de un impuesto — el mismo error que ya
 *   se evitó con las comisiones de captación, donde hay un test de que 100 y 121
 *   no dan lo mismo.
 * - **La fianza no es un ingreso**: es dinero del cliente en custodia que se
 *   devuelve. Repartirla sería entregar dinero ajeno.
 * - **Los cargos extra son de Velto** (decisión de Dorel, 12 de septiembre de
 *   2026): combustible, limpieza, daños, kilómetros de más y multas cubren un
 *   coste o un perjuicio que ha puesto Velto. Repartirlos sería pagarle al
 *   propietario una parte de un depósito de gasolina que pagó la agencia.
 */
export function ownerShareAmount(netRentalAmount: number, sharePercent: number): number {
  const base = Number(netRentalAmount) || 0;
  const porcentaje = Number(sharePercent) || 0;
  if (base <= 0 || porcentaje <= 0) return 0;
  return roundMoney((base * porcentaje) / 100);
}

/** Lo que le queda a Velto de ese alquiler, que es el resto. */
export function veltoShareAmount(netRentalAmount: number, sharePercent: number): number {
  const base = roundMoney(Number(netRentalAmount) || 0);
  return roundMoney(Math.max(0, base - ownerShareAmount(base, sharePercent)));
}

/** Lo que se queda Velto, en porcentaje. Solo para enseñarlo. */
export function veltoSharePercent(sharePercent: number): number {
  const p = Number(sharePercent) || 0;
  return Math.max(0, Math.min(100, 100 - p));
}

/**
 * Lo que impide guardar este porcentaje, si algo lo impide.
 *
 * ⚠️ **El 100 % está permitido y el 0 % también**, y no son un error: un
 * propietario que cede el coche a cambio de todo el alquiler —Velto solo pone la
 * gestión y se cobra aparte— y uno que lo cede gratis existen los dos. Lo que no
 * existe es un reparto negativo ni uno de más del total.
 */
export function ownerSharePercentProblem(percent: number | null | undefined): string | null {
  /**
   * ⚠️ **`null` se comprueba aparte, antes de convertir.** `Number(null)` es
   * **0**, no `NaN`: con un `isFinite` a secas, un campo vacío pasaba como un
   * reparto del 0 % perfectamente válido — y el 0 % aquí es legítimo, así que
   * nada habría chirriado. Al propietario se le habría liquidado cero por cada
   * alquiler y el fallo se habría visto en la primera queja suya.
   */
  if (percent === null || percent === undefined) {
    return 'vehicles.problems.ownerShareRequired';
  }
  const p = Number(percent);
  if (!isFinite(p)) return 'vehicles.problems.ownerShareRequired';
  if (p < 0 || p > 100) return 'vehicles.problems.ownerShareRange';
  return null;
}

export interface VehicleOwnershipInput {
  ownership?: 'own' | 'collaborator';
  ownerCollaboratorId?: string;
  ownerSharePercent?: number;
}

/**
 * Lo que impide guardar la propiedad de un vehículo.
 *
 * ⚠️ **Un coche «de colaborador» sin colaborador no se guarda.** Es el caso que
 * deja una reserva sin poder repartir: el vehículo dice que hay que pagarle a
 * alguien y no dice a quién, y eso no se descubre hasta que se cierra el primer
 * alquiler.
 */
export function vehicleOwnershipProblem(v: VehicleOwnershipInput): Record<string, string> {
  const problemas: Record<string, string> = {};
  if ((v.ownership || 'own') !== 'collaborator') return problemas;

  if (!v.ownerCollaboratorId) {
    problemas['ownerCollaboratorId'] = 'vehicles.problems.ownerRequired';
  }
  const p = ownerSharePercentProblem(v.ownerSharePercent);
  if (p) problemas['ownerSharePercent'] = p;
  return problemas;
}

/**
 * El reparto que hay que congelar en una reserva, o `null` si el coche es de
 * Velto.
 *
 * ⚠️ **Se congela al crear la reserva, como el precio.** Cambiarle mañana el
 * porcentaje al coche, o venderlo a otro propietario, no puede mover lo que se
 * pactó por un alquiler de la semana pasada — es la misma regla que
 * `pricingSnapshot` y que el `commissionPercent` de cada venta.
 */
export function ownerShareSnapshotOf(
  vehicle: VehicleOwnershipInput | null | undefined,
  collaboratorName: string | undefined
): OwnerShareSnapshot | null {
  if (!vehicle || vehicle.ownership !== 'collaborator') return null;
  if (!vehicle.ownerCollaboratorId) return null;
  return {
    collaboratorId: vehicle.ownerCollaboratorId,
    collaboratorName: collaboratorName || '—',
    sharePercent: Number(vehicle.ownerSharePercent) || 0
  };
}
