import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { NotificationService } from '@core/notifications/notification.service';
import { AnalyticsService, AnalyticsData } from '@features/reports/services/analytics.service';
import { LineChartComponent, LineSeries } from '@shared/components/charts/line-chart.component';
import { DonutChartComponent, DonutSlice } from '@shared/components/charts/donut-chart.component';
import { BarChartComponent, BarRow } from '@shared/components/charts/bar-chart.component';
import { Reservation } from '@shared/models/reservation.model';
import { DEFAULT_VAT_RATE } from '@shared/utils/pricing.util';
import { roundMoney } from '@shared/utils/payment-summary.util';
import { toDate } from '@shared/utils/reservation-date.util';
import {
  DateRange,
  daysInRange,
  monthlyRevenue,
  netFromGross,
  occupancy,
  repeatClientStats,
  revenueByMethod,
  revenueByVehicle,
  revenuePayments,
  revenuePerRentalDay,
  sumPaid,
  topClients,
  vatRateOf,
  yearToDate
} from '@shared/utils/analytics.util';

/**
 * Los meses del eje, en el idioma de la plataforma.
 *
 * ⚠️ **No son doce claves de i18n por idioma.** Un mes abreviado lo sabe el
 * navegador y lo declina bien en los tres idiomas; escribirlos a mano son 36
 * cadenas que hay que mantener y que solo pueden empeorar. Es el mismo criterio
 * que el selector de países, que sale de `Intl.DisplayNames`.
 */
function mesesAbreviados(idioma: string): string[] {
  const fmt = new Intl.DateTimeFormat(idioma, { month: 'short' });
  return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2024, m, 1)));
}

/**
 * La salud del negocio de un vistazo.
 *
 * ⚠️ **Lo que se cuenta como ingreso lo decide `analytics.util.ts`, no esta
 * pantalla.** Aquí solo se compone y se pinta: si la definición viviera también
 * aquí, habría dos y el día que discreparan nadie sabría cuál manda.
 *
 * ⚠️ **Y las bases de los números no son la misma en todo.** Los ingresos y los
 * gastos se cuentan **cuando el dinero se mueve**; las comisiones, **cuando se
 * devengan** aunque no estén pagadas — decisión de Dorel del 10 de septiembre de
 * 2026, por prudencia: nunca creerse más rico de lo que uno es. Mezclar dos
 * criterios es legítimo mientras se diga, y por eso la cifra de beneficio lleva
 * su explicación al lado en vez de aparecer sola.
 */
@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, TranslatePipe, LineChartComponent, DonutChartComponent, BarChartComponent],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss'
})
export class ReportsComponent implements OnInit {
  private analytics = inject(AnalyticsService);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);

  readonly loading = signal(true);
  private readonly data = signal<AnalyticsData | null>(null);

  /** El rango por defecto: del 1 de enero hasta hoy, como pidió Dorel. */
  readonly range = signal<DateRange>(yearToDate());
  readonly topLimit = signal(10);

  // --- Filtro --------------------------------------------------------------

  setFrom(v: string): void {
    if (!v) return;
    this.range.set({ ...this.range(), from: new Date(`${v}T00:00:00`) });
  }

  setTo(v: string): void {
    if (!v) return;
    const to = new Date(`${v}T00:00:00`);
    to.setHours(23, 59, 59, 999);
    this.range.set({ ...this.range(), to });
  }

  resetRange(): void {
    this.range.set(yearToDate());
    this.topLimit.set(10);
  }

  dateInput(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.analytics.load());
    } catch {
      this.notifications.error('reports.errors.loadFailed', { retry: () => void this.load() });
    } finally {
      this.loading.set(false);
    }
  }

  // --- Ingresos ------------------------------------------------------------

  private readonly revenueRows = computed(() => {
    const d = this.data();
    return d ? revenuePayments(d.payments, this.range()) : [];
  });

  /** Lo cobrado, IVA incluido. Es lo que ha entrado en la cuenta. */
  readonly grossRevenue = computed(() => sumPaid(this.revenueRows()));

  /**
   * La base imponible **estimada**.
   *
   * ⚠️ **Estimada, y la pantalla lo dice.** El tipo se lee del congelado en cada
   * reserva, pero un cobro libre no tiene reserva y los cargos extra todavía no
   * llevan desglose de IVA: ahí se aplica el tipo general. Presentarla como dato
   * fiscal sería dar por exacta una cifra que no lo es — y para lo fiscal están
   * las facturas.
   */
  readonly netRevenue = computed(() => {
    const d = this.data();
    if (!d) return 0;
    const porId = new Map(d.reservations.filter((r) => r.id).map((r) => [r.id!, r]));
    const total = this.revenueRows().reduce(
      (t, p) => t + netFromGross(Number(p.paidAmount) || 0, vatRateOf(p, porId, DEFAULT_VAT_RATE)),
      0
    );
    return roundMoney(total);
  });

  readonly vatCollected = computed(() => roundMoney(this.grossRevenue() - this.netRevenue()));

  // --- Salidas -------------------------------------------------------------

  /** Gastos del periodo, por su fecha. */
  readonly expenses = computed(() => {
    const d = this.data();
    if (!d) return 0;
    const r = this.range();
    return roundMoney(
      d.expenses
        .filter((e) => {
          const f = e.date ? toDate(e.date) : null;
          return f && !isNaN(f.getTime()) && f >= r.from && f <= r.to;
        })
        .reduce((t, e) => t + (Number(e.amount) || 0), 0)
    );
  });

  /**
   * El mantenimiento, que **no vive en `expenses`**.
   *
   * ⚠️ Un gasto de taller se registra en `vehicleMaintenance` y el módulo de
   * Gastos lo lee y lo suma; escribirlo en los dos sitios daría dos fuentes de
   * verdad para el mismo euro. Aquí se hace lo mismo.
   */
  readonly maintenanceCost = computed(() => {
    const d = this.data();
    if (!d) return 0;
    const r = this.range();
    return roundMoney(
      d.maintenance
        .filter((m) => {
          const f = m.performedAtDate ? toDate(m.performedAtDate) : null;
          return f && !isNaN(f.getTime()) && f >= r.from && f <= r.to;
        })
        .reduce((t, m) => t + (Number(m.cost) || 0), 0)
    );
  });

  /**
   * Las comisiones **devengadas** en el periodo, pagadas o no.
   *
   * Se sitúan por la fecha del alquiler que las generó, que es la misma vara con
   * la que se miden en la ficha del colaborador.
   */
  readonly commissions = computed(() => {
    const d = this.data();
    if (!d) return 0;
    const r = this.range();
    return roundMoney(
      d.commissions
        .filter((c) => {
          const f = c.reservationSnapshot?.pickupDate
            ? toDate(c.reservationSnapshot.pickupDate)
            : null;
          return f && !isNaN(f.getTime()) && f >= r.from && f <= r.to;
        })
        .reduce((t, c) => t + (Number(c.commissionAmount) || 0), 0)
    );
  });

  readonly totalOut = computed(() =>
    roundMoney(this.expenses() + this.maintenanceCost() + this.commissions())
  );

  /**
   * Lo que queda.
   *
   * ⚠️ Se calcula sobre la **base sin IVA**: el IVA cobrado no es beneficio, es
   * dinero de Hacienda que la empresa recauda y entrega. Restarlo de los gastos
   * sin quitarlo de los ingresos inflaría el resultado en un 21 %.
   */
  readonly profit = computed(() => roundMoney(this.netRevenue() - this.totalOut()));

  readonly margin = computed(() => {
    const base = this.netRevenue();
    return base > 0 ? this.profit() / base : 0;
  });

  // --- Pendiente de cobro --------------------------------------------------

  /**
   * ⚠️ **Va aparte del beneficio, no dentro.** Es dinero que se espera, no que
   * se tiene; sumarlo a los ingresos convertiría una promesa en caja.
   */
  readonly outstanding = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return roundMoney(
      d.payments
        .filter((p) => p.status === 'pending' || p.status === 'partial')
        .filter((p) => p.type !== 'deposit')
        .reduce((t, p) => t + Math.max(0, (Number(p.amount) || 0) - (Number(p.paidAmount) || 0)), 0)
    );
  });

  /** Lo que se debe a los colaboradores y aún no ha salido. */
  readonly commissionsPending = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return roundMoney(
      d.commissions
        .filter((c) => c.status === 'pending')
        .reduce((t, c) => t + (Number(c.commissionAmount) || 0), 0)
    );
  });

  // --- Gráficos ------------------------------------------------------------

  readonly monthLabels = computed(() => mesesAbreviados(this.translate.language()));

  /**
   * Este año contra el pasado.
   *
   * ⚠️ **Los doce meses siempre, y un solo eje.** Dos escalas en un mismo dibujo
   * permiten hacer que dos líneas parezcan lo que uno quiera moviendo un cero.
   */
  readonly yearSeries = computed<LineSeries[]>(() => {
    const d = this.data();
    if (!d) return [];
    const año = this.range().to.getFullYear();
    return [
      { label: `${año}`, values: monthlyRevenue(d.payments, año).map((p) => p.amount) },
      {
        label: `${año - 1}`,
        values: monthlyRevenue(d.payments, año - 1).map((p) => p.amount),
        reference: true
      }
    ];
  });

  readonly methodSlices = computed<DonutSlice[]>(() =>
    revenueByMethod(this.revenueRows()).map((s) => ({
      label: this.translate.translate(`reports.methods.${s.family}`),
      value: s.amount,
      detail: `${s.count}`
    }))
  );

  readonly vehicleRows = computed<BarRow[]>(() => {
    const d = this.data();
    if (!d) return [];
    return revenueByVehicle(this.revenueRows(), d.reservations, this.range())
      .slice(0, 8)
      .map((v) => ({
        label: v.label,
        value: v.revenue,
        detail: `${v.days} ${this.translate.translate(
          v.days === 1 ? 'reports.dayRented' : 'reports.daysRented'
        )}`
      }));
  });

  // --- Clientes ------------------------------------------------------------

  private readonly allClients = computed(() => {
    const d = this.data();
    return d ? topClients(this.revenueRows(), d.reservations, this.range()) : [];
  });

  readonly clients = computed(() => this.allClients().slice(0, this.topLimit()));
  readonly hasMoreClients = computed(() => this.allClients().length > this.topLimit());

  showMoreClients(): void {
    this.topLimit.update((n) => n + 20);
  }

  readonly repeat = computed(() => repeatClientStats(this.allClients()));

  // --- Flota ---------------------------------------------------------------

  readonly occupancyRate = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return occupancy(this.inRangeReservations(), d.vehicleCount, this.range());
  });

  readonly rentalDays = computed(() =>
    this.inRangeReservations().reduce((t, r) => t + (Number(r.totalDays) || 0), 0)
  );

  readonly perRentalDay = computed(() =>
    revenuePerRentalDay(this.grossRevenue(), this.rentalDays())
  );

  readonly rangeDays = computed(() => daysInRange(this.range()));

  readonly vehicleCount = computed(() => this.data()?.vehicleCount ?? 0);

  private inRangeReservations(): Reservation[] {
    const d = this.data();
    if (!d) return [];
    const r = this.range();
    return d.reservations.filter((res) => {
      if (res.reservationStatus === 'cancelled') return false;
      const f = res.pickupDateTime ? toDate(res.pickupDateTime) : null;
      return f && !isNaN(f.getTime()) && f >= r.from && f <= r.to;
    });
  }

  readonly rentals = computed(() => this.inRangeReservations().length);
}
