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
  private cleanData<T extends object>(data: T): Partial<T> {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        cleaned[key] =
          typeof value === 'object' && !Array.isArray(value) && value !== null
            ? this.cleanData(value)
            : value;
      }
    }
    return cleaned;
  }

  /** All maintenance records for a given vehicle, newest first. */
  getMaintenanceByVehicle(vehicleId: string): Observable<VehicleMaintenance[]> {
    const q = query(
      this.maintenanceRef,
      where('vehicleId', '==', vehicleId),
      orderBy('nextDueDate', 'desc')
    );
    return from(getDocs(q)).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VehicleMaintenance))
    );
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
