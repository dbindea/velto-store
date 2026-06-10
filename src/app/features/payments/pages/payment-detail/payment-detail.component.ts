import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { PaymentService } from '@features/payments/services/payment.service';
import {
  Payment,
  PaymentStatus,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_METHOD_ICONS
} from '@shared/models/payment.model';
import { toDate } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-payment-detail',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './payment-detail.component.html',
  styleUrl: './payment-detail.component.scss'
})
export class PaymentDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private paymentService = inject(PaymentService);

  payment: Payment | null = null;
  loading = true;
  cancelling = false;
  marking = false;

  // Labels & helpers
  PAYMENT_STATUS_LABELS = PAYMENT_STATUS_LABELS;
  PAYMENT_METHOD_LABELS = PAYMENT_METHOD_LABELS;
  PAYMENT_TYPE_LABELS = PAYMENT_TYPE_LABELS;
  PAYMENT_STATUS_COLORS = PAYMENT_STATUS_COLORS;
  PAYMENT_METHOD_ICONS = PAYMENT_METHOD_ICONS;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadPayment(id);
    } else {
      this.router.navigate(['/payments']);
    }
  }

  loadPayment(id: string): void {
    this.loading = true;
    this.paymentService.getPaymentById(id).subscribe({
      next: (payment) => {
        if (!payment) {
          this.router.navigate(['/payments']);
          return;
        }
        this.payment = payment;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.router.navigate(['/payments']);
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/payments']);
  }

  viewReservation(): void {
    if (this.payment?.reservationId) {
      this.router.navigate(['/reservations', this.payment.reservationId]);
    }
  }

  async markAsPaid(): Promise<void> {
    if (!this.payment?.id) return;
    this.marking = true;
    try {
      await this.paymentService.markPaymentAsPaid(this.payment.id, {});
      this.loadPayment(this.payment.id);
    } catch (error) {
      console.error('Error marking payment as paid:', error);
    } finally {
      this.marking = false;
    }
  }

  async cancelPayment(): Promise<void> {
    if (!this.payment?.id) return;
    const confirmed = confirm('¿Cancelar este pago?');
    if (!confirmed) return;

    this.cancelling = true;
    try {
      await this.paymentService.cancelPayment(this.payment.id);
      this.loadPayment(this.payment.id);
    } catch (error) {
      console.error('Error cancelling payment:', error);
    } finally {
      this.cancelling = false;
    }
  }

  canMarkAsPaid(): boolean {
    return this.payment?.status === 'pending' || this.payment?.status === 'partial' || this.payment?.status === 'failed';
  }

  canCancel(): boolean {
    return this.payment?.status === 'pending' || this.payment?.status === 'partial';
  }

  getDueDate(): Date | null {
    return this.payment?.dueDate ? toDate(this.payment.dueDate) : null;
  }

  getPaidAt(): Date | null {
    return this.payment?.paidAt ? toDate(this.payment.paidAt) : null;
  }

  getCreatedAt(): Date | null {
    return this.payment?.createdAt ? toDate(this.payment.createdAt) : null;
  }
}