import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  CollectionReference,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  Inspection,
  InspectionType,
  InspectionStatus,
  InspectionPhoto,
  PhotoCategory,
  VehicleDamage,
  InspectionExtraCharges,
  InspectionChecklist
} from '@shared/models/inspection.model';
import { Reservation } from '@shared/models/reservation.model';
import { PaymentService } from '@features/payments/services/payment.service';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { roundMoney } from '@shared/utils/payment-summary.util';

@Injectable({ providedIn: 'root' })
export class InspectionService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private inspectionsRef: CollectionReference;
  private paymentService = inject(PaymentService);

  constructor() {
    this.inspectionsRef = collection(this.firestore, 'inspections');
  }

  /** Clean undefined values for Firestore */
  private cleanData<T>(data: T): T {
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) return data.map(item => this.cleanData(item)) as any;
    if (typeof data !== 'object') return data;
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        cleaned[key] = this.cleanData(value);
      }
    }
    return cleaned;
  }

  // === Queries ===

  getInspections(): Observable<Inspection[]> {
    const q = query(this.inspectionsRef, orderBy('createdAt', 'desc'));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Inspection)))
    );
  }

  getInspectionById(id: string): Observable<Inspection | null> {
    const docRef = doc(this.firestore, `inspections/${id}`);
    return from(getDoc(docRef)).pipe(
      map(snap => snap.exists() ? { id: snap.id, ...snap.data() } as Inspection : null)
    );
  }

  getInspectionsByReservation(reservationId: string): Observable<Inspection[]> {
    const q = query(
      this.inspectionsRef,
      where('reservationId', '==', reservationId),
      orderBy('createdAt', 'asc')
    );
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Inspection)))
    );
  }

  /**
   * Get a specific inspection by reservation + type.
   * Returns null if not found.
   */
  async getInspectionByReservationAndType(
    reservationId: string,
    type: InspectionType
  ): Promise<Inspection | null> {
    const q = query(
      this.inspectionsRef,
      where('reservationId', '==', reservationId),
      where('type', '==', type)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const d = snapshot.docs[0];
    return { id: d.id, ...d.data() } as Inspection;
  }

  // === Mutations ===

  /**
   * Create a new inspection (draft).
   * In MVP we mostly create+complete in one step via completePickup/Return.
   */
  async createInspection(data: Inspection): Promise<string> {
    const docRef = await addDoc(this.inspectionsRef, this.cleanData({
      ...data,
      status: data.status || 'draft',
      createdAt: { seconds: Date.now() / 1000 },
      updatedAt: { seconds: Date.now() / 1000 }
    }));
    return docRef.id;
  }

  async updateInspection(id: string, data: Partial<Inspection>): Promise<void> {
    const docRef = doc(this.firestore, `inspections/${id}`);
    await updateDoc(docRef, this.cleanData({
      ...data,
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  async cancelInspection(id: string): Promise<void> {
    const docRef = doc(this.firestore, `inspections/${id}`);
    await updateDoc(docRef, this.cleanData({
      status: 'cancelled',
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  // === Complete pickup / return (main flow) ===

  /**
   * Complete pickup inspection:
   * - Creates/updates the inspection
   * - Sets reservationStatus to delivered
   * - Sets vehicle.status to rented
   * - Saves deliveryInfo on reservation
   */
  async completePickupInspection(reservationId: string, inspection: Partial<Inspection>): Promise<string> {
    const reservation = await this.getReservationData(reservationId);
    if (!reservation) throw new Error('Reservation not found');

    const existing = await this.getInspectionByReservationAndType(reservationId, 'pickup');
    const baseData: Partial<Inspection> = {
      reservationId,
      vehicleId: reservation.vehicleId,
      clientId: reservation.clientId,
      type: 'pickup',
      reservationSnapshot: {
        pickupDateTime: reservation.pickupDateTime,
        returnDateTime: reservation.returnDateTime,
        totalDays: reservation.totalDays,
        finalPrice: reservation.pricingSnapshot?.finalPrice
      },
      vehicleSnapshot: reservation.vehicleSnapshot,
      clientSnapshot: reservation.clientSnapshot
    };

    let inspectionId: string;
    if (existing?.id) {
      inspectionId = existing.id;
      await this.updateInspection(inspectionId, {
        ...inspection,
        status: 'completed',
        completedAt: { seconds: Date.now() / 1000 }
      });
    } else {
      inspectionId = await this.createInspection({
        ...baseData,
        ...inspection,
        status: 'completed',
        completedAt: { seconds: Date.now() / 1000 }
      } as Inspection);
    }

    // Update reservation
    const reservationRef = doc(this.firestore, `reservations/${reservationId}`);
    await updateDoc(reservationRef, this.cleanData({
      reservationStatus: 'delivered',
      deliveryInfo: {
        pickupInspectionId: inspectionId,
        pickupKm: inspection.km,
        pickupFuelLevel: inspection.fuelLevel,
        pickupCompletedAt: { seconds: Date.now() / 1000 }
      },
      updatedAt: { seconds: Date.now() / 1000 }
    }));

    // Update vehicle (if we have new km)
    if (inspection.km !== undefined) {
      const vehicleRef = doc(this.firestore, `vehicles/${reservation.vehicleId}`);
      await updateDoc(vehicleRef, this.cleanData({
        currentKm: inspection.km,
        status: 'rented',
        updatedAt: { seconds: Date.now() / 1000 }
      }));
    } else {
      const vehicleRef = doc(this.firestore, `vehicles/${reservation.vehicleId}`);
      await updateDoc(vehicleRef, this.cleanData({
        status: 'rented',
        updatedAt: { seconds: Date.now() / 1000 }
      }));
    }

    return inspectionId;
  }

  /**
   * Complete return inspection:
   * - Creates/updates the inspection
   * - Sets reservationStatus to returned (or closed)
   * - Sets vehicle.status to available
   * - Updates vehicle.currentKm
   * - Creates extra charge payments
   * - Optionally retains/refunds deposit
   */
  async completeReturnInspection(
    reservationId: string,
    inspection: Partial<Inspection>,
    options: {
      closeReservation?: boolean;
      retainDepositAmount?: number;
      refundDepositAmount?: number;
    } = {}
  ): Promise<string> {
    const reservation = await this.getReservationData(reservationId);
    if (!reservation) throw new Error('Reservation not found');

    const existing = await this.getInspectionByReservationAndType(reservationId, 'return');
    const baseData: Partial<Inspection> = {
      reservationId,
      vehicleId: reservation.vehicleId,
      clientId: reservation.clientId,
      type: 'return',
      reservationSnapshot: {
        pickupDateTime: reservation.pickupDateTime,
        returnDateTime: reservation.returnDateTime,
        totalDays: reservation.totalDays,
        finalPrice: reservation.pricingSnapshot?.finalPrice
      },
      vehicleSnapshot: reservation.vehicleSnapshot,
      clientSnapshot: reservation.clientSnapshot
    };

    const newStatus: 'returned' | 'closed' = options.closeReservation ? 'closed' : 'returned';

    let inspectionId: string;
    if (existing?.id) {
      inspectionId = existing.id;
      await this.updateInspection(inspectionId, {
        ...inspection,
        status: 'completed',
        completedAt: { seconds: Date.now() / 1000 }
      });
    } else {
      inspectionId = await this.createInspection({
        ...baseData,
        ...inspection,
        status: 'completed',
        completedAt: { seconds: Date.now() / 1000 }
      } as Inspection);
    }

    // Update reservation
    const reservationRef = doc(this.firestore, `reservations/${reservationId}`);
    await updateDoc(reservationRef, this.cleanData({
      reservationStatus: newStatus,
      returnInfo: {
        returnInspectionId: inspectionId,
        returnKm: inspection.km,
        returnFuelLevel: inspection.fuelLevel,
        returnCompletedAt: { seconds: Date.now() / 1000 },
        extraChargesTotal: inspection.extraCharges?.totalExtraCharges
      },
      updatedAt: { seconds: Date.now() / 1000 }
    }));

    // Update vehicle
    const vehicleRef = doc(this.firestore, `vehicles/${reservation.vehicleId}`);
    await updateDoc(vehicleRef, this.cleanData({
      currentKm: inspection.km,
      status: 'available',
      updatedAt: { seconds: Date.now() / 1000 }
    }));

    // Create extra charge payments
    if (inspection.extraCharges) {
      await this.createExtraChargePayments(
        reservation,
        inspection.extraCharges
      );
    }

    // Handle deposit
    if (options.retainDepositAmount && options.retainDepositAmount > 0) {
      await this.paymentService.retainDeposit(
        reservationId,
        options.retainDepositAmount,
        inspection.extraCharges?.notes || 'Retención fianza - cargos entrega/devolución'
      );
    }
    if (options.refundDepositAmount && options.refundDepositAmount > 0) {
      await this.paymentService.refundDeposit(
        reservationId,
        options.refundDepositAmount,
        'cash',
        'Devolución fianza'
      );
    }

    return inspectionId;
  }

  // === Photos ===

  async uploadInspectionPhoto(
    reservationId: string,
    type: InspectionType,
    file: File,
    category?: PhotoCategory,
    label?: string
  ): Promise<InspectionPhoto> {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${timestamp}-${safeName}`;
    const storagePath = `inspections/${reservationId}/${type}/${filename}`;
    const storageRef = ref(this.storage, storagePath);

    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    return {
      url,
      path: storagePath,
      label,
      category,
      fileName: file.name,
      size: file.size,
      contentType: file.type,
      uploadedAt: { seconds: Date.now() / 1000 }
    };
  }

  async deleteInspectionPhoto(inspectionId: string, photo: InspectionPhoto): Promise<void> {
    try {
      const storageRef = ref(this.storage, photo.path);
      await deleteObject(storageRef);
    } catch (e) {
      // Ignore storage delete errors
    }

    const docRef = doc(this.firestore, `inspections/${inspectionId}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const inspection = snap.data() as Inspection;
    const photos = (inspection.photos || []).filter(p => p.path !== photo.path);
    await updateDoc(docRef, this.cleanData({
      photos,
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  /**
   * Update photos array of an inspection.
   */
  async updatePhotos(inspectionId: string, photos: InspectionPhoto[]): Promise<void> {
    const docRef = doc(this.firestore, `inspections/${inspectionId}`);
    await updateDoc(docRef, this.cleanData({
      photos,
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  // === Damages ===

  async updateDamages(inspectionId: string, damages: VehicleDamage[]): Promise<void> {
    const docRef = doc(this.firestore, `inspections/${inspectionId}`);
    await updateDoc(docRef, this.cleanData({
      damages,
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  // === Helpers ===

  /**
   * Calculate total of extra charges from raw input
   */
  calculateReturnExtraCharges(input: Partial<InspectionExtraCharges>): InspectionExtraCharges {
    const total =
      (input.extraKmCharge || 0) +
      (input.fuelCharge || 0) +
      (input.refuelPenalty || 0) +
      (input.cleaningCharge || 0) +
      (input.damageCharge || 0) +
      (input.fineCharge || 0) +
      (input.otherCharge || 0);
    return {
      ...input,
      totalExtraCharges: roundMoney(total)
    };
  }

  /**
   * Create payment records for each non-zero extra charge
   */
  private async createExtraChargePayments(
    reservation: Reservation,
    extra: InspectionExtraCharges
  ): Promise<void> {
    const map: Array<{ amount?: number; type: 'extra_charge' | 'extra_km_charge' | 'fuel_charge' | 'cleaning_charge' | 'penalty' | 'fine'; concept: string }> = [
      { amount: extra.extraKmCharge, type: 'extra_km_charge', concept: 'Cargos entrega/devolución: kilómetros extra' },
      { amount: extra.fuelCharge, type: 'fuel_charge', concept: 'Cargos entrega/devolución: combustible' },
      { amount: extra.refuelPenalty, type: 'penalty', concept: 'Cargos entrega/devolución: penalización repostaje' },
      { amount: extra.cleaningCharge, type: 'cleaning_charge', concept: 'Cargos entrega/devolución: limpieza' },
      { amount: extra.damageCharge, type: 'extra_charge', concept: 'Cargos entrega/devolución: daños' },
      { amount: extra.fineCharge, type: 'fine', concept: 'Cargos entrega/devolución: multa' },
      { amount: extra.otherCharge, type: 'extra_charge', concept: 'Cargos entrega/devolución: otros' }
    ];

    for (const item of map) {
      if (item.amount && item.amount > 0) {
        await this.paymentService.createExtraCharge({
          reservationId: reservation.id!,
          clientId: reservation.clientId,
          vehicleId: reservation.vehicleId,
          type: item.type,
          method: 'other',
          amount: item.amount,
          paidAmount: item.amount, // assumed already paid
          concept: item.concept,
          notes: extra.notes,
          source: 'manual',
          reservationSnapshot: {
            pickupDateTime: reservation.pickupDateTime,
            returnDateTime: reservation.returnDateTime,
            totalDays: reservation.totalDays,
            finalPrice: reservation.pricingSnapshot?.finalPrice
          },
          clientSnapshot: reservation.clientSnapshot || { fullName: '' },
          vehicleSnapshot: reservation.vehicleSnapshot
        });
      }
    }
  }

  /**
   * Load reservation data helper
   */
  private async getReservationData(reservationId: string): Promise<Reservation | null> {
    const docRef = doc(this.firestore, `reservations/${reservationId}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Reservation;
  }
}
