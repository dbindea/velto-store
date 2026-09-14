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
  CollaboratorInvoice,
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
  awaitingInvoice,
  awaitingInvoiceTotal,
  balanceByKind,
  balanceOf,
  invoiceMismatch,
  validateCollaboratorInvoice,
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
import { FieldProblems, hasProblems } from '@shared/utils/form-problems.util';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';

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
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent],
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
      const reservas = await firstValueFrom(this.reservations.getReservations());

      /**
       * ⚠️ **La red del reconocimiento automático.**
       *
       * El reparto se apunta solo al cerrar la reserva, pero ese cierre puede
       * haberlo hecho un **empleado**, que no tiene permiso para escribir en
       * `collaboratorSales`. Lo que quedó derivado se recoge aquí, que es la
       * pantalla donde un administrador viene a mirar lo que se le debe.
       *
       * ⚠️ **Escribe al cargar, y es deliberado.** Es el mismo patrón que
       * `syncWithReservation()`: el estado se resuelve donde se mira, en vez de
       * en un disparador que sería otra Cloud Function y otro sitio donde
       * buscar cuando el número no cuadre. Si falla, no rompe la carga: el
       * devengo se sigue derivando y los informes ya lo cuentan.
       */
      await this.service.accruePendingFor(id, reservas || []);

      const [ficha, ventas, facturas] = await Promise.all([
        this.service.getById(id),
        this.service.salesOf(id),
        this.service.invoicesOf(id)
      ]);
      this.collaborator.set(ficha);
      this.sales.set(ventas);
      this.invoices.set(facturas);

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

  // --- La factura que manda el propietario ---------------------------------

  readonly invoices = signal<CollaboratorInvoice[]>([]);
  readonly showInvoice = signal(false);
  readonly savingInvoice = signal(false);
  invoiceForm: Partial<CollaboratorInvoice> = {};
  invoiceProblems: FieldProblems = {};
  readonly invoiceSubmitted = signal(false);
  readonly invoiceSaleIds = signal<Set<string>>(new Set());
  invoiceFile: File | null = null;
  /**
   * Cuál se está editando.
   *
   * ⚠️ **Señal y no una propiedad normal**, porque `invoiceCandidates()` la lee
   * desde un `computed`: como propiedad, ese computed no se enteraba de que
   * había cambiado y solo se recalculaba de rebote, cuando se movía alguna de
   * las otras señales de las que depende. Funcionaba por casualidad.
   */
  readonly editingInvoiceId = signal<string | null>(null);

  /**
   * Los repartos que **siguen esperando su factura**.
   *
   * ⚠️ **«Pendiente de recibir factura» NO es «no hay que facturar»** (Dorel, con
   * esas palabras). Son un trámite que falta y una exención que no existe, y el
   * texto de la pantalla tiene que decir la primera: un «sin factura» a secas se
   * lee como la segunda, y entonces nadie la reclama nunca.
   */
  readonly awaitingInvoiceSales = computed(() => awaitingInvoice(this.sales()));
  readonly awaitingInvoiceAmount = computed(() => awaitingInvoiceTotal(this.sales()));

  /** Lo que suman los repartos marcados en el formulario de factura. */
  readonly invoiceCovered = computed(() =>
    roundMoney(
      this.sales()
        .filter((s) => this.invoiceSaleIds().has(s.id!))
        .reduce((total, s) => total + (Number(s.commissionAmount) || 0), 0)
    )
  );

  /**
   * La diferencia entre lo que dice la factura y lo que cubre.
   *
   * ⚠️ **Se enseña, no se impide.** Una factura con IRPF retenido trae menos que
   * la suma de los repartos y es correcta. Lo que no puede pasar es que la
   * diferencia quede escondida.
   *
   * ⚠️ **Es un getter y NO un `computed()`, y eso no es estilo.** Depende de
   * `invoiceForm.amount`, que es una propiedad normal atada con `ngModel` y no
   * una señal: un `computed` no se entera de que ha cambiado, así que se
   * quedaba con el valor de la primera evaluación —cuando el importe aún estaba
   * vacío— y el aviso enseñaba un descuadre igual al total de los repartos,
   * tecleara uno lo que tecleara. Compila, pasa los tests y solo se ve
   * escribiendo en el campo.
   */
  get invoiceDifference(): number {
    return invoiceMismatch(Number(this.invoiceForm.amount) || 0, this.invoiceCovered());
  }

  invoiceOf(sale: CollaboratorSale): CollaboratorInvoice | null {
    if (!sale.receivedInvoiceId) return null;
    return this.invoices().find((f) => f.id === sale.receivedInvoiceId) || null;
  }

  startInvoice(): void {
    this.editingInvoiceId.set(null);
    this.invoiceForm = { number: '', date: this.today(), amount: undefined };
    // Los que esperan factura, marcados: es el caso normal —una factura cubre
    // lo que está sin justificar— y desmarcar es más fácil que marcar.
    this.invoiceSaleIds.set(new Set(this.awaitingInvoiceSales().map((s) => s.id!)));
    this.invoiceFile = null;
    this.invoiceProblems = {};
    this.invoiceSubmitted.set(false);
    this.showInvoice.set(true);
  }

  editInvoice(factura: CollaboratorInvoice): void {
    this.editingInvoiceId.set(factura.id!);
    this.invoiceForm = {
      number: factura.number,
      date: this.asDateInput(factura.date),
      amount: factura.amount,
      notes: factura.notes,
      fileUrl: factura.fileUrl,
      filePath: factura.filePath
    };
    this.invoiceSaleIds.set(
      new Set(this.sales().filter((s) => s.receivedInvoiceId === factura.id).map((s) => s.id!))
    );
    this.invoiceFile = null;
    this.invoiceProblems = {};
    this.invoiceSubmitted.set(false);
    this.showInvoice.set(true);
  }

  isInvoiceSale(id: string): boolean {
    return this.invoiceSaleIds().has(id);
  }

  toggleInvoiceSale(id: string): void {
    const copia = new Set(this.invoiceSaleIds());
    if (copia.has(id)) copia.delete(id);
    else copia.add(id);
    this.invoiceSaleIds.set(copia);
  }

  onInvoiceFile(files: FileList | null): void {
    this.invoiceFile = files?.length ? files[0] : null;
  }

  /**
   * Los repartos que se pueden vincular a esta factura.
   *
   * Los que esperan factura, **más los que ya están en la que se edita**: sin
   * los segundos, abrir una factura guardada mostraría su lista vacía y el
   * primer guardado la desvincularía de todo.
   */
  readonly invoiceCandidates = computed(() => {
    const esperando = this.awaitingInvoiceSales();
    if (!this.editingInvoiceId()) return esperando;
    const suyos = this.sales().filter((s) => s.receivedInvoiceId === this.editingInvoiceId());
    return [...suyos, ...esperando];
  });

  async saveInvoice(): Promise<void> {
    const ficha = this.collaborator();
    if (!ficha) return;

    this.invoiceSubmitted.set(true);
    this.invoiceProblems = validateCollaboratorInvoice({
      ...this.invoiceForm,
      // El `input[type=date]` da una cadena; el validador solo mira que haya
      // algo, y la conversión a fecha se hace justo antes de escribir.
      date: this.invoiceForm.date
    });
    if (hasProblems(this.invoiceProblems)) return;

    this.savingInvoice.set(true);
    try {
      const id = await this.service.saveInvoice(
        ficha,
        {
          ...this.invoiceForm,
          // A mediodía local, por lo mismo que la fecha de pago: la medianoche
          // UTC de un `input[type=date]` puede caer en el día anterior.
          date: new Date(`${this.invoiceForm.date}T12:00:00`),
          amount: Number(this.invoiceForm.amount)
        },
        [...this.invoiceSaleIds()],
        this.editingInvoiceId() || undefined
      );

      if (this.invoiceFile) {
        const subido = await this.service.uploadInvoiceFile(id, this.invoiceFile);
        await this.service.saveInvoice(
          ficha,
          { ...this.invoiceForm, date: new Date(`${this.invoiceForm.date}T12:00:00`),
            amount: Number(this.invoiceForm.amount), ...subido },
          [...this.invoiceSaleIds()],
          id
        );
      }

      this.showInvoice.set(false);
      this.notifications.success('collaborators.invoice.saved');
      await this.load(ficha.id!);
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.savingInvoice.set(false);
    }
  }

  async removeInvoice(factura: CollaboratorInvoice): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'collaborators.invoice.deleteTitle',
      message: 'collaborators.invoice.deleteMessage',
      confirmLabel: 'common.delete',
      danger: true
    });
    if (!ok) return;

    const ficha = this.collaborator();
    if (!ficha) return;

    this.working.set(true);
    try {
      await this.service.deleteInvoice(factura.id!);
      this.notifications.success('collaborators.invoice.deleted');
      await this.load(ficha.id!);
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.working.set(false);
    }
  }

  /** Una fecha de Firestore como `Date`, para el pipe de la plantilla. */
  asDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const v = value as { toDate?: () => Date; seconds?: number };
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    return null;
  }

  /** Una fecha de Firestore en `yyyy-mm-dd`, para el `input[type=date]`. */
  private asDateInput(value: unknown): string {
    if (!value) return '';
    const v = value as { toDate?: () => Date; seconds?: number };
    const d =
      value instanceof Date
        ? value
        : typeof v.toDate === 'function'
          ? v.toDate()
          : typeof v.seconds === 'number'
            ? new Date(v.seconds * 1000)
            : null;
    if (!d) return '';
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

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
