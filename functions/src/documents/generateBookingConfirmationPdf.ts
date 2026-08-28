/**
 * generateBookingConfirmationPdf
 *
 * Callable (auth required).
 *
 * Renders the "justificante de reserva" — the document the customer gets when
 * they pay the signal and want proof of their booking days before signing
 * anything. Reads the reservation, uploads to
 * `reservations/{reservationId}/booking-confirmation.pdf` and returns a
 * shareable URL.
 *
 * ⚠️ This writes NOTHING back to the reservation: no `contractStatus`, no
 * `contractInfo`, no status change. That is deliberate. The document is
 * informative, not a step of the workflow, and the guards in
 * `reservation-workflow.util.ts` stay the only thing that decides whether the
 * car can be handed over. A customer holding this PDF must not become one step
 * closer to driving off with an unsigned contract.
 */

import * as functions from 'firebase-functions';
import { buildBookingConfirmationPdf } from './documents-pdf';
import { uploadPdf } from './storage';
import { documentLinkUrl, shortIdFor } from './documentLink';
import { companyConfig } from '../company-config';
import { firestore } from '../admin-guard';
import type { ContractLocale } from '../contracts/contract-types';

const LOCALES: ContractLocale[] = ['es', 'en', 'ro'];

/**
 * Statuses that mean "the customer has actually booked". A `reserved`
 * reservation has not paid the signal yet, and a document titled "booking
 * confirmation" would be claiming something that has not happened.
 */
const CONFIRMABLE_STATUSES = ['confirmed', 'delivered', 'returned', 'closed'];

interface BookingConfirmationRequest {
  reservationId: string;
  locale?: ContractLocale;
}

interface BookingConfirmationResponse {
  /** Short branded link, for pasting into WhatsApp. */
  pdfUrl: string;
  /** Direct Storage URL. Kept for the operator's own "open" button. */
  storageUrl: string;
  pdfPath: string;
  locator: string;
}

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (value._seconds) return new Date(value._seconds * 1000);
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

function asString(value: any, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export const generateBookingConfirmationPdf = functions.https.onCall(
  async (request): Promise<BookingConfirmationResponse> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }

    const data = request.data as BookingConfirmationRequest;
    if (!data?.reservationId) {
      throw new functions.https.HttpsError('invalid-argument', 'reservationId es requerido');
    }

    const reservationId = data.reservationId;
    const db = firestore();

    const snap = await db.collection('reservations').doc(reservationId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Reserva no encontrada');
    }
    const reservation = snap.data() as any;

    // The field is `reservationStatus`, not `status` — the documents also carry
    // `paymentStatus` and `contractStatus`, so the name is qualified.
    if (!CONFIRMABLE_STATUSES.includes(reservation.reservationStatus)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'La reserva aún no está confirmada: cobra la señal antes de emitir el justificante'
      );
    }

    const locale: ContractLocale = (() => {
      if (data.locale && LOCALES.includes(data.locale)) return data.locale;
      const fromReservation = reservation.contractLocale as ContractLocale | undefined;
      if (fromReservation && LOCALES.includes(fromReservation)) return fromReservation;
      return (process.env.VELTO_DEFAULT_CONTRACT_LOCALE as ContractLocale) || 'es';
    })();

    // Same convention as the contract number, so the two documents for one
    // rental quote the same reference back to the operator.
    const locator = `R-${reservationId.slice(0, 6).toUpperCase()}`;

    functions.logger.info(
      `generateBookingConfirmationPdf: reservation=${reservationId} locator=${locator}`
    );

    const pricingSnapshot = reservation.pricingSnapshot || {};
    const depositRequired =
      reservation.deposit?.requiredAmount ?? reservation.paymentSummary?.depositRequired ?? 0;

    const pdfBytes = await buildBookingConfirmationPdf({
      company: companyConfig(),
      client: {
        fullName: asString(reservation.clientSnapshot?.fullName, 'Cliente'),
        documentNumber: reservation.clientSnapshot?.documentNumber,
        phone: reservation.clientSnapshot?.phone,
        email: reservation.clientSnapshot?.email
      },
      vehicle: {
        brand: asString(reservation.vehicleSnapshot?.brand),
        model: asString(reservation.vehicleSnapshot?.model),
        version: reservation.vehicleSnapshot?.version,
        plateNumber: asString(reservation.vehicleSnapshot?.plateNumber),
        year: reservation.vehicleSnapshot?.year,
        fuelType: reservation.vehicleSnapshot?.fuelType,
        transmission: reservation.vehicleSnapshot?.transmission
      },
      rental: {
        pickupDateTime: toDate(reservation.pickupDateTime),
        returnDateTime: toDate(reservation.returnDateTime),
        totalDays: reservation.totalDays,
        pickupLocation: reservation.pickupLocation,
        returnLocation: reservation.returnLocation
      },
      pricing: {
        finalPrice: pricingSnapshot.finalPrice,
        depositAmount: depositRequired,
        tariffPrice: pricingSnapshot.basePrice,
        loyaltyDiscountPercent: pricingSnapshot.loyaltyDiscountPercent,
        loyaltyDiscount: pricingSnapshot.loyaltyDiscount,
        manualAdjustment: pricingSnapshot.manualAdjustment,
        netPrice: pricingSnapshot.netPrice,
        vatRate: pricingSnapshot.vatRate
      },
      payments: {
        initialRequired: reservation.initialPayment?.requiredAmount,
        initialPaid: reservation.initialPayment?.paidAmount,
        remainingRequired: reservation.remainingPayment?.requiredAmount,
        remainingPaid: reservation.remainingPayment?.paidAmount,
        remainingDueDate: toDate(reservation.remainingPayment?.dueDate),
        depositRequired,
        depositPaid: reservation.deposit?.paidAmount
      },
      locator,
      contractSigned: reservation.contractStatus === 'signed',
      locale,
      generatedAt: new Date()
    });

    const uploaded = await uploadPdf(
      `reservations/${reservationId}/booking-confirmation.pdf`,
      pdfBytes
    );

    return {
      ...uploaded,
      // Derived from the reservation id, so regenerating the document keeps
      // the link the customer already has in their chat alive.
      pdfUrl: documentLinkUrl(shortIdFor('booking', reservationId)),
      storageUrl: uploaded.pdfUrl,
      locator
    };
  }
);
