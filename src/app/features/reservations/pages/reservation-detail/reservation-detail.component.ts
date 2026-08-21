import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { PaymentService } from '@features/payments/services/payment.service';
import { InspectionService } from '@features/inspections/services/inspection.service';
import { ContractService } from '@features/contracts/services/contract.service';
import { Contract, CONTRACT_STATUS_LABELS as CONTRACT_DOC_STATUS_LABELS, CONTRACT_STATUS_COLORS as CONTRACT_DOC_STATUS_COLORS } from '@shared/models/contract.model';
import {
  Reservation,
  RESERVATION_STATUS_LABELS,
  RESERVATION_PAYMENT_STATUS_LABELS,
  RESERVATION_CONTRACT_STATUS_LABELS
} from '@shared/models/reservation.model';
import {
  Workflow,
  WorkflowDecision,
  WorkflowContext,
  canCancelReservation,
  reasonOf
} from '@shared/utils/reservation-workflow.util';
import {
  Payment,
  PaymentMethod,
  PaymentType,
  PAYMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_METHOD_ICONS
} from '@shared/models/payment.model';
import { Inspection, INSPECTION_STATUS_LABELS } from '@shared/models/inspection.model';
import { toDate } from '@shared/utils/reservation-date.util';
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
  private translateService = inject(TranslateService);

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

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadReservation(id);
    } else {
      this.router.navigate(['/reservations']);
    }
  }

  loadReservation(id: string): void {
    this.loading = true;
    this.reservationService.getReservationById(id).subscribe({
      next: (reservation) => {
        if (!reservation) {
          this.router.navigate(['/reservations']);
          return;
        }
        this.reservation = reservation;
        this.loading = false;
        this.loadPayments(id);
        this.loadInspections(id);
        this.loadContract(id);
      },
      error: (error) => {
        console.error('Error loading reservation:', error);
        this.loading = false;
      }
    });
  }

  loadContract(reservationId: string): void {
    this.contractService.getContractByReservation(reservationId).subscribe({
      next: (c) => {
        this.contract = c;
        if (c && !this.emailRecipient) {
          this.emailRecipient = c.clientSnapshot?.email || '';
        }
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
      },
      error: (error) => {
        console.error('Error loading payments:', error);
        this.loadingPayments = false;
      }
    });
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
  onInternalNotesChanged(notes: ReservationNote[]): void {
    if (this.reservation) {
      this.reservation = { ...this.reservation, internalNotes: notes };
    }
  }

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
      alert('Error al cancelar la reserva');
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

  getPaymentStatusLabel(status: string): string {
    return this.getPaymentLabel(status);
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

  canCancel(): boolean {
    if (!this.reservation) return false;
    const cancellableStatuses: Array<typeof this.reservation.reservationStatus> = ['reserved'];
    return cancellableStatuses.includes(this.reservation.reservationStatus);
  }

  getFuelLabel(fuel: string): string {
    return this.t(FUEL_TYPE_LABELS[fuel as keyof typeof FUEL_TYPE_LABELS], fuel);
  }

  getTransmissionLabel(trans: string): string {
    return this.t(TRANSMISSION_LABELS[trans as keyof typeof TRANSMISSION_LABELS], trans);
  }

  // === Payment methods ===

  async registerPayment(): Promise<void> {
    if (!this.reservation?.id) return;
    this.savingPayment = true;
    try {
      await this.paymentService.createManualPayment({
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
      alert('Error al registrar el pago');
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
      alert('Error al procesar la fianza');
    } finally {
      this.savingDeposit = false;
    }
  }

  resetPaymentForm(): void {
    this.newPayment = { type: 'initial_payment', method: 'cash', amount: 0, paidAmount: 0, concept: '' };
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

  get totalPaid(): number {
    return this.payments
      .filter(p => p.status !== 'cancelled')
      .reduce((sum, p) => sum + p.paidAmount, 0);
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

  /** Returns the workflow decision for "start pickup inspection". */
  startPickupDecision(): WorkflowDecision {
    const ctx = this.workflowCtx;
    if (!ctx) return { ok: false, reason: 'workflow.missingReservation' };
    return Workflow.canStartPickup(ctx);
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
    const ctx = this.workflowCtx;
    if (!ctx) return { ok: false, reason: 'workflow.missingReservation' };
    return Workflow.canStartReturn(ctx);
  }

  canStartReturn(): boolean {
    return this.startReturnDecision().ok;
  }

  startReturnBlockReason(): string {
    return reasonOf(this.startReturnDecision());
  }

  closeReservationDecision(): WorkflowDecision {
    const ctx = this.workflowCtx;
    if (!ctx) return { ok: false, reason: 'workflow.missingReservation' };
    return Workflow.canCloseReservation(ctx);
  }

  canCloseReservation(): boolean {
    return this.closeReservationDecision().ok;
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
    const ctx = this.workflowCtx;
    if (!ctx) return { ok: false, reason: 'workflow.missingReservation' };
    return Workflow.canGenerateContract(ctx);
  }

  canGenerateContract(): boolean {
    return this.generateContractDecision().ok;
  }

  generateContractBlockReason(): string {
    return reasonOf(this.generateContractDecision());
  }

  createSigningLinkDecision(): WorkflowDecision {
    const ctx = this.workflowCtx;
    if (!ctx) return { ok: false, reason: 'workflow.missingReservation' };
    return Workflow.canGenerateSigningLink(ctx);
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
      alert('Error al generar el contrato');
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
      alert('Error al crear el link de firma');
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
      alert('PDF no disponible todavía');
      return;
    }
    const filename = `contrato-${this.contract.contractNumber || this.contract.id}.pdf`;
    await this.contractService.triggerDownload(url, filename);
  }

  async downloadContractSigned(): Promise<void> {
    if (!this.contract) return;
    const url = await this.contractService.getSignedPdfUrl(this.contract);
    if (!url) {
      alert('Contrato firmado no disponible todavía');
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