import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { PaymentConceptPipe } from '@shared/pipes/payment-concept.pipe';
import { PaymentService } from '@features/payments/services/payment.service';
import {
  Payment,
  PaymentMethod,
  PaymentType,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_METHOD_ICONS
} from '@shared/models/payment.model';
import { toDate } from '@shared/utils/reservation-date.util';
import { visiblePayments } from '@shared/utils/payment-scope.util';
import { PermissionsService } from '@core/auth/permissions.service';
import { NotificationService } from '@core/notifications/notification.service';

type TabFilter = 'all' | 'pending' | 'paid' | 'failed';

/**
 * El libro de cobros.
 *
 * ⚠️ **Sin `viewPaymentHistory` solo se ven los cobros ABIERTOS.** La lista de
 * todo lo cobrado desde siempre es la facturación del negocio servida fila a
 * fila, y esa es información de dueño — la misma que protegen Informes y Gastos.
 * Lo que un empleado necesita para trabajar es lo contrario: lo que falta por
 * cobrar. Ver `payment-scope.util.ts`.
 *
 * El recorte se aplica **al cargar**, no en `applyFilters()`: puesto en el
 * filtro, cambiar de pestaña volvería a enseñarlo todo.
 */
@Component({
  selector: 'app-payment-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslatePipe, PaymentConceptPipe],
  templateUrl: './payment-list.component.html',
  styleUrl: './payment-list.component.scss'
})
export class PaymentListComponent implements OnInit {
  private router = inject(Router);
  private paymentService = inject(PaymentService);
  private notifications = inject(NotificationService);
  readonly permissions = inject(PermissionsService);

  payments: Payment[] = [];
  filteredPayments: Payment[] = [];
  loading = true;

  // Filters
  searchTerm = '';
  statusFilter: TabFilter = 'all';
  methodFilter: PaymentMethod | 'all' = 'all';
  typeFilter: PaymentType | 'all' = 'all';
  scopeFilter: 'all' | 'reservation' | 'free' = 'all';

  // Labels & helpers (exposed to template)
  PAYMENT_STATUS_LABELS = PAYMENT_STATUS_LABELS;
  PAYMENT_METHOD_LABELS = PAYMENT_METHOD_LABELS;
  PAYMENT_TYPE_LABELS = PAYMENT_TYPE_LABELS;
  PAYMENT_STATUS_COLORS = PAYMENT_STATUS_COLORS;
  PAYMENT_METHOD_ICONS = PAYMENT_METHOD_ICONS;

  /**
   * ⚠️ **La pestaña «Cobrados» no se ofrece sin el permiso.** Sin el histórico
   * saldría siempre vacía, y un botón que no hace nada es un fallo: el compañero
   * la pulsa, no pasa nada, y acaba llamando para preguntar qué le pasa a la
   * aplicación. Mejor que no esté, y que al lado se explique por qué.
   */
  get statusOptions(): Array<{ value: TabFilter; label: string }> {
    const todas: Array<{ value: TabFilter; label: string }> = [
      { value: 'all', label: 'common.all' },
      { value: 'pending', label: 'payments.status.pending' },
      { value: 'paid', label: 'payments.status.paid' },
      { value: 'failed', label: 'payments.status.failed' }
    ];
    if (this.permissions.canViewPaymentHistory()) return todas;
    return todas.filter((o) => o.value !== 'paid');
  }

  methodOptions: Array<{ value: PaymentMethod | 'all'; label: string }> = [
    { value: 'all', label: 'common.all' },
    { value: 'cash', label: 'payments.methods.cash' },
    { value: 'bank_transfer', label: 'payments.methods.bankTransfer' },
    { value: 'bizum', label: 'payments.methods.bizum' },
    { value: 'physical_pos', label: 'payments.methods.physicalPos' },
    { value: 'redsys', label: 'payments.methods.redsys' },
    { value: 'manual_card', label: 'payments.methods.manualCard' },
    { value: 'other', label: 'payments.methods.other' }
  ];

  scopeOptions: Array<{ value: 'all' | 'reservation' | 'free'; label: string }> = [
    { value: 'all', label: 'common.all' },
    { value: 'reservation', label: 'payments.filters.reservationPayments' },
    { value: 'free', label: 'payments.filters.freePayments' }
  ];

  ngOnInit(): void {
    this.loadPayments();
  }

  loadPayments(): void {
    this.loading = true;
    this.paymentService.getPayments().subscribe({
      next: (payments) => {
        // El recorte va aquí y no en `applyFilters()`: después, cualquier
        // pestaña volvería a enseñar lo que este permiso retira.
        this.payments = visiblePayments(payments, this.permissions.canViewPaymentHistory());
        this.applyFilters();
        this.loading = false;
      },
      error: () => {
        /**
         * ⚠️ Antes esto era un `console.error` y nada más: si fallaba, la lista
         * salía vacía y la pantalla decía «no hay pagos», que es mentira y se
         * actúa sobre ella. Si una acción puede fallar, tiene que contarlo.
         */
        this.notifications.error('payments.errors.loadFailed', {
          retry: () => this.loadPayments()
        });
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    let result = [...this.payments];

    if (this.statusFilter === 'pending') {
      result = result.filter(p => p.status === 'pending' || p.status === 'partial');
    } else if (this.statusFilter === 'paid') {
      result = result.filter(p => p.status === 'paid' || p.status === 'refunded');
    } else if (this.statusFilter === 'failed') {
      result = result.filter(p => p.status === 'failed' || p.status === 'cancelled');
    }

    if (this.methodFilter !== 'all') {
      result = result.filter(p => p.method === this.methodFilter);
    }

    if (this.typeFilter !== 'all') {
      result = result.filter(p => p.type === this.typeFilter);
    }

    if (this.scopeFilter === 'free') {
      result = result.filter(p => p.isFreePayment);
    } else if (this.scopeFilter === 'reservation') {
      result = result.filter(p => !p.isFreePayment && !!p.reservationId);
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(p =>
        p.concept?.toLowerCase().includes(term) ||
        p.clientSnapshot?.fullName?.toLowerCase().includes(term) ||
        p.vehicleSnapshot?.plateNumber?.toLowerCase().includes(term) ||
        p.internalReference?.toLowerCase().includes(term)
      );
    }

    this.filteredPayments = result;
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  viewDetail(payment: Payment): void {
    this.router.navigate(['/payments', payment.id]);
  }

  getDueDate(payment: Payment): Date | null {
    if (!payment.dueDate) return null;
    return toDate(payment.dueDate);
  }

  getPaidAt(payment: Payment): Date | null {
    if (!payment.paidAt) return null;
    return toDate(payment.paidAt);
  }
}