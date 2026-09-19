import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { Reservation } from '@shared/models/reservation.model';
import { TranslateService } from '@core/i18n/translate.service';
import { toDate } from '@shared/utils/reservation-date.util';
import { MonthGridComponent } from './components/month-grid/month-grid.component';
import { firstValueFrom } from 'rxjs';

interface DayReservations {
  date: Date;
  reservations: Reservation[];
}

/** Cuánto hay que arrastrar el dedo para que cuente como cambio de mes. */
const SWIPE_MIN_PX = 60;

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
  loading = signal(true);

  /**
   * Todas las reservas, sin recortar por fecha.
   *
   * ⚠️ **Aquí había un filtro que se cargaba el calendario entero.** Recortaba a
   * una ventana de tres meses **alrededor de HOY** —no del mes que se está
   * mirando—, así que al avanzar dos meses la rejilla salía vacía aunque
   * hubiera reservas. Quién decide qué se pinta en cada día es
   * `MonthGridComponent`, que ya filtra celda a celda: la ventana no ahorraba
   * nada y solo escondía reservas.
   */
  reservations = signal<Reservation[]>([]);

  /** Day detail modal */
  dayDetail = signal<DayReservations | null>(null);

  /** El mes en curso, para el título y para el gesto de deslizar. */
  monthTitle = computed(() => {
    const d = this.currentMonth();
    /**
     * ⚠️ **La primera letra, no cada palabra.** El SCSS llevaba
     * `text-transform: capitalize`, que capitaliza **todas**: «Septiembre De
     * 2026». En español la preposición va en minúscula — es la misma regla que
     * ya se aplica a «Arganda del Rey» en los topónimos.
     */
    const texto = d.toLocaleDateString(this.locale, { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  });

  ngOnInit(): void {
    void this.loadReservations();
  }

  private async loadReservations(): Promise<void> {
    this.loading.set(true);
    try {
      /**
       * `getReservations()` es una lectura de una vez, así que `firstValueFrom`
       * resuelve y se acabó. No es un `watch…`: el calendario se mira, no se
       * vigila, y quien quiera lo último tiene el botón de hoy y la navegación.
       */
      this.reservations.set(await firstValueFrom(this.reservationService.getReservations()));
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
    return this.monthTitle();
  }

  // -------------------------------------------------------------------------
  // Deslizar para cambiar de mes
  //
  // ⚠️ **Solo cuenta el gesto claramente horizontal.** Sin comparar contra el
  // desplazamiento vertical, bajar por el calendario con el dedo cambiaba de
  // mes a media lectura. Y el umbral no es cosmético: un toque normal mueve
  // unos pocos píxeles, así que sin él pulsar un día saltaría de mes.
  //
  // Va en el componente y no en una directiva compartida porque no hay una
  // segunda pantalla que deslice: inventar una API compartida para un solo uso
  // es otra cosa que mantener.
  // -------------------------------------------------------------------------

  private touchX = 0;
  private touchY = 0;

  onTouchStart(event: TouchEvent): void {
    const t = event.changedTouches[0];
    this.touchX = t.clientX;
    this.touchY = t.clientY;
  }

  onTouchEnd(event: TouchEvent): void {
    // Con el detalle del día abierto el gesto es suyo: cambiar de mes por
    // debajo de una modal dejaría al operador mirando otro mes al cerrarla.
    if (this.dayDetail()) return;

    const t = event.changedTouches[0];
    const dx = t.clientX - this.touchX;
    const dy = t.clientY - this.touchY;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;

    // Arrastrar hacia la izquierda trae el mes siguiente, como pasar una hoja.
    if (dx < 0) this.nextMonth();
    else this.prevMonth();
  }

  // -------------------------------------------------------------------------
  // Detalle del día
  // -------------------------------------------------------------------------

  onDayClick(date: Date): void {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    /**
     * ⚠️ **Las fechas se convierten con `toDate()`, la única autoridad.** Aquí
     * había una conversión escrita a mano que solo entendía un `Timestamp` del
     * SDK con su `.toDate()`, y **esta aplicación no guarda eso**: `toTimestamp()`
     * escribe un mapa `{ seconds, nanoseconds }` normal. Así que
     * `new Date({seconds})` daba **Invalid Date**, toda comparación salía falsa
     * y no aparecía ninguna reserva — ni en la rejilla ni aquí.
     */
    const hits = this.reservations()
      .filter((r) => toDate(r.pickupDateTime) <= dayEnd && toDate(r.returnDateTime) >= day)
      .sort((a, b) => toDate(a.pickupDateTime).getTime() - toDate(b.pickupDateTime).getTime());

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

  // -------------------------------------------------------------------------
  // Lo que el operador necesita leer de un vistazo en el detalle del día
  // -------------------------------------------------------------------------

  /** «Dacia Duster · 1234JKL». El coche es lo que se pregunta el operador. */
  vehicleLabel(r: Reservation): string {
    const v = r.vehicleSnapshot;
    const modelo = [v?.brand, v?.model].filter(Boolean).join(' ');
    return modelo || v?.plateNumber || '—';
  }

  /**
   * Qué pasa **ese día** con esta reserva: se entrega, se devuelve, o el coche
   * sigue fuera.
   *
   * ⚠️ Sin esto, un día con cuatro reservas es una lista de cuatro nombres y hay
   * que abrir cada uno para saber cuál toca hoy. Es justo lo que se mira el
   * calendario por la mañana.
   */
  dayRole(r: Reservation): 'pickup' | 'return' | 'ongoing' {
    const day = this.dayDetail()?.date;
    if (!day) return 'ongoing';
    if (this.sameDay(toDate(r.pickupDateTime), day)) return 'pickup';
    if (this.sameDay(toDate(r.returnDateTime), day)) return 'return';
    return 'ongoing';
  }

  /** La hora del hito del día, o '' cuando el coche solo está fuera. */
  dayTime(r: Reservation): string {
    const rol = this.dayRole(r);
    if (rol === 'ongoing') return '';
    const fecha = toDate(rol === 'pickup' ? r.pickupDateTime : r.returnDateTime);
    return fecha.toLocaleTimeString(this.locale, { hour: '2-digit', minute: '2-digit' });
  }

  private sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
}
