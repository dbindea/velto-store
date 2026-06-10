import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { PaymentService } from '@features/payments/services/payment.service';
import {
  Payment,
  PaymentStatus,
  PaymentMethod,
  PaymentType,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_METHOD_ICONS
} from '@shared/models/payment.model';
import { toDate } from '@shared/utils/reservation-date.util';

type TabFilter = 'all' | 'pending' | 'paid' | 'failed';

@Component({
  selector: 'app-payment-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslatePipe],
  templateUrl: './payment-list.component.html',
  styleUrl: './payment-list.component.scss'
})
export class PaymentListComponent implements OnInit {
  private router = inject(Router);
  private paymentService = inject(PaymentService);

  payments: Payment[] = [];
  filteredPayments: Payment[] = [];
  loading = true;

  // Filters
  searchTerm = '';
  statusFilter: TabFilter = 'all';
  methodFilter: PaymentMethod | 'all' = 'all';
  typeFilter: PaymentType | 'all' = 'all';

  // Labels & helpers (exposed to template)
  PAYMENT_STATUS_LABELS = PAYMENT_STATUS_LABELS;
  PAYMENT_METHOD_LABELS = PAYMENT_METHOD_LABELS;
  PAYMENT_TYPE_LABELS = PAYMENT_TYPE_LABELS;
  PAYMENT_STATUS_COLORS = PAYMENT_STATUS_COLORS;
  PAYMENT_METHOD_ICONS = PAYMENT_METHOD_ICONS;

  statusOptions: Array<{ value: TabFilter; label: string }> = [
    { value: 'all', label: 'common.all' },
    { value: 'pending', label: 'payments.status.pending' },
    { value: 'paid', label: 'payments.status.paid' },
    { value: 'failed', label: 'payments.status.failed' }
  ];

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

  ngOnInit(): void {
    this.loadPayments();
  }

  loadPayments(): void {
    this.loading = true;
    this.paymentService.getPayments().subscribe({
      next: (payments) => {
        this.payments = payments;
        this.applyFilters();
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading payments:', error);
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