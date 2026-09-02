import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { BrandLogoComponent } from '@shared/components/brand-logo/brand-logo.component';
import { RedsysPaymentService } from '@features/payments/services/redsys-payment.service';

interface CheckoutView {
  state: 'pending' | 'paid' | 'unavailable';
  amount: number;
  currency: string;
  concept: string;
  brandName: string;
  paymentUrl?: string;
  formData?: { [key: string]: string };
}

/**
 * Pantalla pública de pago. La abre el cliente en su móvil, sin cuenta.
 *
 * Existe para que el operador **no tenga que estar delante**: hasta ahora solo
 * se podía cobrar con tarjeta desde el backoffice, con el cliente al lado. Se
 * le manda el enlace por WhatsApp y paga cuando pueda.
 *
 * El id del pago es el secreto, igual que en los enlaces `/d/…` de los
 * presupuestos. La function pública devuelve solo importe, concepto y marca:
 * quien abra un enlace reenviado no debe enterarse de con quién trabajas.
 *
 * ⚠️ **Quien da el pago por bueno es el webhook, no esta pantalla.** Aquí se
 * lee el estado para enseñárselo al cliente, pero lo que escribe `paid` en la
 * base de datos es la notificación que Redsys manda por su cuenta. Un cliente
 * que cierre el navegador a mitad no deja el cobro a medias.
 */
@Component({
  selector: 'app-payment-checkout',
  standalone: true,
  imports: [CommonModule, TranslatePipe, BrandLogoComponent],
  templateUrl: './payment-checkout.component.html',
  styleUrl: './payment-checkout.component.scss'
})
export class PaymentCheckoutComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private functions = inject(Functions);
  private redsysService = inject(RedsysPaymentService);

  readonly loading = signal(true);
  readonly errored = signal(false);
  readonly view = signal<CheckoutView | null>(null);
  readonly paying = signal(false);

  private paymentId = '';

  ngOnInit(): void {
    this.paymentId = this.route.snapshot.paramMap.get('paymentId') || '';
    if (!this.paymentId) {
      this.errored.set(true);
      this.loading.set(false);
      return;
    }
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const fn = httpsCallable<{ paymentId: string }, CheckoutView>(
        this.functions,
        'getPaymentCheckout'
      );
      const result = await fn({ paymentId: this.paymentId });
      this.view.set(result.data);
      this.errored.set(false);
    } catch {
      // No se distingue entre «no existe» y «cancelado»: desde fuera nadie
      // debería poder averiguar si un identificador es real.
      this.errored.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Abre la pasarela. El POST vive en el servicio, compartido con el backoffice
   * para que el fallo del GET no pueda volver por un lado y no por el otro.
   */
  pay(): void {
    const v = this.view();
    if (!v?.paymentUrl || !v.formData || this.paying()) return;
    this.paying.set(true);
    try {
      this.redsysService.openGateway({
        paymentUrl: v.paymentUrl,
        formData: v.formData,
        reference: ''
      });
    } finally {
      this.paying.set(false);
    }
  }

  /**
   * Vuelve a preguntar el estado.
   *
   * Redsys devuelve al cliente aquí después de pagar, pero su notificación
   * viaja por otro camino y puede tardar un instante más que el navegador. El
   * botón es la salida honesta a esa carrera: en vez de fingir que sabemos el
   * resultado, se vuelve a preguntar.
   */
  refresh(): void {
    void this.load();
  }
}
