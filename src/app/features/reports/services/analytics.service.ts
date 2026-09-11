import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, query, where } from '@angular/fire/firestore';
import { PermissionsService } from '@core/auth/permissions.service';
import { Payment } from '@shared/models/payment.model';
import { Reservation } from '@shared/models/reservation.model';
import { Expense } from '@shared/models/expense.model';
import { CollaboratorSale } from '@shared/models/collaborator.model';
import { VehicleMaintenance } from '@shared/models/vehicle-maintenance.model';

export interface AnalyticsData {
  payments: Payment[];
  reservations: Reservation[];
  vehicleCount: number;
  expenses: Expense[];
  maintenance: VehicleMaintenance[];
  commissions: CollaboratorSale[];
}

/**
 * Los datos en crudo para la pantalla de análisis.
 *
 * ⚠️ **Aquí no se calcula nada.** Las cifras las decide `analytics.util.ts`, que
 * es la única autoridad sobre qué cuenta como ingreso — y es puro y está
 * probado. Un servicio que además sumara sería un segundo sitio donde vive la
 * definición de «ganancia», y la primera vez que discreparan nadie sabría cuál
 * manda. Eso es exactamente lo que pasó con el informe anterior, que sumaba las
 * fianzas como ingresos por su cuenta.
 *
 * ⚠️ **Se carga todo y se filtra en memoria.** Son los datos de una agencia con
 * unos pocos coches: unos miles de documentos al año. Una consulta por rango
 * pediría un índice compuesto por cada combinación de filtro, y comparar con el
 * año pasado obligaría a dos consultas más. Cambiar de periodo no puede costar
 * una lectura.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private firestore = inject(Firestore);
  private permissions = inject(PermissionsService);

  async load(): Promise<AnalyticsData> {
    /**
     * ⚠️ **La tercera capa, y hace falta.** La ruta ya está cerrada con
     * `permissionGuard` y `firestore.rules` deniega `expenses` y
     * `collaboratorSales` a quien no sea administrador — pero sin esto, un
     * empleado que llegara aquí por cualquier camino que no sea la ruta
     * recibiría un `permission-denied` de Firestore a medio camino: un error de
     * base de datos en vez de «esta sección no es tuya», que son dos cosas
     * distintas y se cuentan distinto.
     */
    if (!this.permissions.can('viewReports')) {
      throw new Error('permissions.notAllowed');
    }

    const [pagos, reservas, vehiculos, gastos, mantenimiento, comisiones] = await Promise.all([
      getDocs(collection(this.firestore, 'payments')),
      getDocs(collection(this.firestore, 'reservations')),
      getDocs(collection(this.firestore, 'vehicles')),
      getDocs(collection(this.firestore, 'expenses')),
      getDocs(collection(this.firestore, 'vehicleMaintenance')),
      /**
       * ⚠️ Solo las comisiones **vivas**. Una anulada —su reserva se canceló—
       * no se debe ni se pagó: restarla del beneficio sería descontar un dinero
       * que nunca salió.
       */
      getDocs(
        query(collection(this.firestore, 'collaboratorSales'), where('status', 'in', ['pending', 'paid']))
      )
    ]);

    const mapear = <T>(snap: { docs: { id: string; data: () => unknown }[] }): T[] =>
      snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);

    return {
      payments: mapear<Payment>(pagos),
      reservations: mapear<Reservation>(reservas),
      vehicleCount: vehiculos.size,
      expenses: mapear<Expense>(gastos),
      maintenance: mapear<VehicleMaintenance>(mantenimiento),
      commissions: mapear<CollaboratorSale>(comisiones)
    };
  }
}
