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
import { CONTRACT_CLAUSES, pickBundle } from './clauses';
import { firestore, storageBucket } from '../admin-guard';
import type { ContractLocale } from './contract-types';

const VELTO_COMPANY_NAME = process.env.VELTO_COMPANY_NAME || 'Velto Rent';
const VELTO_COMPANY_EMAIL = process.env.VELTO_COMPANY_EMAIL || 'reservas@veltorent.com';
const VELTO_COMPANY_PHONE = process.env.VELTO_COMPANY_PHONE || '';
const VELTO_COMPANY_ADDRESS = process.env.VELTO_COMPANY_ADDRESS || '';
const VELTO_COMPANY_TAX_ID = process.env.VELTO_COMPANY_TAX_ID || 'B88866900';
const VELTO_COMPANY_REGISTRY =
  process.env.VELTO_COMPANY_REGISTRY ||
  'Sociedad Limitada inscrita en el Registro Mercantil de Madrid, Tomo 45067, Folio 44, Hoja M-793170';
const VELTO_COMPANY_REP_NAME = process.env.VELTO_COMPANY_REP_NAME || '';
const VELTO_COMPANY_REP_NIE = process.env.VELTO_COMPANY_REP_NIE || '';
const VELTO_COMPANY_INSURANCE = process.env.VELTO_COMPANY_INSURANCE || '';
const VELTO_COMPANY_WEBSITE = process.env.VELTO_COMPANY_WEBSITE || 'www.veltorent.com';

interface GenerateRequest {
  reservationId: string;
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

    // 6b. Determine preferred contract locale: prefer reservation metadata,
    //     then the company default, then 'es'.
    const preferredLocale: ContractLocale = (() => {
      const fromReservation = (reservation as any).contractLocale as ContractLocale | undefined;
      if (fromReservation && CONTRACT_CLAUSES.available.includes(fromReservation)) {
        return fromReservation;
      }
      const fromEnv = (process.env.VELTO_DEFAULT_CONTRACT_LOCALE || 'es') as ContractLocale;
      if (CONTRACT_CLAUSES.available.includes(fromEnv)) return fromEnv;
      return 'es';
    })();

    // 7. Build the PDF
    const pdfBytes = await buildContractPdf(
      {
        contractNumber,
        company: {
          legalName: VELTO_COMPANY_NAME,
          taxId: VELTO_COMPANY_TAX_ID,
          registry: VELTO_COMPANY_REGISTRY,
          address: VELTO_COMPANY_ADDRESS,
          phone: VELTO_COMPANY_PHONE,
          email: VELTO_COMPANY_EMAIL,
          website: VELTO_COMPANY_WEBSITE,
          insurancePolicy: VELTO_COMPANY_INSURANCE,
          representativeName: VELTO_COMPANY_REP_NAME,
          representativeNie: VELTO_COMPANY_REP_NIE
        },
        client: clientSnapshot,
        vehicle: vehicleSnapshot,
        reservation: {
          pickupDateTime: toDate(reservation.pickupDateTime),
          returnDateTime: toDate(reservation.returnDateTime),
          totalDays: reservation.totalDays,
          pickupLocation: reservation.pickupLocation,
          returnLocation: reservation.returnLocation,
          finalPrice: reservation.pricingSnapshot?.finalPrice,
          depositAmount: depositRequired
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
        depositAmount: depositRequired
      },
      clientSnapshot,
      vehicleSnapshot,
      companySnapshot: {
        legalName: VELTO_COMPANY_NAME,
        taxId: VELTO_COMPANY_TAX_ID,
        registry: VELTO_COMPANY_REGISTRY,
        address: VELTO_COMPANY_ADDRESS,
        phone: VELTO_COMPANY_PHONE,
        email: VELTO_COMPANY_EMAIL,
        website: VELTO_COMPANY_WEBSITE,
        insurancePolicy: VELTO_COMPANY_INSURANCE,
        representativeName: VELTO_COMPANY_REP_NAME,
        representativeNie: VELTO_COMPANY_REP_NIE
      },
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
