import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { Reservation } from '@shared/models/reservation.model';
import { TranslateService } from '@core/i18n/translate.service';
import { MonthGridComponent } from './components/month-grid/month-grid.component';

interface DayReservations {
  date: Date;
  reservations: Reservation[];
}

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MonthGridComponent],
  templateUrl: './calendar.component.html',
  styleUrl: './calendar.component.scss'
})
export class CalendarComponent implements OnInit {
  private reservationService = inject(ReservationService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  /**
   * El idioma de la aplicación, no el del documento.
   *
   * ⚠️ **Esto leía `document.documentElement.lang`, que no lo escribe nadie.**
   * Valía lo que pusiera `index.html` y no cambiaba nunca, así que el
   * calendario salía **siempre en español** aunque la plataforma estuviera en
   * inglés o en rumano — y no daba ningún error, solo un mes en el idioma que
   * no toca. Mismo caso que los meses del eje de Informes.
   */
  private get locale(): string {
    return this.translate.language();
  }

  currentMonth = signal(new Date());
  reservations = signal<Reservation[]>([]);
  loading = signal(true);

  // Day detail modal
  dayDetail = signal<DayReservations | null>(null);

  ngOnInit(): void {
    this.loadReservations();
  }

  private async loadReservations(): Promise<void> {
    this.loading.set(true);
    // Pull a 3-month window centered on the current month so the
    // grid shows overlap and the user can navigate freely.
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    try {
      const all = await new Promise<Reservation[]>((resolve, reject) => {
        this.reservationService.getReservations().subscribe({
          next: (rows) => resolve(rows),
          error: (e) => reject(e)
        });
      });
      const filtered = all.filter((r) => {
        // Cheap date check — we just want non-cancelled reservations
        // touching the visible window.  MonthGridComponent does the
        // exact per-day filtering.
        if (r.reservationStatus === 'cancelled') return true; // keep for transparency
        const pickup = (r.pickupDateTime as any)?.toDate
          ? (r.pickupDateTime as any).toDate()
          : new Date(r.pickupDateTime);
        const ret = (r.returnDateTime as any)?.toDate
          ? (r.returnDateTime as any).toDate()
          : new Date(r.returnDateTime);
        return pickup <= end && ret >= start;
      });
      this.reservations.set(filtered);
    } finally {
      this.loading.set(false);
    }
  }

  prevMonth(): void {
    const d = this.currentMonth();
    this.currentMonth.set(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  nextMonth(): void {
    const d = this.currentMonth();
    this.currentMonth.set(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  today(): void {
    this.currentMonth.set(new Date());
  }

  monthLabel(): string {
    const d = this.currentMonth();
    // Locale-aware (es, en, ro).
    /**
     * ⚠️ **La primera letra, no cada palabra.** El SCSS llevaba
     * `text-transform: capitalize`, que capitaliza **todas**: «Septiembre De
     * 2026». En español la preposición va en minúscula — es la misma regla que
     * ya se aplica a «Arganda del Rey» en los topónimos.
     */
    const texto = d.toLocaleDateString(this.locale, { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  onDayClick(date: Date): void {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const hits = this.reservations().filter((r) => {
      const pickup = (r.pickupDateTime as any)?.toDate
        ? (r.pickupDateTime as any).toDate()
        : new Date(r.pickupDateTime);
      const ret = (r.returnDateTime as any)?.toDate
        ? (r.returnDateTime as any).toDate()
        : new Date(r.returnDateTime);
      return pickup <= dayEnd && ret >= day;
    });
    this.dayDetail.set({ date: day, reservations: hits });
  }

  closeDayDetail(): void {
    this.dayDetail.set(null);
  }

  onReservationClick(r: Reservation): void {
    this.router.navigate(['/reservations', r.id]);
  }

  dayDetailDate(): string {
    const d = this.dayDetail()?.date;
    if (!d) return '';
    const texto = d.toLocaleDateString(this.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
}
