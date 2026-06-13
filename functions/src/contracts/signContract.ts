/**
 * signContract
 *
 * Public, no auth. Accepts:
 *   - token: the one-time token
 *   - signatureDataUrl: data:image/png;base64,...
 *
 * The function:
 *   1. Validates the token (active, not expired, contract not signed).
 *   2. Decodes the data URL into a PNG buffer.
 *   3. Uploads the signature image to
 *      `contracts/{reservationId}/signature.png`.
 *   4. Re-builds the contract PDF with the embedded signature and
 *      uploads it to `contracts/{reservationId}/contract-signed.pdf`.
 *   5. Marks the contract as signed, marks the token as used, and
 *      updates the reservation.
 *
 * The function is idempotent for invalid/used tokens. Concurrent calls
 * are safe because the token transition is performed with a transaction.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { buildContractPdf } from './pdf';
import { firestore, storageBucket } from '../admin-guard';

interface SignRequest {
  token: string;
  signatureDataUrl: string;
}

interface SignResponse {
  ok: true;
  contractId: string;
  signedAt: string;
}

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return undefined;
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  if (!dataUrl) return null;
  const m = /^data:(image\/(?:png|jpe?g));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return {
    mime: m[1].toLowerCase(),
    buffer: Buffer.from(m[2], 'base64')
  };
}

function downloadToken(): string {
  return require('crypto').randomUUID();
}

export const signContract = functions.https.onCall(
  async (request): Promise<SignResponse> => {
    const data = request.data as SignRequest;
    if (!data?.token || !data?.signatureDataUrl) {
      throw new functions.https.HttpsError('invalid-argument', 'Token y firma son requeridos');
    }
    const decoded = decodeDataUrl(data.signatureDataUrl);
    if (!decoded) {
      throw new functions.https.HttpsError('invalid-argument', 'Firma no válida');
    }

    const db = firestore();
    const storage = storageBucket();

    // 1. Find the token
    const tokenQ = await db.collection('contractSigningTokens')
      .where('token', '==', data.token)
      .limit(1)
      .get();
    if (tokenQ.empty) {
      throw new functions.https.HttpsError('not-found', 'Token no encontrado');
    }
    const tokenDoc = tokenQ.docs[0];
    const tokenData = tokenDoc.data() as any;

    // 2. Validate token state
    const now = new Date();
    if (tokenData.status === 'used') {
      throw new functions.https.HttpsError('failed-precondition', 'El contrato ya está firmado');
    }
    if (tokenData.status === 'cancelled') {
      throw new functions.https.HttpsError('failed-precondition', 'El link fue cancelado');
    }
    const expiresAt = toDate(tokenData.expiresAt);
    if (!expiresAt || expiresAt < now) {
      // Mark expired and reject
      await tokenDoc.ref.update({
        status: 'expired',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      throw new functions.https.HttpsError('failed-precondition', 'El link ha caducado');
    }

    // 3. Load contract
    const contractRef = db.collection('contracts').doc(tokenData.contractId);
    const contractSnap = await contractRef.get();
    if (!contractSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Contrato no encontrado');
    }
    const contract = contractSnap.data() as any;
    if (contract.status === 'signed') {
      throw new functions.https.HttpsError('failed-precondition', 'El contrato ya está firmado');
    }

    const reservationId: string = contract.reservationId;
    const userAgent = (request as any).rawRequest?.headers?.['user-agent'];

    // 4. Upload signature image
    const sigPath = `contracts/${reservationId}/signature.png`;
    const sigFile = storage.bucket().file(sigPath);
    const sigToken = downloadToken();
    await sigFile.save(decoded.buffer, {
      contentType: decoded.mime,
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: sigToken
        }
      },
      resumable: false
    });
    const sigUrl = `https://firebasestorage.googleapis.com/v0/b/${storage.bucket().name}/o/${encodeURIComponent(sigPath)}?alt=media&token=${sigToken}`;

    // 5. Build the signed PDF
    const VELTO_COMPANY_NAME = process.env.VELTO_COMPANY_NAME || 'Velto Rent';
    const VELTO_COMPANY_EMAIL = process.env.VELTO_COMPANY_EMAIL || 'reservas@veltorent.com';
    const VELTO_COMPANY_PHONE = process.env.VELTO_COMPANY_PHONE || '';
    const VELTO_COMPANY_ADDRESS = process.env.VELTO_COMPANY_ADDRESS || '';

    const signedPdfBytes = await buildContractPdf(
      {
        contractNumber: contract.contractNumber,
        companyName: VELTO_COMPANY_NAME,
        companyEmail: VELTO_COMPANY_EMAIL,
        companyPhone: VELTO_COMPANY_PHONE,
        companyAddress: VELTO_COMPANY_ADDRESS,
        client: {
          fullName: contract.clientSnapshot?.fullName || '',
          documentType: contract.clientSnapshot?.documentType,
          documentNumber: contract.clientSnapshot?.documentNumber,
          phone: contract.clientSnapshot?.phone,
          email: contract.clientSnapshot?.email,
          address: contract.clientSnapshot?.address,
          drivingLicenseNumber: contract.clientSnapshot?.drivingLicenseNumber
        },
        vehicle: {
          brand: contract.vehicleSnapshot?.brand || '',
          model: contract.vehicleSnapshot?.model || '',
          version: contract.vehicleSnapshot?.version,
          plateNumber: contract.vehicleSnapshot?.plateNumber || '',
          year: contract.vehicleSnapshot?.year
        },
        reservation: {
          pickupDateTime: toDate(contract.reservationSnapshot?.pickupDateTime),
          returnDateTime: toDate(contract.reservationSnapshot?.returnDateTime),
          totalDays: contract.reservationSnapshot?.totalDays,
          pickupLocation: contract.reservationSnapshot?.pickupLocation,
          returnLocation: contract.reservationSnapshot?.returnLocation,
          finalPrice: contract.reservationSnapshot?.finalPrice,
          depositAmount: contract.reservationSnapshot?.depositAmount
        },
        inspection: contract.inspectionSnapshot
          ? {
              pickupKm: contract.inspectionSnapshot.pickupKm,
              pickupFuelLevel: contract.inspectionSnapshot.pickupFuelLevel,
              returnKm: contract.inspectionSnapshot.returnKm,
              returnFuelLevel: contract.inspectionSnapshot.returnFuelLevel
            }
          : undefined,
        generatedAt: toDate(contract.generatedAt) || toDate(contract.createdAt),
        signaturePng: new Uint8Array(decoded.buffer),
        signedAt: now,
        signerName: contract.clientSnapshot?.fullName
      },
      true
    );

    const signedPath = `contracts/${reservationId}/contract-signed.pdf`;
    const signedFile = storage.bucket().file(signedPath);
    const pdfToken = downloadToken();
    await signedFile.save(Buffer.from(signedPdfBytes), {
      contentType: 'application/pdf',
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: pdfToken
        }
      },
      resumable: false
    });
    const signedUrl = `https://firebasestorage.googleapis.com/v0/b/${storage.bucket().name}/o/${encodeURIComponent(signedPath)}?alt=media&token=${pdfToken}`;

    // 6. Apply state changes in a transaction to prevent double-sign
    const nowServer = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
      const freshToken = await tx.get(tokenDoc.ref);
      if (!freshToken.exists) {
        throw new functions.https.HttpsError('failed-precondition', 'Token no encontrado');
      }
      const ft = freshToken.data() as any;
      if (ft.status === 'used') {
        throw new functions.https.HttpsError('failed-precondition', 'El contrato ya está firmado');
      }
      tx.update(tokenDoc.ref, {
        status: 'used',
        usedAt: nowServer,
        updatedAt: nowServer,
        clientAccessInfo: {
          userAgent: userAgent || null
        }
      });
      tx.update(contractRef, {
        status: 'signed',
        signedAt: nowServer,
        signedPdfUrl: signedUrl,
        signedPdfPath: signedPath,
        signatureUrl: sigUrl,
        signaturePath: sigPath,
        updatedAt: nowServer
      });
      tx.set(
        db.collection('reservations').doc(reservationId),
        {
          contractStatus: 'signed',
          contractInfo: {
            contractId: tokenData.contractId,
            contractNumber: contract.contractNumber,
            pdfUrl: contract.pdfUrl,
            signedPdfUrl: signedUrl,
            signedAt: nowServer
          },
          updatedAt: nowServer
        },
        { merge: true }
      );
    });

    functions.logger.info(`Contract ${tokenData.contractId} signed by token ${tokenDoc.id}`);

    return {
      ok: true,
      contractId: tokenData.contractId,
      signedAt: now.toISOString()
    };
  }
);
