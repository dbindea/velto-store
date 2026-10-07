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

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
/**
 * ⚠️ **El generador de PDF se carga al USARSE, no al arrancar.**
 *
 * Este fichero es uno de los treinta y cuatro que `index.ts` reexporta, y el
 * contenedor los evalúa TODOS al arrancar. Con el import arriba, una petición
 * para listar cuatro coches en la web pública cargaba `pdf-lib` y `fontkit`
 * enteros: medido, 156 ms y 162 ms, dentro de 921 módulos y 105 MB de memoria
 * que se pagan en cada arranque en frío de CUALQUIERA de las 34.
 *
 * El `await import()` compila a `Promise.resolve().then(() => require(...))`
 * con este tsconfig —comprobado sobre la salida real—, o sea perezoso de verdad
 * y con la misma semántica de `require` que antes. Y el especificador se sigue
 * comprobando de tipos: una ruta mal escrita es un error de compilación, no un
 * fallo en producción.
 *
 * ⚠️ Lo vigila `arranque.spec.ts`. Si alguien vuelve a subir este import
 * arriba, la mejora se pierde entera y **nada más avisa**: compila, pasa los
 * tests y despliega bien.
 */
import { nombreDePdf, palabraDocumento } from './nombre-descarga';
import { uploadPdf } from './storage';
import { documentLinkUrl, shortIdFor } from './documentLink';
import { reservationLocator } from './locator';
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

export const generateBookingConfirmationPdf = onCall(
  async (request): Promise<BookingConfirmationResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
    }

    const data = request.data as BookingConfirmationRequest;
    if (!data?.reservationId) {
      throw new HttpsError('invalid-argument', 'reservationId es requerido');
    }

    const reservationId = data.reservationId;
    const db = firestore();

    const snap = await db.collection('reservations').doc(reservationId).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Reserva no encontrada');
    }
    const reservation = snap.data() as any;

    // The field is `reservationStatus`, not `status` — the documents also carry
    // `paymentStatus` and `contractStatus`, so the name is qualified.
    if (!CONFIRMABLE_STATUSES.includes(reservation.reservationStatus)) {
      throw new HttpsError(
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
    // rental quote the same reference back to the operator. The receipt prints
    // it too, which is why the formula lives in one place.
    const locator = reservationLocator(reservationId);

    logger.info(
      `generateBookingConfirmationPdf: reservation=${reservationId} locator=${locator}`
    );

    const pricingSnapshot = reservation.pricingSnapshot || {};
    const depositRequired =
      reservation.deposit?.requiredAmount ?? reservation.paymentSummary?.depositRequired ?? 0;

    const { buildBookingConfirmationPdf } = await import('./documents-pdf');
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
        vatRate: pricingSnapshot.vatRate,
        // Fuera de `pricingSnapshot` en la reserva: el desplazamiento lo pone la
        // agencia, no el coche, y por eso no entra en el reparto con su dueño.
        deliveryPickupFee: reservation.deliveryFees?.pickupFee,
        deliveryReturnFee: reservation.deliveryFees?.returnFee
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
      pdfBytes,
      nombreDePdf(
        palabraDocumento('booking', locale),
        reservation.vehicleSnapshot?.plateNumber,
        reservation.clientSnapshot?.fullName
      )
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
