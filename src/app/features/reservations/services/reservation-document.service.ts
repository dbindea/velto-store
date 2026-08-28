/**
 * The two customer-facing PDFs that are NOT the rental contract:
 *
 *   - the quote, generated from the booking wizard before anything is saved
 *   - the booking confirmation, generated once the signal is collected
 *
 * Both are rendered by Cloud Functions — the frontend never builds PDFs — and
 * both come back as a Storage URL the operator copies into WhatsApp.
 *
 * ⚠️ Neither call changes the reservation. They are informative documents, not
 * steps of the workflow: `reservation-workflow.util.ts` remains the only thing
 * that decides whether a vehicle can be handed over.
 */

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { TranslateService } from '@core/i18n/translate.service';

export interface QuoteDocumentRequest {
  client?: {
    fullName: string;
    documentNumber?: string;
    phone?: string;
    email?: string;
  };
  vehicle: {
    brand: string;
    model: string;
    version?: string;
    plateNumber: string;
    year?: number;
    fuelType?: string;
    transmission?: string;
  };
  rental: {
    pickupDateTime: string;
    returnDateTime: string;
    totalDays?: number;
    pickupLocation?: string;
    returnLocation?: string;
  };
  pricing: {
    finalPrice: number;
    depositAmount?: number;
    tariffPrice?: number;
    loyaltyDiscountPercent?: number;
    loyaltyDiscount?: number;
    manualAdjustment?: number;
    netPrice?: number;
    vatRate?: number;
  };
  locale?: string;
}

export interface QuoteDocumentResponse {
  /** Short link on the company's own domain — this is what goes to WhatsApp. */
  pdfUrl: string;
  /** Direct Storage URL, for the operator's own "open" button. */
  storageUrl: string;
  pdfPath: string;
  /** ISO date. The quote is offered until then. */
  validUntil: string;
}

export interface BookingConfirmationResponse {
  /** Short link on the company's own domain — this is what goes to WhatsApp. */
  pdfUrl: string;
  /** Direct Storage URL, for the operator's own "open" button. */
  storageUrl: string;
  pdfPath: string;
  /** Human-readable reference the customer can quote back. */
  locator: string;
}

@Injectable({ providedIn: 'root' })
export class ReservationDocumentService {
  private functions = inject(Functions);
  private translateService = inject(TranslateService);

  /**
   * Renders a quote for what the wizard currently shows. Nothing is persisted:
   * no reservation, no `quote` status, and the vehicle stays available.
   */
  async generateQuote(payload: QuoteDocumentRequest): Promise<QuoteDocumentResponse> {
    const fn = httpsCallable<QuoteDocumentRequest, QuoteDocumentResponse>(
      this.functions,
      'generateQuotePdf'
    );
    const result = await fn({ ...payload, locale: payload.locale ?? this.currentLocale() });
    return result.data;
  }

  /**
   * Renders the booking confirmation for a reservation whose signal has been
   * collected. Re-running it overwrites the file but keeps the same download
   * token, so a link already sent to the customer stays alive.
   */
  async generateBookingConfirmation(reservationId: string): Promise<BookingConfirmationResponse> {
    const fn = httpsCallable<
      { reservationId: string; locale?: string },
      BookingConfirmationResponse
    >(this.functions, 'generateBookingConfirmationPdf');
    const result = await fn({ reservationId, locale: this.currentLocale() });
    return result.data;
  }

  /**
   * Copy to clipboard with the same fallback the signing link uses: the async
   * Clipboard API is unavailable over plain HTTP and in some in-app browsers.
   */
  async copyToClipboard(text: string): Promise<boolean> {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    }
  }

  private currentLocale(): string {
    return this.translateService.getCurrentLanguage();
  }
}
