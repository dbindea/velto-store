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
        throw new Error('Redsys no está configurado. Contacta con el administrador.');
      }
      throw error;
    }
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