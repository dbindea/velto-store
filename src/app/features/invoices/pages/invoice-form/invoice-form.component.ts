import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
import { NotificationService } from '@core/notifications/notification.service';
import { InvoiceService } from '@features/invoices/services/invoice.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import {
  BillingProfile,
  InvoiceLine,
  InvoicePaymentMethod,
  InvoiceRecipient,
  InvoiceTotals,
  RECIPIENT_TYPE_LABELS,
  RecipientType,
  TAX_REGIME_LABELS,
  TaxRegime
} from '@shared/models/invoice.model';
import {
  calculateInvoiceTotals,
  cashAllowedFor,
  differsFromReservation,
  isInvoiceOverdue,
  lineBase,
  rebuMargin,
  suggestPaymentMethod,
  validateInvoice
} from '@shared/utils/invoice.util';
import { FieldProblems, hasProblems, problemKeys } from '@shared/utils/form-problems.util';
import { DEFAULT_VAT_RATE } from '@shared/utils/pricing.util';
import { toDate, toDateString } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-invoice-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent],
  templateUrl: './invoice-form.component.html',
  styleUrl: './invoice-form.component.scss'
})
export class InvoiceFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(InvoiceService);
  private reservations = inject(ReservationService);
  private notifications = inject(NotificationService);

  loading = signal(false);
  issuing = signal(false);
  /**
   * Nada se marca en rojo hasta el primer intento: señalar un campo que el
   * operador aún no ha tenido ocasión de rellenar es regañarle por no haber
   * terminado de escribir.
   */
  submitted = signal(false);

  recipientType: RecipientType = 'individual';
  recipient: InvoiceRecipient = { type: 'individual', name: '', taxId: '', address: '' };
  lines: InvoiceLine[] = [this.emptyLine()];
  paymentMethod: InvoicePaymentMethod = 'transfer';
  notes = '';

  operationDate: string | null = null;
  periodStart: string | null = null;
  periodEnd: string | null = null;

  // Origen, cuando la factura sale de una reserva. Vacío en una factura libre.
  reservationId?: string;
  vehicleId?: string;
  vehicleLabel?: string;
  contractNumber?: string;
  reservationTotal?: number;
  amountAlreadyPaid = 0;

  profiles = signal<BillingProfile[]>([]);
  recipientTypeOptions = Object.keys(RECIPIENT_TYPE_LABELS) as RecipientType[];
  recipientTypeLabels = RECIPIENT_TYPE_LABELS;
  regimeOptions = Object.keys(TAX_REGIME_LABELS) as TaxRegime[];
  regimeLabels = TAX_REGIME_LABELS;

  /**
   * Los totales, con la misma función que ejecuta el backend antes de emitir.
   *
   * ⚠️ **Es un método y no un `computed()`**, y la diferencia no es de estilo.
   * `lines` es un array normal que `ngModel` muta en sitio: un `computed` solo
   * se reevalúa cuando cambia una **señal**, así que se calculaba una vez y se
   * quedaba clavado. En una factura libre eso significaba teclear 7.000 € y ver
   * «Total 0,00 €»; en una que venía de una reserva no se notaba, porque los
   * datos llegaban antes del primer pintado.
   *
   * Como método, la detección de cambios lo reevalúa en cada tecla. El cálculo
   * es trivial y son cuatro líneas: no hay nada que memorizar.
   */
  totals(): InvoiceTotals {
    return calculateInvoiceTotals(this.lines);
  }

  problems: FieldProblems = {};

  async ngOnInit(): Promise<void> {
    void this.service.listProfiles().then((p) => this.profiles.set(p));

    const reservationId = this.route.snapshot.queryParamMap.get('reservation');
    if (reservationId) await this.loadFromReservation(reservationId);
  }

  emptyLine(): InvoiceLine {
    // Nace en régimen general, que es el 99 % de lo que factura una empresa de
    // alquiler. Los demás se eligen a mano y a conciencia.
    return { description: '', quantity: 1, unitPrice: 0, vatRate: DEFAULT_VAT_RATE, taxRegime: 'standard' };
  }

  /**
   * La reserva **propone** las líneas; no las impone.
   *
   * A partir de aquí la factura vive por su cuenta: se puede subir o bajar el
   * importe, añadir conceptos o quitarlos. Si el total acaba difiriendo, se
   * anota en la factura con su autor.
   */
  private async loadFromReservation(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const r = await firstValueFrom(this.reservations.getReservationById(id));
      if (!r) return;

      this.reservationId = id;
      this.vehicleId = r.vehicleId;
      this.vehicleLabel = [r.vehicleSnapshot?.brand, r.vehicleSnapshot?.model]
        .filter(Boolean)
        .join(' ')
        .concat(r.vehicleSnapshot?.plateNumber ? ` · ${r.vehicleSnapshot.plateNumber}` : '');
      this.contractNumber = r.contractInfo?.contractNumber;
      this.reservationTotal = r.pricingSnapshot?.finalPrice;
      this.amountAlreadyPaid = r.paymentSummary?.totalPaid || 0;

      this.recipient = {
        type: 'individual',
        name: r.clientSnapshot?.fullName || '',
        taxId: r.clientSnapshot?.documentNumber || '',
        address: '',
        email: r.clientSnapshot?.email
      };

      const dias = r.totalDays || 1;
      this.lines = [
        {
          description: `Alquiler de vehículo sin conductor ${this.vehicleLabel}${
            this.contractNumber ? `, según contrato ${this.contractNumber}` : ''
          }.`,
          quantity: 1,
          unitPrice: r.pricingSnapshot?.netPrice ?? 0,
          vatRate: r.pricingSnapshot?.vatRate ?? DEFAULT_VAT_RATE
        }
      ];

      // El periodo del servicio sale de las fechas de la reserva. Es lo que
      // permite facturar hoy un alquiler de hace dos meses sin retrodatar la
      // expedición, que no se puede.
      this.periodStart = this.toInputDate(r.pickupDateTime);
      this.periodEnd = this.toInputDate(r.returnDateTime);
      this.operationDate = this.periodEnd;
      void dias;

      this.paymentMethod = suggestPaymentMethod(this.totals().total, this.amountAlreadyPaid);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * ⚠️ Se usan los utils del proyecto y no un conversor propio.
   *
   * El conversor propio que había aquí solo entendía `Date` y
   * `Timestamp.toDate()`, y un timestamp llega también como `{ seconds }` desde
   * el SDK web o `{ _seconds }` si lo escribió el admin SDK. Con esos,
   * `new Date(objeto)` da fecha inválida y **los tres campos de fecha se
   * quedaban vacíos en silencio**: la primera factura salió sin el periodo del
   * servicio y sin la fecha de operación.
   *
   * Además convertía con `toISOString()`, que pasa por UTC: una entrega a las
   * 00:30 en Madrid habría salido con la fecha del día anterior — el mismo
   * fallo que ya tuvieron los contratos.
   */
  private toInputDate(value: any): string | null {
    if (!value) return null;
    return toDateString(toDate(value));
  }

  addLine(): void {
    this.lines = [...this.lines, this.emptyLine()];
  }

  removeLine(index: number): void {
    this.lines = this.lines.filter((_, i) => i !== index);
    if (!this.lines.length) this.lines = [this.emptyLine()];
  }

  baseOf(line: InvoiceLine): number {
    return lineBase(line);
  }

  /** El margen del REBU, en vivo: es la única forma de que se vea de dónde
   * sale el impuesto, que no es del precio de venta. */
  marginOf(line: InvoiceLine): number {
    return rebuMargin(line);
  }

  /** `0.21` ↔ `21`, para que el operador teclee un porcentaje y no una fracción. */
  vatPercentOf(line: InvoiceLine): number {
    return Math.round((Number(line.vatRate) || 0) * 10000) / 100;
  }

  setVatPercent(line: InvoiceLine, percent: number | string): void {
    const n = Number(percent);
    line.vatRate = isFinite(n) ? n / 100 : 0;
  }

  onRecipientTypeChange(): void {
    this.recipient.type = this.recipientType;
  }

  applyProfile(id: string): void {
    const p = this.profiles().find((x) => x.id === id);
    if (!p) return;
    this.recipientType = p.type;
    this.recipient = {
      type: p.type,
      name: p.name,
      taxId: p.taxId,
      address: p.address,
      email: p.email,
      billingProfileId: p.id
    };
  }

  /** El efectivo no se oculta cuando no cabe: se apaga y se explica. */
  get cashAllowed(): boolean {
    return cashAllowedFor(this.totals().total);
  }

  get amountDiffers(): boolean {
    return differsFromReservation(this.totals().total, this.reservationTotal);
  }

  /**
   * Avisa, no bloquea.
   *
   * A un particular se le factura cuando la pide, así que ahí no hay plazo que
   * vigilar. A una empresa hay que emitirle la factura **antes del día 16 del
   * mes siguiente** al devengo (art. 11 RD 1619/2012), la pida o no, y la
   * sanción por llegar tarde es del 2 % del importe. Desde 2027 las fechas
   * quedan registradas en la AEAT, así que pasa de invisible a comprobable.
   */
  get isOverdue(): boolean {
    if (this.recipientType !== 'company' || !this.operationDate) return false;
    return isInvoiceOverdue({
      recipientType: 'company',
      operationDate: new Date(this.operationDate)
    });
  }

  get problemList(): string[] {
    return problemKeys(this.problems);
  }

  async issue(): Promise<void> {
    this.submitted.set(true);
    this.recipient.type = this.recipientType;
    this.problems = validateInvoice({
      recipient: this.recipient,
      lines: this.lines,
      paymentMethod: this.paymentMethod
    });
    if (hasProblems(this.problems)) return;

    this.issuing.set(true);
    try {
      const res = await this.service.issue({
        recipient: this.recipient,
        lines: this.lines,
        paymentMethod: this.paymentMethod,
        amountAlreadyPaid: this.amountAlreadyPaid,
        operationDate: this.operationDate ? new Date(this.operationDate) : null,
        operationPeriodStart: this.periodStart ? new Date(this.periodStart) : null,
        operationPeriodEnd: this.periodEnd ? new Date(this.periodEnd) : null,
        reservationId: this.reservationId,
        vehicleId: this.vehicleId,
        vehicleLabel: this.vehicleLabel,
        contractNumber: this.contractNumber,
        notes: this.notes || undefined,
        reservationTotal: this.reservationTotal
      });
      this.notifications.success('invoices.issued', { n: res.fullNumber });
      if (res.pdfUrl) window.open(res.pdfUrl, '_blank');
      void this.router.navigate(['/invoices']);
    } catch (err: any) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.issuing.set(false);
    }
  }

  /**
   * Lo que rechaza el backend viaja como **clave i18n**, nunca como frase, para
   * que el aviso salga en el idioma del operador.
   *
   * La lista es explícita en vez de aceptar cualquier cosa que empiece por
   * `invoices.`: si la function devolviera una clave que no está traducida, el
   * usuario vería el identificador en crudo —`TranslateService` devuelve la
   * propia clave cuando no la encuentra, y no hay respaldo a español—. Con esta
   * lista, lo desconocido cae en un mensaje que sí existe.
   */
  private errorKeyOf(err: any): string {
    const conocidas = [
      'invoices.errors.unauthenticated',
      'invoices.errors.alreadyIssued',
      'invoices.errors.cannotDeleteIssued'
    ];
    const msg = typeof err?.message === 'string' ? err.message : '';
    if (conocidas.includes(msg)) return msg;
    // Las de validación también viajan como clave y sí están traducidas.
    if (msg.startsWith('invoices.problems.')) return msg;
    return 'invoices.errors.issueFailed';
  }

  cancel(): void {
    void this.router.navigate(['/invoices']);
  }
}
