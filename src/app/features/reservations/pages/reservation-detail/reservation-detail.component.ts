import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { PaymentService } from '@features/payments/services/payment.service';
import { Reservation, RESERVATION_STATUS_LABELS, PAYMENT_STATUS_LABELS, CONTRACT_STATUS_LABELS } from '@shared/models/reservation.model';
import {
  Payment,
  PaymentMethod,
  PaymentType,
  PAYMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_METHOD_ICONS
} from '@shared/models/payment.model';
import { toDate } from '@shared/utils/reservation-date.util';
import { FUEL_TYPE_LABELS, TRANSMISSION_LABELS } from '@shared/models/vehicle.model';

@Component({
  selector: 'app-reservation-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './reservation-detail.component.html',
  styleUrl: './reservation-detail.component.scss'
})
export class ReservationDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private reservationService = inject(ReservationService);
  private paymentService = inject(PaymentService);

  reservation: Reservation | null = null;
  payments: Payment[] = [];
  loading = true;
  loadingPayments = false;
  cancelling = false;
  savingPayment = false;
  savingDeposit = false;

  // Forms
  showPaymentForm = false;
  showDepositForm = false;
  showExtraChargeForm = false;

  newPayment: {
    type: PaymentType;
    method: PaymentMethod;
    amount: number;
    paidAmount: number;
    concept: string;
    notes?: string;
  } = { type: 'initial_payment', method: 'cash', amount: 0, paidAmount: 0, concept: '' };

  newExtraCharge: {
    type: 'extra_charge' | 'fuel_charge' | 'cleaning_charge' | 'extra_km_charge' | 'penalty' | 'fine';
    method: PaymentMethod;
    amount: number;
    paidAmount: number;
    concept: string;
    notes?: string;
  } = { type: 'fuel_charge', method: 'cash', amount: 0, paidAmount: 0, concept: '' };

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
    'initial_payment', 'remaining_payment', 'deposit', 'other'
  ];
  extraChargeTypeOptions: Array<'extra_charge' | 'fuel_charge' | 'cleaning_charge' | 'extra_km_charge' | 'penalty' | 'fine'> = [
    'fuel_charge', 'cleaning_charge', 'extra_km_charge', 'penalty', 'fine', 'extra_charge'
  ];
  methodOptions: PaymentMethod[] = ['cash', 'bank_transfer', 'bizum', 'physical_pos', 'manual_card', 'other'];

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
      },
      error: (error) => {
        console.error('Error loading reservation:', error);
        this.loading = false;
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

  getReturnDate(): Date {
    return this.reservation ? toDate(this.reservation.returnDateTime) : new Date();
  }

  getStatusLabel(status: string): string {
    return RESERVATION_STATUS_LABELS[status as keyof typeof RESERVATION_STATUS_LABELS] || status;
  }

  getPaymentLabel(status: string): string {
    return PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] || status;
  }

  getPaymentStatusLabel(status: string): string {
    return PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] || status;
  }

  getContractLabel(status: string): string {
    return CONTRACT_STATUS_LABELS[status as keyof typeof CONTRACT_STATUS_LABELS] || status;
  }

  getStatusClass(status: string): string {
    const statusClasses: Record<string, string> = {
      quote: 'status-quote',
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
    const cancellableStatuses = ['quote', 'reserved'];
    return cancellableStatuses.includes(this.reservation.reservationStatus);
  }

  getFuelLabel(fuel: string): string {
    return FUEL_TYPE_LABELS[fuel as keyof typeof FUEL_TYPE_LABELS] || fuel;
  }

  getTransmissionLabel(trans: string): string {
    return TRANSMISSION_LABELS[trans as keyof typeof TRANSMISSION_LABELS] || trans;
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

  async registerExtraCharge(): Promise<void> {
    if (!this.reservation?.id) return;
    this.savingPayment = true;
    try {
      await this.paymentService.createExtraCharge({
        reservationId: this.reservation.id,
        clientId: this.reservation.clientId,
        vehicleId: this.reservation.vehicleId,
        type: this.newExtraCharge.type,
        method: this.newExtraCharge.method,
        amount: this.newExtraCharge.amount,
        paidAmount: this.newExtraCharge.paidAmount,
        concept: this.newExtraCharge.concept || this.newExtraCharge.type,
        notes: this.newExtraCharge.notes,
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
      this.showExtraChargeForm = false;
      this.resetExtraChargeForm();
    } catch (error) {
      console.error('Error creating extra charge:', error);
      alert('Error al añadir el cargo extra');
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

  resetExtraChargeForm(): void {
    this.newExtraCharge = { type: 'fuel_charge', method: 'cash', amount: 0, paidAmount: 0, concept: '' };
  }

  togglePaymentForm(): void {
    this.showPaymentForm = !this.showPaymentForm;
    this.showDepositForm = false;
    this.showExtraChargeForm = false;
    if (this.showPaymentForm) this.resetPaymentForm();
  }

  toggleDepositForm(type: 'refund' | 'retain'): void {
    if (this.showDepositForm && this.depositForm.type === type) {
      this.showDepositForm = false;
    } else {
      this.showDepositForm = true;
      this.showPaymentForm = false;
      this.showExtraChargeForm = false;
      this.depositForm = { type, amount: 0, method: 'cash' };
    }
  }

  toggleExtraChargeForm(): void {
    this.showExtraChargeForm = !this.showExtraChargeForm;
    this.showPaymentForm = false;
    this.showDepositForm = false;
    if (this.showExtraChargeForm) this.resetExtraChargeForm();
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
    return this.payments
      .filter(p => p.status !== 'cancelled' && (
        p.type === 'extra_charge' || p.type === 'fuel_charge' ||
        p.type === 'cleaning_charge' || p.type === 'extra_km_charge' ||
        p.type === 'penalty' || p.type === 'fine'
      ))
      .reduce((sum, p) => sum + p.paidAmount, 0);
  }

  getDueDate(payment: Payment): Date | null {
    return payment.dueDate ? toDate(payment.dueDate) : null;
  }
}