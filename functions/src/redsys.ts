/**
 * Redsys payment integration.
 *
 * Skeleton - the actual signature logic is intentionally left for a
 * future iteration. The function signatures are stable and the
 * frontend integration is in place.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface CreateRedsysLinkRequest {
  paymentId: string;
}

interface CreateRedsysLinkResponse {
  paymentUrl?: string;
  formData?: { [key: string]: string };
  reference: string;
}

export const createRedsysPaymentLink = functions.https.onCall(
  async (data: CreateRedsysLinkRequest, context): Promise<CreateRedsysLinkResponse> => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }
    // TODO: check user role/authorization

    if (!data.paymentId) {
      throw new functions.https.HttpsError('invalid-argument', 'paymentId es requerido');
    }

    const paymentSnap = await db.collection('payments').doc(data.paymentId).get();
    if (!paymentSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Pago no encontrado');
    }
    const payment = paymentSnap.data();
    if (!payment) {
      throw new functions.https.HttpsError('not-found', 'Pago no encontrado');
    }

    const MERCHANT_CODE = process.env.REDSYS_MERCHANT_CODE;
    const TERMINAL = process.env.REDSYS_TERMINAL;
    const SECRET_KEY = process.env.REDSYS_SECRET_KEY;
    const ENVIRONMENT = process.env.REDSYS_ENVIRONMENT || 'test';
    const CURRENCY = process.env.REDSYS_CURRENCY || '978';
    const TRANSACTION_TYPE = process.env.REDSYS_TRANSACTION_TYPE || '0';

    if (!MERCHANT_CODE || !TERMINAL || !SECRET_KEY) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Redsys no está configurado. Configura las variables de entorno.'
      );
    }

    const order = `VEL${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`.substring(0, 12);
    const amount = Math.round((payment.amount || 0) * 100).toString();

    const merchantParameters: { [key: string]: string } = {
      Ds_Merchant_Amount: amount,
      Ds_Merchant_Currency: CURRENCY,
      Ds_Merchant_Order: order,
      Ds_Merchant_MerchantCode: MERCHANT_CODE,
      Ds_Merchant_Terminal: TERMINAL,
      Ds_Merchant_TransactionType: TRANSACTION_TYPE,
      Ds_Merchant_MerchantURL: process.env.REDSYS_NOTIFICATION_URL || '',
      Ds_Merchant_UrlOK: process.env.REDSYS_URL_OK || '',
      Ds_Merchant_UrlKO: process.env.REDSYS_URL_KO || '',
      Ds_Merchant_ProductDescription: payment.concept || 'Reserva Velto',
      Ds_Merchant_Titular: payment.clientSnapshot?.fullName || '',
      Ds_Merchant_ConsumerLanguage: '001'
    };

    // TODO: encode merchantParameters as base64, sign with SECRET_KEY using
    // sha256 (or sha1 for legacy), produce Ds_Signature.

    await paymentSnap.ref.update({
      'redsys.order': order,
      'redsys.merchantCode': MERCHANT_CODE,
      'redsys.terminal': TERMINAL,
      'redsys.transactionType': TRANSACTION_TYPE,
      externalReference: order,
      status: 'pending',
      method: 'redsys',
      source: 'redsys',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const baseUrl = ENVIRONMENT === 'live'
      ? 'https://sis.redsys.es/sis/realizarPago'
      : 'https://sis-t.redsys.es:25443/sis/realizarPago';

    return {
      paymentUrl: baseUrl,
      formData: {
        Ds_SignatureVersion: 'HMAC_SHA256_V1'
      },
      reference: order
    };
  }
);

export const redsysNotificationWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // TODO: implement actual Redsys notification parsing.

  res.status(200).send('OK');
});
