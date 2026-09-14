/**
 * Redsys Payment Service (Frontend).
 * 
 * This service does NOT handle any Redsys secrets.
 * All signing, merchant config, and secret keys are in Cloud Functions.
 * 
 * The frontend only:
 * - Calls a Cloud Function to get a payment URL/form data
 * - Receives webhook notifications indirectly via Firestore updates from the backend
 * 
 * Never include REDSYS_SECRET_KEY, REDSYS_MERCHANT_CODE, etc. in this file
 * or any other frontend code.
 */

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payment } from '@shared/models/payment.model';
import { Firestore, doc, getDoc, updateDoc } from '@angular/fire/firestore';

export interface RedsysLinkResponse {
  paymentUrl?: string;
  formData?: { [key: string]: string };
  reference: string;
}

@Injectable({ providedIn: 'root' })
export class RedsysPaymentService {
  private functions = inject(Functions);
  private firestore = inject(Firestore);

  /**
   * Check if Redsys is configured (Cloud Function exists and is reachable).
   * This is a soft check - we just attempt the call and handle errors.
   */
  isAvailable(): boolean {
    // Without trying to call the function, we can only assume it's available
    // The actual check happens when createRedsysPaymentLink is called
    return true;
  }

  /**
   * Create a Redsys payment link for a payment.
   * Calls the Cloud Function which holds all secrets.
   */
  async createRedsysPaymentLink(paymentId: string): Promise<RedsysLinkResponse> {
    try {
      const fn = httpsCallable<{ paymentId: string }, RedsysLinkResponse>(
        this.functions,
        'createRedsysPaymentLink'
      );
      const result = await fn({ paymentId });
      return result.data;
    } catch (error: any) {
      // The function may not be deployed yet - this is expected during MVP
      if (error.code === 'functions/not-found') {
        // ⚠️ Clave i18n, no una frase: el componente PEGA este mensaje al
        // aviso que ve el operador, así que en español duro un compañero
        // rumano leía castellano justo cuando algo falla.
        throw new Error('payments.errors.redsysNotConfigured');
      }
      throw error;
    }
  }

  /**
   * Devolver a la tarjeta parte o todo de un cobro hecho con Redsys.
   *
   * ⚠️ **Aquí no se decide nada, y eso es deliberado.** Quién puede, cuánto
   * puede y contra qué operación lo decide la Cloud Function leyendo el pago de
   * Firestore: el importe que mande esta pantalla es una petición, no una orden.
   * Si la decisión viviera aquí, cualquiera con la consola del navegador abierta
   * podría pedir la devolución de un importe que nunca se cobró.
   *
   * ⚠️ **Y no se reintenta solo.** Un fallo de red después de que el banco haya
   * aceptado es indistinguible desde aquí de un fallo antes: reintentar sería
   * arriesgarse a devolver dos veces. Si falla, lo dice y para — quien decide
   * volver a intentarlo es una persona, mirando antes el extracto.
   */
  async refundRedsysPayment(
    paymentId: string,
    amount: number,
    reason?: string
  ): Promise<{ refunded: number; remaining: number; authorizationCode?: string }> {
    try {
      const fn = httpsCallable<
        { paymentId: string; amount: number; reason?: string },
        { refunded: number; remaining: number; authorizationCode?: string }
      >(this.functions, 'refundRedsysPayment');
      const result = await fn({ paymentId, amount, reason });
      return result.data;
    } catch (error: any) {
      if (error.code === 'functions/not-found') {
        throw new Error('payments.errors.redsysNotConfigured');
      }
      // El backend manda claves i18n en el mensaje; se dejan pasar tal cual para
      // que el operador lea el motivo real y no un «error» genérico.
      throw error;
    }
  }

  /**
   * Abre la pasarela **enviando un POST**, que es la única forma que Redsys
   * admite.
   *
   * Vive aquí y no en el componente porque lo necesitan dos pantallas —el cobro
   * libre y las filas pendientes de una reserva— y es justo el detalle que ya
   * se hizo mal una vez: se abría `paymentUrl` con un GET, sin parámetros, y el
   * cliente aterrizaba en una pantalla de error del banco. La firma y el
   * importe van en `formData`, así que **el formulario es el pago**.
   *
   * El formulario se crea, se envía y se retira: no queda nada en el DOM.
   */
  openGateway(link: RedsysLinkResponse): void {
    if (!link.paymentUrl || !link.formData) {
      throw new Error('payments.errors.redsysNoForm');
    }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = link.paymentUrl;
    form.target = '_blank';
    form.style.display = 'none';

    for (const [name, value] of Object.entries(link.formData)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  /**
   * Get the current status of a Redsys payment.
   * Reads from Firestore (the backend updates it after webhook).
   */
  getRedsysPaymentStatus(paymentId: string): Observable<Payment | null> {
    const docRef = doc(this.firestore, `payments/${paymentId}`);
    return from(getDoc(docRef)).pipe(
      map(snap => snap.exists() ? { id: snap.id, ...snap.data() } as Payment : null)
    );
  }

  /**
   * Update the payment with the Redsys form data received from the Cloud Function.
   * The Cloud Function will also write its own metadata, but we store the
   * paymentUrl locally so the UI can show "open payment".
   */
  async attachPaymentUrl(paymentId: string, paymentUrl: string, order?: string): Promise<void> {
    const docRef = doc(this.firestore, `payments/${paymentId}`);
    await updateDoc(docRef, {
      'redsys.paymentUrl': paymentUrl,
      'redsys.order': order,
      'redsys.notifiedAt': null,
      status: 'pending',
      updatedAt: { seconds: Date.now() / 1000 }
    });
  }
}