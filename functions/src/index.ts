/**
 * Cloud Functions for Velto.
 *
 * IMPORTANT:
 * - All Redsys secrets (MERCHANT_CODE, TERMINAL, SECRET_KEY) must be set via
 *   `firebase functions:secrets:set` or environment configuration.
 * - NEVER commit real keys to this repository.
 * - The frontend does NOT have access to these functions or their secrets.
 *
 * Required environment / secrets:
 * - REDSYS_MERCHANT_CODE
 * - REDSYS_TERMINAL
 * - REDSYS_SECRET_KEY
 * - REDSYS_ENVIRONMENT (test | live)
 * - REDSYS_CURRENCY (default: 978 = EUR)
 * - REDSYS_TRANSACTION_TYPE (default: 0 = authorization)
 * - REDSYS_NOTIFICATION_URL (Cloud Function URL for webhook)
 *
 * This is a SKELETON. The actual Redsys signature logic and notification
 * parsing should be implemented when ready. The function signatures are
 * stable and the frontend integration is in place.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

interface CreateRedsysLinkRequest {
  paymentId: string;
}

interface CreateRedsysLinkResponse {
  paymentUrl?: string;
  formData?: { [key: string]: string };
  reference: string;
}

/**
 * HTTPS callable function to create a Redsys payment link.
 * 
 * Verifies user is authenticated, loads the payment, generates a Redsys
 * order ID, signs the operation using the secret key, and returns the
 * form data / URL needed by the frontend to redirect the user.
 */
export const createRedsysPaymentLink = functions.https.onCall(
  async (data: CreateRedsysLinkRequest, context): Promise<CreateRedsysLinkResponse> => {
    // 1. Auth check
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }
    // TODO: check user role/authorization

    // 2. Validate input
    if (!data.paymentId) {
      throw new functions.https.HttpsError('invalid-argument', 'paymentId es requerido');
    }

    // 3. Load payment
    const paymentSnap = await db.collection('payments').doc(data.paymentId).get();
    if (!paymentSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Pago no encontrado');
    }
    const payment = paymentSnap.data();
    if (!payment) {
      throw new functions.https.HttpsError('not-found', 'Pago no encontrado');
    }

    // 4. Load secrets from environment
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

    // 5. Generate unique order (4 chars prefix + 8 random alphanumeric)
    const order = `VEL${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`.substring(0, 12);
    const amount = Math.round((payment.amount || 0) * 100).toString();

    // 6. Build Redsys parameters
    // TODO: implement actual Redsys signature (sha256, base64, etc.)
    // This requires a Redsys-specific library or manual implementation.
    // The skeleton here documents the expected structure.
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

    // 7. Save order reference in payment
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

    // 8. Return form data
    const baseUrl = ENVIRONMENT === 'live'
      ? 'https://sis.redsys.es/sis/realizarPago'
      : 'https://sis-t.redsys.es:25443/sis/realizarPago';

    return {
      paymentUrl: baseUrl,
      formData: {
        Ds_SignatureVersion: 'HMAC_SHA256_V1',
        // Ds_MerchantParameters: '<base64>',
        // Ds_Signature: '<signature>'
      },
      reference: order
    };
  }
);

/**
 * HTTPS webhook endpoint for Redsys server-to-server notifications.
 * 
 * IMPORTANT:
 * - This endpoint is public (no auth), but the request is validated by
 *   verifying the Redsys signature with the SECRET_KEY.
 * - Idempotency: check if the payment is already marked as paid before
 *   processing to avoid double-processing on retries.
 */
export const redsysNotificationWebhook = functions.https.onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // TODO: Implement actual Redsys notification parsing
  // 1. Extract Ds_MerchantParameters and Ds_Signature from the body
  // 2. Base64 decode parameters to get the order ID and response code
  // 3. Verify the signature using REDSYS_SECRET_KEY
  // 4. Look up the payment by order ID
  // 5. If response code is "0000" (or 9000 for refunds), mark as paid
  // 6. Recalculate the reservation payment summary
  // 7. Always respond 200 to acknowledge receipt (even on errors that
  //    don't require Redsys to retry)

  res.status(200).send('OK');
});

/**
 * Future: trigger for WhatsApp AI agent to create payment + Redsys link
 * and send it to the client. Not implemented.
 */
// export const whatsappAiCreatePayment = functions.https.onCall(...)
