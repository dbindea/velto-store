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
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, firstValueFrom, from } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  Payment,
  PaymentType,
  PaymentMethod,
  PaymentSource,
  PaymentStatus
} from '@shared/models/payment.model';
import { Reservation } from '@shared/models/reservation.model';
import { reservationStatusAfterPayment } from '@shared/utils/reservation-workflow.util';
import {
  applySettlement,
  calculateReservationPaymentSummary,
  calculatePaymentStatus,
  calculatePendingAmount,
  generateInternalReference,
  roundMoney,
  selectSettleablePayment,
  buildInitialPaymentRows,
  distributeRentalPayment,
  collectedTotalsOf,
  EXTRA_TYPES
} from '@shared/utils/payment-summary.util';
import { depositAvailable, depositMovementProblem } from '@shared/utils/deposit.util';
import { PermissionsService } from '@core/auth/permissions.service';
import { receiptProblem } from '@shared/utils/receipt.util';
import { TranslateService } from '@core/i18n/translate.service';

export interface CreateManualPaymentData {
  /** Required for reservation-linked payments. Optional for free payments. */
  reservationId?: string;
  clientId?: string;
  vehicleId?: string;
  /** True when this is a "cobro libre". */
  isFreePayment?: boolean;
  /** Free-payment payer fields (only used when isFreePayment). */
  payerName?: string;
  payerEmail?: string;
  payerPhone?: string;
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

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private permissions = inject(PermissionsService);
  private translate = inject(TranslateService);
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

  // === Recibo de cobro ===

  /**
   * El justificante de un cobro, en PDF.
   *
   * ⚠️ **No le pasa el importe a la function: solo el id del pago.** El
   * documento se construye leyendo `payments`, que es la única fuente de verdad
   * del dinero que entra; mandar la cifra desde aquí convertiría el recibo en
   * un papel firmado por la empresa que dice lo que diga la pantalla.
   *
   * `invoiceExpected` es lo único que la aplicación no puede saber —se factura
   * **a petición**— y por eso lo marca el operador.
   *
   * ⚠️ Se comprueba aquí y también dentro de la function, con la misma regla:
   * la pantalla no debe dejar intentar algo que el backend va a rechazar, y el
   * backend no puede fiarse de que la pantalla estuviera bien.
   */
  async generateReceipt(
    payment: Payment,
    options: { invoiceExpected?: boolean } = {}
  ): Promise<{ reference: string; pdfUrl: string; shortUrl: string }> {
    const problema = receiptProblem(payment);
    if (problema) throw new Error(problema);
    if (!payment.id) throw new Error('payments.receipt.problems.paymentRequired');

    const fn = httpsCallable<
      Record<string, unknown>,
      { reference: string; pdfUrl: string; shortUrl: string }
    >(this.functions, 'generateReceipt');
    const res = await fn({
      paymentId: payment.id,
      invoiceExpected: !!options.invoiceExpected,
      // El documento sale en el idioma que tiene puesto la plataforma: es el
      // idioma en el que se está hablando con este cliente.
      locale: this.translate.getCurrentLanguage()
    });
    return res.data;
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
   * Create a manual payment (signal, remaining, deposit, etc.) or
   * a "cobro libre" (free payment) when isFreePayment is true.
   */
  async createManualPayment(data: CreateManualPaymentData): Promise<string> {
    if (!data.isFreePayment && !data.reservationId) {
      throw new Error('reservationId is required for non-free payments');
    }
    const status = calculatePaymentStatus(data.amount, data.paidAmount);
    const direction: 'income' | 'refund' | 'retention' | 'charge' =
      data.type === 'deposit_refund' ? 'refund' :
      data.type === 'deposit_retention' ? 'retention' :
      (data.type === 'extra_fuel' || data.type === 'refuel_penalty' ||
       data.type === 'extra_cleaning' || data.type === 'extra_km' ||
       data.type === 'extra_damage' || data.type === 'extra_fine' ||
       data.type === 'extra_other') ? 'charge' :
      'income';

    const payment: Payment = {
      reservationId: data.reservationId,
      clientId: data.clientId,
      vehicleId: data.vehicleId,
      isFreePayment: data.isFreePayment || false,
      payerName: data.payerName,
      payerEmail: data.payerEmail,
      payerPhone: data.payerPhone,
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
      internalReference: generateInternalReference(data.isFreePayment ? 'FRE' : 'PMT'),
      createdAt: { seconds: Date.now() / 1000 }
    };

    const docRef = await addDoc(this.paymentsRef, this.cleanData(payment));
    if (data.reservationId) {
      await this.recalculateReservationPaymentSummary(data.reservationId);
    }
    return docRef.id;
  }

  /**
   * Register a collection against a reservation.
   *
   * `createInitialPaymentsForReservation` seeds one `pending` document per
   * expected concept (señal, resto, fianza). Collecting money must **settle
   * that document**, not create a second one alongside it — otherwise a
   * closed reservation ends up showing six rows, three of them "Pendiente"
   * forever. So: look for an open payment of the same type and settle it;
   * only create a new document when there is nothing to settle (extras, or a
   * second collection over an already-paid concept).
   *
   * `rental_payment` es el caso aparte: no tiene fila sembrada porque no es un
   * concepto, es **cobrarlo todo de una vez**, así que se reparte entre las dos
   * que sí existen. Ver abajo.
   *
   * Returns the id of the payment that ended up holding the money.
   */
  async registerReservationPayment(data: CreateManualPaymentData): Promise<string> {
    if (!data.reservationId) {
      throw new Error('reservationId is required to register a reservation payment');
    }

    /**
     * «Pago completo del alquiler» no tiene fila propia: **salda la señal y el
     * resto** (D-5).
     *
     * Antes creaba un documento aparte y dejaba las dos sembradas pendientes
     * para siempre. El dinero contaba como ingreso pero no para el estado de
     * pago ni para `remainingPaid`, así que la reserva se cobraba entera y no
     * se podía cerrar nunca sin saltarse un paso del workflow.
     */
    if (data.type === 'rental_payment' && data.paidAmount > 0) {
      const payments = await this.fetchReservationPayments(data.reservationId);
      const { steps, leftover } = distributeRentalPayment(payments, data.paidAmount);

      for (const step of steps) {
        await this.settlePendingPayment(step.paymentId, {
          paidAmount: step.apply,
          method: data.method,
          paidAt: data.paidAt,
          notes: data.notes,
          concept: data.concept
        });
      }

      // Lo que sobra sí abre fila propia: es dinero entregado de más y perderlo
      // sería peor que tener que cuadrarlo.
      if (leftover > 0) {
        return this.createManualPayment({ ...data, amount: leftover, paidAmount: leftover });
      }
      if (steps.length > 0) return steps[0].paymentId;
    }

    if (data.paidAmount > 0) {
      const open = await this.findSettleablePayment(data.reservationId, data.type);
      if (open?.id) {
        await this.settlePendingPayment(open.id, {
          paidAmount: data.paidAmount,
          method: data.method,
          paidAt: data.paidAt,
          notes: data.notes,
          concept: data.concept
        });
        return open.id;
      }
    }

    return this.createManualPayment(data);
  }

  /**
   * Find the oldest still-open payment of a given type for a reservation.
   * `partial` counts as open: a second collection tops up the same row.
   */
  async findSettleablePayment(
    reservationId: string,
    type: PaymentType
  ): Promise<Payment | null> {
    const payments = await this.fetchReservationPayments(reservationId);
    return selectSettleablePayment(payments, type);
  }

  /**
   * Add money to an open payment. Unlike `markPaymentAsPaid`, which
   * *replaces* `paidAmount`, this **accumulates** — registering 250 € over a
   * row that already holds 100 € means the customer handed over 250 € more.
   *
   * If the collected total exceeds the expected amount, `amount` grows to
   * match it: the row records what actually happened, and `pendingAmount`
   * never goes negative.
   */
  async settlePendingPayment(
    id: string,
    input: {
      paidAmount: number;
      method?: PaymentMethod;
      paidAt?: any;
      notes?: string;
      concept?: string;
    }
  ): Promise<void> {
    const docRef = doc(this.firestore, `payments/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payment not found');
    const payment = snap.data() as Payment;

    const settlement = applySettlement(payment, input.paidAmount);

    // Keep the seeded concept ("Señal reserva") unless the operator typed a
    // real one. A concept that just echoes the payment type is what callers
    // send when the field was left empty — same convention as PaymentConceptPipe.
    const typedConcept = input.concept?.trim();
    const concept =
      typedConcept && typedConcept !== payment.type ? typedConcept : payment.concept;

    await updateDoc(docRef, this.cleanData({
      ...settlement,
      method: input.method || payment.method,
      // The seeded rows are `system`; once a human collects against them the
      // movement is manual.
      source: 'manual' as PaymentSource,
      paidAt: input.paidAt || { seconds: Date.now() / 1000 },
      concept,
      notes: input.notes,
      updatedAt: { seconds: Date.now() / 1000 }
    }));

    if (payment.reservationId) {
      await this.recalculateReservationPaymentSummary(payment.reservationId);
    }
  }

  /**
   * Cancel the payments of a reservation that never collected a cent.
   *
   * Called when a reservation is closed or cancelled, so it cannot end up
   * `closed` while its payment list still advertises pending money. Rows with
   * a partial collection are left alone: cancelling them would drop their
   * `paidAmount` from the summary, which filters out `cancelled`.
   *
   * Returns how many rows were cancelled.
   */
  async cancelUncollectedPayments(reservationId: string): Promise<number> {
    const payments = await this.fetchReservationPayments(reservationId);
    const stale = payments.filter(p =>
      p.id &&
      p.status === 'pending' &&
      (p.paidAmount || 0) === 0 &&
      // ⚠️ Un cargo extra NO es una fila sembrada que se quedó sin usar: nace
      // de un hecho —un daño, kilómetros de más, el depósito sin llenar— y es
      // deuda del cliente. Cancelarlo al cerrar hacía desaparecer el dinero
      // igual que marcarlo pagado sin cobrarlo, solo que con otra etiqueta.
      // Se nota sobre todo con la fianza a 0, donde nada los cubre.
      !EXTRA_TYPES.includes(p.type)
    );
    if (stale.length === 0) return 0;

    for (const payment of stale) {
      await updateDoc(doc(this.firestore, `payments/${payment.id}`), {
        status: 'cancelled',
        updatedAt: { seconds: Date.now() / 1000 }
      });
    }

    await this.recalculateReservationPaymentSummary(reservationId);
    return stale.length;
  }

  /**
   * Convenience: create a free payment with a minimal interface.
   * Always sets `isFreePayment: true` and `type: 'free_payment'`.
   */
  async createFreePayment(input: {
    amount: number;
    paidAmount: number;
    concept: string;
    payerName?: string;
    payerEmail?: string;
    payerPhone?: string;
    method?: PaymentMethod;
    notes?: string;
  }): Promise<string> {
    return this.createManualPayment({
      isFreePayment: true,
      type: 'free_payment',
      method: input.method || 'other',
      amount: input.amount,
      paidAmount: input.paidAmount,
      concept: input.concept,
      payerName: input.payerName,
      payerEmail: input.payerEmail,
      payerPhone: input.payerPhone,
      notes: input.notes
    });
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
    // Recalc summary if the payment is linked to a reservation.
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const payment = snap.data() as Payment;
      if (payment.reservationId) {
        await this.recalculateReservationPaymentSummary(payment.reservationId);
      }
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

    if (payment.reservationId) {
      await this.recalculateReservationPaymentSummary(payment.reservationId);
    }
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
    if (payment.reservationId) {
      await this.recalculateReservationPaymentSummary(payment.reservationId);
    }
  }

  /**
   * Cancel a payment (mark as cancelled, doesn't delete).
   */
  async cancelPayment(id: string): Promise<void> {
    // Defensa en profundidad: la UI esconde el botón y esto rechaza la
    // llamada igualmente. Cualquier camino que no pase por ese botón se
    // saltaría el permiso.
    if (!this.permissions.can('cancelReservations')) {
      throw new Error('permissions.notAllowed');
    }
    const docRef = doc(this.firestore, `payments/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const payment = snap.data() as Payment;
    await updateDoc(docRef, this.cleanData({
      status: 'cancelled',
      updatedAt: { seconds: Date.now() / 1000 }
    }));
    if (payment.reservationId) {
      await this.recalculateReservationPaymentSummary(payment.reservationId);
    }
  }

  /**
   * Lo que queda de fianza por mover en esta reserva.
   *
   * Se deriva de `payments`, que es la única fuente de verdad del dinero: la
   * copia guardada en la reserva se queda vieja y **responde `0` cuando está
   * desfasada**, que aquí bloquearía una devolución legítima.
   */
  private async depositAvailableFor(reservationId: string): Promise<number> {
    const pagos = await firstValueFrom(this.getPaymentsByReservation(reservationId));
    return depositAvailable(collectedTotalsOf(pagos));
  }

  /**
   * Devolver la fianza, entera o en parte.
   *
   * ⚠️ **No comprobaba nada.** Escribía el importe que le dieran, así que se
   * podía devolver más fianza de la cobrada —regalar dinero— y, peor, devolver
   * el total **y** retener el total, que son dos operaciones que por separado
   * parecen bien y juntas entregan el doble de lo que el cliente depositó.
   *
   * El descuadre no salía por ninguna parte: una devolución no cuenta como
   * ingreso en Informes, así que lo único que pasaba es que faltaba dinero.
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

    const problema = depositMovementProblem(amount, await this.depositAvailableFor(reservationId));
    if (problema) throw new Error(problema);

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
   * Las filas de pago que le corresponden a una reserva recién creada, **como
   * datos**: una por concepto esperado (señal, resto, fianza).
   *
   * Devuelve en vez de escribir para que quien llama decida cómo persistirlas.
   * Es lo que permite que la reserva y sus pagos entren en Firestore **en una
   * sola escritura atómica**: antes eran hasta cuatro sueltas, y si fallaba la
   * segunda quedaba una reserva sin filas de cobro mientras la pantalla decía
   * que no se había podido crear. El operador la creaba otra vez y tenía dos.
   *
   * Un concepto a 0 no genera fila: una fianza exenta no es una fianza
   * pendiente de 0 €, es que no hay fianza.
   */
  buildInitialPayments(reservationId: string, reservation: Reservation): any[] {
    // La construcción vive en el util, donde se puede probar sin Firestore;
    // aquí solo se limpia antes de escribir.
    return buildInitialPaymentRows(reservationId, reservation).map(row => this.cleanData(row));
  }

  /**
   * Siembra las filas de pago de una reserva ya creada.
   *
   * Se conserva para quien cree una reserva fuera del camino atómico; el
   * asistente usa `buildInitialPayments` dentro de su propio `writeBatch`.
   */
  async createInitialPaymentsForReservation(
    reservationId: string,
    reservation: Reservation
  ): Promise<void> {
    for (const row of this.buildInitialPayments(reservationId, reservation)) {
      await addDoc(this.paymentsRef, row);
    }
  }

  /**
   * Recalculate the payment summary on the reservation from its payments.
   */
  async recalculateReservationPaymentSummary(reservationId: string): Promise<void> {
    const payments = await this.fetchReservationPayments(reservationId);

    const reservation = await this.getReservationData(reservationId);
    if (!reservation) return;

    const summary = calculateReservationPaymentSummary(payments, reservation);

    // Step 2 of the flow: a fully collected signal confirms the reservation.
    // The decision is the workflow util's, not this service's — and it only
    // ever moves `reserved` forward.
    const initialPaid =
      summary.initialPaymentRequired > 0 &&
      summary.initialPaymentPaid >= summary.initialPaymentRequired;
    const nextStatus = reservationStatusAfterPayment(
      reservation.reservationStatus,
      initialPaid
    );

    // Also update the legacy fields to keep backward compatibility
    const reservationRef = doc(this.firestore, `reservations/${reservationId}`);
    await updateDoc(reservationRef, this.cleanData({
      paymentSummary: summary,
      paymentStatus: summary.paymentStatus,
      ...(nextStatus ? { reservationStatus: nextStatus } : {}),
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

  /** Payments of a reservation, oldest first. Plain read, not a live query. */
  private async fetchReservationPayments(reservationId: string): Promise<Payment[]> {
    const q = query(
      this.paymentsRef,
      where('reservationId', '==', reservationId),
      orderBy('createdAt', 'asc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
  }

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
    // Nothing to ask for and nothing collected: the deposit was waived, not
    // left pending. Falling through to 'pending' would relabel a deliberate
    // decision as an outstanding debt every time payments were recalculated.
    if ((summary.depositRequired || 0) === 0 && (summary.depositPaid || 0) === 0) return 'waived';
    return 'pending';
  }
}