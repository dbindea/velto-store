import { Injectable, inject } from '@angular/core';
import { Firestore, CollectionReference, collection, doc, addDoc, updateDoc, getDoc, getDocs, query, orderBy, where } from '@angular/fire/firestore';
import { Observable, from, forkJoin, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Vehicle } from '@shared/models/vehicle.model';
import { VehicleService } from '../../vehicles/services/vehicle.service';
import { 
  Reservation, 
  ReservationStatus, 
  BLOCKING_STATUSES,
  ReservationPricingSnapshot 
} from '@shared/models/reservation.model';
import { Client } from '@shared/models/client.model';
import { 
  calculateCalendarDays, 
  toTimestamp, 
  toDate,
  dateRangesOverlap 
} from '@shared/utils/reservation-date.util';
import { calculateBasePrice, findPricingRuleByDays } from '@shared/utils/pricing.util';

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

  constructor() {
    this.reservationsRef = collection(this.firestore, 'reservations');
  }

  /** Removes undefined/null fields recursively */
  private cleanData<T extends object>(data: T): Partial<T> {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        cleaned[key] = typeof value === 'object' && !Array.isArray(value) && value !== null
          ? this.cleanData(value)
          : value;
      }
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
   * Get reservation by ID.
   */
  getReservationById(id: string): Observable<Reservation | null> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    return from(getDoc(docRef)).pipe(
      map(snap => {
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() } as Reservation;
      })
    );
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
          conflictMessage: 'Vehículo no disponible en flota'
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
    returnLocation?: string
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
        acrissCode: vehicle.acrissCode,
        mainImageUrl: vehicle.images?.[0]?.url
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
        dueDate: toTimestamp(new Date(pickupDateTime.getTime() - 7 * 24 * 60 * 60 * 1000)), // 7 days before pickup
        status: 'pending'
      },
      deposit: {
        requiredAmount: depositRequired,
        paidAmount: 0,
        returnedAmount: 0,
        retainedAmount: 0,
        status: 'pending'
      },
      paymentStatus: 'pending',
      contractStatus: 'pending',
      reservationStatus: 'reserved',
      notes,
      createdAt: { seconds: Date.now() / 1000 },
      updatedAt: { seconds: Date.now() / 1000 }
    };

    const docRef = await addDoc(this.reservationsRef, this.cleanData(reservation));
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
    returnLocation?: string
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
    
    const finalPrice = basePriceResult.basePrice;
    const remainingPaymentRequired = Math.max(0, finalPrice - initialPaymentRequired);

    const reservation: Omit<Reservation, 'id'> = {
      vehicleId: vehicle.id!,
      vehicleSnapshot: {
        brand: vehicle.brand,
        model: vehicle.model,
        plateNumber: vehicle.plateNumber,
        acrissCode: vehicle.acrissCode,
        mainImageUrl: vehicle.images?.[0]?.url
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
        dueDate: toTimestamp(new Date(pickupDateTime.getTime() - 7 * 24 * 60 * 60 * 1000)),
        status: 'pending'
      },
      deposit: {
        requiredAmount: depositRequired,
        paidAmount: 0,
        returnedAmount: 0,
        retainedAmount: 0,
        status: 'pending'
      },
      paymentStatus: 'pending',
      contractStatus: 'pending',
      reservationStatus: 'reserved',
      notes,
      createdAt: { seconds: Date.now() / 1000 },
      updatedAt: { seconds: Date.now() / 1000 }
    };

    const docRef = await addDoc(this.reservationsRef, this.cleanData(reservation));
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
   * Cancel reservation.
   */
  async cancelReservation(id: string): Promise<void> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    await updateDoc(docRef, {
      reservationStatus: 'cancelled',
      updatedAt: { seconds: Date.now() / 1000 }
    });
  }
}