import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { PaymentConceptPipe } from '@shared/pipes/payment-concept.pipe';
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
import { PermissionsService } from '@core/auth/permissions.service';
import { canIssueReceipt } from '@shared/utils/receipt.util';
import { ReceiptDialogComponent } from '@shared/components/receipt-dialog/receipt-dialog.component';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
import { ConfirmService } from '@core/notifications/confirm.service';
import { NotificationService } from '@core/notifications/notification.service';
import { RedsysPaymentService } from '@features/payments/services/redsys-payment.service';
import {
  canRefund,
  refundProblem,
  refundableAmount,
  refundedSoFar
} from '@shared/utils/refund.util';

@Component({
  selector: 'app-payment-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    PaymentConceptPipe,
    ReceiptDialogComponent,
    FormErrorComponent
  ],
  templateUrl: './payment-detail.component.html',
  styleUrl: './payment-detail.component.scss'
})
export class PaymentDetailComponent implements OnInit {
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private paymentService = inject(PaymentService);
  private redsys = inject(RedsysPaymentService);
  private notifications = inject(NotificationService);
  /** Público: las plantillas preguntan qué permite el rol. */
  permissions = inject(PermissionsService);

  payment: Payment | null = null;
  loading = true;
  cancelling = false;
  marking = false;

  // --- Devolver a la tarjeta ------------------------------------------------
  //
  // ⚠️ Es el único sitio de la aplicación por el que sale dinero, así que va con
  // más frenos que nada: permiso propio, importe topado por lo cobrado, y una
  // confirmación en rojo con la cifra delante.

  showRefund = false;
  refundAmount: number | null = null;
  refundReason = '';
  refunding = false;
  refundSubmitted = false;

  /**
   * Una fecha de Firestore como `Date`, para el pipe de la plantilla.
   *
   * ⚠️ **El pipe `date` de Angular NO entiende un `Timestamp` de Firestore**:
   * lanza `InvalidPipeArgument` y **tumba el pintado de todo el bloque**, así
   * que no se pierde la fecha, se pierde la tarjeta entera. Compila, pasa los
   * tests y solo aparece cuando hay un dato real que pintar — por eso el
   * `notifiedAt` de la pasarela llevaba aquí desde siempre sin que se viera:
   * hasta hoy no había en desarrollo ningún cobro con notificación de Redsys.
   */
  asDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    if (typeof v._seconds === 'number') return new Date(v._seconds * 1000);
    return null;
  }

  /** ¿Se le ofrece siquiera el botón? */
  get canRefund(): boolean {
    return this.permissions.can('refundPayments') && canRefund(this.payment);
  }

  /** Lo que queda por devolver de este cobro. */
  get refundable(): number {
    return refundableAmount(this.payment);
  }

  /** Lo ya devuelto, para que la ficha lo diga en vez de esconderlo. */
  get refunded(): number {
    return refundedSoFar(this.payment);
  }

  /**
   * Lo que impide devolver el importe escrito.
   *
   * ⚠️ **Getter y no `computed`**, porque lee `refundAmount`, que es una
   * propiedad de `ngModel`: un `computed` se quedaría con la primera
   * evaluación y el aviso no cambiaría al teclear.
   */
  get refundProblemKey(): string {
    return refundProblem(this.payment, this.refundAmount) || '';
  }

  openRefund(): void {
    // Propone el total pendiente: lo normal es devolverlo entero, y quien
    // devuelve una parte lo teclea a propósito.
    this.refundAmount = this.refundable;
    this.refundReason = '';
    this.refundSubmitted = false;
    this.showRefund = true;
  }

  /**
   * Devolver, con una confirmación que dice el importe **y** que no se deshace.
   *
   * ⚠️ **La confirmación no es burocracia.** Una devolución aceptada por el
   * banco ya ha movido el dinero: recuperarlo es una llamada al comercio, no un
   * botón. Es el único sitio donde la aplicación no puede arreglar su propio
   * error, y por eso pregunta con la cifra delante.
   */
  async doRefund(): Promise<void> {
    this.refundSubmitted = true;
    if (this.refundProblemKey || !this.payment?.id) return;

    const importe = Number(this.refundAmount);
    const ok = await this.confirm.ask({
      title: 'payments.refund.confirmTitle',
      message: 'payments.refund.confirmMessage',
      confirmLabel: 'payments.refund.confirmAction',
      danger: true
    });
    if (!ok) return;

    this.refunding = true;
    try {
      const r = await this.redsys.refundRedsysPayment(
        this.payment.id,
        importe,
        this.refundReason
      );
      this.showRefund = false;
      this.notifications.success('payments.refund.done');
      void r;
      this.loadPayment(this.payment.id);
    } catch (error: any) {
      /**
       * ⚠️ **No se reintenta, y se dice por qué.** Un fallo después de que el
       * banco haya aceptado es indistinguible de uno anterior, así que ofrecer
       * «reintentar» sería ofrecer devolver dos veces. Lo que toca es mirar el
       * extracto.
       */
      const clave = String(error?.message || '');
      this.notifications.error(
        clave.startsWith('payments.') ? clave : 'payments.refund.errors.failed'
      );
    } finally {
      this.refunding = false;
    }
  }

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
    const confirmed = await this.confirm.ask({
      title: 'payments.confirm.cancelTitle',
      message: 'payments.confirm.cancelMessage',
      confirmLabel: 'payments.actions.cancelPayment',
      danger: true
    });
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

  // === Recibo de cobro ===
  //
  // Esta pantalla es la **única puerta de un cobro libre**: sin reserva no hay
  // ficha de reserva desde la que pedirlo.

  showReceiptDialog = false;

  /** ¿Este cobro admite recibo? La regla vive en el util, no aquí. */
  canIssueReceipt(): boolean {
    return !!this.payment && canIssueReceipt(this.payment);
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