/**
 * generateQuotePdf
 *
 * Callable (auth required).
 *
 * Renders a rental quote from what the operator is looking at in the booking
 * wizard, uploads it to `quotes/{uuid}/quote.pdf` and returns a shareable URL.
 *
 * ⚠️ This function writes NOTHING to Firestore. There is no `quote` document,
 * no `quote` reservation status, and no effect on vehicle availability — a
 * quote does not hold a car. The only trace left behind is the PDF itself,
 * which has to live somewhere for the link to work.
 *
 * Unlike the reservation service, this does NOT recompute the price. The
 * figures arrive in the payload because no reservation exists yet to derive
 * them from, and duplicating the whole pricing engine here would give us two
 * copies to keep in step. That is acceptable precisely because the document is
 * non-binding and the caller is an authenticated operator who can already
 * agree any price by hand.
 */

import * as functions from 'firebase-functions';
import { randomUUID } from 'crypto';
import { buildQuotePdf } from './documents-pdf';
import { uploadPdf } from './storage';
import { documentLinkUrl, shortIdFor } from './documentLink';
import { companyConfig } from '../company-config';
import type { ContractLocale } from '../contracts/contract-types';

/** How long a quote is offered for. Commercial promise, not a technical one. */
const QUOTE_VALIDITY_DAYS = Number(process.env.VELTO_QUOTE_VALIDITY_DAYS || 7);

const LOCALES: ContractLocale[] = ['es', 'en', 'ro'];

interface QuoteRequest {
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
    vatRate?: number;
  };
  locale?: ContractLocale;
}

interface QuoteResponse {
  /** Short branded link, for pasting into WhatsApp. */
  pdfUrl: string;
  /** Direct Storage URL. Kept for the operator's own "open" button. */
  storageUrl: string;
  pdfPath: string;
  validUntil: string;
}

/**
 * URL-safe id, short enough to read over the phone and long enough to be the
 * secret that guards the document (~95 bits).
 */
function shortRandomId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

function finiteOrUndefined(value: any): number | undefined {
  return typeof value === 'number' && isFinite(value) ? value : undefined;
}

export const generateQuotePdf = functions.https.onCall(
  async (request): Promise<QuoteResponse> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }

    const data = request.data as QuoteRequest;
    if (!data?.vehicle?.plateNumber) {
      throw new functions.https.HttpsError('invalid-argument', 'Falta el vehículo');
    }
    const pickupDateTime = toDate(data.rental?.pickupDateTime);
    const returnDateTime = toDate(data.rental?.returnDateTime);
    if (!pickupDateTime || !returnDateTime) {
      throw new functions.https.HttpsError('invalid-argument', 'Fechas no válidas');
    }
    const finalPrice = finiteOrUndefined(data.pricing?.finalPrice);
    if (finalPrice === undefined || finalPrice < 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Precio no válido');
    }

    const locale: ContractLocale =
      data.locale && LOCALES.includes(data.locale)
        ? data.locale
        : ((process.env.VELTO_DEFAULT_CONTRACT_LOCALE as ContractLocale) || 'es');

    const generatedAt = new Date();
    const validUntil = new Date(
      generatedAt.getTime() + QUOTE_VALIDITY_DAYS * 24 * 60 * 60 * 1000
    );

    functions.logger.info(
      `generateQuotePdf: plate=${data.vehicle.plateNumber} locale=${locale}`
    );

    const pdfBytes = await buildQuotePdf({
      company: companyConfig(),
      client: data.client?.fullName ? data.client : undefined,
      vehicle: data.vehicle,
      rental: {
        pickupDateTime,
        returnDateTime,
        totalDays: finiteOrUndefined(data.rental?.totalDays),
        pickupLocation: data.rental?.pickupLocation,
        returnLocation: data.rental?.returnLocation
      },
      pricing: {
        finalPrice,
        depositAmount: finiteOrUndefined(data.pricing?.depositAmount),
        tariffPrice: finiteOrUndefined(data.pricing?.tariffPrice),
        loyaltyDiscountPercent: finiteOrUndefined(data.pricing?.loyaltyDiscountPercent),
        loyaltyDiscount: finiteOrUndefined(data.pricing?.loyaltyDiscount),
        manualAdjustment: finiteOrUndefined(data.pricing?.manualAdjustment),
        vatRate: finiteOrUndefined(data.pricing?.vatRate)
      },
      locale,
      generatedAt,
      validUntil
    });

    // A fresh folder per quote: two quotes for the same car on the same day are
    // different offers, and overwriting one with the other would change a
    // document already sent to somebody.
    const quoteId = shortRandomId();
    const uploaded = await uploadPdf(`quotes/${quoteId}/quote.pdf`, pdfBytes);

    return {
      ...uploaded,
      // What the operator sends: short, on the company's own domain.
      pdfUrl: documentLinkUrl(shortIdFor('quote', quoteId)),
      storageUrl: uploaded.pdfUrl,
      validUntil: validUntil.toISOString()
    };
  }
);
