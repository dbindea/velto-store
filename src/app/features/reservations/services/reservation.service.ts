import { Injectable, inject } from '@angular/core';
import { Firestore, CollectionReference, arrayUnion, collection, doc, addDoc, updateDoc, getDoc, getDocs, onSnapshot, query, orderBy, where } from '@angular/fire/firestore';
import { Observable, from, forkJoin, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Vehicle } from '@shared/models/vehicle.model';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import {
  Reservation,
  ReservationStatus,
  BLOCKING_STATUSES,
  ReservationPricingSnapshot,
  ReservationNote
} from '@shared/models/reservation.model';
import { Client } from '@shared/models/client.model';
import { 
  calculateCalendarDays, 
  toTimestamp, 
  toDate,
  dateRangesOverlap 
} from '@shared/utils/reservation-date.util';
import {
  calculateBasePrice,
  findPricingRuleByDays,
  resolveRentalPrice,
  DEFAULT_VAT_RATE
} from '@shared/utils/pricing.util';
import { buildDeposit } from '@shared/utils/deposit.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { PaymentService } from '@features/payments/services/payment.service';
import { InspectionService } from '@features/inspections/services/inspection.service';
import { AuthService } from '@core/auth/auth.service';
import {
  Workflow,
  WorkflowContext,
  canCloseReservation as assertCanClose
} from '@shared/utils/reservation-workflow.util';

export interface VehicleAvailabilityResult {
  vehicleId: string;
  vehicle: Vehicle;
  available: boolean;
  totalDays: number;
  pricing: ReservationPricingSnapshot | null;
  conflictReservationId?: string;
  conflictMessage?: string;
}

@Injectable({ providedIn: 'root' })
export class ReservationService {
  private firestore = inject(Firestore);
  private reservationsRef: CollectionReference;
  private vehicleService = inject(VehicleService);
  private paymentService = inject(PaymentService);
  private inspectionService = inject(InspectionService);
  private authService = inject(AuthService);

  constructor() {
    this.reservationsRef = collection(this.firestore, 'reservations');
  }

  /**
   * Removes undefined fields recursively.
   * Dates, arrays and Firestore Timestamps are passed through untouched.
   * Only plain object literals are recursed into.
   */
  private cleanData<T>(data: T): T {
    if (data === null || typeof data !== 'object') return data;
    if (data instanceof Date) return data;
    if (Array.isArray(data)) return data;
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data as object)) {
      if (value === undefined) continue;
      const isPlainObject =
        typeof value === 'object' &&
        value !== null &&
        !(value instanceof Date) &&
        !Array.isArray(value) &&
        // Avoid recursing into Firestore Timestamp / GeoPoint
        typeof (value as any).toDate !== 'function';
      cleaned[key] = isPlainObject ? this.cleanData(value) : value;
    }
    return cleaned;
  }

  /**
   * Get all reservations.
   */
  getReservations(): Observable<Reservation[]> {
    const q = query(this.reservationsRef, orderBy('pickupDateTime', 'asc'));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)))
    );
  }

  /**
   * Get all reservations for a specific client.
   * NOTE: Firestore may require a composite index for vehicleId + clientId + pickupDateTime.
   */
  getReservationsByClient(clientId: string): Observable<Reservation[]> {
    const q = query(
      this.reservationsRef,
      where('clientId', '==', clientId),
      orderBy('pickupDateTime', 'desc')
    );
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)))
    );
  }

  /**
   * Get all reservations for a specific vehicle.
   * NOTE: Firestore may require a composite index for vehicleId + pickupDateTime.
   */
  getReservationsByVehicle(vehicleId: string): Observable<Reservation[]> {
    const q = query(
      this.reservationsRef,
      where('vehicleId', '==', vehicleId),
      orderBy('pickupDateTime', 'desc')
    );
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)))
    );
  }

  /**
   * Get reservation by ID.
   */
  /**
   * Live subscription to a single reservation.
   *
   * The detail view changes underneath the operator while they work: signing a
   * contract updates `contractStatus`, completing an inspection moves
   * `reservationStatus`. With a one-shot `getDoc()` the screen kept showing
   * "Pendiente de firma" after the customer had already signed on their phone.
   */
  getReservationById(id: string): Observable<Reservation | null> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    return new Observable<Reservation | null>((subscriber) => {
      const unsubscribe = onSnapshot(
        docRef,
        (snap) => {
          subscriber.next(snap.exists() ? ({ id: snap.id, ...snap.data() } as Reservation) : null);
        },
        (error) => subscriber.error(error)
      );
      return () => unsubscribe();
    });
  }

  /**
   * Check if a vehicle is available for given dates.
   */
  async checkVehicleAvailability(
    vehicleId: string, 
    pickupDateTime: Date, 
    returnDateTime: Date
  ): Promise<{ available: boolean; conflictId?: string; conflictMessage?: string }> {
    // Get all reservations for this vehicle
    const q = query(
      this.reservationsRef, 
      where('vehicleId', '==', vehicleId)
    );
    const snapshot = await getDocs(q);
    
    const pickupTimestamp = toTimestamp(pickupDateTime);
    const returnTimestamp = toTimestamp(returnDateTime);
    
    for (const docSnap of snapshot.docs) {
      const reservation = docSnap.data() as Reservation;
      
      // Skip non-blocking statuses
      if (!BLOCKING_STATUSES.includes(reservation.reservationStatus)) {
        continue;
      }
      
      // Check for overlap
      const existingPickup = toDate(reservation.pickupDateTime);
      const existingReturn = toDate(reservation.returnDateTime);
      
      if (dateRangesOverlap(existingPickup, existingReturn, pickupDateTime, returnDateTime)) {
        return {
          available: false,
          conflictId: docSnap.id,
          conflictMessage: `Ya existe una reserva (${reservation.reservationStatus}) para estas fechas`
        };
      }
    }
    
    return { available: true };
  }

  /**
   * Search availability for all vehicles.
   */
  async searchAvailability(
    pickupDateTime: Date,
    returnDateTime: Date
  ): Promise<VehicleAvailabilityResult[]> {
    // Get total days
    const totalDays = calculateCalendarDays(pickupDateTime, returnDateTime);
    if (totalDays <= 0) {
      throw new Error('Invalid dates: return must be after pickup');
    }

    // Get all vehicles
    const vehicles = await new Promise<Vehicle[]>((resolve) => {
      this.vehicleService.getVehicles().subscribe(v => resolve(v));
    });

    // Get all reservations
    const q = query(this.reservationsRef);
    const reservationSnapshot = await getDocs(q);
    const reservations = reservationSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    } as Reservation));

    const pickupTimestamp = toTimestamp(pickupDateTime);
    const returnTimestamp = toTimestamp(returnDateTime);

    const results: VehicleAvailabilityResult[] = [];

    for (const vehicle of vehicles) {
      // Only consider available vehicles
      if (vehicle.status !== 'available') {
        results.push({
          vehicleId: vehicle.id!,
          vehicle,
          available: false,
          totalDays,
          pricing: null,
          conflictMessage: 'VehÃ­culo no disponible en flota'
        });
        continue;
      }

      // Check for conflicting reservations
      let conflictId: string | undefined;
      let conflictMessage: string | undefined;
      
      for (const reservation of reservations) {
        if (reservation.vehicleId !== vehicle.id) continue;
        
        // Skip non-blocking statuses
        if (!BLOCKING_STATUSES.includes(reservation.reservationStatus)) {
          continue;
        }
        
        const existingPickup = toDate(reservation.pickupDateTime);
        const existingReturn = toDate(reservation.returnDateTime);
        
        if (dateRangesOverlap(existingPickup, existingReturn, pickupDateTime, returnDateTime)) {
          conflictId = reservation.id;
          conflictMessage = `Reservado (${reservation.reservationStatus})`;
          break;
        }
      }

      if (conflictId) {
        results.push({
          vehicleId: vehicle.id!,
          vehicle,
          available: false,
          totalDays,
          pricing: null,
          conflictReservationId: conflictId,
          conflictMessage
        });
        continue;
      }

      // Calculate pricing
      const pricingRules = vehicle.pricingRules || [];
      const basePriceResult = calculateBasePrice(pricingRules, totalDays);
      
      const pricing: ReservationPricingSnapshot = {
        totalDays,
        appliedRule: basePriceResult.appliedRule ? {
          minDays: basePriceResult.appliedRule.minDays,
          maxDays: basePriceResult.appliedRule.maxDays,
          pricePerDay: basePriceResult.appliedRule.pricePerDay,
          label: basePriceResult.appliedRule.label
        } : null,
        pricePerDay: basePriceResult.pricePerDay,
        basePrice: basePriceResult.basePrice,
        finalPrice: basePriceResult.basePrice
      };

      results.push({
        vehicleId: vehicle.id!,
        vehicle,
        available: true,
        totalDays,
        pricing
      });
    }

    // Sort: available first, then by price
    results.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (!a.pricing || !b.pricing) return 0;
      return a.pricing.finalPrice - b.pricing.finalPrice;
    });

    return results;
  }

  /**
   * Create a new reservation.
   * Re-checks availability before saving.
   */
  async createReservation(
    vehicleId: string,
    clientId: string,
    pickupDateTime: Date,
    returnDateTime: Date,
    initialPaymentRequired: number,
    depositRequired: number,
    notes?: string,
    pickupLocation?: string,
    returnLocation?: string,
    /** Required when `depositRequired` is 0. See `buildDeposit`. */
    depositWaivedReason?: string
  ): Promise<string> {
    // Re-check availability
    const availability = await this.checkVehicleAvailability(vehicleId, pickupDateTime, returnDateTime);
    if (!availability.available) {
      throw new Error('Vehicle no longer available for these dates');
    }

    // Get vehicle data
    const vehicle = await new Promise<Vehicle | null>((resolve) => {
      this.vehicleService.getVehicleById(vehicleId).subscribe(v => resolve(v));
    });
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    // Calculate pricing
    const totalDays = calculateCalendarDays(pickupDateTime, returnDateTime);
    const pricingRules = vehicle.pricingRules || [];
    const basePriceResult = calculateBasePrice(pricingRules, totalDays);
    
    const finalPrice = basePriceResult.basePrice;
    const remainingPaymentRequired = Math.max(0, finalPrice - initialPaymentRequired);

    // TODO: Use Firestore transaction or Cloud Function for atomic operations
    // This is client-side validation only for MVP

    const reservation: Omit<Reservation, 'id'> = {
      vehicleId,
      vehicleSnapshot: {
        brand: vehicle.brand,
        model: vehicle.model,
        plateNumber: vehicle.plateNumber,
        year: vehicle.year,
        acrissCode: vehicle.acrissCode,
        fuelType: vehicle.fuelType,
        transmission: vehicle.transmission,
        seats: vehicle.seats,
        luggageCapacity: vehicle.luggageCapacity,
        currentKm: vehicle.currentKm,
        color: vehicle.color
      },
      clientId,
      clientSnapshot: {
        fullName: '', // Will be filled after client lookup
        phone: undefined,
        email: undefined,
        documentNumber: undefined
      },
      pickupDateTime: toTimestamp(pickupDateTime),
      returnDateTime: toTimestamp(returnDateTime),
      pickupLocation,
      returnLocation,
      totalDays,
      pricingSnapshot: {
        totalDays,
        appliedRule: basePriceResult.appliedRule ? {
          minDays: basePriceResult.appliedRule.minDays,
          maxDays: basePriceResult.appliedRule.maxDays,
          pricePerDay: basePriceResult.appliedRule.pricePerDay,
          label: basePriceResult.appliedRule.label
        } : null,
        pricePerDay: basePriceResult.pricePerDay,
        basePrice: basePriceResult.basePrice,
        finalPrice
      },
      initialPayment: {
        requiredAmount: initialPaymentRequired,
        paidAmount: 0,
        status: 'pending'
      },
      remainingPayment: {
        requiredAmount: remainingPaymentRequired,
        paidAmount: 0,
        dueDate: toTimestamp(new Date(pickupDateTime.getTime() - APP_DEFAULTS.REMAINING_PAYMENT_DUE_DAYS_BEFORE_PICKUP * 24 * 60 * 60 * 1000)), // days before pickup from APP_DEFAULTS
        status: 'pending'
      },
      // A deposit of 0 is a legitimate business decision — known customers
      // are not asked for one — but it is not the same thing as a deposit
      // nobody has collected yet. It is born `waived`, with its reason, so
      // the workflow never sits waiting for money no one intends to pay.
      deposit: buildDeposit(depositRequired, depositWaivedReason),
      paymentStatus: 'pending',
      contractStatus: 'pending',
      reservationStatus: 'reserved',
      notes,
      createdAt: { seconds: Date.now() / 1000 },
      updatedAt: { seconds: Date.now() / 1000 }
    };

    const docRef = await addDoc(this.reservationsRef, this.cleanData(reservation));
    // Generate initial payment records
    const savedReservation: Reservation = { id: docRef.id, ...reservation };
    await this.paymentService.createInitialPaymentsForReservation(docRef.id, savedReservation);
    return docRef.id;
  }

  /**
   * Create reservation with full client snapshot.
   */
  async createReservationWithClient(
    vehicle: Vehicle,
    client: Client,
    pickupDateTime: Date,
    returnDateTime: Date,
    initialPaymentRequired: number,
    depositRequired: number,
    notes?: string,
    pickupLocation?: string,
    returnLocation?: string,
    /**
     * Price agreed with the customer, overriding the tariff calculation.
     * The snapshot keeps the calculated figures and records the difference in
     * `manualAdjustment`, so the discount stays auditable.
     */
    finalPriceOverride?: number,
    /** Required when `depositRequired` is 0. See `buildDeposit`. */
    depositWaivedReason?: string
  ): Promise<string> {
    // Re-check availability
    const availability = await this.checkVehicleAvailability(vehicle.id!, pickupDateTime, returnDateTime);
    if (!availability.available) {
      throw new Error('Vehicle no longer available for these dates');
    }

    // Calculate pricing
    const totalDays = calculateCalendarDays(pickupDateTime, returnDateTime);
    const pricingRules = vehicle.pricingRules || [];
    const basePriceResult = calculateBasePrice(pricingRules, totalDays);

    // Tariff → loyalty discount → hand-agreed price. The service recomputes it
    // instead of trusting the figure the wizard showed: this is the value that
    // gets frozen into the contract.
    const pricing = resolveRentalPrice(
      basePriceResult.basePrice,
      client.loyaltyDiscountPercent,
      finalPriceOverride
    );
    const finalPrice = pricing.finalPrice;

    // A signal larger than the whole rental would leave the reservation
    // impossible to settle, so it is capped at the agreed price.
    const initialPayment = Math.min(initialPaymentRequired, finalPrice);
    const remainingPaymentRequired = Math.max(0, finalPrice - initialPayment);

    const reservation: Omit<Reservation, 'id'> = {
      vehicleId: vehicle.id!,
      vehicleSnapshot: {
        brand: vehicle.brand,
        model: vehicle.model,
        plateNumber: vehicle.plateNumber,
        year: vehicle.year,
        acrissCode: vehicle.acrissCode,
        fuelType: vehicle.fuelType,
        transmission: vehicle.transmission,
        seats: vehicle.seats,
        luggageCapacity: vehicle.luggageCapacity,
        currentKm: vehicle.currentKm,
        color: vehicle.color
      },
      clientId: client.id!,
      clientSnapshot: {
        fullName: client.fullName,
        phone: client.phone,
        email: client.email,
        documentNumber: client.documentNumber
      },
      pickupDateTime: toTimestamp(pickupDateTime),
      returnDateTime: toTimestamp(returnDateTime),
      pickupLocation,
      returnLocation,
      totalDays,
      pricingSnapshot: {
        totalDays,
        appliedRule: basePriceResult.appliedRule ? {
          minDays: basePriceResult.appliedRule.minDays,
          maxDays: basePriceResult.appliedRule.maxDays,
          pricePerDay: basePriceResult.appliedRule.pricePerDay,
          label: basePriceResult.appliedRule.label
        } : null,
        pricePerDay: basePriceResult.pricePerDay,
        basePrice: basePriceResult.basePrice,
        // Both discounts are frozen separately. Withdrawing the client's
        // discount tomorrow must not move a contract signed today.
        loyaltyDiscountPercent: pricing.loyaltyDiscountPercent || undefined,
        loyaltyDiscount: pricing.loyaltyDiscount || undefined,
        manualAdjustment: pricing.priceOverridden ? pricing.manualAdjustment : undefined,
        finalPrice,
        vatRate: DEFAULT_VAT_RATE
      },
      initialPayment: {
        requiredAmount: initialPayment,
        paidAmount: 0,
        status: 'pending'
      },
      remainingPayment: {
        requiredAmount: remainingPaymentRequired,
        paidAmount: 0,
        dueDate: toTimestamp(new Date(pickupDateTime.getTime() - APP_DEFAULTS.REMAINING_PAYMENT_DUE_DAYS_BEFORE_PICKUP * 24 * 60 * 60 * 1000)),
        status: 'pending'
      },
      // A deposit of 0 is a legitimate business decision — known customers
      // are not asked for one — but it is not the same thing as a deposit
      // nobody has collected yet. It is born `waived`, with its reason, so
      // the workflow never sits waiting for money no one intends to pay.
      deposit: buildDeposit(depositRequired, depositWaivedReason),
      paymentStatus: 'pending',
      contractStatus: 'pending',
      reservationStatus: 'reserved',
      notes,
      createdAt: { seconds: Date.now() / 1000 },
      updatedAt: { seconds: Date.now() / 1000 }
    };

    const docRef = await addDoc(this.reservationsRef, this.cleanData(reservation));
    // Generate initial payment records
    const savedReservation: Reservation = { id: docRef.id, ...reservation };
    await this.paymentService.createInitialPaymentsForReservation(docRef.id, savedReservation);
    return docRef.id;
  }

  /**
   * Update reservation.
   */
  async updateReservation(id: string, data: Partial<Reservation>): Promise<void> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    await updateDoc(docRef, this.cleanData({
      ...data,
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  /**
   * Append a new internal note to the reservation's `internalNotes`
   * log.  Notes are append-only — never edited or deleted.
   *
   * @param id reservation id
   * @param text note body (trimmed; must be non-empty)
   * @param author optional author (display name + email of the
   *               operator).  Falls back to the AuthService user.
   */
  async addInternalNote(
    id: string,
    text: string,
    author?: { displayName?: string; email?: string }
  ): Promise<ReservationNote> {
    const trimmed = (text || '').trim();
    if (!trimmed) throw new Error('Note text is required');

    // Fall back to the signed-in operator if no author is passed.
    const fallbackAuthor = this.authService.authorizedUser?.();
    const finalAuthor = {
      displayName: author?.displayName ?? fallbackAuthor?.displayName ?? undefined,
      email: author?.email ?? fallbackAuthor?.email ?? undefined
    };

    const note: ReservationNote = {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      createdAt: { seconds: Date.now() / 1000 },
      createdBy: finalAuthor.displayName,
      createdByEmail: finalAuthor.email
    };

    const docRef = doc(this.firestore, `reservations/${id}`);
    await updateDoc(docRef, this.cleanData({
      internalNotes: arrayUnion(note),
      updatedAt: { seconds: Date.now() / 1000 }
    }));

    return note;
  }

  /**
   * Cancel reservation. Only valid from `reserved` or `confirmed`.
   * Throws if the reservation has already been delivered, returned or closed.
   */
  async cancelReservation(id: string): Promise<void> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Reserva no encontrada');
    }
    const current = snap.data() as Reservation;
    const cancellable: ReservationStatus[] = ['reserved', 'confirmed'];
    if (!cancellable.includes(current.reservationStatus)) {
      throw new Error(`No se puede cancelar una reserva en estado ${current.reservationStatus}`);
    }
    await updateDoc(docRef, {
      reservationStatus: 'cancelled',
      updatedAt: { seconds: Date.now() / 1000 }
    });
    // A cancelled reservation must not keep advertising money to collect.
    await this.paymentService.cancelUncollectedPayments(id);
  }

  /**
   * Close reservation. Only allowed from `returned` with the return
   * inspection completed and the deposit fully settled (refunded or
   * retained). Throws with a workflow i18n key otherwise.
   */
  async closeReservation(id: string): Promise<void> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Reserva no encontrada');
    const reservation = { id: snap.id, ...snap.data() } as Reservation;

    const pickup = await this.inspectionService
      .getInspectionByReservationAndType(id, 'pickup');
    const ret = await this.inspectionService
      .getInspectionByReservationAndType(id, 'return');

    const decision = assertCanClose({
      reservation,
      pickupInspection: pickup || null,
      returnInspection: ret || null
    } as WorkflowContext);
    if (!decision.ok) {
      throw new Error(decision.reason);
    }

    await updateDoc(docRef, {
      reservationStatus: 'closed',
      updatedAt: { seconds: Date.now() / 1000 }
    });
    // Anything still seeded and untouched is not going to be collected on a
    // closed rental — otherwise the payment list contradicts the status.
    await this.paymentService.cancelUncollectedPayments(id);
  }
}
