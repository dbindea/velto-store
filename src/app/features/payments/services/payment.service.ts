import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  CollectionReference,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  collectionData,
  docData,
  getDocs,
  query,
  orderBy,
  where,
  WriteBatch
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, firstValueFrom, from } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  Payment,
  PaymentType,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
  PAYMENT_TYPE_LABELS
} from '@shared/models/payment.model';
import { Reservation } from '@shared/models/reservation.model';
import { amountProblem, canEditAmount } from '@shared/utils/payment-edit.util';
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

  /**
   * El libro de cobros **escuchando**. Es la pantalla que el operador deja
   * abierta mientras el cliente paga con tarjeta, así que una lectura única la
   * deja mintiendo: quien da el cobro por bueno es el webhook de Redsys, no
   * esta pantalla, y sin escuchar la fila se queda en «Pendiente» hasta que
   * alguien pulsa F5. Ver la nota larga de `watchPaymentsByReservation`.
   */
  watchPayments(): Observable<Payment[]> {
    const q = query(this.paymentsRef, orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<Payment[]>;
  }

  getPaymentById(id: string): Observable<Payment | null> {
    const docRef = doc(this.firestore, `payments/${id}`);
    return from(getDoc(docRef)).pipe(
      map(snap => snap.exists() ? { id: snap.id, ...snap.data() } as Payment : null)
    );
  }

  /**
   * El mismo pago, **escuchando**. Es el caso más agudo de los tres: aquí es
   * donde el operador genera el enlace de Redsys y se queda mirando la ficha
   * mientras el cliente paga delante de él.
   *
   * ⚠️ `docData` emite `undefined` cuando el documento no existe —no lanza—, y
   * eso incluye **el pago que se acaba de borrar estando abierto**. Se traduce
   * a `null` para que el componente lo trate igual que un id inventado.
   */
  watchPaymentById(id: string): Observable<Payment | null> {
    const docRef = doc(this.firestore, `payments/${id}`);
    return (docData(docRef, { idField: 'id' }) as Observable<Payment | undefined>).pipe(
      map(data => data ?? null)
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

  /**
   * Los mismos pagos, pero **escuchando**: se vuelven a emitir solos cuando algo
   * los cambia desde fuera.
   *
   * ⚠️ **Quien los cambia desde fuera es el WEBHOOK de Redsys**, y ese es todo
   * el motivo de que esto exista. El operador cobra con tarjeta, el cliente paga
   * en la pasarela y quien da el cobro por bueno es el aviso que Redsys manda al
   * backend — no esta pantalla. Con una lectura única, la fila se quedaba en
   * «Pendiente» hasta que alguien pulsaba F5, y quien acaba de ver pagar al
   * cliente delante no entiende por qué la aplicación dice que no.
   *
   * ⚠️ **Es un método APARTE y no el de arriba convertido.** Un stream vivo no
   * termina nunca, y quien espera a que **termine** se queda colgado sin decir
   * nada: `.toPromise()`, `lastValueFrom()` y —el caso que más duele— un
   * `forkJoin`, que no emite hasta que todas sus fuentes han terminado. Es lo
   * que documenta `inspection.service.ts` sobre el contrato, que por eso lleva
   * `.pipe(first())`. (`firstValueFrom` sí resuelve con la primera emisión: ese
   * es el uso del de arriba para la fecha de operación de una factura, y no
   * cuelga. Lo que deja es un oyente abierto para leer una vez.) El nombre lo
   * avisa: `watch…` escucha, `get…` lee una vez.
   *
   * ⚠️ **Quien se suscriba tiene que desengancharse.** Sin
   * `takeUntilDestroyed()`, la suscripción sobrevive a la pantalla y sigue
   * escribiendo en un componente que ya no existe.
   */
  watchPaymentsByReservation(reservationId: string): Observable<Payment[]> {
    const q = query(
      this.paymentsRef,
      where('reservationId', '==', reservationId),
      orderBy('createdAt', 'asc')
    );
    return collectionData(q, { idField: 'id' }) as Observable<Payment[]>;
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
   * Corrige el importe y el concepto de un cobro que aún no se ha cobrado del
   * todo. Es para el importe mal tecleado: sin esto, la única salida era
   * cancelar la fila y crear otra, dejando dos apuntes donde había uno.
   *
   * Sustituye a un `updatePayment(id, data: Partial<Payment>)` que existía
   * desde el principio, **que no llamaba nadie** y que aceptaba cualquier campo
   * del documento: habría dejado poner `status: 'paid'` a mano sobre un cobro
   * que nunca entró, o mover el `paidAmount` sin que hubiera pasado dinero.
   *
   * ⚠️ **No toca `paidAmount` ni `paidAt`.** Corregir lo que se pide no es
   * cobrar: lo que ya entró se queda como está, y el estado se recalcula a
   * partir de los dos. Con 20 € cobrados de 50 corregidos a 35, el pago queda
   * `partial` con 15 € pendientes.
   */
  async editPendingPayment(
    id: string,
    changes: { amount: number; concept?: string; notes?: string }
  ): Promise<void> {
    const docRef = doc(this.firestore, `payments/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('payments.edit.denied.notFound');
    const payment = { id: snap.id, ...snap.data() } as Payment;

    // Defensa en profundidad: la pantalla ya lo impide, y esto rechaza la
    // llamada venga por donde venga.
    const decision = canEditAmount(payment);
    if (!decision.ok) throw new Error(decision.reason);

    const problema = amountProblem(changes.amount, payment);
    if (problema) throw new Error(problema);

    const importe = roundMoney(Number(changes.amount));
    const cobrado = roundMoney(Number(payment.paidAmount) || 0);

    await updateDoc(
      docRef,
      this.cleanData({
        amount: importe,
        pendingAmount: calculatePendingAmount(importe, cobrado),
        status: calculatePaymentStatus(importe, cobrado),
        concept: changes.concept?.trim() || payment.concept,
        notes: changes.notes?.trim() || payment.notes,
        updatedAt: { seconds: Date.now() / 1000 }
      })
    );

    if (payment.reservationId) {
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

    /**
     * ⚠️ **Un cobro que ya entró no se cancela, y esto NO lo comprobaba.**
     * El resumen de la reserva descarta lo cancelado
     * (`payments.filter(p => p.status !== 'cancelled')`), así que cancelar un
     * pago cobrado borraba de los libros dinero que estaba en el banco: la
     * reserva pasaba a decir que ese cobro no ocurrió. La pantalla escondía el
     * botón —`canCancel()` solo deja `pending` y `partial`—, pero eso es la
     * interfaz, no la seguridad.
     *
     * Lo que corresponde con dinero ya cobrado es devolverlo, que deja rastro
     * de las dos cosas: que entró y que salió.
     */
    if (payment.status === 'paid' || payment.status === 'refunded') {
      throw new Error('payments.errors.cancelCollected');
    }
    if ((Number(payment.paidAmount) || 0) > 0) {
      throw new Error('payments.errors.cancelCollected');
    }
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
   * Pone al día las filas **pendientes** de una reserva que se acaba de editar,
   * dentro del `writeBatch` que ya trae quien llama.
   *
   * ⚠️ **Recibe el batch en vez de escribir por su cuenta, y es lo que hace que
   * esto sea correcto.** La reserva nueva y sus filas de cobro tienen que
   * entrar juntas o no entrar: escritas por separado, un fallo entre medias
   * deja una reserva que dice valer 300 € y unas filas que piden 250 — y nadie
   * se entera, porque las dos cifras se enseñan en pantallas distintas. Es la
   * misma razón por la que crear una reserva es una sola escritura.
   *
   * Tres reglas, y las tres tienen su motivo:
   *
   * ⚠️ **Lo ya cobrado no se toca.** Una fila `paid` o `partial` documenta
   * dinero que entró de verdad; reescribirle el importe haría que el recibo que
   * tiene el cliente y la aplicación dijeran cosas distintas. Solo se mueven
   * las filas que siguen enteras por cobrar.
   *
   * ⚠️ **Un concepto que baja a 0 se CANCELA, no se deja en 0.** Una fila
   * pendiente de 0 € es una fila incobrable: no se puede marcar como cobrada
   * porque no hay nada que cobrar, y mientras exista la reserva no se puede dar
   * por pagada. Es el mismo motivo por el que la creación no siembra filas de
   * conceptos a 0.
   *
   * ⚠️ **Y un concepto que sube desde 0 necesita fila nueva**, porque al crear
   * la reserva no se sembró ninguna. Sin esto, subir la señal de 0 a 50 € no
   * dejaría nada que cobrar y el dinero no se pediría nunca.
   */
  queueRepricedRows(
    batch: WriteBatch,
    payments: Payment[],
    amounts: { initialRequired: number; remainingRequired: number; depositRequired?: number }
  ): void {
    const conceptos: Array<{ type: PaymentType; required: number | undefined }> = [
      { type: 'initial_payment', required: amounts.initialRequired },
      { type: 'remaining_payment', required: amounts.remainingRequired },
      { type: 'deposit', required: amounts.depositRequired }
    ];

    for (const { type, required } of conceptos) {
      if (required === undefined) continue;
      const objetivo = roundMoney(required);
      const abiertas = payments.filter(
        (p) => p.type === type && (p.status === 'pending' || p.status === 'failed')
      );

      if (!abiertas.length) {
        if (objetivo <= 0) continue;
        const ref = doc(collection(this.firestore, 'payments'));
        batch.set(ref, this.cleanData(this.buildRepricedRow(payments, type, objetivo)));
        continue;
      }

      // Con varias filas abiertas del mismo concepto —puede pasar si un cobro
      // falló y se sembró otro—, la primera se lleva el importe y las demás se
      // cancelan: repartirlo entre todas dejaría cobros sueltos sin sentido.
      const [principal, ...sobrantes] = abiertas;
      for (const extra of sobrantes) {
        batch.update(doc(this.firestore, `payments/${extra.id}`), {
          status: 'cancelled',
          pendingAmount: 0,
          updatedAt: { seconds: Date.now() / 1000 }
        });
      }

      const ref = doc(this.firestore, `payments/${principal.id}`);
      if (objetivo <= 0) {
        batch.update(ref, {
          status: 'cancelled',
          amount: 0,
          pendingAmount: 0,
          updatedAt: { seconds: Date.now() / 1000 }
        });
      } else {
        batch.update(ref, {
          amount: objetivo,
          pendingAmount: calculatePendingAmount(objetivo, Number(principal.paidAmount) || 0),
          status: calculatePaymentStatus(objetivo, Number(principal.paidAmount) || 0),
          updatedAt: { seconds: Date.now() / 1000 }
        });
      }
    }
  }

  /**
   * Una fila nueva para un concepto que antes valía 0, copiando la reserva, el
   * cliente y el vehículo de cualquier otra fila de la misma reserva: son datos
   * que ya están congelados ahí y volver a buscarlos sería una lectura de más
   * que además podría traer algo distinto.
   */
  private buildRepricedRow(payments: Payment[], type: PaymentType, amount: number): Payment {
    const modelo = payments[0];
    return {
      reservationId: modelo?.reservationId,
      clientId: modelo?.clientId,
      vehicleId: modelo?.vehicleId,
      isFreePayment: false,
      reservationSnapshot: modelo?.reservationSnapshot,
      clientSnapshot: modelo?.clientSnapshot,
      vehicleSnapshot: modelo?.vehicleSnapshot,
      type,
      direction: 'income',
      method: 'cash',
      source: 'manual',
      status: 'pending',
      amount,
      paidAmount: 0,
      pendingAmount: amount,
      currency: 'EUR',
      concept: PAYMENT_TYPE_LABELS[type],
      internalReference: generateInternalReference('PMT'),
      createdAt: { seconds: Date.now() / 1000 }
    } as Payment;
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