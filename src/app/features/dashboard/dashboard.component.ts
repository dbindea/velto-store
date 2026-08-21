/**
 * Dashboard with actionable cards.
 *
 * One card per real bottleneck the operator has to clear during a day:
 *   - Reservations awaiting first payment
 *   - Contracts awaiting signature
 *   - Pickups scheduled for today
 *   - Returns scheduled for today
 *   - Returns pending close (deposit still open)
 *   - Vehicles currently out on rental
 *   - Vehicle availability snapshot (rented vs available)
 *
 * Each card links to the matching list with a sensible filter, or to the
 * detail page when there is exactly one item.
 */

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { forkJoin } from 'rxjs';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs
} from '@angular/fire/firestore';

import { Reservation } from '@shared/models/reservation.model';
import { Contract } from '@shared/models/contract.model';
import { Vehicle } from '@shared/models/vehicle.model';
import {
  MAINTENANCE_DUE_SOON_DAYS,
  VehicleMaintenance
} from '@shared/models/vehicle-maintenance.model';

interface PendingPaymentCard {
  type: 'pending_payment';
  reservation: Reservation;
  pendingAmount: number;
}

interface ContractCard {
  type: 'pending_signature';
  contract: Contract;
}

interface CalendarCard {
  type: 'pickup_today' | 'return_today';
  reservation: Reservation;
}

interface ReturnOpenCard {
  type: 'return_open';
  reservation: Reservation;
}

interface VehicleRentedCard {
  type: 'vehicle_rented';
  vehicle: Vehicle;
}

interface FleetCard {
  type: 'fleet';
  rented: number;
  available: number;
  total: number;
}

interface MaintenanceOverdueCard {
  type: 'maintenance_overdue';
  items: VehicleMaintenance[];
}

interface MaintenanceDueSoonCard {
  type: 'maintenance_due_soon';
  items: VehicleMaintenance[];
}

type DashboardCard =
  | PendingPaymentCard
  | ContractCard
  | CalendarCard
  | ReturnOpenCard
  | VehicleRentedCard
  | FleetCard
  | MaintenanceOverdueCard
  | MaintenanceDueSoonCard;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, TranslatePipe, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private firestore = inject(Firestore);
  private router = inject(Router);

  loading = true;
  cards: DashboardCard[] = [];

  /** Some data could not be loaded, so the cards shown are incomplete. */
  partialFailure = false;
  /** Nothing could be loaded at all. */
  loadFailed = false;

  ngOnInit(): void {
    this.loadDashboard();
  }

  private async loadDashboard(): Promise<void> {
    this.loading = true;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    try {
      // Reservations: all in active states (not closed/cancelled)
      const reservationsRef = collection(this.firestore, 'reservations');
      const reservationsSnap = await getDocs(
        query(
          reservationsRef,
          where('reservationStatus', 'in', ['reserved', 'confirmed', 'delivered', 'returned'])
        )
      );
      const reservations = reservationsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Reservation
      );

      // Contracts awaiting signature
      const contractsRef = collection(this.firestore, 'contracts');
      const contractsSnap = await getDocs(
        query(contractsRef, where('status', '==', 'pending_signature'))
      );
      const pendingContracts = contractsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Contract
      );

      // Vehicles
      const vehiclesRef = collection(this.firestore, 'vehicles');
      const vehiclesSnap = await getDocs(vehiclesRef);
      const vehicles = vehiclesSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Vehicle
      );

      // Maintenance is queried separately and its failure is contained.
      //
      // It used to sit inside the same try as the three queries above, so a
      // permission error on `vehicleMaintenance` threw away the reservations,
      // contracts and vehicles that had already loaded fine. The dashboard then
      // rendered its empty state — telling the operator "all clear" when in
      // reality nothing had loaded. A degraded dashboard is fine; a dashboard
      // that silently claims there is nothing to do is not.
      let maintenanceItems: VehicleMaintenance[] = [];
      try {
        const maintenanceRef = collection(this.firestore, 'vehicleMaintenance');
        const maintenanceSnap = await getDocs(
          query(maintenanceRef, where('status', 'in', ['pending', 'scheduled', 'overdue']))
        );
        maintenanceItems = maintenanceSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as VehicleMaintenance
        );
      } catch (error) {
        console.error('Dashboard: no se pudo cargar el mantenimiento', error);
        this.partialFailure = true;
      }

      this.cards = this.buildCards(
        reservations,
        pendingContracts,
        vehicles,
        maintenanceItems,
        todayStart,
        todayEnd
      );
    } catch (error) {
      console.error('Dashboard load error:', error);
      this.cards = [];
      this.loadFailed = true;
    } finally {
      this.loading = false;
    }
  }

  private buildCards(
    reservations: Reservation[],
    pendingContracts: Contract[],
    vehicles: Vehicle[],
    maintenanceItems: VehicleMaintenance[],
    todayStart: Date,
    todayEnd: Date
  ): DashboardCard[] {
    const cards: DashboardCard[] = [];

    // 1) Reservations awaiting first payment (signal not paid).
    const pendingPayments: PendingPaymentCard[] = reservations
      .filter((r) => {
        const initial = r.paymentSummary?.initialPaymentRequired || 0;
        const paid = r.paymentSummary?.initialPaymentPaid || 0;
        return initial > 0 && paid < initial;
      })
      .map((r) => ({
        type: 'pending_payment',
        reservation: r,
        pendingAmount:
          (r.paymentSummary?.initialPaymentRequired || 0) -
          (r.paymentSummary?.initialPaymentPaid || 0)
      }));

    // 2) Contracts awaiting signature.
    const contractCards: ContractCard[] = pendingContracts.map((c) => ({
      type: 'pending_signature',
      contract: c
    }));

    // 3) Pickups scheduled for today (status: reserved/confirmed).
    const pickupsToday: CalendarCard[] = reservations
      .filter((r) => {
        if (!['reserved', 'confirmed'].includes(r.reservationStatus)) return false;
        const pickup = this.toDateSafe(r.pickupDateTime);
        return pickup ? pickup >= todayStart && pickup <= todayEnd : false;
      })
      .map((r) => ({ type: 'pickup_today', reservation: r }));

    // 4) Returns scheduled for today (status: delivered).
    const returnsToday: CalendarCard[] = reservations
      .filter((r) => {
        if (r.reservationStatus !== 'delivered') return false;
        const ret = this.toDateSafe(r.returnDateTime);
        return ret ? ret >= todayStart && ret <= todayEnd : false;
      })
      .map((r) => ({ type: 'return_today', reservation: r }));

    // 5) Returns pending close (deposit unsettled).
    const returnsOpen: ReturnOpenCard[] = reservations
      .filter((r) => {
        if (r.reservationStatus !== 'returned') return false;
        const d = r.deposit;
        if (!d) return true;
        if ((d.requiredAmount || 0) === 0) return !d.waivedReason;
        return (
          (d.returnedAmount || 0) + (d.retainedAmount || 0) < (d.requiredAmount || 0)
        );
      })
      .map((r) => ({ type: 'return_open', reservation: r }));

    // 6) Vehicles currently rented.
    const rentedVehicles: VehicleRentedCard[] = vehicles
      .filter((v) => v.status === 'rented')
      .map((v) => ({ type: 'vehicle_rented', vehicle: v }));

    // 7) Fleet availability.
    const total = vehicles.length;
    const rented = vehicles.filter((v) => v.status === 'rented').length;
    const available = vehicles.filter((v) => v.status === 'available').length;
    cards.push({
      type: 'fleet',
      rented,
      available,
      total
    });

    // 8) Maintenance overdue.
    const now = new Date();
    const horizon = new Date(now.getTime() + MAINTENANCE_DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
    const overdueItems = maintenanceItems.filter((m) => {
      if (!m.nextDueDate) return false;
      const d = this.toDateSafe(m.nextDueDate);
      return d ? d.getTime() < now.getTime() : false;
    });
    if (overdueItems.length) {
      cards.push({ type: 'maintenance_overdue', items: overdueItems });
    }

    // 9) Maintenance due soon (next 30 days).
    const dueSoonItems = maintenanceItems.filter((m) => {
      if (!m.nextDueDate) return false;
      const d = this.toDateSafe(m.nextDueDate);
      return d ? d.getTime() >= now.getTime() && d.getTime() <= horizon.getTime() : false;
    });
    if (dueSoonItems.length) {
      cards.push({ type: 'maintenance_due_soon', items: dueSoonItems });
    }

    // Add actionable cards (skip empty ones to avoid noise).
    if (pendingPayments.length) {
      cards.push(...pendingPayments);
    }
    if (contractCards.length) {
      cards.push(...contractCards);
    }
    if (pickupsToday.length) {
      cards.push(...pickupsToday);
    }
    if (returnsToday.length) {
      cards.push(...returnsToday);
    }
    if (returnsOpen.length) {
      cards.push(...returnsOpen);
    }
    if (rentedVehicles.length) {
      cards.push(...rentedVehicles);
    }

    return cards;
  }

  toDateSafe(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value.seconds) return new Date(value.seconds * 1000);
    return null;
  }

  // === Click navigation ===

  openReservation(reservationId?: string): void {
    if (reservationId) this.router.navigate(['/reservations', reservationId]);
  }

  openContract(contractId?: string): void {
    if (contractId) this.router.navigate(['/contracts', contractId]);
  }

  openReservationsWithPendingPayment(): void {
    this.router.navigate(['/reservations'], { queryParams: { filter: 'pending_payment' } });
  }

  openContractsPendingSignature(): void {
    this.router.navigate(['/contracts'], { queryParams: { status: 'pending_signature' } });
  }

  openReservationsForToday(type: 'pickup_today' | 'return_today'): void {
    this.router.navigate(['/reservations'], { queryParams: { today: type } });
  }

  openReservationsReturnedOpen(): void {
    this.router.navigate(['/reservations'], { queryParams: { status: 'returned' } });
  }

  openVehicles(status?: string): void {
    this.router.navigate(['/vehicles'], { queryParams: status ? { status } : undefined });
  }

  openVehicle(vehicleId?: string): void {
    if (vehicleId) this.router.navigate(['/vehicles', vehicleId]);
  }

  /**
   * Open the vehicle that owns the maintenance record, jumping
   * straight to the Maintenance tab.  Vehicle-detail honours the
   * optional `?tab=maintenance` query param.
   */
  openVehicleMaintenanceTab(vehicleId?: string): void {
    if (vehicleId) {
      this.router.navigate(['/vehicles', vehicleId], { queryParams: { tab: 'maintenance' } });
    }
  }

  formatTime(d: Date): string {
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }
}
