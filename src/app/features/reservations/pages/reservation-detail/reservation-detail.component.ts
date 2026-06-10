import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { Reservation, RESERVATION_STATUS_LABELS, PAYMENT_STATUS_LABELS, CONTRACT_STATUS_LABELS } from '@shared/models/reservation.model';
import { toDate } from '@shared/utils/reservation-date.util';
import { FUEL_TYPE_LABELS, TRANSMISSION_LABELS } from '@shared/models/vehicle.model';

@Component({
  selector: 'app-reservation-detail',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './reservation-detail.component.html',
  styleUrl: './reservation-detail.component.scss'
})
export class ReservationDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private reservationService = inject(ReservationService);

  reservation: Reservation | null = null;
  loading = true;
  cancelling = false;

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
      },
      error: (error) => {
        console.error('Error loading reservation:', error);
        this.loading = false;
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/reservations']);
  }

  async cancelReservation(): Promise<void> {
    if (!this.reservation?.id) return;
    
    const confirmed = confirm('¿Estás seguro de que quieres cancelar esta reserva?');
    if (!confirmed) return;

    this.cancelling = true;
    try {
      await this.reservationService.cancelReservation(this.reservation.id);
      this.reservation.reservationStatus = 'cancelled';
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
}