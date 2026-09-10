import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { InvoiceService } from '@features/invoices/services/invoice.service';
import {
  INVOICE_KIND_LABELS,
  INVOICE_PAYMENT_METHOD_LABELS,
  INVOICE_STATUS_LABELS,
  Invoice,
  InvoiceKind
} from '@shared/models/invoice.model';
import {
  EMPTY_INVOICE_FILTER,
  InvoiceFilter,
  filterInvoices,
  filteredTotal,
  hasFilter,
  invoiceKinds,
  invoiceYears
} from '@shared/utils/invoice-filter.util';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { canRectify } from '@shared/utils/invoice.util';
import { NotificationService } from '@core/notifications/notification.service';

@Component({
  selector: 'app-invoice-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './invoice-list.component.html',
  styleUrl: './invoice-list.component.scss'
})
export class InvoiceListComponent implements OnInit {
  private service = inject(InvoiceService);
  private translate = inject(TranslateService);
  private notifications = inject(NotificationService);
  private router = inject(Router);

  /** Todas las que hay. La pantalla pinta `visible()`, no esto. */
  invoices = signal<Invoice[]>([]);
  loading = signal(true);

  // --- Filtros -------------------------------------------------------------
  //
  // ⚠️ **Se filtra en memoria, no en Firestore.** Son las facturas de la
  // empresa, no un catálogo: unos cientos al año. Una consulta por cada
  // combinación de año, tipo y rango pediría un índice compuesto por cada una,
  // y cambiar un desplegable costaría una lectura. Aquí se carga una vez y se
  // filtra al instante.
  readonly filter = signal<InvoiceFilter>({ ...EMPTY_INVOICE_FILTER });

  /** Lo que se está mirando. */
  readonly visible = computed(() => filterInvoices(this.invoices(), this.filter()));
  readonly years = computed(() => invoiceYears(this.invoices()));
  readonly kinds = computed(() => invoiceKinds(this.invoices()));
  readonly total = computed(() => filteredTotal(this.visible()));
  readonly filtering = computed(() => hasFilter(this.filter()));

  kindLabels = INVOICE_KIND_LABELS;

  /**
   * ⚠️ **El filtro se reemplaza entero, no se muta.** `filter` es una señal: si
   * se le cambia una propiedad al objeto que lleva dentro, la referencia sigue
   * siendo la misma, `computed` no se entera y la lista se queda como estaba.
   * Es la misma trampa que dejó los totales de la factura clavados en «0,00 €».
   */
  setYear(value: string): void {
    this.filter.set({ ...this.filter(), year: value ? Number(value) : null });
  }

  setKind(value: string): void {
    this.filter.set({ ...this.filter(), kind: (value || null) as InvoiceKind | null });
  }

  setFrom(value: string): void {
    this.filter.set({ ...this.filter(), from: value ? new Date(`${value}T00:00:00`) : null });
  }

  setTo(value: string): void {
    this.filter.set({ ...this.filter(), to: value ? new Date(`${value}T00:00:00`) : null });
  }

  clearFilter(): void {
    this.filter.set({ ...EMPTY_INVOICE_FILTER });
  }

  /** `Date` → `yyyy-mm-dd` para el `<input type="date">`, en hora local. */
  dateInput(d: Date | null): string {
    if (!d) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.invoices.set(await this.service.list());
    } catch {
      // Un fallo de carga se cuenta y se puede reintentar: aquí sí ha fallado
      // algo, al contrario que en una validación.
      this.notifications.error('invoices.errors.loadFailed', { retry: () => void this.load() });
    } finally {
      this.loading.set(false);
    }
  }

  statusLabel(invoice: Invoice): string {
    return this.translate.translate(INVOICE_STATUS_LABELS[invoice.status]);
  }

  paymentLabel(invoice: Invoice): string {
    return this.translate.translate(INVOICE_PAYMENT_METHOD_LABELS[invoice.paymentMethod]);
  }

  /** Un borrador todavía no tiene número: se enseña su estado, no un hueco. */
  numberOf(invoice: Invoice): string {
    return invoice.fullNumber || this.statusLabel(invoice);
  }

  open(invoice: Invoice): void {
    if (invoice.pdfUrl) {
      window.open(invoice.pdfUrl, '_blank');
      return;
    }
    // Sin PDF solo puede ser un borrador o una emisión cuyo documento falló;
    // en los dos casos el sitio al que ir es el formulario.
    void this.router.navigate(['/invoices', invoice.id]);
  }

  /** Solo una factura emitida se rectifica; una rectificativa, no. */
  canRectifyInvoice(invoice: Invoice): boolean {
    return canRectify(invoice);
  }

  asDate(value: any): Date | null {
    if (!value) return null;
    return value?.toDate ? value.toDate() : new Date(value);
  }
}
