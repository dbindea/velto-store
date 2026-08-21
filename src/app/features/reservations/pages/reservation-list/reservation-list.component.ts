import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ReservationService } from '@features/reservations/services/reservation.service';
import {
  Reservation,
  ReservationStatus,
  RESERVATION_STATUS_LABELS,
  RESERVATION_PAYMENT_STATUS_LABELS
} from '@shared/models/reservation.model';
import { TranslateService } from '@core/i18n/translate.service';
import { toDate } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-reservation-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslatePipe],
  templateUrl: './reservation-list.component.html',
  styleUrl: './reservation-list.component.scss'
})
export class ReservationListComponent implements OnInit {
  private router = inject(Router);
  private reservationService = inject(ReservationService);
  private translateService = inject(TranslateService);

  reservations: Reservation[] = [];
  filteredReservations: Reservation[] = [];
  loading = true;

  // Filters
  statusFilter: ReservationStatus | 'all' = 'all';
  searchTerm = '';

  // Status options for filter
  statusOptions: Array<{ value: ReservationStatus | 'all'; label: string }> = [
    { value: 'all', label: 'common.all' },
    { value: 'reserved', label: 'reservations.status.reserved' },
    { value: 'confirmed', label: 'reservations.status.confirmed' },
    { value: 'delivered', label: 'reservations.status.delivered' },
    { value: 'returned', label: 'reservations.status.returned' },
    { value: 'closed', label: 'reservations.status.closed' },
    { value: 'cancelled', label: 'reservations.status.cancelled' }
  ];

  ngOnInit(): void {
    this.loadReservations();
  }

  loadReservations(): void {
    this.loading = true;
    this.reservationService.getReservations().subscribe({
      next: (reservations) => {
        this.reservations = reservations;
        this.applyFilters();
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading reservations:', error);
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    let result = [...this.reservations];

    // Status filter
    if (this.statusFilter !== 'all') {
      result = result.filter(r => r.reservationStatus === this.statusFilter);
    }

    // Search term
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(r =>
        r.vehicleSnapshot.brand.toLowerCase().includes(term) ||
        r.vehicleSnapshot.model.toLowerCase().includes(term) ||
        r.vehicleSnapshot.plateNumber.toLowerCase().includes(term) ||
        r.clientSnapshot.fullName.toLowerCase().includes(term)
      );
    }

    this.filteredReservations = result;
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  viewDetail(reservation: Reservation): void {
    this.router.navigate(['/reservations', reservation.id]);
  }

  createNew(): void {
    this.router.navigate(['/reservations', 'new']);
  }

  // The *_LABELS maps hold i18n keys, and the template calls these getters
  // without a `| translate`, so they resolve the key here.
  getStatusLabel(status: ReservationStatus): string {
    return this.t(RESERVATION_STATUS_LABELS[status], status);
  }

  getPaymentLabel(status: string): string {
    return this.t(
      RESERVATION_PAYMENT_STATUS_LABELS[status as keyof typeof RESERVATION_PAYMENT_STATUS_LABELS],
      status
    );
  }

  /** Resolve an i18n key, falling back to the raw value for unknown states. */
  private t(key: string | undefined, fallback: string): string {
    return key ? this.translateService.translate(key) : fallback;
  }

  getPickupDate(reservation: Reservation): Date {
    return toDate(reservation.pickupDateTime);
  }

  getReturnDate(reservation: Reservation): Date {
    return toDate(reservation.returnDateTime);
  }

  getPendingAmount(reservation: Reservation): number {
    return reservation.initialPayment.requiredAmount - reservation.initialPayment.paidAmount +
           reservation.remainingPayment.requiredAmount - reservation.remainingPayment.paidAmount;
  }

  getStatusClass(status: ReservationStatus): string {
    const statusClasses: Record<ReservationStatus, string> = {
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
}