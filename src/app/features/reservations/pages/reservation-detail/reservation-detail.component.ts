import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { PaymentConceptPipe } from '@shared/pipes/payment-concept.pipe';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { PaymentService } from '@features/payments/services/payment.service';
import { InspectionService } from '@features/inspections/services/inspection.service';
import { ContractService } from '@features/contracts/services/contract.service';
import { Contract, CONTRACT_STATUS_LABELS as CONTRACT_DOC_STATUS_LABELS, CONTRACT_STATUS_COLORS as CONTRACT_DOC_STATUS_COLORS } from '@shared/models/contract.model';
import {
  Reservation,
  RESERVATION_STATUS_LABELS,
  RESERVATION_PAYMENT_STATUS_LABELS,
  RESERVATION_CONTRACT_STATUS_LABELS,
  RESERVATION_DEPOSIT_STATUS_LABELS
} from '@shared/models/reservation.model';
import {
  Workflow,
  WorkflowDecision,
  WorkflowContext,
  canCancelReservation,
  ExceptionableAction,
  reasonOf
} from '@shared/utils/reservation-workflow.util';
import {
  Payment,
  PaymentMethod,
  PaymentType,
  PAYMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_METHOD_ICONS
} from '@shared/models/payment.model';
import { Inspection, INSPECTION_STATUS_LABELS } from '@shared/models/inspection.model';
import { toDate } from '@shared/utils/reservation-date.util';
import { vatBreakdownOf, VatBreakdown } from '@shared/utils/pricing.util';
import {
  collectedTotalsOf,
  calculateReservationPaymentSummary
} from '@shared/utils/payment-summary.util';
import { ReservationDocumentService } from '@features/reservations/services/reservation-document.service';
import { RedsysPaymentService } from '@features/payments/services/redsys-payment.service';
import { FUEL_TYPE_LABELS, TRANSMISSION_LABELS } from '@shared/models/vehicle.model';
import { TranslateService } from '@core/i18n/translate.service';
import { ReservationTimelineComponent } from '@shared/components/reservation-timeline/reservation-timeline.component';
import { ReservationNotesPanelComponent } from '@features/reservations/components/reservation-notes-panel/reservation-notes-panel.component';
import { ReservationNote } from '@shared/models/reservation.model';

@Component({
  selector: 'app-reservation-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    PaymentConceptPipe,
    ReservationTimelineComponent,
    ReservationNotesPanelComponent
  ],
  templateUrl: './reservation-detail.component.html',
  styleUrl: './reservation-detail.component.scss'
})
export class ReservationDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private reservationService = inject(ReservationService);
  private paymentService = inject(PaymentService);
  private inspectionService = inject(InspectionService);
  private contractService = inject(ContractService);
  private documentService = inject(ReservationDocumentService);
  private redsysService = inject(RedsysPaymentService);
  private translateService = inject(TranslateService);
  private destroyRef = inject(DestroyRef);

  /** Id del pago cuya pasarela se está pidiendo, para no permitir dos clics. */
  readonly chargingPaymentId = signal<string | null>(null);

  // === Excepciones de workflow (N-7) ===
  /** Paso que se está saltando ahora mismo; `null` con el diálogo cerrado. */
  readonly skippingAction = signal<ExceptionableAction | null>(null);
  /** Motivo tecleado por el operador. Obligatorio. */
  skipReason = '';
  skipError = '';
  savingSkip = false;

  reservation: Reservation | null = null;
  payments: Payment[] = [];
  pickupInspection: Inspection | null = null;
  returnInspection: Inspection | null = null;
  contract: Contract | null = null;
  loading = true;
  generatingContract = false;
  creatingSigningLink = false;
  sendingEmail = false;
  showEmailForm = false;
  emailRecipient = '';
  emailError = '';
  copyToast = false;
  private copyToastTimer: any;
  loadingPayments = false;
  // Booking confirmation (N-2). Informative document: generating it writes
  // nothing back to the reservation.
  generatingBookingConfirmation = false;
  bookingConfirmationUrl = '';
  bookingConfirmationStorageUrl = '';
  bookingConfirmationError = '';
  cancelling = false;
  closingReservation = false;
  savingPayment = false;
  savingDeposit = false;

  // Forms
  showPaymentForm = false;
  showDepositForm = false;

  newPayment: {
    type: PaymentType;
    method: PaymentMethod;
    amount: number;
    paidAmount: number;
    concept: string;
    notes?: string;
  } = { type: 'initial_payment', method: 'cash', amount: 0, paidAmount: 0, concept: '' };

  depositForm: {
    type: 'refund' | 'retain';
    amount: number;
    method: PaymentMethod;
    reason?: string;
  } = { type: 'refund', amount: 0, method: 'cash' };

  PAYMENT_TYPE_LABELS = PAYMENT_TYPE_LABELS;
  PAYMENT_METHOD_LABELS = PAYMENT_METHOD_LABELS;
  PAYMENT_STATUS_COLORS = PAYMENT_STATUS_COLORS;
  PAYMENT_METHOD_ICONS = PAYMENT_METHOD_ICONS;

  paymentTypeOptions: PaymentType[] = [
    'initial_payment', 'remaining_payment', 'rental_payment', 'deposit'
  ];
  methodOptions: PaymentMethod[] = ['cash', 'bank_transfer', 'bizum', 'physical_pos', 'redsys', 'manual_card', 'other'];

  /**
   * Tax split of the rental, at the rate AND in the direction frozen on the
   * reservation. No total ever moves.
   */
  get vat(): VatBreakdown {
    // Reads the direction frozen on the reservation, not today's default: a
    // reservation priced when tariffs were VAT-inclusive still splits that way.
    return vatBreakdownOf(this.reservation?.pricingSnapshot ?? {});
  }

  /** The rate as a percentage, for the "IVA (21 %)" label. */
  get vatPercent(): number {
    return Math.round(this.vat.rate * 100);
  }

  /**
   * The booking confirmation only makes sense once the signal is in: before
   * that, a document titled "reserva confirmada" would be claiming something
   * that has not happened. The Cloud Function refuses it too.
   */
  get canIssueBookingConfirmation(): boolean {
    const status = this.reservation?.reservationStatus;
    return status === 'confirmed' || status === 'delivered' || status === 'returned' || status === 'closed';
  }

  /**
   * Generates the booking confirmation and copies its link, ready to paste
   * into WhatsApp.
   *
   * This does NOT touch the reservation: it is an informative document, not a
   * step of the workflow. Handing the customer this PDF must not bring the
   * pickup any closer — only a signed contract does that.
   */
  async generateBookingConfirmation(): Promise<void> {
    if (!this.reservation?.id) return;

    this.generatingBookingConfirmation = true;
    this.bookingConfirmationError = '';
    try {
      const response = await this.documentService.generateBookingConfirmation(this.reservation.id);
      // Short link for the customer, Storage URL for the operator's own view.
      this.bookingConfirmationUrl = response.pdfUrl;
      this.bookingConfirmationStorageUrl = response.storageUrl;
      await this.copyBookingConfirmationLink();
    } catch (error) {
      console.error('Error generating booking confirmation:', error);
      this.bookingConfirmationError = 'reservations.bookingConfirmation.error';
    } finally {
      this.generatingBookingConfirmation = false;
    }
  }

  async copyBookingConfirmationLink(): Promise<void> {
    if (!this.bookingConfirmationUrl) return;
    const copied = await this.documentService.copyToClipboard(this.bookingConfirmationUrl);
    if (copied) this.showCopyToast();
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadReservation(id);
    } else {
      this.router.navigate(['/reservations']);
    }
  }

  /**
   * Live subscription: the reservation document changes while this screen is
   * open (the customer signs, an inspection completes). The related
   * collections are loaded once, on the first emission — re-running them on
   * every field change would refetch payments and inspections needlessly.
   */
  loadReservation(id: string): void {
    this.loading = true;
    let relatedLoaded = false;

    this.reservationService
      .getReservationById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reservation: Reservation | null) => {
          if (!reservation) {
            this.router.navigate(['/reservations']);
            return;
          }
          this.reservation = reservation;
          this.loading = false;

          if (!relatedLoaded) {
            relatedLoaded = true;
            this.loadPayments(id);
            this.loadInspections(id);
            this.loadContract(id);
          }
        },
        error: (error) => {
          console.error('Error loading reservation:', error);
          this.loading = false;
        }
      });
  }

  /**
   * Live subscription: the contract status changes underneath this screen when
   * the operator issues a signing link and, more importantly, when the customer
   * signs on their own phone. `takeUntilDestroyed` closes the Firestore
   * listener when the view goes away.
   */
  loadContract(reservationId: string): void {
    this.contractService
      .getContractByReservation(reservationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c: Contract | null) => {
          this.contract = c;
          if (c && !this.emailRecipient) {
            this.emailRecipient = c.clientSnapshot?.email || '';
          }
          // `workflowCtx` is a getter, so the guards and the timeline pick the
          // new status up on the next change detection pass by themselves.
        },
        error: (err) => console.error('Error loading contract:', err)
      });
  }

  loadInspections(reservationId: string): void {
    this.inspectionService.getInspectionsByReservation(reservationId).subscribe({
      next: (inspections) => {
        this.pickupInspection = inspections.find(i => i.type === 'pickup') || null;
        this.returnInspection = inspections.find(i => i.type === 'return') || null;
      },
      error: (error) => {
        console.error('Error loading inspections:', error);
      }
    });
  }

  loadPayments(reservationId: string): void {
    this.loadingPayments = true;
    this.paymentService.getPaymentsByReservation(reservationId).subscribe({
      next: (payments) => {
        this.payments = payments;
        this.loadingPayments = false;
        void this.reconcileAfterExternalPayment(reservationId);
      },
      error: (error) => {
        console.error('Error loading payments:', error);
        this.loadingPayments = false;
      }
    });
  }

  /**
   * Vuelve a cuadrar la reserva cuando un pago se ha cobrado **fuera de esta
   * pantalla**, que hoy significa: por Redsys.
   *
   * El webhook es quien da un pago por bueno —es la única confirmación que
   * vale— pero solo escribe en la colección `payments`. Los campos que la
   * reserva lleva embebidos (`initialPayment`, `paymentStatus`, y la
   * transición a `confirmed`) los calcula el frontend, así que sin esto se
   * cobraba la señal con tarjeta y la reserva seguía diciendo «Reservado» y
   * «pendiente» con el dinero ya en la cuenta.
   *
   * Se compara contra los pagos reales y solo se escribe si difieren, así que
   * converge y para: una visita normal no genera escrituras.
   *
   * ⚠️ Esto cuadra la reserva **cuando alguien la abre**. Es suficiente
   * mientras el operador esté delante del cobro, que es el caso de hoy. El día
   * que un cliente pague solo desde la web (N-5), el cálculo tendrá que vivir
   * en la Cloud Function: nadie garantiza que alguien abra la pantalla.
   */
  private async reconcileAfterExternalPayment(reservationId: string): Promise<void> {
    if (!this.reservation) return;

    // Se compara contra el resumen recalculado, no contra tres importes
    // sueltos: así entra cualquier divergencia, incluida la del estado de pago
    // cuando quedan cargos extra pendientes.
    const fresco = calculateReservationPaymentSummary(this.payments, this.reservation);
    const guardado = this.reservation.paymentSummary;

    // Céntimo de tolerancia: el resumen redondea y no queremos reescribir en
    // bucle por un error de coma flotante.
    const difiere = (a?: number, b?: number) => Math.abs((a || 0) - (b || 0)) > 0.005;
    const desincronizada =
      !guardado ||
      fresco.paymentStatus !== this.reservation.paymentStatus ||
      difiere(fresco.initialPaymentPaid, guardado.initialPaymentPaid) ||
      difiere(fresco.remainingPaymentPaid, guardado.remainingPaymentPaid) ||
      difiere(fresco.depositPaid, guardado.depositPaid) ||
      difiere(fresco.totalPending, guardado.totalPending);
    if (!desincronizada) return;

    try {
      // No hace falta recargar: la reserva llega por una suscripción viva, así
      // que la propia escritura la refresca en pantalla.
      await this.paymentService.syncReservationPaymentStatus(reservationId);
    } catch (error) {
      console.error('Error reconciling reservation after external payment:', error);
    }
  }

  goBack(): void {
    this.router.navigate(['/reservations']);
  }

  /**
   * Refresh the local reservation snapshot when a new internal note
   * is added through the notes panel.  We do NOT re-fetch the
   * entire reservation (lightweight) — just patch the array so the
   * panel re-renders with the new entry.
   */
  showCancelModal = false;

  openCancelModal(): void {
    this.showCancelModal = true;
  }

  closeCancelModal(): void {
    this.showCancelModal = false;
  }

  async cancelReservation(): Promise<void> {
    if (!this.reservation?.id) return;

    this.cancelling = true;
    try {
      await this.reservationService.cancelReservation(this.reservation.id);
      this.reservation.reservationStatus = 'cancelled';
      this.showCancelModal = false;
    } catch (error) {
      console.error('Error cancelling reservation:', error);
      alert(this.t('reservations.errors.cancel', ''));
    } finally {
      this.cancelling = false;
    }
  }

  getPickupDate(): Date {
    return this.reservation ? toDate(this.reservation.pickupDateTime) : new Date();
  }

  async closeReservation(): Promise<void> {
    if (!this.reservation?.id) return;
    this.closingReservation = true;
    try {
      await this.reservationService.closeReservation(this.reservation.id);
      if (this.reservation) {
        this.reservation.reservationStatus = 'closed';
      }
    } catch (error: any) {
      console.error('Error closing reservation:', error);
      const reason = error?.message || 'workflow.cannotClose';
      alert(reason);
    } finally {
      this.closingReservation = false;
    }
  }

  getReturnDate(): Date {
    return this.reservation ? toDate(this.reservation.returnDateTime) : new Date();
  }

  // The *_LABELS maps hold i18n keys, and the template calls these getters
  // without a `| translate`, so they resolve the key here.
  getStatusLabel(status: string): string {
    return this.t(RESERVATION_STATUS_LABELS[status as keyof typeof RESERVATION_STATUS_LABELS], status);
  }

  getPaymentLabel(status: string): string {
    return this.t(
      RESERVATION_PAYMENT_STATUS_LABELS[status as keyof typeof RESERVATION_PAYMENT_STATUS_LABELS],
      status
    );
  }

  /**
   * Estado de **un pago** (`pending`, `paid`, `cancelled`, `refunded`…).
   *
   * Ojo con el mapa: esto usaba `RESERVATION_PAYMENT_STATUS_LABELS`, que es el
   * estado de pago **de la reserva** y solo conoce `pending`, `partial` y
   * `paid`. Un pago `cancelled` no estaba ahí, así que caía al respaldo y se
   * pintaba **«cancelled» en crudo, en inglés** — visible al cancelar una
   * reserva. La traducción existía desde siempre en `payments.status.*`.
   */
  getPaymentStatusLabel(status: string): string {
    return this.t(
      PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS],
      status
    );
  }

  getDepositStatusLabel(status: string): string {
    return this.t(
      RESERVATION_DEPOSIT_STATUS_LABELS[status as keyof typeof RESERVATION_DEPOSIT_STATUS_LABELS],
      status
    );
  }

  getContractLabel(status: string): string {
    return this.t(
      RESERVATION_CONTRACT_STATUS_LABELS[status as keyof typeof RESERVATION_CONTRACT_STATUS_LABELS],
      status
    );
  }

  /** Resolve an i18n key, falling back to the raw value for unknown states. */
  private t(key: string | undefined, fallback: string): string {
    return key ? this.translateService.translate(key) : fallback;
  }

  getStatusClass(status: string): string {
    const statusClasses: Record<string, string> = {
      reserved: 'status-reserved',
      confirmed: 'status-confirmed',
      delivered: 'status-delivered',
      returned: 'status-returned',
      closed: 'status-closed',
      cancelled: 'status-cancelled'
    };
    return statusClasses[status] || '';
  }

  getPaymentStatusClass(status: string): string {
    const statusClasses: Record<string, string> = {
      pending: 'payment-pending',
      partial: 'payment-partial',
      paid: 'payment-paid',
      refunded: 'payment-refunded'
    };
    return statusClasses[status] || '';
  }

  getDepositStatusClass(status: string): string {
    const statusClasses: Record<string, string> = {
      pending: 'deposit-pending',
      paid: 'deposit-paid',
      partial_returned: 'deposit-partial',
      returned: 'deposit-returned',
      retained: 'deposit-retained'
    };
    return statusClasses[status] || '';
  }

  // `canCancel()` vivía aquí y copiaba la regla a mano: solo dejaba cancelar en
  // `reserved`, mientras `canCancelReservation()` —que delega en el workflow,
  // la única autoridad— también lo permite en `confirmed`. Las dos reglas
  // convivían en este mismo fichero, así que una reserva con la señal cobrada
  // mostraba un botón «Cancelar» **muerto y sin explicar por qué**: el `title`
  // salía vacío porque el workflow no tenía nada que objetar.

  getFuelLabel(fuel: string): string {
    return this.t(FUEL_TYPE_LABELS[fuel as keyof typeof FUEL_TYPE_LABELS], fuel);
  }

  getTransmissionLabel(trans: string): string {
    return this.t(TRANSMISSION_LABELS[trans as keyof typeof TRANSMISSION_LABELS], trans);
  }

  // === Payment methods ===

  async registerPayment(): Promise<void> {
    if (!this.reservation?.id) return;
    if (this.newPayment.amount <= 0 && this.newPayment.paidAmount <= 0) {
      alert(this.translateService.translate('payments.errors.invalidAmount'));
      return;
    }
    this.savingPayment = true;
    try {
      // `registerReservationPayment` settles the pending row seeded at
      // reservation time instead of adding a duplicate next to it.
      await this.paymentService.registerReservationPayment({
        reservationId: this.reservation.id,
        clientId: this.reservation.clientId,
        vehicleId: this.reservation.vehicleId,
        type: this.newPayment.type,
        method: this.newPayment.method,
        amount: this.newPayment.amount,
        paidAmount: this.newPayment.paidAmount,
        concept: this.newPayment.concept || this.newPayment.type,
        notes: this.newPayment.notes,
        source: 'manual',
        reservationSnapshot: {
          pickupDateTime: this.reservation.pickupDateTime,
          returnDateTime: this.reservation.returnDateTime,
          totalDays: this.reservation.totalDays,
          finalPrice: this.reservation.pricingSnapshot?.finalPrice
        },
        clientSnapshot: this.reservation.clientSnapshot,
        vehicleSnapshot: this.reservation.vehicleSnapshot
      });
      this.loadPayments(this.reservation.id);
      this.loadReservation(this.reservation.id);
      this.showPaymentForm = false;
      this.resetPaymentForm();
    } catch (error) {
      console.error('Error registering payment:', error);
      alert(this.t('reservations.errors.registerPayment', ''));
    } finally {
      this.savingPayment = false;
    }
  }

  async processDeposit(): Promise<void> {
    if (!this.reservation?.id) return;
    this.savingDeposit = true;
    try {
      if (this.depositForm.type === 'refund') {
        await this.paymentService.refundDeposit(
          this.reservation.id,
          this.depositForm.amount,
          this.depositForm.method,
          this.depositForm.reason
        );
      } else {
        await this.paymentService.retainDeposit(
          this.reservation.id,
          this.depositForm.amount,
          this.depositForm.reason || 'Retención fianza'
        );
      }
      this.loadPayments(this.reservation.id);
      this.loadReservation(this.reservation.id);
      this.showDepositForm = false;
      this.depositForm = { type: 'refund', amount: 0, method: 'cash' };
    } catch (error) {
      console.error('Error processing deposit:', error);
      alert(this.t('reservations.errors.processDeposit', ''));
    } finally {
      this.savingDeposit = false;
    }
  }

  resetPaymentForm(): void {
    this.newPayment = {
      type: this.firstPendingPaymentType(),
      method: 'cash',
      amount: 0,
      paidAmount: 0,
      concept: ''
    };
    // Rellena el importe del tipo elegido. Ya funcionaba al cambiar el
    // desplegable a mano; lo que faltaba era abrir en el tipo correcto.
    this.onPaymentTypeChange();
  }

  /**
   * El primer concepto que queda por cobrar, en el orden del alquiler.
   *
   * El formulario abría siempre en «Señal» y a 0 €, aun con la señal cobrada:
   * el operador tenía que elegir el tipo a mano cada vez, y ese es el botón que
   * más se toca al día. Con todo cobrado se queda en el resto, que es lo último
   * que se suele ampliar.
   */
  private firstPendingPaymentType(): PaymentType {
    const pendiente = (type: PaymentType) =>
      this.payments.some(
        (p) => p.type === type && p.status !== 'paid' && p.status !== 'cancelled'
      );

    if (pendiente('initial_payment')) return 'initial_payment';
    if (pendiente('remaining_payment')) return 'remaining_payment';
    if (pendiente('deposit')) return 'deposit';
    return 'remaining_payment';
  }

  /**
   * Prefill the amounts with what is still owed for the selected concept.
   * The screen already knows the figure, and with the settle-the-pending-row
   * model an empty form would otherwise settle a row with 0 €.
   */
  onPaymentTypeChange(): void {
    const outstanding = this.outstandingFor(this.newPayment.type);
    this.newPayment.amount = outstanding;
    this.newPayment.paidAmount = outstanding;
  }

  private outstandingFor(type: PaymentType): number {
    if (!this.reservation) return 0;
    const owed = (required: number, paid: number) =>
      Math.round(Math.max(0, required - paid) * 100) / 100;

    switch (type) {
      case 'initial_payment':
        return owed(this.initialPayment.required, this.initialPayment.paid);
      case 'remaining_payment':
        return owed(this.remainingPayment.required, this.remainingPayment.paid);
      case 'deposit':
        return owed(this.deposit.required, this.deposit.paid);
      case 'rental_payment':
        return owed(
          this.reservation.pricingSnapshot?.finalPrice || 0,
          this.initialPayment.paid + this.remainingPayment.paid
        );
      default:
        return 0;
    }
  }

  togglePaymentForm(): void {
    this.showPaymentForm = !this.showPaymentForm;
    this.showDepositForm = false;
    if (this.showPaymentForm) this.resetPaymentForm();
  }

  toggleDepositForm(type: 'refund' | 'retain'): void {
    if (this.showDepositForm && this.depositForm.type === type) {
      this.showDepositForm = false;
    } else {
      this.showDepositForm = true;
      this.showPaymentForm = false;
      this.depositForm = { type, amount: 0, method: 'cash' };
    }
  }

  viewPayment(paymentId: string | undefined): void {
    if (paymentId) {
      this.router.navigate(['/payments', paymentId]);
    }
  }

  /**
   * Cobra con tarjeta una fila **ya sembrada** (señal, resto o fianza).
   *
   * No crea un pago nuevo: `createRedsysPaymentLink` recibe el id del que ya
   * existe, le adjunta el pedido de Redsys y lo deja en `pending`. Quien lo da
   * por bueno es el webhook, no esta pantalla — por eso aquí no se toca el
   * estado. Si el operador cierra la pasarela sin pagar, la fila se queda
   * pendiente, que es lo correcto.
   *
   * `stopPropagation` porque la fila entera navega al detalle del pago.
   */
  async chargeWithCard(payment: Payment, event: Event): Promise<void> {
    event.stopPropagation();
    if (!payment.id || this.chargingPaymentId()) return;

    this.chargingPaymentId.set(payment.id);
    try {
      const link = await this.redsysService.createRedsysPaymentLink(payment.id);
      this.redsysService.openGateway(link);
    } catch (err: any) {
      alert(
        this.translateService.translate('payments.actions.chargeCardError') +
          (err?.message ? `: ${err.message}` : '')
      );
    } finally {
      this.chargingPaymentId.set(null);
    }
  }

  // === Computed for summary ===

  get initialPayment(): { required: number; paid: number } {
    if (!this.reservation) return { required: 0, paid: 0 };
    return {
      required: this.reservation.initialPayment?.requiredAmount || 0,
      paid: this.reservation.initialPayment?.paidAmount || 0
    };
  }

  get remainingPayment(): { required: number; paid: number } {
    if (!this.reservation) return { required: 0, paid: 0 };
    return {
      required: this.reservation.remainingPayment?.requiredAmount || 0,
      paid: this.reservation.remainingPayment?.paidAmount || 0
    };
  }

  get deposit(): { required: number; paid: number; returned: number; retained: number } {
    if (!this.reservation) return { required: 0, paid: 0, returned: 0, retained: 0 };
    return {
      required: this.reservation.deposit?.requiredAmount || 0,
      paid: this.reservation.deposit?.paidAmount || 0,
      returned: this.reservation.deposit?.returnedAmount || 0,
      retained: this.reservation.deposit?.retainedAmount || 0
    };
  }

  /**
   * What the customer has actually paid US: rental plus extra charges.
   *
   * It used to add up every `paidAmount` on the reservation, which folded the
   * deposit, the part retained out of it and the part handed back into one
   * figure — 693 € on a 350 € rental, with a refund counted as income. The
   * split lives in `payment-summary.util.ts` and is covered by tests.
   */
  get totalPaid(): number {
    return collectedTotalsOf(this.payments).income;
  }

  get extraChargesTotal(): number {
    // Always derived from the denormalized summary so we don't double-count
    // when the inspection service also pushes extras to the collection.
    return this.reservation?.paymentSummary?.extrasTotal || 0;
  }

  getDueDate(payment: Payment): Date | null {
    return payment.dueDate ? toDate(payment.dueDate) : null;
  }

  // === Inspection helpers ===
  // These wrappers delegate to the central reservation-workflow util so
  // the UI and the service agree on what is allowed at every step. The
  // returned `WorkflowDecision` exposes the reason key for tooltips.

  private get workflowCtx(): WorkflowContext | null {
    if (!this.reservation) return null;
    return {
      reservation: this.reservation,
      pickupInspection: this.pickupInspection,
      returnInspection: this.returnInspection,
      contract: this.contract
    } as WorkflowContext;
  }

  /**
   * Public counterpart of `workflowCtx` for the <app-reservation-timeline>
   * component.  Returns null until the reservation doc is loaded.
   */
  get timelineContext(): WorkflowContext | null {
    return this.workflowCtx;
  }

  /**
   * Resuelve un guard **honrando las excepciones documentadas**.
   *
   * `canWithException` existía desde el principio y no la llamaba nadie: las
   * excepciones se podían escribir en el modelo y el workflow las respetaba en
   * teoría, pero ninguna pantalla las consultaba. Pasar por aquí es lo que hace
   * que registrar una excepción sirva de algo.
   */
  private decide(action: ExceptionableAction, guard: (ctx: WorkflowContext) => WorkflowDecision): WorkflowDecision {
    const ctx = this.workflowCtx;
    if (!ctx) return { ok: false, reason: 'workflow.missingReservation' };
    return Workflow.canWithException(guard(ctx), ctx, action);
  }

  /**
   * Abre el diálogo para saltarse un paso.
   *
   * Se ofrece **solo cuando el paso está bloqueado**: si el workflow permite
   * seguir, no hay nada que saltar y el botón normal hace el trabajo.
   */
  openSkipDialog(action: ExceptionableAction): void {
    this.skipReason = '';
    this.skipError = '';
    this.skippingAction.set(action);
  }

  closeSkipDialog(): void {
    this.skippingAction.set(null);
    this.skipReason = '';
    this.skipError = '';
  }

  /**
   * Registra la excepción. A partir de aquí el guard deja pasar ese paso.
   *
   * El motivo no se valida aquí: lo hace `buildWorkflowException()`, que lanza
   * si no llega a tres caracteres. Tener la regla en dos sitios es como
   * empezaron los líos de la cancelación.
   */
  async confirmSkip(): Promise<void> {
    const action = this.skippingAction();
    if (!action || !this.reservation?.id || this.savingSkip) return;

    this.savingSkip = true;
    this.skipError = '';
    try {
      await this.reservationService.addWorkflowException(this.reservation.id, action, this.skipReason);
      this.closeSkipDialog();
    } catch (error: any) {
      this.skipError = error?.message || this.t('workflow.exceptionReasonRequired', '');
    } finally {
      this.savingSkip = false;
    }
  }

  /** Excepciones ya registradas, para poder mostrarlas en la ficha. */
  get workflowExceptions(): Array<{ action: string; reason: string; createdBy?: string; createdAt?: any }> {
    return this.reservation?.workflowExceptions ?? [];
  }

  /** Etiqueta traducible del paso saltado. */
  exceptionActionLabel(action: string): string {
    return this.t('workflow.' + action, action);
  }

  /** Los timestamps de Firestore no los entiende el pipe `date` a secas. */
  toDateValue(value: any): Date | null {
    return value ? toDate(value) : null;
  }

  /** Returns the workflow decision for "start pickup inspection". */
  startPickupDecision(): WorkflowDecision {
    return this.decide('startPickup', Workflow.canStartPickup);
  }

  /** Boolean shorthand used by the template @if/@else blocks. */
  canStartPickup(): boolean {
    return this.startPickupDecision().ok;
  }

  /** Tooltip key when canStartPickup() is false. */
  startPickupBlockReason(): string {
    return reasonOf(this.startPickupDecision());
  }

  startReturnDecision(): WorkflowDecision {
    return this.decide('startReturn', Workflow.canStartReturn);
  }

  canStartReturn(): boolean {
    return this.startReturnDecision().ok;
  }

  startReturnBlockReason(): string {
    return reasonOf(this.startReturnDecision());
  }

  closeReservationDecision(): WorkflowDecision {
    return this.decide('closeReservation', Workflow.canCloseReservation);
  }

  canCloseReservation(): boolean {
    return this.closeReservationDecision().ok;
  }

  /**
   * Deposit actions. These two buttons had no guard at all: "Devolver total"
   * and "Retener" were clickable with the deposit uncollected (0 € of 150 €),
   * which lets an operator refund money that was never taken. The workflow util
   * is the single authority, so the UI must ask it like every other action.
   */
  private depositDecision(kind: 'refund' | 'retain'): WorkflowDecision {
    const ctx = this.workflowCtx;
    if (!ctx) return { ok: false, reason: 'workflow.missingReservation' };
    return kind === 'refund' ? Workflow.canRefundDeposit(ctx) : Workflow.canRetainDeposit(ctx);
  }

  canRefundDeposit(): boolean {
    return this.depositDecision('refund').ok;
  }

  canRetainDeposit(): boolean {
    return this.depositDecision('retain').ok;
  }

  depositBlockReason(kind: 'refund' | 'retain'): string {
    return reasonOf(this.depositDecision(kind));
  }

  closeReservationBlockReason(): string {
    return reasonOf(this.closeReservationDecision());
  }

  cancelReservationDecision(): WorkflowDecision {
    const ctx = this.workflowCtx;
    if (!ctx) return { ok: false, reason: 'workflow.missingReservation' };
    return canCancelReservation(ctx);
  }

  canCancelReservation(): boolean {
    return this.cancelReservationDecision().ok;
  }

  cancelReservationBlockReason(): string {
    return reasonOf(this.cancelReservationDecision());
  }

  /** One-line next required action for the dashboard / header chip. */
  nextRequiredAction(): string {
    const ctx = this.workflowCtx;
    if (!ctx) return 'workflow.missingReservation';
    return Workflow.getReservationNextRequiredAction(ctx);
  }

  startPickup(): void {
    if (!this.reservation?.id) return;
    this.router.navigate(['/inspections/pickup', this.reservation.id]);
  }

  startReturn(): void {
    if (!this.reservation?.id) return;
    this.router.navigate(['/inspections/return', this.reservation.id]);
  }

  viewPickup(): void {
    if (this.pickupInspection?.id) {
      this.router.navigate(['/inspections', this.pickupInspection.id]);
    }
  }

  viewReturn(): void {
    if (this.returnInspection?.id) {
      this.router.navigate(['/inspections', this.returnInspection.id]);
    }
  }

  getInspectionStatusLabel(status: string): string {
    return this.t(INSPECTION_STATUS_LABELS[status as keyof typeof INSPECTION_STATUS_LABELS], status);
  }

  // === Contract ===

  generateContractDecision(): WorkflowDecision {
    return this.decide('generateContract', Workflow.canGenerateContract);
  }

  canGenerateContract(): boolean {
    return this.generateContractDecision().ok;
  }

  generateContractBlockReason(): string {
    return reasonOf(this.generateContractDecision());
  }

  createSigningLinkDecision(): WorkflowDecision {
    return this.decide('generateSigningLink', Workflow.canGenerateSigningLink);
  }

  canCreateContractSigningLink(): boolean {
    return this.createSigningLinkDecision().ok;
  }

  createSigningLinkBlockReason(): string {
    return reasonOf(this.createSigningLinkDecision());
  }

  hasActiveSigningLink(): boolean {
    return this.contract?.status === 'pending_signature';
  }

  canDownloadContractOriginal(): boolean {
    return !!this.contract?.pdfPath;
  }

  canDownloadContractSigned(): boolean {
    return !!this.contract?.signedPdfPath;
  }

  canSendContractEmail(): boolean {
    return this.contract?.status === 'signed';
  }

  async generateContract(): Promise<void> {
    if (!this.reservation?.id) return;
    this.generatingContract = true;
    try {
      await this.contractService.generateContractFromReservation(this.reservation.id);
      this.loadContract(this.reservation.id);
    } catch (err) {
      console.error('Error generating contract:', err);
      alert(this.t('reservations.errors.generateContract', ''));
    } finally {
      this.generatingContract = false;
    }
  }

  async createContractSigningLink(): Promise<void> {
    if (!this.contract?.id) return;
    this.creatingSigningLink = true;
    try {
      await this.contractService.generateSigningLink(this.contract.id);
      if (this.reservation?.id) this.loadContract(this.reservation.id);
    } catch (err) {
      console.error('Error creating signing link:', err);
      alert(this.t('reservations.errors.createSigningLink', ''));
    } finally {
      this.creatingSigningLink = false;
    }
  }

  async copyContractSigningLink(): Promise<void> {
    if (!this.contract?.signingLinkPath) return;
    const abs = this.contractService.buildAbsoluteSigningUrl(this.contract.signingLinkPath);
    try {
      await navigator.clipboard.writeText(abs);
      this.showCopyToast();
    } catch {
      const ta = document.createElement('textarea');
      ta.value = abs;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); this.showCopyToast(); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
  }

  getContractSigningUrl(): string {
    if (!this.contract?.signingLinkPath) return '';
    return this.contractService.buildAbsoluteSigningUrl(this.contract.signingLinkPath);
  }

  private showCopyToast(): void {
    this.copyToast = true;
    if (this.copyToastTimer) clearTimeout(this.copyToastTimer);
    this.copyToastTimer = setTimeout(() => (this.copyToast = false), 2200);
  }

  async downloadContractOriginal(): Promise<void> {
    if (!this.contract || !this.reservation) return;
    const url = await this.contractService.getOriginalPdfUrl(this.contract);
    if (!url) {
      alert(this.t('reservations.errors.pdfNotReady', ''));
      return;
    }
    const filename = `contrato-${this.contract.contractNumber || this.contract.id}.pdf`;
    await this.contractService.triggerDownload(url, filename);
  }

  async downloadContractSigned(): Promise<void> {
    if (!this.contract) return;
    const url = await this.contractService.getSignedPdfUrl(this.contract);
    if (!url) {
      alert(this.t('reservations.errors.signedPdfNotReady', ''));
      return;
    }
    const filename = `contrato-firmado-${this.contract.contractNumber || this.contract.id}.pdf`;
    await this.contractService.triggerDownload(url, filename);
  }

  openContractEmailForm(): void {
    this.showEmailForm = true;
    this.emailError = '';
    if (!this.emailRecipient && this.contract?.clientSnapshot?.email) {
      this.emailRecipient = this.contract.clientSnapshot.email;
    }
  }

  closeContractEmailForm(): void {
    this.showEmailForm = false;
    this.emailError = '';
  }

  async sendContractEmail(): Promise<void> {
    if (!this.contract?.id) return;
    const email = (this.emailRecipient || '').trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      this.emailError = 'Introduce un email válido';
      return;
    }
    this.sendingEmail = true;
    this.emailError = '';
    try {
      await this.contractService.sendSignedContractByEmail(this.contract.id, email);
      this.showEmailForm = false;
      if (this.reservation?.id) this.loadContract(this.reservation.id);
    } catch (err: any) {
      console.error('Error sending email:', err);
      this.emailError = err?.message || 'Error al enviar el email';
    } finally {
      this.sendingEmail = false;
    }
  }

  viewContract(): void {
    if (this.contract?.id) {
      this.router.navigate(['/contracts', this.contract.id]);
    }
  }

  getContractStatusLabel(status: string): string {
    return this.t(CONTRACT_DOC_STATUS_LABELS[status as keyof typeof CONTRACT_DOC_STATUS_LABELS], status);
  }

  getContractStatusClass(status: string): string {
    return CONTRACT_DOC_STATUS_COLORS[status as keyof typeof CONTRACT_DOC_STATUS_COLORS] || '';
  }
}