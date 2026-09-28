import { DatePickerDirective } from '@shared/directives/date-picker.directive';
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import {
  Firestore,
  collection,
  getDocs,
  query,
  where
} from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { NotificationService } from '@core/notifications/notification.service';
import { ConfirmService } from '@core/notifications/confirm.service';
import { AuthService } from '@core/auth/auth.service';
import { ReminderService } from '@features/events/services/reminder.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import {
  REMINDER_CATEGORIES,
  REMINDER_CATEGORY_ICONS,
  REMINDER_CATEGORY_LABELS,
  Reminder,
  ReminderCategory
} from '@shared/models/reminder.model';
import { VehicleMaintenance } from '@shared/models/vehicle-maintenance.model';
import { Invoice } from '@shared/models/invoice.model';
import {
  DEFAULT_EVENT_HORIZON,
  EVENT_HORIZONS,
  UpcomingEvent,
  buildEventList,
  daysUntil,
  reminderToEvent
} from '@shared/utils/events.util';
import { can } from '@shared/utils/permissions.util';
import { toDate } from '@shared/utils/reservation-date.util';
import { invoiceDeadlineFor } from '@shared/utils/invoice.util';
import {
  BLOCKING_MAINTENANCE_TYPES,
  maintenanceOverdue
} from '@shared/utils/vehicle-availability.util';
import { ClearInputDirective } from '@shared/directives/clear-input.directive';

/**
 * Eventos próximos: todo lo que hay que hacer, mezclado y en una sola lista.
 *
 * ⚠️ **Los eventos derivados no se guardan.** Una entrega ya está en su reserva
 * y una ITV en su mantenimiento; copiarlos aquí sería una segunda fuente de
 * verdad que se queda vieja en cuanto alguien mueve una fecha. Se derivan al
 * abrir la pantalla, y por eso hace falta pulsar recargar para verlos frescos —
 * no hay nada que sincronizar.
 *
 * ⚠️ **Y no repite lo que ya se ve donde se trabaja.** Un aviso que duplica la
 * pantalla en la que ya estás hace que la lista se lea por encima, y una lista
 * de avisos que se lee por encima es peor que no tenerla.
 */
@Component({
  selector: 'app-event-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, DatePickerDirective, ClearInputDirective],
  templateUrl: './event-list.component.html',
  styleUrl: './event-list.component.scss'
})
export class EventListComponent implements OnInit {
  private firestore = inject(Firestore);
  private reminders = inject(ReminderService);
  private reservations = inject(ReservationService);
  private vehicles = inject(VehicleService);
  private notifications = inject(NotificationService);
  private confirm = inject(ConfirmService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly horizon = signal<number>(DEFAULT_EVENT_HORIZON);
  readonly showDone = signal(false);
  readonly horizons = EVENT_HORIZONS;

  private readonly derived = signal<UpcomingEvent[]>([]);
  private readonly reminderList = signal<Reminder[]>([]);

  categories = REMINDER_CATEGORIES;
  categoryLabels = REMINDER_CATEGORY_LABELS;
  categoryIcons = REMINDER_CATEGORY_ICONS;

  /** La lista final, ya filtrada y ordenada. */
  readonly events = computed(() =>
    buildEventList(
      [
        ...this.derived(),
        ...this.reminderList().map((r) => {
          const d = r.dueDate ? toDate(r.dueDate) : new Date();
          return reminderToEvent(r, d);
        })
      ],
      { horizon: this.horizon(), showDone: this.showDone() }
    )
  );

  /** Cuántos hay ya vencidos. Es lo que decide si la pantalla grita o no. */
  readonly overdue = computed(() => this.events().filter((e) => daysUntil(e.date) < 0).length);

  // --- Formulario de recordatorio -----------------------------------------
  readonly showForm = signal(false);
  readonly saving = signal(false);
  editingId: string | null = null;
  form = this.emptyForm();

  async ngOnInit(): Promise<void> {
    /**
     * ⚠️ **El plazo se puede traer en la URL**, y existe por el panel: sus
     * tarjetas de mantenimiento dicen «Ver todo» sobre una lista de 30 días, y
     * sin esto aterrizaban aquí con el plazo por defecto de 7 — o sea que el
     * operador veía **menos** de lo que la tarjeta le acababa de prometer. Es la
     * misma clase de falsedad que se está corrigiendo en el panel.
     *
     * Solo se admiten los plazos que la pantalla ofrece: un valor inventado en
     * la barra de direcciones deja el que ya había.
     *
     * ⚠️ **Se mira la cadena CRUDA antes de convertir, y no es quisquillosería:
     * `Number(null)` es `0`, no `NaN`** — y `0` es un plazo válido, «Hoy». Con
     * la conversión primero, **abrir Eventos desde el menú** ponía el plazo en
     * hoy y desaparecían las entregas de mañana, las devoluciones de la semana
     * y las ITV a siete días. La lista no salía vacía, que es lo peor: se lee
     * como «no hay más». Es el mismo fallo que ya costó la fianza imposible de
     * bajar a 0, y está escrito en CLAUDE.md.
     */
    const crudo = this.route.snapshot.queryParamMap.get('horizon');
    if (crudo !== null && crudo !== '') {
      const pedido = Number(crudo);
      if ((EVENT_HORIZONS as readonly number[]).includes(pedido)) this.horizon.set(pedido);
    }

    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [derivados, recordatorios] = await Promise.all([
        this.buildDerived(),
        this.reminders.list()
      ]);
      this.derived.set(derivados);
      this.reminderList.set(recordatorios);
    } catch {
      this.notifications.error('events.errors.loadFailed', { retry: () => void this.load() });
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Los eventos que salen de los datos que ya existen.
   *
   * ⚠️ **El plazo de factura solo se mira si se pueden ver facturas.** Un
   * empleado no tiene ese permiso, y pedir la colección le daría un error de
   * permisos que llenaría la consola sin aportar nada. Se pregunta antes.
   */
  private async buildDerived(): Promise<UpcomingEvent[]> {
    const eventos: UpcomingEvent[] = [];

    // Entregas y devoluciones, de las reservas vivas.
    const reservas = (await firstValueFrom(this.reservations.getReservations())) || [];
    for (const r of reservas) {
      if (r.reservationStatus === 'cancelled' || r.reservationStatus === 'closed') continue;

      if (r.reservationStatus === 'reserved' || r.reservationStatus === 'confirmed') {
        const cuando = r.pickupDateTime ? toDate(r.pickupDateTime) : null;
        if (cuando && !isNaN(cuando.getTime())) {
          eventos.push({
            key: `pickup:${r.id}`,
            source: 'pickup',
            date: cuando,
            title: r.clientSnapshot?.fullName || '—',
            detail: this.vehicleOf(r.vehicleSnapshot),
            /**
             * ⚠️ Sin contrato firmado no se puede entregar el coche. Va como
             * aviso dentro de la entrega, no como evento aparte: duplicar la
             * misma reserva en dos filas hace que se lean las dos por encima.
             */
            alert:
              r.contractStatus !== 'signed' ? 'events.alerts.contractNotSigned' : undefined,
            link: ['/reservations', r.id]
          });
        }
      }

      if (r.reservationStatus === 'delivered') {
        const cuando = r.returnDateTime ? toDate(r.returnDateTime) : null;
        if (cuando && !isNaN(cuando.getTime())) {
          eventos.push({
            key: `return:${r.id}`,
            source: 'return',
            date: cuando,
            title: r.clientSnapshot?.fullName || '—',
            detail: this.vehicleOf(r.vehicleSnapshot),
            link: ['/reservations', r.id]
          });
        }
      }
    }

    // Mantenimiento de la flota: ITV, seguro, revisiones.
    const mantSnap = await getDocs(
      query(
        collection(this.firestore, 'vehicleMaintenance'),
        where('status', 'in', ['pending', 'scheduled', 'overdue'])
      )
    );
    /**
     * ⚠️ **Los kilómetros del coche, para poder contar lo vencido por
     * kilometraje.** Sin esto, `if (!m.nextDueDate) continue` dejaba fuera
     * **todo** registro sin fecha —un cambio de aceite con «Km del
     * recordatorio» puesto y la fecha vacía es lo que sale del formulario sin
     * tocar nada más—, así que esta pantalla, que es la única que enseña el
     * mantenimiento de toda la flota junta, no los enseñaba nunca.
     */
    const kmPorVehiculo = new Map(
      (await firstValueFrom(this.vehicles.getVehicles())).map((v) => [v.id, v.currentKm])
    );

    const ahora = new Date();
    for (const d of mantSnap.docs) {
      const m = { id: d.id, ...(d.data() as VehicleMaintenance) };
      const fecha = m.nextDueDate ? toDate(m.nextDueDate) : null;
      const fechaValida = fecha && !isNaN(fecha.getTime()) ? fecha : null;
      const plazo = {
        status: m.status,
        dueDate: fechaValida,
        dueKm: m.nextDueKm,
        currentKm: m.vehicleId ? kmPorVehiculo.get(m.vehicleId) : undefined
      };
      const vencido = maintenanceOverdue(plazo, ahora);

      // Sin fecha y sin vencer por kilómetros no hay nada que anunciar: no se
      // sabe cuándo toca.
      if (!fechaValida && !vencido) continue;

      /**
       * ⚠️ **Un vencido por kilómetros toca AHORA, y por eso lleva la fecha de
       * hoy.** La lista se ordena y se filtra por fecha, así que un registro sin
       * ella no tendría sitio; y poner la suya —futura— lo mandaría al final
       * anunciando como próximo algo que ya se pasó.
       */
      const cuando = vencido && !fechaValida ? ahora : (fechaValida as Date);

      eventos.push({
        key: `maintenance:${m.id}`,
        source: 'maintenance',
        date: cuando,
        title: m.title || '—',
        detail: this.vehicleOf(m.vehicleSnapshot),
        /**
         * ⚠️ **El aviso depende del TIPO, porque no todo lo vencido impide
         * alquilar.** Aquí salía siempre «Vencido: no alquiles este coche hasta
         * pasarla» —en femenino, que delata que se escribió pensando en la
         * ITV—, así que un cambio de aceite pasado ordenaba no alquilar un
         * coche que la aplicación **sí alquila y sí entrega**: desde el 21 de
         * septiembre de 2026 solo bloquean `itv` e `insurance`
         * (`BLOCKING_MAINTENANCE_TYPES`).
         *
         * Y lo que se pierde con un aviso falso no es solo ese aviso: el
         * operador aprende a no creérselos, y entonces tampoco se cree el de la
         * ITV, que sí manda. Por eso el que no bloquea dice lo que de verdad
         * pasa —conviene hacerlo— en vez de una prohibición que nadie aplica.
         */
        alert: vencido
          ? (BLOCKING_MAINTENANCE_TYPES as readonly string[]).includes(m.type)
            ? 'events.alerts.maintenanceBlocking'
            : 'events.alerts.maintenanceOverdue'
          : undefined,
        link: m.vehicleId ? ['/vehicles', m.vehicleId] : undefined
      });
    }

    // Plazo de facturación de las emitidas a empresa, que es el que lleva
    // sanción — el 2 % del importe.
    if (can(this.auth.authorizedUser()?.role, 'viewInvoices')) {
      const facturas = await getDocs(collection(this.firestore, 'invoices'));
      for (const d of facturas.docs) {
        const inv = { id: d.id, ...(d.data() as Invoice) };
        if (inv.status !== 'draft') continue;
        if (inv.recipient?.type !== 'company') continue;
        const operacion = inv.operationDate ? toDate(inv.operationDate) : null;
        if (!operacion || isNaN(operacion.getTime())) continue;
        eventos.push({
          key: `invoiceDeadline:${inv.id}`,
          source: 'invoiceDeadline',
          date: invoiceDeadlineFor(operacion),
          title: inv.recipient?.name || '—',
          detail: `${(Number(inv.totals?.total) || 0).toFixed(2)} €`,
          alert: 'events.alerts.invoiceDeadline',
          link: ['/invoices', inv.id]
        });
      }
    }

    return eventos;
  }

  private vehicleOf(snap?: { brand?: string; model?: string; plateNumber?: string }): string {
    if (!snap) return '';
    const nombre = [snap.brand, snap.model].filter(Boolean).join(' ');
    return snap.plateNumber ? `${nombre} · ${snap.plateNumber}` : nombre;
  }

  // --- Interacción ---------------------------------------------------------

  setHorizon(days: number): void {
    this.horizon.set(days);
  }

  days(event: UpcomingEvent): number {
    return daysUntil(event.date);
  }

  open(event: UpcomingEvent): void {
    if (event.link) void this.router.navigate(event.link as unknown[]);
  }

  async toggleDone(event: UpcomingEvent, e: Event): Promise<void> {
    e.stopPropagation();
    if (!event.reminderId) return;
    try {
      await this.reminders.setDone(event.reminderId, !event.done);
      await this.load();
    } catch {
      this.notifications.error('events.errors.saveFailed');
    }
  }

  // --- Alta de recordatorio ------------------------------------------------

  private emptyForm(): {
    title: string;
    notes: string;
    category: ReminderCategory;
    dueDate: string;
  } {
    const hoy = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      title: '',
      notes: '',
      category: 'other',
      // Por defecto hoy: lo normal es apuntar algo que hay que hacer ya.
      dueDate: `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(hoy.getDate())}`
    };
  }

  newReminder(): void {
    this.editingId = null;
    this.form = this.emptyForm();
    this.showForm.set(true);
  }

  editReminder(event: UpcomingEvent, e: Event): void {
    e.stopPropagation();
    const r = this.reminderList().find((x) => x.id === event.reminderId);
    if (!r) return;
    const d = toDate(r.dueDate);
    const p = (n: number) => String(n).padStart(2, '0');
    this.editingId = r.id!;
    this.form = {
      title: r.title,
      notes: r.notes || '',
      category: r.category,
      dueDate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    };
    this.showForm.set(true);
  }

  async saveReminder(): Promise<void> {
    if (!this.form.title.trim() || !this.form.dueDate) {
      this.notifications.error('events.problems.titleAndDateRequired');
      return;
    }
    this.saving.set(true);
    try {
      await this.reminders.save(
        {
          title: this.form.title.trim(),
          notes: this.form.notes.trim() || undefined,
          category: this.form.category,
          done: false,
          /**
           * ⚠️ **A mediodía UTC, no a medianoche.** `new Date('2026-09-11')` es
           * medianoche UTC y basta un huso al oeste para que pase a ser el día
           * 10. Es el mismo cuidado que la fecha del mantenimiento.
           */
          dueDate: new Date(`${this.form.dueDate}T12:00:00Z`)
        },
        this.editingId || undefined
      );
      this.showForm.set(false);
      this.editingId = null;
      await this.load();
    } catch {
      this.notifications.error('events.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  async removeReminder(event: UpcomingEvent, e: Event): Promise<void> {
    e.stopPropagation();
    if (!event.reminderId) return;
    const ok = await this.confirm.ask({
      title: 'events.confirmDelete.title',
      message: 'events.confirmDelete.message',
      danger: true
    });
    if (!ok) return;
    try {
      await this.reminders.delete(event.reminderId);
      await this.load();
    } catch {
      this.notifications.error('events.errors.saveFailed');
    }
  }
}
