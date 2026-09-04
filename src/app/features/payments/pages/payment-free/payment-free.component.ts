import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { FieldProblems, hasProblems } from '@shared/utils/form-problems.util';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
import { PaymentService } from '@features/payments/services/payment.service';
import { RedsysPaymentService, RedsysLinkResponse } from '@features/payments/services/redsys-payment.service';
import { PaymentMethod } from '@shared/models/payment.model';

interface FormState {
  amount: number | null;
  concept: string;
  payerName: string;
  payerEmail: string;
  payerPhone: string;
  notes: string;
  method: PaymentMethod;
}

interface CreatedPayment {
  paymentId: string;
  internalReference: string;
  redsys?: {
    paymentUrl?: string;
    formData?: { [k: string]: string };
    order?: string;
  };
}

/**
 * "Cobro libre" — create a payment that is not attached to any
 * reservation.  The user enters an amount + concept, optionally a
 * payer, and the form triggers the Redsys Cloud Function which
 * returns the gateway URL/form data so the customer can pay.
 */
@Component({
  selector: 'app-payment-free',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, RouterLink, FormErrorComponent],
  templateUrl: './payment-free.component.html',
  styleUrl: './payment-free.component.scss'
})
export class PaymentFreeComponent implements OnInit {
  private paymentService = inject(PaymentService);
  private redsysService = inject(RedsysPaymentService);

  form: FormState = {
    amount: null,
    concept: '',
    payerName: '',
    payerEmail: '',
    payerPhone: '',
    notes: '',
    method: 'redsys'
  };

  saving = signal(false);
  error = signal<string | null>(null);
  created = signal<CreatedPayment | null>(null);

  methodOptions: { value: PaymentMethod; label: string }[] = [
    { value: 'redsys', label: 'payments.methods.redsys' },
    { value: 'cash', label: 'payments.methods.cash' },
    { value: 'bank_transfer', label: 'payments.methods.bankTransfer' },
    { value: 'bizum', label: 'payments.methods.bizum' },
    { value: 'manual_card', label: 'payments.methods.manualCard' },
    { value: 'other', label: 'payments.methods.other' }
  ];

  ngOnInit(): void {
    // No data to load — pure form page.
  }

  /** Si ya se ha intentado cobrar. Hasta entonces no se marca nada en rojo. */
  readonly submitted = signal(false);

  /** Lo que impide cobrar: campo → clave de i18n. */
  get problems(): FieldProblems {
    const problems: FieldProblems = {};
    if (this.form.amount === null || this.form.amount <= 0) {
      problems['amount'] = 'payments.free.amountRequired';
    }
    if (!this.form.concept.trim()) {
      problems['concept'] = 'payments.free.conceptRequired';
    }
    return problems;
  }

  async generate(): Promise<void> {
    // Antes solo se enseñaba el primero de los dos problemas y sin señalar el
    // campo: con importe y concepto vacíos había que arreglarlos de uno en uno,
    // descubriendo el segundo al resolver el primero.
    this.submitted.set(true);
    if (hasProblems(this.problems)) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const amount = this.form.amount as number;
      const paidAmount = this.form.method === 'redsys' ? 0 : amount;
      const id = await this.paymentService.createFreePayment({
        amount,
        paidAmount,
        concept: this.form.concept,
        payerName: this.form.payerName || undefined,
        payerEmail: this.form.payerEmail || undefined,
        payerPhone: this.form.payerPhone || undefined,
        method: this.form.method,
        notes: this.form.notes || undefined
      });

      let redsys: CreatedPayment['redsys'];
      if (this.form.method === 'redsys') {
        try {
          const response: RedsysLinkResponse = await this.redsysService.createRedsysPaymentLink(id);
          redsys = {
            paymentUrl: response.paymentUrl,
            formData: response.formData,
            order: response.reference
          };
        } catch (err: any) {
          this.error.set(err?.message || 'Redsys no disponible');
        }
      }
      this.created.set({
        paymentId: id,
        internalReference: id.slice(0, 8).toUpperCase(),
        redsys
      });
    } catch (err: any) {
      this.error.set(err?.message || 'Error');
    } finally {
      this.saving.set(false);
    }
  }

  /** Abre la pasarela. El POST y su porqué viven en el servicio. */
  openRedsys(): void {
    const r = this.created()?.redsys;
    if (!r?.paymentUrl || !r.formData) return;
    this.redsysService.openGateway({ paymentUrl: r.paymentUrl, formData: r.formData, reference: r.order || '' });
  }

  reset(): void {
    this.form = {
      amount: null,
      concept: '',
      payerName: '',
      payerEmail: '',
      payerPhone: '',
      notes: '',
      method: 'redsys'
    };
    this.created.set(null);
    this.error.set(null);
  }
}
