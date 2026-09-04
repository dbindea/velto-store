import { Injectable, inject } from '@angular/core';
import {
  CollectionReference,
  Firestore,
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Storage, deleteObject, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';
import { Observable, from, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';
import {
  MaintenanceStatus,
  MAINTENANCE_DUE_SOON_DAYS,
  MAINTENANCE_DUE_SOON_KM,
  VehicleMaintenance,
} from '@shared/models/vehicle-maintenance.model';
import { APP_DEFAULTS } from '@shared/constants/app.constants';

/**
 * CRUD + alert helpers for the `vehicleMaintenance` top-level
 * collection.
 *
 * Documents are flat (not a subcollection) so the dashboard can
 * pull global alerts in a single query.
 */
@Injectable({ providedIn: 'root' })
export class VehicleMaintenanceService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private maintenanceRef: CollectionReference;

  constructor() {
    this.maintenanceRef = collection(this.firestore, 'vehicleMaintenance');
  }

  /** Removes undefined/null fields recursively — required by Firestore. */
  /**
   * Removes `undefined` and `null` before writing.
   *
   * The previous local version rebuilt every object it walked, which turned
   * the `serverTimestamp()` sentinels below into plain maps — the same
   * corruption that hit contract timestamps in F-4. It never showed because
   * the collection is still empty in production.
   */
  /**
   * Removes `undefined` and `null` before writing.
   *
   * The previous local version rebuilt every object it walked, which turned
   * the `serverTimestamp()` sentinels below into plain maps — the same
   * corruption that hit contract timestamps in F-4. It never showed because
   * the collection is still empty in production.
   */
  private cleanData<T extends object>(data: T): Partial<T> {
    return cleanForFirestore(data, { stripNulls: true });
  }

  /**
   * Todo el mantenimiento de un vehículo, de más reciente a más antiguo.
   *
   * ⚠️ **Sin `orderBy` en la consulta, y no es por ahorrarse un índice.**
   * Firestore **excluye del resultado los documentos que no tienen el campo por
   * el que se ordena**. Con `orderBy('nextDueDate')`, una reparación ya hecha y
   * sin próxima revisión programada —el caso más normal de todos: un cambio de
   * aceite que se paga y se olvida— **desaparecía de la ficha del coche**. Se
   * guardaba bien en Firestore y la pantalla decía «Sin registros de
   * mantenimiento para este vehículo».
   *
   * Salió al construir el módulo de Gastos (4 de septiembre de 2026): el gasto
   * aparecía en Gastos, leído de esta misma colección, y no en la pestaña del
   * vehículo. El orden se hace ahora en memoria, que con estos volúmenes no
   * cuesta nada y no puede esconder una fila.
   */
  getMaintenanceByVehicle(vehicleId: string): Observable<VehicleMaintenance[]> {
    const q = query(this.maintenanceRef, where('vehicleId', '==', vehicleId));
    return from(getDocs(q)).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VehicleMaintenance)),
      map((records) => records.sort((a, b) => this.sortKey(b) - this.sortKey(a)))
    );
  }

  /**
   * Por qué fecha se ordena una ficha de mantenimiento.
   *
   * La de cuando se hizo manda sobre la de cuando toca, y `createdAt` es el
   * último recurso: lo que importa es que **ninguna quede fuera** por no tener
   * una de las tres.
   */
  private sortKey(m: VehicleMaintenance): number {
    const value = m.performedAtDate || m.nextDueDate || m.createdAt;
    if (!value) return 0;
    const date =
      value instanceof Timestamp ? value.toDate()
      : value instanceof Date ? value
      : new Date(value);
    return isNaN(date.getTime()) ? 0 : date.getTime();
  }

  getMaintenanceById(id: string): Observable<VehicleMaintenance | null> {
    const docRef = doc(this.firestore, `vehicleMaintenance/${id}`);
    return from(getDoc(docRef)).pipe(
      map((snap) => (snap.exists() ? ({ id: snap.id, ...snap.data() } as VehicleMaintenance) : null))
    );
  }

  /**
   * Returns scheduled/pending items for any vehicle whose due
   * date is within `withinDays` (default 30) or whose km threshold
   * is within `withinKm` (default 1000).  Used by the dashboard
   * "due soon" cards.
   */
  getUpcomingMaintenance(
    withinDays: number = MAINTENANCE_DUE_SOON_DAYS,
    withinKm: number = MAINTENANCE_DUE_SOON_KM
  ): Observable<VehicleMaintenance[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    const q = query(
      this.maintenanceRef,
      where('status', 'in', ['pending', 'scheduled', 'overdue']),
      where('nextDueDate', '<=', Timestamp.fromDate(horizon)),
      orderBy('nextDueDate', 'asc')
    );
    return from(getDocs(q)).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VehicleMaintenance))
    );
  }

  /**
   * Items that are explicitly overdue or whose next due date is
   * in the past.  Used by the dashboard "overdue" card.
   */
  getOverdueMaintenance(): Observable<VehicleMaintenance[]> {
    const now = new Date();
    const q = query(
      this.maintenanceRef,
      where('status', 'in', ['pending', 'scheduled', 'overdue']),
      where('nextDueDate', '<', Timestamp.fromDate(now)),
      orderBy('nextDueDate', 'asc')
    );
    return from(getDocs(q)).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VehicleMaintenance))
    );
  }

  async createMaintenance(data: Omit<VehicleMaintenance, 'id'>): Promise<string> {
    const payload = this.cleanData({
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    const ref = await addDoc(this.maintenanceRef, payload);
    return ref.id;
  }

  async updateMaintenance(id: string, data: Partial<VehicleMaintenance>): Promise<void> {
    const docRef = doc(this.firestore, `vehicleMaintenance/${id}`);
    const payload = this.cleanData({ ...data, updatedAt: serverTimestamp() });
    await updateDoc(docRef, payload);
  }

  /**
   * Mark a maintenance as completed.  If `nextDueKm` or `nextDueDate`
   * are provided we also create a follow-up record so the operator
   * doesn't have to enter it twice.
   */
  async completeMaintenance(
    id: string,
    completion: {
      performedAtKm?: number;
      performedAtDate?: any;
      cost?: number;
      provider?: string;
      invoiceUrl?: string;
      invoicePath?: string;
      notes?: string;
      scheduleFollowUp?: {
        type: MaintenanceStatus extends never ? never : VehicleMaintenance['type'];
        title: string;
        nextDueKm?: number;
        nextDueDate?: any;
        priority?: VehicleMaintenance['priority'];
      };
    }
  ): Promise<string | null> {
    const docRef = doc(this.firestore, `vehicleMaintenance/${id}`);
    const current = await getDoc(docRef);
    if (!current.exists()) throw new Error('Maintenance not found');
    const data = current.data() as VehicleMaintenance;

    await updateDoc(docRef, {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...this.cleanData({
        performedAtKm: completion.performedAtKm,
        performedAtDate: completion.performedAtDate,
        cost: completion.cost,
        provider: completion.provider,
        invoiceUrl: completion.invoiceUrl,
        invoicePath: completion.invoicePath,
        notes: completion.notes
      })
    });

    // Optional follow-up.
    if (completion.scheduleFollowUp) {
      const followUp: Omit<VehicleMaintenance, 'id'> = {
        vehicleId: data.vehicleId,
        vehicleSnapshot: data.vehicleSnapshot,
        type: completion.scheduleFollowUp.type,
        status: 'scheduled',
        priority: completion.scheduleFollowUp.priority || 'medium',
        title: completion.scheduleFollowUp.title,
        nextDueKm: completion.scheduleFollowUp.nextDueKm,
        nextDueDate: completion.scheduleFollowUp.nextDueDate
      };
      return this.createMaintenance(followUp);
    }
    return null;
  }

  async cancelMaintenance(id: string): Promise<void> {
    const docRef = doc(this.firestore, `vehicleMaintenance/${id}`);
    await updateDoc(docRef, { status: 'cancelled', updatedAt: serverTimestamp() });
  }

  async deleteMaintenance(id: string): Promise<void> {
    const docRef = doc(this.firestore, `vehicleMaintenance/${id}`);
    await deleteDoc(docRef);
  }

  /**
   * Upload a supporting document (invoice, photo, etc.) to
   * `vehicle-maintenance/{vehicleId}/{maintenanceId}/{ts}-{filename}`.
   * Returns the Storage path + the download URL.
   */
  async uploadMaintenanceInvoice(
    vehicleId: string,
    maintenanceId: string,
    file: File
  ): Promise<{ path: string; url: string }> {
    if (file.size > APP_DEFAULTS.MAX_DOCUMENT_FILE_SIZE) {
      throw new Error('File too large');
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `vehicle-maintenance/${vehicleId}/${maintenanceId}/${Date.now()}-${safeName}`;
    const fileRef = ref(this.storage, path);
    await uploadBytes(fileRef, file, {
      contentType: APP_DEFAULTS.ALLOWED_DOCUMENT_TYPES.includes(
        ext as (typeof APP_DEFAULTS.ALLOWED_DOCUMENT_TYPES)[number]
      )
        ? file.type
        : 'application/octet-stream'
    });
    const url = await getDownloadURL(fileRef);
    return { path, url };
  }

  async deleteMaintenanceInvoice(maintenanceId: string): Promise<void> {
    const docRef = doc(this.firestore, `vehicleMaintenance/${maintenanceId}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const data = snap.data() as VehicleMaintenance;
    if (data.invoicePath) {
      try {
        await deleteObject(ref(this.storage, data.invoicePath));
      } catch {
        // ignore — file may have been removed already
      }
    }
  }

  /**
   * Pure helper: derive the "effective" status of a record by
   * comparing its `nextDueDate` / `nextDueKm` against today + the
   * vehicle's current km.  Used to compute the badge on the
   * per-vehicle tab and the dashboard.
   */
  computeEffectiveStatus(
    m: VehicleMaintenance,
    vehicleCurrentKm?: number
  ): MaintenanceStatus {
    if (m.status === 'completed' || m.status === 'cancelled') {
      return m.status;
    }
    const now = new Date();
    let overdue = false;
    if (m.nextDueDate) {
      const d = m.nextDueDate instanceof Timestamp ? m.nextDueDate.toDate() : new Date(m.nextDueDate);
      if (d.getTime() < now.getTime()) overdue = true;
    }
    if (m.nextDueKm !== undefined && vehicleCurrentKm !== undefined) {
      if (vehicleCurrentKm >= m.nextDueKm) overdue = true;
    }
    if (overdue) return 'overdue';
    return m.status;
  }
}
