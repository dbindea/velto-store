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
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  Payment,
  PaymentType,
  PaymentMethod,
  PaymentSource,
  PaymentStatus
} from '@shared/models/payment.model';
import { Reservation } from '@shared/models/reservation.model';
import {
  calculateReservationPaymentSummary,
  calculatePaymentStatus,
  calculatePendingAmount,
  generateInternalReference,
  roundMoney
} from '@shared/utils/payment-summary.util';

export interface CreateManualPaymentData {
  reservationId: string;
  clientId: string;
  vehicleId: string;
  type: PaymentType;
  method: PaymentMethod;
  amount: number;
  paidAmount: number;
  concept: string;
  notes?: string;
  dueDate?: any;
  paidAt?: any;
  source?: PaymentSource;
  reservationSnapshot?: Payment['reservationSnapshot'];
  clientSnapshot?: Payment['clientSnapshot'];
  vehicleSnapshot?: Payment['vehicleSnapshot'];
}

export interface CreateExtraChargeData extends Omit<CreateManualPaymentData, 'type'> {
  type: 'extra_charge' | 'fuel_charge' | 'cleaning_charge' | 'extra_km_charge' | 'penalty' | 'fine';
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private firestore = inject(Firestore);
  private paymentsRef: CollectionReference;

  constructor() {
    this.paymentsRef = collection(this.firestore, 'payments');
  }

  /** Removes undefined/null fields recursively. Preserves arrays. */
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

  getPayments(): Observable<Payment[]> {
    const q = query(this.paymentsRef, orderBy('createdAt', 'desc'));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Payment)))
    );
  }

  getPaymentById(id: string): Observable<Payment | null> {
    const docRef = doc(this.firestore, `payments/${id}`);
    return from(getDoc(docRef)).pipe(
      map(snap => snap.exists() ? { id: snap.id, ...snap.data() } as Payment : null)
    );
  }

  getPaymentsByReservation(reservationId: string): Observable<Payment[]> {
    const q = query(
      this.paymentsRef,
      where('reservationId', '==', reservationId),
      orderBy('createdAt', 'asc')
    );
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Payment)))
    );
  }

  getPaymentsByClient(clientId: string): Observable<Payment[]> {
    const q = query(
      this.paymentsRef,
      where('clientId', '==', clientId),
      orderBy('createdAt', 'desc')
    );
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Payment)))
    );
  }

  getPaymentsByVehicle(vehicleId: string): Observable<Payment[]> {
    const q = query(
      this.paymentsRef,
      where('vehicleId', '==', vehicleId),
      orderBy('createdAt', 'desc')
    );
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Payment)))
    );
  }

  // === Mutations ===

  /**
   * Create a manual payment (signal, remaining, deposit, etc.).
   */
  async createManualPayment(data: CreateManualPaymentData): Promise<string> {
    const status = calculatePaymentStatus(data.amount, data.paidAmount);
    const direction: 'income' | 'refund' | 'retention' | 'charge' =
      data.type === 'deposit_refund' ? 'refund' :
      data.type === 'deposit_retention' ? 'retention' :
      (data.type === 'extra_charge' || data.type === 'fuel_charge' ||
       data.type === 'cleaning_charge' || data.type === 'extra_km_charge' ||
       data.type === 'penalty' || data.type === 'fine') ? 'charge' :
      'income';

    const payment: Payment = {
      reservationId: data.reservationId,
      clientId: data.clientId,
      vehicleId: data.vehicleId,
      reservationSnapshot: data.reservationSnapshot,
      clientSnapshot: data.clientSnapshot,
      vehicleSnapshot: data.vehicleSnapshot,
      type: data.type,
      direction,
      method: data.method,
      source: data.source || 'manual',
      status,
      amount: roundMoney(data.amount),
      paidAmount: roundMoney(data.paidAmount),
      pendingAmount: calculatePendingAmount(data.amount, data.paidAmount),
      currency: 'EUR',
      dueDate: data.dueDate,
      paidAt: data.paidAt || (data.paidAmount > 0 ? { seconds: Date.now() / 1000 } : undefined),
      concept: data.concept,
      notes: data.notes,
      internalReference: generateInternalReference('PMT'),
      createdAt: { seconds: Date.now() / 1000 }
    };

    const docRef = await addDoc(this.paymentsRef, this.cleanData(payment));
    await this.recalculateReservationPaymentSummary(data.reservationId);
    return docRef.id;
  }

  /**
   * Create an extra charge (fuel, cleaning, extra km, penalty, fine).
   */
  async createExtraCharge(data: CreateExtraChargeData): Promise<string> {
    return this.createManualPayment({ ...data, source: data.source || 'manual' });
  }

  /**
   * Update a payment.
   */
  async updatePayment(id: string, data: Partial<Payment>): Promise<void> {
    const docRef = doc(this.firestore, `payments/${id}`);
    const update: any = {
      ...data,
      updatedAt: { seconds: Date.now() / 1000 }
    };
    if (data.amount !== undefined && data.paidAmount !== undefined) {
      update.pendingAmount = calculatePendingAmount(data.amount, data.paidAmount);
      update.status = calculatePaymentStatus(data.amount, data.paidAmount);
    }
    await updateDoc(docRef, this.cleanData(update));
    // Recalc summary
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const payment = snap.data() as Payment;
      await this.recalculateReservationPaymentSummary(payment.reservationId);
    }
  }

  /**
   * Mark a payment as paid (for pending payments).
   */
  async markPaymentAsPaid(
    id: string,
    paidData: { paidAmount?: number; method?: PaymentMethod; paidAt?: any; notes?: string }
  ): Promise<void> {
    const docRef = doc(this.firestore, `payments/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payment not found');
    const payment = snap.data() as Payment;

    const newPaidAmount = paidData.paidAmount ?? payment.amount;
    const paidAt = paidData.paidAt || { seconds: Date.now() / 1000 };

    await updateDoc(docRef, this.cleanData({
      paidAmount: roundMoney(newPaidAmount),
      pendingAmount: calculatePendingAmount(payment.amount, newPaidAmount),
      status: calculatePaymentStatus(payment.amount, newPaidAmount),
      method: paidData.method || payment.method,
      paidAt,
      notes: paidData.notes,
      updatedAt: { seconds: Date.now() / 1000 }
    }));

    await this.recalculateReservationPaymentSummary(payment.reservationId);
  }

  /**
   * Mark a payment as failed.
   */
  async markPaymentAsFailed(id: string, reason: string): Promise<void> {
    const docRef = doc(this.firestore, `payments/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const payment = snap.data() as Payment;
    await updateDoc(docRef, this.cleanData({
      status: 'failed',
      notes: reason,
      updatedAt: { seconds: Date.now() / 1000 }
    }));
    await this.recalculateReservationPaymentSummary(payment.reservationId);
  }

  /**
   * Cancel a payment (mark as cancelled, doesn't delete).
   */
  async cancelPayment(id: string): Promise<void> {
    const docRef = doc(this.firestore, `payments/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const payment = snap.data() as Payment;
    await updateDoc(docRef, this.cleanData({
      status: 'cancelled',
      updatedAt: { seconds: Date.now() / 1000 }
    }));
    await this.recalculateReservationPaymentSummary(payment.reservationId);
  }

  /**
   * Refund deposit (full or partial).
   */
  async refundDeposit(
    reservationId: string,
    amount: number,
    method: PaymentMethod,
    notes?: string
  ): Promise<string> {
    // Need reservation data
    const reservation = await this.getReservationData(reservationId);
    if (!reservation) throw new Error('Reservation not found');

    return this.createManualPayment({
      reservationId,
      clientId: reservation.clientId,
      vehicleId: reservation.vehicleId,
      type: 'deposit_refund',
      method,
      amount: roundMoney(amount),
      paidAmount: roundMoney(amount),
      paidAt: { seconds: Date.now() / 1000 },
      concept: 'Devolución fianza',
      notes,
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

  /**
   * Retain part of the deposit.
   */
  async retainDeposit(
    reservationId: string,
    amount: number,
    reason: string
  ): Promise<string> {
    const reservation = await this.getReservationData(reservationId);
    if (!reservation) throw new Error('Reservation not found');

    return this.createManualPayment({
      reservationId,
      clientId: reservation.clientId,
      vehicleId: reservation.vehicleId,
      type: 'deposit_retention',
      method: 'other',
      amount: roundMoney(amount),
      paidAmount: roundMoney(amount),
      paidAt: { seconds: Date.now() / 1000 },
      concept: 'Retención fianza',
      notes: reason,
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

  /**
   * Create default initial payments for a new reservation.
   * Called from ReservationService after creating a reservation.
   */
  async createInitialPaymentsForReservation(
    reservationId: string,
    reservation: Reservation
  ): Promise<void> {
    const finalPrice = reservation.pricingSnapshot?.finalPrice || 0;
    const initialPaymentRequired = reservation.initialPayment?.requiredAmount || 0;
    const remainingPaymentRequired = reservation.remainingPayment?.requiredAmount || 0;
    const depositRequired = reservation.deposit?.requiredAmount || 0;

    // Initial payment
    if (initialPaymentRequired > 0) {
      await addDoc(this.paymentsRef, this.cleanData({
        reservationId,
        clientId: reservation.clientId,
        vehicleId: reservation.vehicleId,
        reservationSnapshot: {
          pickupDateTime: reservation.pickupDateTime,
          returnDateTime: reservation.returnDateTime,
          totalDays: reservation.totalDays,
          finalPrice
        },
        clientSnapshot: reservation.clientSnapshot,
        vehicleSnapshot: reservation.vehicleSnapshot,
        type: 'initial_payment',
        direction: 'income',
        method: 'other',
        source: 'system',
        status: 'pending',
        amount: roundMoney(initialPaymentRequired),
        paidAmount: 0,
        pendingAmount: roundMoney(initialPaymentRequired),
        currency: 'EUR',
        dueDate: { seconds: Date.now() / 1000 },
        concept: 'Señal reserva',
        internalReference: generateInternalReference('INIT'),
        createdAt: { seconds: Date.now() / 1000 }
      }));
    }

    // Remaining payment
    if (remainingPaymentRequired > 0) {
      await addDoc(this.paymentsRef, this.cleanData({
        reservationId,
        clientId: reservation.clientId,
        vehicleId: reservation.vehicleId,
        reservationSnapshot: {
          pickupDateTime: reservation.pickupDateTime,
          returnDateTime: reservation.returnDateTime,
          totalDays: reservation.totalDays,
          finalPrice
        },
        clientSnapshot: reservation.clientSnapshot,
        vehicleSnapshot: reservation.vehicleSnapshot,
        type: 'remaining_payment',
        direction: 'income',
        method: 'other',
        source: 'system',
        status: 'pending',
        amount: roundMoney(remainingPaymentRequired),
        paidAmount: 0,
        pendingAmount: roundMoney(remainingPaymentRequired),
        currency: 'EUR',
        dueDate: reservation.remainingPayment?.dueDate,
        concept: 'Resto alquiler',
        internalReference: generateInternalReference('REMAIN'),
        createdAt: { seconds: Date.now() / 1000 }
      }));
    }

    // Deposit
    if (depositRequired > 0) {
      await addDoc(this.paymentsRef, this.cleanData({
        reservationId,
        clientId: reservation.clientId,
        vehicleId: reservation.vehicleId,
        reservationSnapshot: {
          pickupDateTime: reservation.pickupDateTime,
          returnDateTime: reservation.returnDateTime,
          totalDays: reservation.totalDays,
          finalPrice
        },
        clientSnapshot: reservation.clientSnapshot,
        vehicleSnapshot: reservation.vehicleSnapshot,
        type: 'deposit',
        direction: 'income',
        method: 'other',
        source: 'system',
        status: 'pending',
        amount: roundMoney(depositRequired),
        paidAmount: 0,
        pendingAmount: roundMoney(depositRequired),
        currency: 'EUR',
        dueDate: reservation.pickupDateTime,
        concept: 'Fianza',
        internalReference: generateInternalReference('DEP'),
        createdAt: { seconds: Date.now() / 1000 }
      }));
    }
  }

  /**
   * Recalculate the payment summary on the reservation from its payments.
   */
  async recalculateReservationPaymentSummary(reservationId: string): Promise<void> {
    const payments = await new Promise<Payment[]>((resolve) => {
      this.getPaymentsByReservation(reservationId).subscribe(p => resolve(p));
    });

    const reservation = await this.getReservationData(reservationId);
    if (!reservation) return;

    const summary = calculateReservationPaymentSummary(payments, reservation);

    // Also update the legacy fields to keep backward compatibility
    const reservationRef = doc(this.firestore, `reservations/${reservationId}`);
    await updateDoc(reservationRef, this.cleanData({
      paymentSummary: summary,
      paymentStatus: summary.paymentStatus,
      'initialPayment.paidAmount': summary.initialPaymentPaid,
      'initialPayment.status': summary.initialPaymentPaid >= summary.initialPaymentRequired && summary.initialPaymentRequired > 0 ? 'paid' :
                                 summary.initialPaymentPaid > 0 ? 'pending' : 'pending',
      'remainingPayment.paidAmount': summary.remainingPaymentPaid,
      'remainingPayment.status': summary.remainingPaymentPaid >= summary.remainingPaymentRequired && summary.remainingPaymentRequired > 0 ? 'paid' : 'pending',
      'deposit.paidAmount': summary.depositPaid,
      'deposit.returnedAmount': summary.depositReturned,
      'deposit.retainedAmount': summary.depositRetained,
      'deposit.status': this.depositStatusFromSummary(summary),
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  /**
   * Sync the reservation paymentStatus (kept for backward compat).
   */
  async syncReservationPaymentStatus(reservationId: string): Promise<void> {
    await this.recalculateReservationPaymentSummary(reservationId);
  }

  // === Private helpers ===

  private async getReservationData(reservationId: string): Promise<Reservation | null> {
    const docRef = doc(this.firestore, `reservations/${reservationId}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Reservation;
  }

  private depositStatusFromSummary(summary: any): string {
    if (summary.depositRetained > 0 && summary.depositReturned === 0) return 'retained';
    if (summary.depositReturned === summary.depositPaid && summary.depositPaid > 0) return 'returned';
    if (summary.depositReturned > 0) return 'partial_returned';
    if (summary.depositPaid >= summary.depositRequired && summary.depositRequired > 0) return 'paid';
    return 'pending';
  }
}