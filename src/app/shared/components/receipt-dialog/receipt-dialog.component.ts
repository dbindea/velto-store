import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { PaymentConceptPipe } from '@shared/pipes/payment-concept.pipe';
import { Payment } from '@shared/models/payment.model';
import { PaymentService } from '@features/payments/services/payment.service';
import { NotificationService } from '@core/notifications/notification.service';
import { copyToClipboard } from '@shared/utils/clipboard.util';

/**
 * El recibo de un cobro: el justificante que hasta ahora se hacía a mano en
 * Word cuando alguien entregaba la señal.
 *
 * ⚠️ **No es una factura, y todo el diseño consiste en que no lo parezca.** El
 * PDF lo lleva impreso, no desglosa IVA y no lleva número de serie fiscal; ver
 * `functions/src/invoices/receipt-pdf.ts`. Aquí solo se decide **lo único que
 * la aplicación no puede saber**: si va a haber factura. Se factura *a
 * petición*, así que prometerla en todo recibo sería imprimir algo que muchas
 * veces es falso — el mismo fallo que el presupuesto que afirmaba llevar el IVA
 * incluido.
 *
 * Es compartido porque hay **dos sitios desde los que se cobra**: la ficha de
 * la reserva y la del pago, que es la única puerta de un cobro libre. Con el
 * diálogo duplicado, el día que cambie el texto legal cambiaría en uno.
 */
@Component({
  selector: 'app-receipt-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, PaymentConceptPipe],
  template: `
    <div class="modal-overlay" (click)="close()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <i class="pi pi-receipt"></i>
          <h3>{{ 'payments.receipt.title' | translate }}</h3>
          <button class="modal-close" type="button" (click)="close()">
            <i class="pi pi-times"></i>
          </button>
        </div>

        <div class="modal-body">
          @if (reference) {
            <!-- Generado: lo que queda es entregárselo al cliente. -->
            <p class="receipt-done">
              <i class="pi pi-check-circle"></i>
              <span>
                {{ 'payments.receipt.generated' | translate }}
                <strong>{{ reference }}</strong>
              </span>
            </p>
            <div class="modal-actions">
              <a class="btn btn-secondary" [href]="pdfUrl" target="_blank" rel="noopener">
                <i class="pi pi-file-pdf"></i>
                {{ 'payments.receipt.open' | translate }}
              </a>
              <button class="btn btn-primary" type="button" (click)="copyLink()">
                <i class="pi pi-link"></i>
                {{ 'payments.receipt.copyLink' | translate }}
              </button>
            </div>
          } @else {
            <p>
              {{ 'payments.receipt.confirm' | translate }}
              <strong>{{ payment.paidAmount | number: '1.2-2' }} €</strong>
              — {{ payment | paymentConcept }}
            </p>
            <p class="modal-hint">{{ 'payments.receipt.notAnInvoice' | translate }}</p>

            <!-- checkbox-item es global: la misma casilla que en el resto de
                 la aplicación, y la etiqueta envuelve al control para que se
                 pueda pulsar el texto. -->
            <label class="checkbox-item">
              <input type="checkbox" [(ngModel)]="invoiceExpected" />
              <span>{{ 'payments.receipt.invoiceExpected' | translate }}</span>
            </label>
            <p class="modal-hint">{{ 'payments.receipt.invoiceExpectedHint' | translate }}</p>

            <div class="modal-actions">
              <button class="btn btn-secondary" type="button" (click)="close()">
                {{ 'common.cancel' | translate }}
              </button>
              <!-- Solo se apaga mientras genera. Un botón deshabilitado por
                   datos que faltan deja al operador pulsando sin que pase nada. -->
              <button
                class="btn btn-primary"
                type="button"
                [disabled]="generating"
                (click)="generate()"
              >
                @if (generating) {
                  <i class="pi pi-spin pi-spinner"></i>
                } @else {
                  <i class="pi pi-receipt"></i>
                }
                {{ 'payments.receipt.generate' | translate }}
              </button>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 1rem;
      }

      .modal {
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        width: 100%;
        max-width: 460px;
        max-height: 90vh;
        overflow-y: auto;
      }

      .modal-header {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid var(--border-color);

        i {
          color: var(--accent-color);
        }

        h3 {
          margin: 0;
          flex: 1;
          /* Sin esto, un título largo estira el diálogo entero. */
          min-width: 0;
          font-size: 1rem;
          color: var(--text-primary);
        }
      }

      .modal-close {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 0.25rem;
      }

      .modal-body {
        padding: 1.25rem;

        p {
          margin: 0 0 0.5rem;
          color: var(--text-primary);
          font-size: 0.95rem;
        }
      }

      .modal-hint {
        font-size: 0.85rem;
        color: var(--text-muted);
      }

      /* La casilla es .checkbox-item, global en styles.scss. Aquí solo su hueco. */
      .checkbox-item {
        margin: 0.875rem 0 0.25rem;
      }

      .receipt-done {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;

        i {
          color: var(--success-color);
          margin-top: 0.15rem;
        }
      }

      .modal-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        flex-wrap: wrap;
        margin-top: 1.25rem;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        border: none;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
      }

      .btn-primary {
        background: var(--accent-color);
        color: #fff;
      }

      .btn-secondary {
        background: var(--bg-input);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
      }
    `
  ]
})
export class ReceiptDialogComponent {
  private paymentService = inject(PaymentService);
  private notifications = inject(NotificationService);

  /** El cobro que se justifica. Quien abre el diálogo ya comprobó que admite recibo. */
  @Input({ required: true }) payment!: Payment;
  @Output() closed = new EventEmitter<void>();

  invoiceExpected = false;
  generating = false;
  reference = '';
  shortUrl = '';
  pdfUrl = '';

  close(): void {
    this.closed.emit();
  }

  async generate(): Promise<void> {
    if (this.generating) return;

    this.generating = true;
    try {
      const res = await this.paymentService.generateReceipt(this.payment, {
        invoiceExpected: this.invoiceExpected
      });
      this.reference = res.reference;
      this.shortUrl = res.shortUrl;
      this.pdfUrl = res.pdfUrl;
      // El enlace corto se copia solo: es el que se pega en WhatsApp, que es
      // el canal real. Igual que hace el justificante de reserva.
      await this.copyLink();
    } catch (err: any) {
      this.notifications.error(this.errorKeyOf(err), { retry: () => void this.generate() });
    } finally {
      this.generating = false;
    }
  }

  /**
   * Lo que rechaza el backend viaja como **clave i18n**, nunca como frase, para
   * que el aviso salga en el idioma del operador.
   *
   * La lista es explícita, igual que en el formulario de factura: si la
   * function devolviera una clave sin traducir, el usuario vería el
   * identificador en crudo — `TranslateService` devuelve la propia clave cuando
   * no la encuentra. Con la lista, lo desconocido cae en un mensaje que sí
   * existe.
   */
  private errorKeyOf(err: any): string {
    const conocidas = [
      'payments.receipt.problems.cancelled',
      'payments.receipt.problems.notIncoming',
      'payments.receipt.problems.nothingCollected',
      'payments.receipt.problems.paymentRequired',
      'payments.receipt.problems.notFound',
      'invoices.errors.unauthenticated'
    ];
    const msg = typeof err?.message === 'string' ? err.message : '';
    return conocidas.includes(msg) ? msg : 'payments.receipt.error';
  }

  async copyLink(): Promise<void> {
    if (!this.shortUrl) return;
    const copied = await copyToClipboard(this.shortUrl);
    if (copied) this.notifications.success('payments.receipt.linkCopied');
  }
}
