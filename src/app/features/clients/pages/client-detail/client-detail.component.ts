import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ClientService } from '@features/clients/services/client.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { PaymentService } from '@features/payments/services/payment.service';
import {
  Client,
  ClientDocumentFile,
  ClientTrustLevel,
  CLIENT_TRUST_LEVEL_LABELS,
  CLIENT_TRUST_LEVEL_COLORS,
  CLIENT_FILE_TYPE_LABELS,
  DRIVING_LICENSE_COUNTRY_LABELS
} from '@shared/models/client.model';
import { Reservation, RESERVATION_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@shared/models/reservation.model';
import { Payment, PAYMENT_TYPE_LABELS, PAYMENT_STATUS_LABELS as PAYMENT_STATUS_LABELS_PAYMENT } from '@shared/models/payment.model';
import { toDate } from '@shared/utils/reservation-date.util';

type Tab = 'summary' | 'license' | 'documents' | 'reservations' | 'payments';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './client-detail.component.html',
  styleUrl: './client-detail.component.scss'
})
export class ClientDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private clientService = inject(ClientService);
  private reservationService = inject(ReservationService);
  private paymentService = inject(PaymentService);

  client: Client | null = null;
  reservations: Reservation[] = [];
  payments: Payment[] = [];
  loading = true;
  loadingReservations = false;
  loadingPayments = false;
  activeTab: Tab = 'summary';

  // Payment labels exposed to template
  PAYMENT_TYPE_LABELS = PAYMENT_TYPE_LABELS;
  PAYMENT_STATUS_LABELS_PAYMENT = PAYMENT_STATUS_LABELS_PAYMENT;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadClient(id);
    } else {
      this.router.navigate(['/clients']);
    }
  }

  loadClient(id: string): void {
    this.loading = true;
    this.clientService.getClientById(id).subscribe({
      next: (client) => {
        if (!client) {
          this.router.navigate(['/clients']);
          return;
        }
        this.client = client;
        this.loading = false;
        this.loadReservations(id);
        this.loadPayments(id);
      },
      error: () => {
        this.loading = false;
        this.router.navigate(['/clients']);
      }
    });
  }

  loadReservations(clientId: string): void {
    this.loadingReservations = true;
    this.reservationService.getReservationsByClient(clientId).subscribe({
      next: (reservations) => {
        this.reservations = reservations;
        this.loadingReservations = false;
      },
      error: (error) => {
        console.error('Error loading reservations:', error);
        this.loadingReservations = false;
      }
    });
  }

  loadPayments(clientId: string): void {
    this.loadingPayments = true;
    this.paymentService.getPaymentsByClient(clientId).subscribe({
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

  viewPayment(paymentId: string | undefined): void {
    if (paymentId) this.router.navigate(['/payments', paymentId]);
  }

  get totalPaid(): number {
    return this.payments
      .filter(p => p.status !== 'cancelled')
      .reduce((sum, p) => sum + p.paidAmount, 0);
  }

  get totalPending(): number {
    return this.payments
      .filter(p => p.status === 'pending' || p.status === 'partial')
      .reduce((sum, p) => sum + p.pendingAmount, 0);
  }

  get depositsRetained(): number {
    return this.payments
      .filter(p => p.type === 'deposit_retention' && p.status !== 'cancelled')
      .reduce((sum, p) => sum + p.paidAmount, 0);
  }

  setTab(tab: Tab): void {
    this.activeTab = tab;
  }

  goBack(): void {
    this.router.navigate(['/clients']);
  }

  editClient(): void {
    if (this.client?.id) {
      this.router.navigate(['/clients', this.client.id, 'edit']);
    }
  }

  viewReservation(reservationId: string | undefined): void {
    if (reservationId) {
      this.router.navigate(['/reservations', reservationId]);
    }
  }

  // Helpers
  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  getTrustLabel(level: ClientTrustLevel | undefined): string {
    return CLIENT_TRUST_LEVEL_LABELS[level || 'new'];
  }

  getTrustClass(level: ClientTrustLevel | undefined): string {
    return CLIENT_TRUST_LEVEL_COLORS[level || 'new'];
  }

  getFileTypeLabel(type: ClientDocumentFile['type']): string {
    return CLIENT_FILE_TYPE_LABELS[type];
  }

  getCountryLabel(country: any): string {
    return DRIVING_LICENSE_COUNTRY_LABELS[country as keyof typeof DRIVING_LICENSE_COUNTRY_LABELS] || country;
  }

  getDocumentTypeLabel(type: string | undefined): string {
    if (!type) return '';
    const labels: Record<string, string> = {
      dni: 'DNI',
      nie: 'NIE',
      passport: 'Passport',
      other: 'Other'
    };
    return labels[type] || type;
  }

  getStatusLabel(status: string): string {
    return RESERVATION_STATUS_LABELS[status as keyof typeof RESERVATION_STATUS_LABELS] || status;
  }

  getPaymentLabel(status: string): string {
    return PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] || status;
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      quote: 'status-quote',
      reserved: 'status-reserved',
      confirmed: 'status-confirmed',
      delivered: 'status-delivered',
      returned: 'status-returned',
      closed: 'status-closed',
      cancelled: 'status-cancelled'
    };
    return map[status] || '';
  }

  getPaymentStatusClass(status: string): string {
    const map: Record<string, string> = {
      pending: 'payment-pending',
      partial: 'payment-partial',
      paid: 'payment-paid',
      refunded: 'payment-refunded'
    };
    return map[status] || '';
  }

  isImage(contentType: string | undefined): boolean {
    return contentType?.startsWith('image/') || false;
  }

  getPickupDate(r: Reservation): Date {
    return toDate(r.pickupDateTime);
  }

  getReturnDate(r: Reservation): Date {
    return toDate(r.returnDateTime);
  }

  // Reservations split
  get upcomingReservations(): Reservation[] {
    const now = new Date();
    return this.reservations.filter(r => {
      const returnDate = toDate(r.returnDateTime);
      return returnDate >= now && r.reservationStatus !== 'cancelled';
    });
  }

  get pastReservations(): Reservation[] {
    const now = new Date();
    return this.reservations.filter(r => {
      const returnDate = toDate(r.returnDateTime);
      return returnDate < now && r.reservationStatus !== 'cancelled';
    });
  }

  get cancelledReservations(): Reservation[] {
    return this.reservations.filter(r => r.reservationStatus === 'cancelled');
  }
}