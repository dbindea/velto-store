import { Component, EventEmitter, Output, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { Reservation } from '@shared/models/reservation.model';
import {
  DateRange,
  DayState,
  EMPTY_RANGE,
  RangePosition,
  dayKey,
  dayState,
  occupiedDays,
  pickDay,
  rangePosition,
  rentalDays
} from '@shared/utils/availability-calendar.util';

interface Celda {
  fecha: Date;
  dia: number;
  delMes: boolean;
  hoy: boolean;
  estado: DayState;
  posicion: RangePosition;
}

/**
 * El calendario de disponibilidad de UN coche.
 *
 * Lo pidió Dorel el 5 de noviembre de 2026: «si alguien me pide alquilar este
 * coche, me gustaría poder realizar una reserva, ver el calendario de
 * disponibilidad al igual que en la web pública».
 *
 * ⚠️ **No decide nada: todo lo que se puede calcular mal vive en
 * `availability-calendar.util.ts`, con tests.** Es la misma razón que el QR del
 * contrato y el aspa de los campos: un calendario mal calculado tiene
 * exactamente la misma pinta que uno bueno, y lo que se rompe en silencio
 * —ofrecer un día ocupado, cerrar un rango por encima de una reserva— acaba en
 * un cliente que se planta a por un coche que no está.
 *
 * ⚠️ **Y no crea la reserva ni comprueba la disponibilidad de verdad.** Lo que
 * hace es rellenar las fechas del asistente; quien dice que sí es
 * `searchAvailability()`, y después `createReservationWithClient()`. Un
 * calendario que diera por buena una fecha sería una segunda autoridad sobre
 * cuándo se puede alquilar.
 */
@Component({
  selector: 'app-availability-calendar',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './availability-calendar.component.html',
  styleUrl: './availability-calendar.component.scss'
})
export class AvailabilityCalendarComponent {
  private translateService = inject(TranslateService);

  readonly reservations = input<Reservation[]>([]);
  /** La reserva que se está editando: no debe bloquearse a sí misma. */
  readonly excludeReservationId = input<string | undefined>(undefined);
  readonly loading = input(false);

  /** Se emite **solo con el rango cerrado**: media selección no es una fecha. */
  @Output() rangePicked = new EventEmitter<DateRange>();

  private readonly hoy = new Date();
  readonly mes = signal(new Date(this.hoy.getFullYear(), this.hoy.getMonth(), 1));
  readonly rango = signal<DateRange>(EMPTY_RANGE);

  readonly ocupados = computed(() =>
    occupiedDays(this.reservations(), this.excludeReservationId())
  );

  /**
   * ⚠️ **`computed()` y no un getter.** Son 42 celdas × todas las reservas del
   * coche: en un getter se recalcularía en cada ciclo de detección de cambios,
   * que es exactamente el fallo que tuvo el calendario de la aplicación.
   */
  readonly celdas = computed<Celda[]>(() => {
    const mes = this.mes();
    const ocupados = this.ocupados();
    const rango = this.rango();
    const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
    // Lunes primero, como el resto de la aplicación.
    const desplazamiento = (primero.getDay() + 6) % 7;
    const inicio = new Date(primero);
    inicio.setDate(primero.getDate() - desplazamiento);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const celdas: Celda[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      d.setHours(0, 0, 0, 0);
      celdas.push({
        fecha: d,
        dia: d.getDate(),
        delMes: d.getMonth() === mes.getMonth(),
        hoy: d.getTime() === hoy.getTime(),
        estado: dayState(d, ocupados, hoy),
        posicion: rangePosition(d, rango)
      });
    }
    return celdas;
  });

  readonly dias = computed(() => rentalDays(this.rango()));

  readonly weekdayKeys = [
    'calendar.weekdays.mon',
    'calendar.weekdays.tue',
    'calendar.weekdays.wed',
    'calendar.weekdays.thu',
    'calendar.weekdays.fri',
    'calendar.weekdays.sat',
    'calendar.weekdays.sun'
  ];

  /**
   * El rótulo del mes.
   *
   * ⚠️ **En mayúscula solo la PRIMERA letra, nunca `text-transform: capitalize`**,
   * que en español capitaliza todas las palabras: «Noviembre De 2026». Ya pasó
   * dos veces en el calendario de la aplicación.
   */
  etiquetaMes(): string {
    const lang = this.translateService.language();
    const texto = this.mes().toLocaleDateString(lang, { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  mesAnterior(): void {
    const m = this.mes();
    this.mes.set(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }

  mesSiguiente(): void {
    const m = this.mes();
    this.mes.set(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  /** ¿Se puede retroceder? No tiene sentido pasear por meses ya pasados. */
  get puedeRetroceder(): boolean {
    const m = this.mes();
    const hoy = new Date();
    return m.getFullYear() > hoy.getFullYear() || m.getMonth() > hoy.getMonth();
  }

  pulsar(celda: Celda): void {
    if (celda.estado !== 'libre') return;
    const siguiente = pickDay(this.rango(), celda.fecha, this.ocupados());
    this.rango.set(siguiente);
    if (siguiente.desde && siguiente.hasta) this.rangePicked.emit(siguiente);
  }

  limpiar(): void {
    this.rango.set(EMPTY_RANGE);
  }

  /** Para el `title` de cada celda: la fecha completa, que el número no basta. */
  tituloCelda(celda: Celda): string {
    const lang = this.translateService.language();
    const fecha = celda.fecha.toLocaleDateString(lang, {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    const estado = this.translateService.translate(
      celda.estado === 'ocupado'
        ? 'reservations.availabilityCalendar.occupied'
        : celda.estado === 'pasado'
          ? 'reservations.availabilityCalendar.past'
          : 'reservations.availabilityCalendar.free'
    );
    return `${fecha} — ${estado}`;
  }

  claveDia(_i: number, celda: Celda): string {
    return dayKey(celda.fecha);
  }
}
