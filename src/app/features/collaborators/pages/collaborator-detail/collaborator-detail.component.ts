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
  COMMISSION_KIND_LABELS,
  COMMISSION_STATUS_LABELS,
  CommissionPaymentMethod
} from '@shared/models/collaborator.model';
import { Reservation } from '@shared/models/reservation.model';
import {
  ALL_TIME,
  CommissionPeriod,
  adjustmentDelta,
  amountProblem,
  balanceByKind,
  balanceOf,
  commissionAmount,
  hasPeriod,
  isAdjusted,
  periodSummary,
  saleDate,
  salesInPeriod,
  settlements,
  yearlyTotals
} from '@shared/utils/collaborator.util';
import {
  OwnerShareAccrual,
  accruedTotal,
  ownerShareAccruals,
  unsettledAccruals
} from '@shared/utils/owner-share.util';
import { roundMoney } from '@shared/utils/payment-summary.util';

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

  /**
   * Lo devengado por sus coches y todavía sin liquidar.
   *
   * ⚠️ **Es una previsión derivada, no una deuda apuntada.** Se calcula de las
   * reservas cerradas y desaparece de aquí en cuanto se reconoce como apunte,
   * que es lo que impide contarlo dos veces.
   */
  readonly ownerAccruals = signal<OwnerShareAccrual[]>([]);

  /** La suma de lo devengado sin liquidar, al céntimo. */
  readonly accruedPending = computed(() => accruedTotal(this.ownerAccruals()));

  statusLabels = COMMISSION_STATUS_LABELS;
  methodLabels = COMMISSION_PAYMENT_METHOD_LABELS;
  kindLabels = COMMISSION_KIND_LABELS;

  // --- Asignar una venta ---------------------------------------------------
  readonly showAssign = signal(false);
  readonly assignable = signal<Reservation[]>([]);
  selectedReservationId = '';

  // --- Liquidar ------------------------------------------------------------
  readonly showSettle = signal(false);
  settleMethod: CommissionPaymentMethod = 'transfer';
  settleNote = '';
  /** El día en que salió el dinero, en `yyyy-mm-dd`. */
  settleDate = '';

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    await this.load(id);
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const [ficha, ventas, reservas] = await Promise.all([
        this.service.getById(id),
        this.service.salesOf(id),
        firstValueFrom(this.reservations.getReservations())
      ]);
      this.collaborator.set(ficha);
      this.sales.set(ventas);

      /**
       * Lo devengado por sus coches, **derivado de las reservas cerradas**.
       *
       * ⚠️ **No hay colección de devengos**: cada reserva cerrada ya lleva
       * dentro su reparto y su precio congelados, y copiarlos aquí sería una
       * segunda fuente de verdad para el mismo euro. Ver `owner-share.util.ts`.
       *
       * ⚠️ **Se quita lo ya liquidado, o se cuenta dos veces.** Al liquidar, el
       * reparto pasa a ser un apunte con su importe congelado; si la derivación
       * siguiera incluyendo esa reserva, aquí saldría el doble de lo que se le
       * debe. Y sería una cifra creíble.
       */
      const yaLiquidadas = ventas
        .filter((v) => v.kind === 'vehicle_owner' && v.status !== 'cancelled')
        .map((v) => v.reservationId);
      this.ownerAccruals.set(
        unsettledAccruals(ownerShareAccruals(reservas || [], id), yaLiquidadas)
      );
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

  /**
   * Lo mismo, **separado por motivo**.
   *
   * ⚠️ **Un total que mezcla dos conceptos no se puede explicar.** «Le debo
   * 212,50 €» no dice cuánto es por traer clientes y cuánto por ceder su coche,
   * y son dos cosas que se pactan, se liquidan y se justifican distinto — una
   * acaba en una factura suya por la cesión y la otra no. El total sigue arriba,
   * porque «¿cuánto le debo?» es una pregunta legítima; el desglose va debajo
   * **solo cuando hay de las dos clases**, que es cuando el total solo no basta.
   */
  readonly byKind = computed(() => balanceByKind(this.sales()));

  /** ¿Cobra por los dos conceptos? Entonces el total hay que desglosarlo. */
  readonly mixedKinds = computed(() => {
    const b = this.byKind();
    return b.referral.pending + b.referral.paid > 0 &&
      b.vehicleOwner.pending + b.vehicleOwner.paid > 0;
  });

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
    this.assignAmount = null;
    this.assignReason = '';
    try {
      const [todas, ventas] = await Promise.all([
        firstValueFrom(this.reservations.getReservations()),
        this.service.allSales()
      ]);
      /**
       * ⚠️ **Solo las de captación cuentan como «ya asignada».** Una reserva
       * puede tener a la vez la comisión por traer al cliente y el reparto por
       * ceder el coche: mirando las dos clases, el reparto de un coche cedido
       * escondería esa reserva de esta lista y no habría forma de reconocerle
       * nunca la comisión a quien trajo al cliente. Es el mismo filtro que hace
       * `saleForReservation()` en el servicio, y tienen que decir lo mismo.
       */
      const asignadas = new Set(
        ventas
          .filter((s) => s.kind === 'referral' && s.status !== 'cancelled')
          .map((s) => s.reservationId)
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

  /** Lo que da el porcentaje para la reserva elegida. Es la propuesta. */
  get calculatedCommission(): number {
    const r = this.assignable().find((x) => x.id === this.selectedReservationId);
    const pct = this.collaborator()?.commissionPercent || 0;
    return r ? commissionAmount(Number(r.pricingSnapshot?.netPrice) || 0, pct) : 0;
  }

  /**
   * El importe que se va a pagar, con el que se puede jugar antes de crear la
   * venta: a veces se paga más, a veces menos, y a veces se redondea.
   *
   * ⚠️ **Se rellena solo al elegir la reserva y a partir de ahí es del
   * operador.** Recalcularlo en cada pintado borraría lo que acaba de teclear.
   */
  assignAmount: number | null = null;
  assignReason = '';

  onReservationChosen(): void {
    this.assignAmount = this.calculatedCommission;
    this.assignReason = '';
  }

  /** ¿El importe escrito difiere de lo que da el porcentaje? */
  get assignIsAdjusted(): boolean {
    if (this.assignAmount === null) return false;
    return Math.abs(Number(this.assignAmount) - this.calculatedCommission) >= 0.005;
  }

  get assignDelta(): number {
    return Math.round((Number(this.assignAmount || 0) - this.calculatedCommission) * 100) / 100;
  }

  // --- Cambiar el importe de una venta ya creada ---------------------------

  editingAmountId: string | null = null;
  editAmount: number | null = null;
  editReason = '';

  /** ¿Se le cambió el importe a mano? La fila lo dice y enseña el calculado. */
  adjusted(sale: CollaboratorSale): boolean {
    return isAdjusted(sale);
  }

  delta(sale: CollaboratorSale): number {
    return adjustmentDelta(sale);
  }

  startEditAmount(sale: CollaboratorSale, e: Event): void {
    e.stopPropagation();
    this.editingAmountId = sale.id!;
    this.editAmount = sale.commissionAmount;
    this.editReason = sale.adjustmentReason || '';
  }

  cancelEditAmount(e: Event): void {
    e.stopPropagation();
    this.editingAmountId = null;
  }

  async saveAmount(sale: CollaboratorSale, e: Event): Promise<void> {
    e.stopPropagation();
    const problema = amountProblem(this.editAmount);
    if (problema) {
      this.notifications.error(problema);
      return;
    }
    this.working.set(true);
    try {
      await this.service.updateAmount(sale.id!, Number(this.editAmount), this.editReason);
      this.editingAmountId = null;
      this.notifications.success('collaborators.amountUpdated');
      await this.load(this.collaborator()!.id!);
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.working.set(false);
    }
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
      await this.service.assignSale(
        ficha,
        reserva,
        // Solo se manda si de verdad difiere: una venta sin ajuste no debe
        // nacer marcada como ajustada.
        this.assignIsAdjusted
          ? { amount: Number(this.assignAmount), reason: this.assignReason }
          : undefined
      );
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

  /**
   * Reconocer lo devengado por sus coches.
   *
   * ⚠️ **Reconocer no es pagar**, y por eso son dos gestos. Aquí el reparto
   * derivado se convierte en un apunte con su importe congelado y estado
   * «pendiente»; entregarle el dinero es el paso siguiente, con su fecha y su
   * forma de pago. Juntarlos obligaría a pagar en el mismo momento en que se
   * reconoce, y lo normal es reconocer al cerrar y pagar a fin de mes.
   */
  async settleAccruals(): Promise<void> {
    const ficha = this.collaborator();
    if (!ficha) return;

    this.working.set(true);
    try {
      const cuantas = await this.service.settleOwnerShares(ficha, this.ownerAccruals());
      if (cuantas) this.notifications.success('collaborators.ownerShare.settled');
      await this.load(ficha.id!);
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.working.set(false);
    }
  }

  // --- Pagarle -------------------------------------------------------------

  /**
   * Abre el pago con **todo lo pendiente marcado y la fecha de hoy**.
   *
   * Es el caso normal —se le paga todo lo que se le debe— y así el operador solo
   * toca lo que se salga de eso. Desmarcar es más fácil que marcar seis.
   */
  startSettle(): void {
    this.selectedSaleIds.set(new Set(this.pendingSales().map((s) => s.id!)));
    this.settleDate = this.today();
    this.settleNote = '';
    this.showSettle.set(true);
  }

  /** Las que se pueden pagar: pendientes, de las dos clases. */
  readonly pendingSales = computed(() => this.sales().filter((s) => s.status === 'pending'));

  readonly selectedSaleIds = signal<Set<string>>(new Set());

  isSelected(id: string): boolean {
    return this.selectedSaleIds().has(id);
  }

  toggleSale(id: string): void {
    const copia = new Set(this.selectedSaleIds());
    if (copia.has(id)) copia.delete(id);
    else copia.add(id);
    this.selectedSaleIds.set(copia);
  }

  /**
   * Lo que suma este pago.
   *
   * ⚠️ **Se calcula, no se teclea.** Un importe escrito a mano que no cuadre con
   * las filas marcadas dejaría un pago que no se puede explicar: para pagar de
   * menos por una venta concreta está el ajuste de su importe, que sí queda
   * anotado con lo calculado al lado.
   */
  readonly settleTotal = computed(() =>
    roundMoney(
      this.pendingSales()
        .filter((s) => this.selectedSaleIds().has(s.id!))
        .reduce((total, s) => total + (Number(s.commissionAmount) || 0), 0)
    )
  );

  /** Hoy en `yyyy-mm-dd`, que es lo que entiende un `input[type=date]`. */
  private today(): string {
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  async settle(): Promise<void> {
    const ficha = this.collaborator();
    if (!ficha) return;

    const ids = [...this.selectedSaleIds()];
    if (!ids.length) {
      this.notifications.error('collaborators.problems.nothingSelected');
      return;
    }

    this.working.set(true);
    try {
      const cuantas = await this.service.paySettlement(
        ficha.id!,
        this.settleMethod,
        this.settleNote,
        {
          saleIds: ids,
          /**
           * ⚠️ **A mediodía, no a medianoche.** Un `input[type=date]` da la
           * medianoche UTC, y en España eso puede caer en el día anterior: el
           * pago se agruparía en una fecha que no es la que se tecleó. El
           * mediodía local aguanta cualquier huso.
           */
          paidAt: this.settleDate ? new Date(`${this.settleDate}T12:00:00`) : undefined
        }
      );
      this.showSettle.set(false);
      this.settleNote = '';
      // Clave propia y no la de la fila de la lista: aquella describe un
      // estado («no se le debe nada») y esta un hecho que acaba de ocurrir.
      // Compartirlas hacía que cambiar una cambiara la otra sin querer.
      if (cuantas) this.notifications.success('collaborators.paymentRecorded');
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
