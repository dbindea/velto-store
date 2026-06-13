/**
 * sendSignedContractEmail
 *
 * Callable (auth required). Sends the signed contract by email using
 * Resend's HTTPS API.
 *
 * Secrets (set with `firebase functions:secrets:set`):
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL (default: reservas@veltorent.com)
 *
 * The signed PDF is downloaded from Storage and attached to the email
 * (filename: contrato-firmado-{contractNumber}.pdf).
 *
 * The function does NOT expose the API key. It only talks to the
 * Resend HTTPS API from the Cloud Functions runtime.
 *
 * The email is sent with a simple, professional template in Spanish.
 * For multilingual support, switch on the customer's locale.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { firestore, storageBucket } from '../admin-guard';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'reservas@veltorent.com';
const RESEND_API_URL = 'https://api.resend.com/emails';

interface SendRequest {
  contractId: string;
  email?: string;
}

interface SendResponse {
  contractId: string;
  emailedAt: string;
  to: string;
}

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return undefined;
}

function formatDate(d?: Date): string {
  if (!d) return '—';
  try {
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch {
    return '—';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const sendSignedContractEmail = functions.https.onCall(
  async (request): Promise<SendResponse> => {
    const data = request.data as SendRequest;
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }
    if (!data?.contractId) {
      throw new functions.https.HttpsError('invalid-argument', 'contractId es requerido');
    }
    if (!RESEND_API_KEY) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Resend no está configurado. Configura RESEND_API_KEY.'
      );
    }

    const db = firestore();
    const storage = storageBucket();

    const contractRef = db.collection('contracts').doc(data.contractId);
    const snap = await contractRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Contrato no encontrado');
    }
    const contract = snap.data() as any;
    if (contract.status !== 'signed') {
      throw new functions.https.HttpsError('failed-precondition', 'El contrato no está firmado');
    }

    const to = (data.email || contract.clientSnapshot?.email || '').trim();
    if (!to) {
      throw new functions.https.HttpsError('failed-precondition', 'El cliente no tiene email');
    }
    if (!/^\S+@\S+\.\S+$/.test(to)) {
      throw new functions.https.HttpsError('invalid-argument', 'Email no válido');
    }

    // Download the signed PDF
    const signedPath: string = contract.signedPdfPath;
    if (!signedPath) {
      throw new functions.https.HttpsError('failed-precondition', 'PDF firmado no disponible');
    }
    const file = storage.bucket().file(signedPath);
    const [buffer] = await file.download();

    // Build email body
    const clientName = contract.clientSnapshot?.fullName || 'cliente';
    const vehicleLabel = `${contract.vehicleSnapshot?.brand || ''} ${contract.vehicleSnapshot?.model || ''}`.trim();
    const pickup = formatDate(toDate(contract.reservationSnapshot?.pickupDateTime));
    const ret = formatDate(toDate(contract.reservationSnapshot?.returnDateTime));

    const subject = 'Contrato de alquiler Velto Rent';
    const html = `
      <p>Hola ${escapeHtml(clientName)},</p>
      <p>Adjuntamos el contrato firmado correspondiente a la reserva del vehículo
        <strong>${escapeHtml(vehicleLabel)}</strong> con fechas
        <strong>${escapeHtml(pickup)}</strong> a <strong>${escapeHtml(ret)}</strong>.
      </p>
      <p>Gracias por confiar en Velto Rent.</p>
      <p>Velto Rent<br/>reservas@veltorent.com</p>
    `;
    const text = `Hola ${clientName},\n\nAdjuntamos el contrato firmado correspondiente a la reserva del vehículo ${vehicleLabel} con fechas ${pickup} a ${ret}.\n\nGracias por confiar en Velto Rent.\n\nVelto Rent\nreservas@veltorent.com`;

    const filename = `contrato-firmado-${contract.contractNumber || contract.id}.pdf`;

    const resendPayload = {
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html,
      text,
      attachments: [
        {
          filename,
          content: buffer.toString('base64')
        }
      ]
    };

    functions.logger.info(`Sending signed contract ${contract.id} to ${to}`);
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(resendPayload)
    });

    if (!res.ok) {
      const body = await res.text();
      functions.logger.error('Resend API error', res.status, body);
      throw new functions.https.HttpsError(
        'internal',
        `Error al enviar el email (${res.status})`
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();
    await contractRef.set(
      {
        emailedAt: now,
        updatedAt: now,
        updatedBy: request.auth!.uid || null
      },
      { merge: true }
    );
    await db.collection('reservations').doc(contract.reservationId).set(
      {
        contractInfo: { emailedAt: nowIso },
        updatedAt: now
      },
      { merge: true }
    );

    return {
      contractId: contract.id,
      emailedAt: nowIso,
      to
    };
  }
);
