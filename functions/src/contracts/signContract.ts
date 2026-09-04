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
import { companyConfig } from '../company-config';
import {
  SIGNING_SECRETS,
  isSigningConfigured,
  signPdfWithCompanyCertificate
} from './sign-pdf';
import {
  formatVerificationCode,
  generateVerificationCode,
  sha256Hex,
  verificationUrl,
  verificationUrlLabel
} from './verification';

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
  {
    // ⚠️ Declarar el secret no es opcional: uno que existe en Secret Manager
    // pero no aparece aquí **no se monta en el runtime**, así que `.value()`
    // sale vacío y el contrato se guardaría sin sellar sin decir por qué. Es
    // exactamente lo que le pasó a `RESEND_API_KEY` durante meses (M-22).
    secrets: SIGNING_SECRETS
  },
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
    //
    // Use the persisted clauses bundle (frozen at generation time), falling
    // back to the current static bundle if the contract predates the schema.
    let clauses = contract.clauses;
    if (!clauses) {
      const { CONTRACT_CLAUSES } = await import('./clauses');
      clauses = CONTRACT_CLAUSES;
    }
    // The snapshot taken when the contract was generated wins: the signed PDF
    // has to reproduce the document the customer agreed to, not today's
    // company details.
    const companySnapshot = contract.companySnapshot || companyConfig();

    /**
     * Código Seguro de Verificación (N-9).
     *
     * Se decide **antes** de construir el PDF porque el QR va dentro del
     * documento que después se sella: un PDF firmado no admite cambios, así que
     * no hay una segunda oportunidad de dibujarlo. Si el contrato ya tuviera
     * código se respeta — el que el cliente tenga impreso tiene que seguir
     * valiendo.
     */
    const verificationCode: string = contract.verificationCode || generateVerificationCode();

    /**
     * Se construye a demanda porque puede haber que rehacerlo.
     *
     * `anunciarFirma` gobierna la línea «Firmado digitalmente con certificado
     * digital». Si el sellado acaba fallando, se vuelve a construir con `false`
     * y se guarda ese: el documento no puede afirmar una firma que no lleva.
     */
    const construirPdf = (anunciarFirma: boolean) => buildContractPdf(
      {
        contractNumber: contract.contractNumber,
        company: companySnapshot,
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
          depositAmount: contract.reservationSnapshot?.depositAmount,
          tariffPrice: contract.reservationSnapshot?.tariffPrice,
          loyaltyDiscountPercent: contract.reservationSnapshot?.loyaltyDiscountPercent,
          loyaltyDiscount: contract.reservationSnapshot?.loyaltyDiscount,
          manualAdjustment: contract.reservationSnapshot?.manualAdjustment,
          netPrice: contract.reservationSnapshot?.netPrice,
          vatRate: contract.reservationSnapshot?.vatRate
        },
        inspection: contract.inspectionSnapshot
          ? {
              pickupKm: contract.inspectionSnapshot.pickupKm,
              pickupFuelLevel: contract.inspectionSnapshot.pickupFuelLevel,
              returnKm: contract.inspectionSnapshot.returnKm,
              returnFuelLevel: contract.inspectionSnapshot.returnFuelLevel
            }
          : undefined,
        clauses,
        preferredLocale: contract.locale,
        generatedAt: toDate(contract.generatedAt) || toDate(contract.createdAt),
        signaturePng: new Uint8Array(decoded.buffer),
        signedAt: now,
        signerName: contract.clientSnapshot?.fullName,
        willBeDigitallySigned: anunciarFirma,
        verification: {
          code: formatVerificationCode(verificationCode),
          url: verificationUrl(verificationCode),
          urlLabel: verificationUrlLabel()
        }
      },
      true
    );

    /**
     * Sellado con el certificado de la empresa (N-8).
     *
     * Va el último porque un PDF firmado no admite cambios: cualquier cosa que
     * se le haga después rompe la firma. Y no lanza — si falla se guarda sin
     * sellar, porque perder el sello es un problema y perder la firma que el
     * cliente acaba de hacer es uno mucho peor.
     *
     * ⚠️ **Si se anunció la firma y el sellado falla, se rehace el PDF.**
     * La primera versión decidía la frase antes de intentar sellar, y la
     * primera prueba con el certificado real dio un documento que decía estar
     * firmado digitalmente sin estarlo: exactamente el problema que N-8 venía a
     * arreglar, pero ahora intermitente. La frase y la realidad se deciden
     * juntas o no valen.
     */
    const anuncioPrevisto = isSigningConfigured();
    const sealed = await signPdfWithCompanyCertificate(
      await construirPdf(anuncioPrevisto),
      `Contrato de alquiler ${contract.contractNumber || ''}`.trim()
    );
    const pdfParaGuardar =
      anuncioPrevisto && !sealed.signed
        ? await construirPdf(false)
        : sealed.bytes;

    /**
     * ⚠️ **La huella se calcula sobre lo que se guarda, no sobre lo que se
     * construyó.** El sellado cambia los bytes —es lo que hace—, y si el
     * anuncio se retira el PDF se rehace entero. Calcularla antes daría un
     * valor que no coincide con ningún fichero existente, y la página de
     * verificación diría que el contrato del cliente está alterado.
     */
    const fingerprint = sha256Hex(pdfParaGuardar);

    const signedPath = `contracts/${reservationId}/contract-signed.pdf`;
    const signedFile = storage.bucket().file(signedPath);
    const pdfToken = downloadToken();
    await signedFile.save(Buffer.from(pdfParaGuardar), {
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
        // N-9. El código es lo que se busca desde la página pública, y la
        // huella lo que permite decirle a quien la abre si el fichero que
        // tiene delante es el que emitimos. `digitallySealed` guarda lo que de
        // verdad pasó al sellar, no lo que se pretendía: es la misma regla que
        // la frase impresa, y por el mismo motivo.
        verificationCode,
        signedPdfSha256: fingerprint,
        digitallySealed: sealed.signed,
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
