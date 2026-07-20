import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  getDocs
} from '@angular/fire/firestore';
import { Observable, forkJoin, from, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reservation } from '@shared/models/reservation.model';
import { Vehicle } from '@shared/models/vehicle.model';
import { Payment } from '@shared/models/payment.model';
import { toDate } from '@shared/utils/reservation-date.util';

export interface MonthlyRevenuePoint {
  /** First day of the month (UTC midnight). */
  date: Date;
  /** Sum of paid payment amounts in this month. */
  revenue: number;
  /** Number of reservations that overlapped this month. */
  reservationCount: number;
}

export interface VehicleRevenue {
  vehicleId: string;
  brand: string;
  model: string;
  plateNumber: string;
  revenue: number;
  reservationCount: number;
}

export interface FleetUtilization {
  /** Sum of reserved days across all reservations / days in window. */
  utilizationPct: number;
  totalReservationDays: number;
  totalFleetDays: number;
  reservationCount: number;
}

export interface OutstandingBalance {
  reservationId: string;
  clientName: string;
  vehiclePlate: string;
  pendingAmount: number;
  pickupDate: Date;
}

export interface ReportsSnapshot {
  monthlyRevenue: MonthlyRevenuePoint[];
  topVehicles: VehicleRevenue[];
  utilization: FleetUtilization;
  outstandingBalances: OutstandingBalance[];
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Pure-aggregation reports service.  Pulls all reservations,
 * vehicles and payments once and computes KPIs in-memory so we
 * don't add a Cloud Function roundtrip for every report load.
 *
 * The default window is the last 6 months.  Callers can pass a
 * different range via the public `compute(windowStart, windowEnd)`
 * entry point.
 */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private firestore = inject(Firestore);

  compute(windowStart?: Date, windowEnd?: Date): Observable<ReportsSnapshot> {
    const end = windowEnd || new Date();
    const start =
      windowStart ||
      new Date(end.getFullYear(), end.getMonth() - 5, 1);

    return forkJoin({
      reservations: this.fetchReservations(),
      vehicles: this.fetchVehicles(),
      payments: this.fetchPayments()
    }).pipe(
      map(({ reservations, vehicles, payments }) =>
        this.aggregate(reservations, vehicles, payments, start, end)
      )
    );
  }

  // ---- Fetchers ----

  private fetchReservations(): Observable<Reservation[]> {
    return from(getDocs(collection(this.firestore, 'reservations'))).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Reservation))
    );
  }

  private fetchVehicles(): Observable<Vehicle[]> {
    return from(getDocs(collection(this.firestore, 'vehicles'))).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Vehicle))
    );
  }

  private fetchPayments(): Observable<Payment[]> {
    return from(getDocs(collection(this.firestore, 'payments'))).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Payment))
    );
  }

  // ---- Aggregators ----

  private aggregate(
    reservations: Reservation[],
    vehicles: Vehicle[],
    payments: Payment[],
    start: Date,
    end: Date
  ): ReportsSnapshot {
    const inWindow = reservations.filter((r) => {
      const pickup = toDate(r.pickupDateTime);
      const ret = toDate(r.returnDateTime);
      return pickup <= end && ret >= start;
    });

    return {
      monthlyRevenue: this.computeMonthlyRevenue(inWindow, payments, start, end),
      topVehicles: this.computeTopVehicles(inWindow, payments, vehicles),
      utilization: this.computeUtilization(inWindow, vehicles, start, end),
      outstandingBalances: this.computeOutstandingBalances(reservations),
      windowStart: start,
      windowEnd: end
    };
  }

  private computeMonthlyRevenue(
    reservations: Reservation[],
    payments: Payment[],
    start: Date,
    end: Date
  ): MonthlyRevenuePoint[] {
    // Bucket per month.
    const points: MonthlyRevenuePoint[] = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const monthStart = new Date(cursor);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);

      // Sum of paid payments whose paidAt falls in this month.
      const revenue = payments
        .filter((p) => {
          if (p.status !== 'paid') return false;
          if (!p.paidAt) return false;
          const t = toDate(p.paidAt);
          return t >= monthStart && t <= monthEnd;
        })
        .reduce((sum, p) => sum + (p.paidAmount || 0), 0);

      // Number of reservations that overlap the month.
      const reservationCount = reservations.filter((r) => {
        const pickup = toDate(r.pickupDateTime);
        const ret = toDate(r.returnDateTime);
        return pickup <= monthEnd && ret >= monthStart;
      }).length;

      points.push({
        date: monthStart,
        revenue: Math.round(revenue * 100) / 100,
        reservationCount
      });

      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return points;
  }

  private computeTopVehicles(
    reservations: Reservation[],
    payments: Payment[],
    vehicles: Vehicle[]
  ): VehicleRevenue[] {
    // Group revenue by vehicleId.
    const byVehicle = new Map<string, { revenue: number; count: number }>();
    for (const p of payments) {
      if (p.status !== 'paid') continue;
      if (!p.reservationId) continue;
      const r = reservations.find((x) => x.id === p.reservationId);
      if (!r) continue;
      const cur = byVehicle.get(r.vehicleId) || { revenue: 0, count: 0 };
      cur.revenue += p.paidAmount || 0;
      cur.count += 1;
      byVehicle.set(r.vehicleId, cur);
    }
    return Array.from(byVehicle.entries())
      .map(([vehicleId, v]) => {
        const veh = vehicles.find((x) => x.id === vehicleId);
        return {
          vehicleId,
          brand: veh?.brand || '—',
          model: veh?.model || '—',
          plateNumber: veh?.plateNumber || '—',
          revenue: Math.round(v.revenue * 100) / 100,
          reservationCount: v.count
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }

  private computeUtilization(
    reservations: Reservation[],
    vehicles: Vehicle[],
    start: Date,
    end: Date
  ): FleetUtilization {
    const days = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    );
    const fleetSize = vehicles.length;
    const totalFleetDays = fleetSize * days;
    let totalReservationDays = 0;
    for (const r of reservations) {
      if (r.reservationStatus === 'cancelled') continue;
      const pickup = toDate(r.pickupDateTime);
      const ret = toDate(r.returnDateTime);
      const overlapStart = pickup > start ? pickup : start;
      const overlapEnd = ret < end ? ret : end;
      if (overlapEnd <= overlapStart) continue;
      const overlapDays =
        Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      totalReservationDays += Math.max(1, overlapDays);
    }
    const utilizationPct =
      totalFleetDays > 0
        ? Math.min(100, Math.round((totalReservationDays / totalFleetDays) * 1000) / 10)
        : 0;
    return {
      utilizationPct,
      totalReservationDays,
      totalFleetDays,
      reservationCount: reservations.length
    };
  }

  private computeOutstandingBalances(reservations: Reservation[]): OutstandingBalance[] {
    const out: OutstandingBalance[] = [];
    for (const r of reservations) {
      if (r.reservationStatus === 'closed' || r.reservationStatus === 'cancelled') continue;
      const pending = r.paymentSummary?.totalPending || 0;
      if (pending <= 0) continue;
      out.push({
        reservationId: r.id || '',
        clientName: r.clientSnapshot?.fullName || '—',
        vehiclePlate: r.vehicleSnapshot?.plateNumber || '—',
        pendingAmount: Math.round(pending * 100) / 100,
        pickupDate: toDate(r.pickupDateTime)
      });
    }
    return out
      .sort((a, b) => b.pendingAmount - a.pendingAmount)
      .slice(0, 10);
  }
}
