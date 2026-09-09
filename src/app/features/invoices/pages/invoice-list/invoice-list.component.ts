import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { InvoiceService } from '@features/invoices/services/invoice.service';
import {
  INVOICE_PAYMENT_METHOD_LABELS,
  INVOICE_STATUS_LABELS,
  Invoice
} from '@shared/models/invoice.model';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { canRectify } from '@shared/utils/invoice.util';
import { NotificationService } from '@core/notifications/notification.service';

@Component({
  selector: 'app-invoice-list',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './invoice-list.component.html',
  styleUrl: './invoice-list.component.scss'
})
export class InvoiceListComponent implements OnInit {
  private service = inject(InvoiceService);
  private translate = inject(TranslateService);
  private notifications = inject(NotificationService);
  private router = inject(Router);

  invoices = signal<Invoice[]>([]);
  loading = signal(true);

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
