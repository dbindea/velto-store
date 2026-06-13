/**
 * createContractSigningLink
 *
 * Callable (auth required). Issues a one-time token for the customer to
 * sign the contract. The token is a 32-byte URL-safe random string
 * generated server-side. The token document lives in
 * `contractSigningTokens` which has Firestore rules that deny direct
 * client access.
 *
 * The customer-facing URL is `/sign-contract/{token}`. The absolute
 * origin is taken from VELTO_PUBLIC_BASE_URL when set, otherwise the
 * function falls back to a placeholder that the frontend will replace
 * with `window.location.origin` at display time.
 *
 * Default expiry: 7 days.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const db = admin.firestore();

const DEFAULT_EXPIRY_DAYS = Number(process.env.CONTRACT_LINK_EXPIRY_DAYS || 7);
const VELTO_PUBLIC_BASE_URL = process.env.VELTO_PUBLIC_BASE_URL || '';

interface CreateRequest {
  contractId: string;
}

interface CreateResponse {
  contractId: string;
  signingUrl: string;
  signingUrlAbsolute: string;
  expiresAt: any;
}

function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export const createContractSigningLink = functions.https.onCall(
  async (data: CreateRequest, context): Promise<CreateResponse> => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }
    if (!data?.contractId) {
      throw new functions.https.HttpsError('invalid-argument', 'contractId es requerido');
    }

    const contractId = data.contractId;
    const contractRef = db.collection('contracts').doc(contractId);
    const snap = await contractRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Contrato no encontrado');
    }
    const contract = snap.data() as any;
    if (contract.status === 'signed') {
      throw new functions.https.HttpsError('failed-precondition', 'El contrato ya está firmado');
    }
    if (contract.status === 'cancelled') {
      throw new functions.https.HttpsError('failed-precondition', 'El contrato está cancelado');
    }

    // Cancel any previous active tokens for this contract
    const oldTokensQ = await db.collection('contractSigningTokens')
      .where('contractId', '==', contractId)
      .where('status', '==', 'active')
      .get();
    const batch = db.batch();
    oldTokensQ.docs.forEach((d) => batch.update(d.ref, {
      status: 'cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }));
    await batch.commit();

    const token = generateToken(32);
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    );
    const now = admin.firestore.FieldValue.serverTimestamp();

    const tokenRef = await db.collection('contractSigningTokens').add({
      token,
      contractId,
      reservationId: contract.reservationId,
      clientId: contract.clientId,
      status: 'active',
      expiresAt,
      createdAt: now,
      updatedAt: now
    });

    const relativeUrl = `/sign-contract/${token}`;
    const absoluteUrl = VELTO_PUBLIC_BASE_URL
      ? `${VELTO_PUBLIC_BASE_URL.replace(/\/$/, '')}${relativeUrl}`
      : relativeUrl;

    const signingLinkPath = relativeUrl;

    await contractRef.set(
      {
        status: 'pending_signature',
        signingTokenId: tokenRef.id,
        signingLinkPath,
        updatedAt: now,
        updatedBy: context.auth.uid || null
      },
      { merge: true }
    );

    await db.collection('reservations').doc(contract.reservationId).set(
      {
        contractStatus: 'pending_signature',
        contractInfo: {
          contractId,
          contractNumber: contract.contractNumber,
          pdfUrl: contract.pdfUrl,
          signingUrl: relativeUrl
        },
        updatedAt: now
      },
      { merge: true }
    );

    return {
      contractId,
      signingUrl: relativeUrl,
      signingUrlAbsolute: absoluteUrl,
      expiresAt: expiresAt.toDate().toISOString()
    };
  }
);

interface CancelRequest {
  contractId: string;
}

export const cancelContractSigningLink = functions.https.onCall(
  async (data: CancelRequest, context): Promise<{ ok: true }> => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }
    if (!data?.contractId) {
      throw new functions.https.HttpsError('invalid-argument', 'contractId es requerido');
    }

    const contractId = data.contractId;
    const contractRef = db.collection('contracts').doc(contractId);
    const snap = await contractRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Contrato no encontrado');
    }
    const contract = snap.data() as any;
    if (contract.status === 'signed') {
      throw new functions.https.HttpsError('failed-precondition', 'El contrato ya está firmado');
    }

    const tokensQ = await db.collection('contractSigningTokens')
      .where('contractId', '==', contractId)
      .where('status', '==', 'active')
      .get();
    const batch = db.batch();
    tokensQ.docs.forEach((d) => batch.update(d.ref, {
      status: 'cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }));
    await batch.commit();

    const now = admin.firestore.FieldValue.serverTimestamp();
    await contractRef.set(
      {
        status: 'generated',
        signingTokenId: null,
        signingLinkPath: null,
        updatedAt: now,
        updatedBy: context.auth.uid || null
      },
      { merge: true }
    );
    await db.collection('reservations').doc(contract.reservationId).set(
      {
        contractStatus: 'generated',
        updatedAt: now
      },
      { merge: true }
    );

    return { ok: true };
  }
);
