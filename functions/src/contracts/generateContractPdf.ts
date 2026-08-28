/**
 * generateContractPdf
 *
 * Callable (auth required).
 *
 * Reads the reservation, the linked client, vehicle, pickup inspection
 * (if any) and payment summary, builds the full Contract snapshot,
 * renders the PDF, uploads it to Storage under
 * `contracts/{reservationId}/contract-original.pdf`, and creates or
 * updates the contract document.
 *
 * The contract id is the same as the reservationId for simplicity
 * (one contract per reservation in the MVP). Re-running this function
 * overwrites the previous PDF and snapshot.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { buildContractPdf } from './pdf';
import { CONTRACT_CLAUSES } from './clauses';
import { firestore, storageBucket } from '../admin-guard';
import { companyConfig } from '../company-config';
import type { ContractLocale } from './contract-types';

interface GenerateRequest {
  reservationId: string;
  /** Language of the platform when the operator pressed the button. */
  locale?: ContractLocale;
}

interface GenerateResponse {
  contractId: string;
  pdfUrl: string;
  pdfPath: string;
}

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return undefined;
}

function asString(value: any, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

// A `stripUndefined()` helper used to sit here and wrap every payload before
// `.set()`. It corrupted data: it rebuilt each object with `Object.entries()`,
// and a `FieldValue.serverTimestamp()` sentinel is an object with no own
// enumerable properties, so it was flattened to `{}`. Contracts were written
// with `createdAt` and `generatedAt` as empty maps instead of timestamps, and
// the contract list then crashed the Angular date pipe with "Invalid Date".
//
// It was redundant anyway: `ignoreUndefinedProperties` in admin-guard.ts
// already makes Firestore skip undefined fields, and unlike the helper it
// leaves sentinels, Timestamps and DocumentReferences untouched.
// Do not reintroduce a generic deep-clean on Firestore payloads.

export const generateContractPdf = functions.https.onCall(
  async (request): Promise<GenerateResponse> => {
    const data = request.data as GenerateRequest;
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }
    if (!data?.reservationId) {
      throw new functions.https.HttpsError('invalid-argument', 'reservationId es requerido');
    }

    const reservationId = data.reservationId;
    functions.logger.info(`generateContractPdf: reservation=${reservationId}`);

    const db = firestore();
    const storage = storageBucket();

    // 1. Load reservation
    const resSnap = await db.collection('reservations').doc(reservationId).get();
    if (!resSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Reserva no encontrada');
    }
    const reservation = resSnap.data() as any;

    // 2. Load client snapshot (prefer reservation snapshot to avoid extra read)
    const clientSnapshot = {
      fullName: asString(reservation.clientSnapshot?.fullName, 'Cliente'),
      phone: reservation.clientSnapshot?.phone,
      email: reservation.clientSnapshot?.email,
      documentType: reservation.clientSnapshot?.documentType,
      documentNumber: reservation.clientSnapshot?.documentNumber,
      address: reservation.clientSnapshot?.address,
      drivingLicenseNumber: reservation.clientSnapshot?.drivingLicenseNumber
    };

    // Optional: enrich with current client doc values
    if (reservation.clientId) {
      try {
        const clientSnap = await db.collection('clients').doc(reservation.clientId).get();
        if (clientSnap.exists) {
          const c = clientSnap.data() as any;
          clientSnapshot.fullName = c.fullName || clientSnapshot.fullName;
          clientSnapshot.phone = c.phone || clientSnapshot.phone;
          clientSnapshot.email = c.email || clientSnapshot.email;
          clientSnapshot.documentType = c.documentType || clientSnapshot.documentType;
          clientSnapshot.documentNumber = c.documentNumber || clientSnapshot.documentNumber;
          clientSnapshot.address = c.address || clientSnapshot.address;
          clientSnapshot.drivingLicenseNumber = c.drivingLicenseNumber || clientSnapshot.drivingLicenseNumber;
        }
      } catch (err) {
        functions.logger.warn('Failed to enrich client snapshot, using reservation snapshot', err);
      }
    }

    // 3. Load vehicle snapshot
    const vehicleSnapshot = {
      brand: asString(reservation.vehicleSnapshot?.brand, ''),
      model: asString(reservation.vehicleSnapshot?.model, ''),
      version: reservation.vehicleSnapshot?.version,
      plateNumber: asString(reservation.vehicleSnapshot?.plateNumber, ''),
      acrissCode: reservation.vehicleSnapshot?.acrissCode,
      year: reservation.vehicleSnapshot?.year,
      fuelType: reservation.vehicleSnapshot?.fuelType,
      transmission: reservation.vehicleSnapshot?.transmission
    };

    // 4. Find pickup inspection (if any)
    let pickupInspection: any = null;
    try {
      const inspQ = await db.collection('inspections')
        .where('reservationId', '==', reservationId)
        .where('type', '==', 'pickup')
        .limit(1)
        .get();
      if (!inspQ.empty) {
        pickupInspection = inspQ.docs[0].data();
      }
    } catch (err) {
      functions.logger.warn('Failed to load pickup inspection', err);
    }

    // 5. Load payment summary (deposit)
    const paymentSummary = reservation.paymentSummary || {};
    const depositRequired = reservation.deposit?.requiredAmount || paymentSummary.depositRequired || 0;

    // 6. Determine contract number
    const contractNumber = `C-${reservationId.slice(0, 6).toUpperCase()}-${new Date().getFullYear()}`;

    // 6b. Contract language.
    //
    // The caller's language wins: the operator issues the document in whatever
    // language the platform is set to, which is the one they are speaking to
    // the customer in. Then anything frozen on the reservation, then the
    // configured default, and finally Spanish.
    const preferredLocale: ContractLocale = (() => {
      const candidates = [
        data.locale,
        (reservation as any).contractLocale as ContractLocale | undefined,
        process.env.VELTO_DEFAULT_CONTRACT_LOCALE as ContractLocale | undefined
      ];
      for (const candidate of candidates) {
        if (candidate && CONTRACT_CLAUSES.available.includes(candidate)) return candidate;
      }
      return 'es';
    })();

    const company = companyConfig();

    // 7. Build the PDF
    const pdfBytes = await buildContractPdf(
      {
        contractNumber,
        company,
        client: clientSnapshot,
        vehicle: vehicleSnapshot,
        reservation: {
          pickupDateTime: toDate(reservation.pickupDateTime),
          returnDateTime: toDate(reservation.returnDateTime),
          totalDays: reservation.totalDays,
          pickupLocation: reservation.pickupLocation,
          returnLocation: reservation.returnLocation,
          finalPrice: reservation.pricingSnapshot?.finalPrice,
          depositAmount: depositRequired,
          tariffPrice: reservation.pricingSnapshot?.basePrice,
          loyaltyDiscountPercent: reservation.pricingSnapshot?.loyaltyDiscountPercent,
          loyaltyDiscount: reservation.pricingSnapshot?.loyaltyDiscount,
          manualAdjustment: reservation.pricingSnapshot?.manualAdjustment,
          netPrice: reservation.pricingSnapshot?.netPrice,
          vatRate: reservation.pricingSnapshot?.vatRate
        },
        inspection: pickupInspection
          ? {
              pickupKm: pickupInspection.km,
              pickupFuelLevel: pickupInspection.fuelLevel
            }
          : undefined,
        clauses: CONTRACT_CLAUSES,
        preferredLocale,
        generatedAt: new Date()
      },
      false
    );

    // 8. Upload to Storage
    const pdfPath = `contracts/${reservationId}/contract-original.pdf`;
    const file = storage.bucket().file(pdfPath);
    const downloadToken = require('crypto').randomUUID();
    await file.save(Buffer.from(pdfBytes), {
      contentType: 'application/pdf',
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken
        }
      },
      resumable: false
    });
    const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${storage.bucket().name}/o/${encodeURIComponent(pdfPath)}?alt=media&token=${downloadToken}`;

    // 9. Upsert the contract document
    const now = admin.firestore.FieldValue.serverTimestamp();
    const contractRef = db.collection('contracts').doc(reservationId);
    const existing = await contractRef.get();
    const baseUpdate: any = {
      reservationId,
      clientId: reservation.clientId,
      vehicleId: reservation.vehicleId,
      status: 'generated',
      contractNumber,
      locale: preferredLocale,
      reservationSnapshot: {
        pickupDateTime: reservation.pickupDateTime,
        returnDateTime: reservation.returnDateTime,
        totalDays: reservation.totalDays,
        pickupLocation: reservation.pickupLocation,
        returnLocation: reservation.returnLocation,
        finalPrice: reservation.pricingSnapshot?.finalPrice,
        depositAmount: depositRequired,
        // Frozen alongside the price so re-rendering the PDF at signing time
        // reproduces exactly the same breakdown, even if the client's discount
        // or the VAT rate has moved in the meantime.
        tariffPrice: reservation.pricingSnapshot?.basePrice,
        loyaltyDiscountPercent: reservation.pricingSnapshot?.loyaltyDiscountPercent,
        loyaltyDiscount: reservation.pricingSnapshot?.loyaltyDiscount,
        manualAdjustment: reservation.pricingSnapshot?.manualAdjustment,
        netPrice: reservation.pricingSnapshot?.netPrice,
        vatRate: reservation.pricingSnapshot?.vatRate
      },
      clientSnapshot,
      vehicleSnapshot,
      companySnapshot: company,
      // Persist a copy of the clauses bundle so the contract is reproducible
      // even if clauses.ts is edited later.
      clauses: CONTRACT_CLAUSES,
      inspectionSnapshot: pickupInspection
        ? {
            pickupKm: pickupInspection.km,
            pickupFuelLevel: pickupInspection.fuelLevel
          }
        : null,
      paymentSnapshot: {
        rentalTotal: reservation.pricingSnapshot?.finalPrice,
        depositRequired,
        depositPaid: reservation.deposit?.paidAmount,
        totalPaid: paymentSummary.totalPaid
      },
      pdfUrl,
      pdfPath,
      generatedAt: now,
      updatedAt: now,
      updatedBy: request.auth!.uid || null
    };
    if (!existing.exists) {
      baseUpdate.createdAt = now;
      baseUpdate.createdBy = request.auth!.uid || null;
    }
    await contractRef.set(baseUpdate, { merge: true });

    // 10. Update reservation contractStatus and contractInfo
    await db.collection('reservations').doc(reservationId).set(
      {
        contractStatus: 'generated',
        contractInfo: {
          contractId: reservationId,
          contractNumber,
          pdfUrl
        },
        updatedAt: now
      },
      { merge: true }
    );

    return {
      contractId: reservationId,
      pdfUrl,
      pdfPath
    };
  }
);
