import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { NotificationService } from '@core/notifications/notification.service';
import { ConfirmService } from '@core/notifications/confirm.service';
import { CollaboratorService } from '@features/collaborators/services/collaborator.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import {
  Collaborator,
  CollaboratorSale,
  COMMISSION_PAYMENT_METHOD_LABELS,
  COMMISSION_STATUS_LABELS,
  CommissionPaymentMethod
} from '@shared/models/collaborator.model';
import { Reservation } from '@shared/models/reservation.model';
import {
  ALL_TIME,
  CommissionPeriod,
  balanceOf,
  commissionAmount,
  hasPeriod,
  periodSummary,
  saleDate,
  salesInPeriod,
  settlements,
  yearlyTotals
} from '@shared/utils/collaborator.util';

/**
 * La ficha de un colaborador: lo que ha traído y lo que se le debe.
 *
 * ⚠️ **Aquí se asigna la venta, no en la reserva.** Es como lo dijo Dorel —«dar
 * de alta ventas para ellos»— y encaja con cómo ocurre: te acuerdas de que
 * fulano te trajo tres clientes y se los apuntas de una sentada, no reserva a
 * reserva en el momento de crearlas.
 */
@Component({
  selector: 'app-collaborator-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './collaborator-detail.component.html',
  styleUrl: './collaborator-detail.component.scss'
})
export class CollaboratorDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(CollaboratorService);
  private reservations = inject(ReservationService);
  private notifications = inject(NotificationService);
  private confirm = inject(ConfirmService);

  readonly loading = signal(true);
  readonly collaborator = signal<Collaborator | null>(null);
  readonly sales = signal<CollaboratorSale[]>([]);
  readonly working = signal(false);

  statusLabels = COMMISSION_STATUS_LABELS;
  methodLabels = COMMISSION_PAYMENT_METHOD_LABELS;

  // --- Asignar una venta ---------------------------------------------------
  readonly showAssign = signal(false);
  readonly assignable = signal<Reservation[]>([]);
  selectedReservationId = '';

  // --- Liquidar ------------------------------------------------------------
  readonly showSettle = signal(false);
  settleMethod: CommissionPaymentMethod = 'transfer';
  settleNote = '';

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    await this.load(id);
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const [ficha, ventas] = await Promise.all([
        this.service.getById(id),
        this.service.salesOf(id)
      ]);
      this.collaborator.set(ficha);
      this.sales.set(ventas);
    } catch {
      this.notifications.error('collaborators.errors.loadFailed', {
        retry: () => void this.load(id)
      });
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Lo que se le debe, **de todo lo que hay**.
   *
   * ⚠️ **No depende del periodo que se esté mirando, y eso es lo importante.**
   * Lo que se debe se debe: filtrar a 2025 y leer «pendiente: 0» haría creer que
   * está al día cuando lo de 2026 sigue sin pagar. Por eso el pendiente total
   * vive fuera del filtro y el del periodo va aparte y con su etiqueta.
   */
  get balance() {
    return balanceOf(this.sales());
  }

  // --- Análisis por periodo ------------------------------------------------

  readonly period = signal<CommissionPeriod>({ ...ALL_TIME });

  /** Lo que se está mirando: generado, pagado y pendiente **del periodo**. */
  readonly summary = computed(() => periodSummary(this.sales(), this.period()));
  readonly filtering = computed(() => hasPeriod(this.period()));

  /** Las comisiones del periodo, que es lo que se lista. */
  readonly visibleSales = computed(() => {
    const dentro = salesInPeriod(this.sales(), this.period());
    return [...dentro].sort((a, b) => {
      const fa = saleDate(a)?.getTime() ?? 0;
      const fb = saleDate(b)?.getTime() ?? 0;
      return fb - fa;
    });
  });

  /** Lo acumulado año a año. Responde a «¿cuánto me trajo cada año?». */
  readonly byYear = computed(() => yearlyTotals(this.sales()));

  /** Los pagos que se le han hecho, agrupados por día y forma de pago. */
  readonly payments = computed(() => settlements(this.sales()));

  /** Los años que de verdad tienen ventas. */
  readonly years = computed(() => this.byYear().map((y) => y.year));

  setYear(value: string): void {
    this.period.set({ ...this.period(), year: value ? Number(value) : null });
  }

  setFrom(value: string): void {
    this.period.set({ ...this.period(), from: value ? new Date(`${value}T00:00:00`) : null });
  }

  setTo(value: string): void {
    this.period.set({ ...this.period(), to: value ? new Date(`${value}T00:00:00`) : null });
  }

  clearPeriod(): void {
    this.period.set({ ...ALL_TIME });
  }

  /** `Date` → `yyyy-mm-dd` para el `<input type="date">`, en hora local. */
  dateInput(d: Date | null): string {
    if (!d) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  back(): void {
    void this.router.navigate(['/collaborators']);
  }

  openReservation(id: string): void {
    void this.router.navigate(['/reservations', id]);
  }

  // --- Asignar -------------------------------------------------------------

  /**
   * Las reservas que se le pueden asignar.
   *
   * ⚠️ **Se quitan las canceladas y las que ya tienen comisión viva.** Dejarlas
   * en la lista es ofrecer algo que el servicio va a rechazar, y una reserva
   * asignada dos veces es pagar dos veces por una venta.
   */
  async startAssign(): Promise<void> {
    this.showAssign.set(true);
    this.selectedReservationId = '';
    try {
      const [todas, ventas] = await Promise.all([
        firstValueFrom(this.reservations.getReservations()),
        this.service.allSales()
      ]);
      const asignadas = new Set(
        ventas.filter((s) => s.status !== 'cancelled').map((s) => s.reservationId)
      );
      this.assignable.set(
        (todas || [])
          .filter((r) => r.reservationStatus !== 'cancelled')
          .filter((r) => Number(r.pricingSnapshot?.netPrice) > 0)
          .filter((r) => !asignadas.has(r.id!))
      );
    } catch {
      this.notifications.error('collaborators.errors.loadFailed');
    }
  }

  /** Lo que se le pagaría por la reserva elegida, antes de confirmarla. */
  get previewCommission(): number {
    const r = this.assignable().find((x) => x.id === this.selectedReservationId);
    const pct = this.collaborator()?.commissionPercent || 0;
    return r ? commissionAmount(Number(r.pricingSnapshot?.netPrice) || 0, pct) : 0;
  }

  /**
   * La fecha de recogida congelada en la venta.
   *
   * ⚠️ **Convertida en el util, no aquí ni en la plantilla.** Llega como
   * `Timestamp` y el pipe `date` de Angular no lo entiende: pinta vacío, sin
   * error. Y es **la misma función por la que se filtra**, no una copia: dos
   * conversores acabarían discrepando y entonces una comisión saldría en la
   * lista con una fecha y se filtraría por otra.
   */
  pickupDate(sale: CollaboratorSale): Date | null {
    return saleDate(sale);
  }

  reservationLabel(r: Reservation): string {
    const coche = [r.vehicleSnapshot?.brand, r.vehicleSnapshot?.model].filter(Boolean).join(' ');
    const neto = Number(r.pricingSnapshot?.netPrice) || 0;
    return `${r.clientSnapshot?.fullName || '—'} · ${coche} · ${neto.toFixed(2)} €`;
  }

  async confirmAssign(): Promise<void> {
    const ficha = this.collaborator();
    const reserva = this.assignable().find((r) => r.id === this.selectedReservationId);
    if (!ficha || !reserva) return;

    this.working.set(true);
    try {
      await this.service.assignSale(ficha, reserva);
      this.notifications.success('collaborators.saleAssigned');
      this.showAssign.set(false);
      await this.load(ficha.id!);
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.working.set(false);
    }
  }

  // --- Pagar ---------------------------------------------------------------

  async paySale(sale: CollaboratorSale, method: CommissionPaymentMethod): Promise<void> {
    /**
     * ⚠️ Se pregunta porque **no se puede deshacer**: una comisión pagada es
     * dinero que salió, y volverla a pendiente haría cuadrar el balance
     * mintiendo.
     */
    const ok = await this.confirm.ask({
      title: 'collaborators.confirmPay.title',
      message: 'collaborators.confirmPay.message'
    });
    if (!ok) return;

    this.working.set(true);
    try {
      await this.service.pay(sale.id!, method);
      this.notifications.success('collaborators.paid');
      await this.load(this.collaborator()!.id!);
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.working.set(false);
    }
  }

  async settle(): Promise<void> {
    const ficha = this.collaborator();
    if (!ficha) return;

    this.working.set(true);
    try {
      const cuantas = await this.service.paySettlement(
        ficha.id!,
        this.settleMethod,
        this.settleNote
      );
      this.showSettle.set(false);
      this.settleNote = '';
      if (cuantas) this.notifications.success('collaborators.settled');
      await this.load(ficha.id!);
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.working.set(false);
    }
  }

  private errorKeyOf(err: unknown): string {
    const conocidas = [
      'collaborators.problems.collaboratorInactive',
      'collaborators.problems.reservationCancelled',
      'collaborators.problems.reservationWithoutNet',
      'collaborators.problems.alreadyAssigned',
      'collaborators.problems.alreadyPaid',
      'collaborators.problems.saleCancelled',
      'collaborators.problems.saleNotFound'
    ];
    const msg = typeof (err as { message?: unknown })?.message === 'string'
      ? (err as { message: string }).message
      : '';
    return conocidas.includes(msg) ? msg : 'collaborators.errors.saveFailed';
  }
}
