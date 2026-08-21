import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { Reservation } from '@shared/models/reservation.model';
import { toDate } from '@shared/utils/reservation-date.util';
import { RESERVATION_STATUS_LABELS } from '@shared/models/reservation.model';

interface DayCell {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  reservations: ReservationWithSegments[];
}

interface ReservationWithSegments extends Reservation {
  /** Segments for this day only (clipped to the day boundary). */
  startsHere: boolean;
  endsHere: boolean;
  continuesFrom: boolean;
  continuesTo: boolean;
}

/**
 * Visual month grid for reservations.
 *
 * Each day cell shows up to 3 reservation bars (truncated to fit).
 * Tap on a day cell opens the day's reservation list (modal handled
 * by the parent page).
 *
 * Mobile-first: a 7-column CSS grid that scales fluidly.  Each
 * cell is at least 80px tall on phone, 120px on desktop.
 */
@Component({
  selector: 'app-month-grid',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './month-grid.component.html',
  styleUrl: './month-grid.component.scss'
})
export class MonthGridComponent {
  @Input({ required: true }) month!: Date;
  @Input() reservations: Reservation[] = [];

  @Output() dayClick = new EventEmitter<Date>();
  @Output() reservationClick = new EventEmitter<Reservation>();

  /** Returns the calendar grid: 6 rows × 7 columns of DayCell. */
  get cells(): DayCell[] {
    const firstOfMonth = new Date(this.month.getFullYear(), this.month.getMonth(), 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - firstWeekday);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cells: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      d.setHours(0, 0, 0, 0);

      cells.push({
        date: d,
        inMonth: d.getMonth() === this.month.getMonth(),
        isToday: d.getTime() === today.getTime(),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        reservations: this.getDayReservations(d)
      });
    }
    return cells;
  }

  weekdayLabels(): string[] {
    // Monday first.
    return ['calendar.weekdays.mon', 'calendar.weekdays.tue', 'calendar.weekdays.wed', 'calendar.weekdays.thu', 'calendar.weekdays.fri', 'calendar.weekdays.sat', 'calendar.weekdays.sun']
      .map((k) => k);
  }

  /** Returns the reservations whose date range overlaps `day` (clipped). */
  private getDayReservations(day: Date): ReservationWithSegments[] {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    return this.reservations
      .filter((r) => {
        const pickup = toDate(r.pickupDateTime);
        const ret = toDate(r.returnDateTime);
        return pickup <= dayEnd && ret >= dayStart;
      })
      .map((r) => {
        const pickup = toDate(r.pickupDateTime);
        const ret = toDate(r.returnDateTime);
        const pickupDay = new Date(pickup);
        pickupDay.setHours(0, 0, 0, 0);
        const retDay = new Date(ret);
        retDay.setHours(0, 0, 0, 0);
        return {
          ...r,
          startsHere: pickupDay.getTime() === dayStart.getTime(),
          endsHere: retDay.getTime() === dayStart.getTime(),
          continuesFrom: pickupDay.getTime() < dayStart.getTime(),
          continuesTo: retDay.getTime() > dayStart.getTime()
        };
      });
  }

  /** Status → CSS modifier for the reservation bar. */
  statusClass(r: Reservation): string {
    return 'status-' + r.reservationStatus;
  }

  /** Short label for the reservation bar. */
  shortLabel(r: Reservation): string {
    return r.clientSnapshot?.fullName || r.vehicleSnapshot?.plateNumber || '—';
  }

  /** Click handlers */
  onDayClick(d: DayCell): void {
    this.dayClick.emit(d.date);
  }

  onReservationClick(event: MouseEvent, r: Reservation): void {
    event.stopPropagation();
    this.reservationClick.emit(r);
  }

  private translateService = inject(TranslateService);

  /**
   * Status label for accessibility. RESERVATION_STATUS_LABELS holds i18n keys,
   * so the key is resolved here rather than relying on a `| translate` in the
   * template.
   */
  statusLabel(status: string): string {
    const key = RESERVATION_STATUS_LABELS[status as keyof typeof RESERVATION_STATUS_LABELS];
    return key ? this.translateService.translate(key) : status;
  }
}
