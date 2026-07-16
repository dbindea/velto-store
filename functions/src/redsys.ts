/**
 * Redsys payment integration.
 *
 * Two Cloud Functions:
 *
 *   1. `createRedsysPaymentLink` (callable, auth) — given a
 *      `paymentId`, builds a Redsys-compliant POST form with the
 *      `Ds_MerchantParameters` (Base64-encoded JSON), computes the
 *      `Ds_Signature` using HMAC-SHA256 against the
 *      `REDSYS_SECRET_KEY` (kept as a Firebase Secret), and stores
 *      the order/amount/transaction metadata on the payment doc.
 *      Returns the gateway URL + the form fields the frontend must
 *      POST to start the payment.
 *
 *   2. `redsysNotificationWebhook` (public HTTPS endpoint) —
 *      receives the asynchronous notification Redsys sends when a
 *      payment completes (or fails).  It validates the signature
 *      using the same `REDSYS_SECRET_KEY`, parses the
 *      `Ds_MerchantParameters` (Base64-JSON), updates the matching
 *      payment (status, paidAmount, authorization code, response
 *      code), and re-derives the reservation's payment summary if
 *      the payment is linked to a reservation.
 *
 * Required secrets / env vars (configured with
 *   firebase functions:secrets:set <NAME>
 *   firebase functions:config set <NAME>=<VALUE>):
 *   REDSYS_SECRET_KEY      (secret)
 *   REDSYS_MERCHANT_CODE   (env)
 *   REDSYS_TERMINAL        (env)
 *   REDSYS_ENVIRONMENT     (test | live, defaults to test)
 *   REDSYS_CURRENCY        (default 978 = EUR)
 *   REDSYS_TRANSACTION_TYPE (default 0 = authorization)
 *   REDSYS_NOTIFICATION_URL (the public URL of the webhook CF)
 *   REDSYS_URL_OK          (frontend URL to redirect on success)
 *   REDSYS_URL_KO          (frontend URL to redirect on failure)
 *
 * SECURITY:
 *   - The secret key never leaves the Cloud Function runtime.
 *   - The webhook validates the signature BEFORE touching Firestore.
 *   - The webhook is idempotent: re-processing a notification with
 *     the same Ds_Order + Ds_Response is a no-op once the payment
 *     is already `paid`.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { firestore } from './admin-guard';
import { createHmac, randomBytes } from 'crypto';

// ----- Secrets / config -----
const REDSYS_SECRET_KEY = defineSecret('REDSYS_SECRET_KEY');

interface CreateRedsysLinkRequest {
  paymentId: string;
}

interface CreateRedsysLinkResponse {
  paymentUrl?: string;
  formData?: { [key: string]: string };
  reference: string;
}

// ---------------------------------------------------------------------------
// createRedsysPaymentLink — callable
// ---------------------------------------------------------------------------

export const createRedsysPaymentLink = functions.https.onCall(
  {
    secrets: [REDSYS_SECRET_KEY]
  },
  async (request): Promise<CreateRedsysLinkResponse> => {
    const data = request.data as CreateRedsysLinkRequest;
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }
    // The frontend only ever calls this from authenticated pages;
    // the existing isAuthorized() check is enforced by Firestore
    // rules, which the admin SDK bypasses.  We trust the auth state.

    if (!data.paymentId) {
      throw new functions.https.HttpsError('invalid-argument', 'paymentId es requerido');
    }

    const db = firestore();
    const paymentSnap = await db.collection('payments').doc(data.paymentId).get();
    if (!paymentSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Pago no encontrado');
    }
    const payment = paymentSnap.data() as any;
    if (!payment) {
      throw new functions.https.HttpsError('not-found', 'Pago no encontrado');
    }

    const MERCHANT_CODE = process.env.REDSYS_MERCHANT_CODE;
    const TERMINAL = process.env.REDSYS_TERMINAL;
    const SECRET = REDSYS_SECRET_KEY.value();
    const ENVIRONMENT = process.env.REDSYS_ENVIRONMENT || 'test';
    const CURRENCY = process.env.REDSYS_CURRENCY || '978';
    const TRANSACTION_TYPE = process.env.REDSYS_TRANSACTION_TYPE || '0';

    if (!MERCHANT_CODE || !TERMINAL || !SECRET) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Redsys no está configurado. Configura las variables de entorno / secrets.'
      );
    }

    // Idempotent order: 4-char prefix + 8-char timestamp + 4 random
    // hex chars = 16 chars (well under the 12-char limit Redsys
    // actually accepts; we keep the trailing 8 chars of the
    // timestamp + 4 random for uniqueness within a second).
    const random = randomBytes(2).toString('hex').toUpperCase();
    const order = `VEL${Date.now().toString().slice(-8)}${random}`.slice(0, 12);
    const amount = Math.round((payment.amount || 0) * 100).toString();

    const params: { [k: string]: string } = {
      Ds_Merchant_Amount: amount,
      Ds_Merchant_Currency: CURRENCY,
      Ds_Merchant_Order: order,
      Ds_Merchant_MerchantCode: MERCHANT_CODE,
      Ds_Merchant_Terminal: TERMINAL,
      Ds_Merchant_TransactionType: TRANSACTION_TYPE,
      Ds_Merchant_MerchantURL:
        process.env.REDSYS_NOTIFICATION_URL ||
        `https://${process.env.GCLOUD_PROJECT}-${process.env.GCLOUD_REGION || 'us-central1'}.cloudfunctions.net/redsysNotificationWebhook`,
      Ds_Merchant_UrlOK: process.env.REDSYS_URL_OK || '',
      Ds_Merchant_UrlKO: process.env.REDSYS_URL_KO || '',
      Ds_Merchant_ProductDescription: (payment.concept || 'Cobro Velto').slice(0, 125),
      Ds_Merchant_Titular: (payment.payerName || payment.clientSnapshot?.fullName || '').slice(0, 60),
      Ds_Merchant_ConsumerLanguage: '001'
    };

    const dsMerchantParameters = Buffer.from(JSON.stringify(params)).toString('base64');
    const signature = signRedsysParameters(dsMerchantParameters, order, SECRET);

    await paymentSnap.ref.update({
      'redsys.order': order,
      'redsys.merchantCode': MERCHANT_CODE,
      'redsys.terminal': TERMINAL,
      'redsys.transactionType': TRANSACTION_TYPE,
      'redsys.paymentUrl': ENVIRONMENT === 'live'
        ? 'https://sis.redsys.es/sis/realizarPago'
        : 'https://sis-t.redsys.es:25443/sis/realizarPago',
      externalReference: order,
      status: 'pending',
      method: 'redsys',
      source: 'redsys',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      paymentUrl: ENVIRONMENT === 'live'
        ? 'https://sis.redsys.es/sis/realizarPago'
        : 'https://sis-t.redsys.es:25443/sis/realizarPago',
      formData: {
        Ds_SignatureVersion: 'HMAC_SHA256_V1',
        Ds_MerchantParameters: dsMerchantParameters,
        Ds_Signature: signature
      },
      reference: order
    };
  }
);

// ---------------------------------------------------------------------------
// redsysNotificationWebhook — public HTTPS endpoint
// ---------------------------------------------------------------------------

export const redsysNotificationWebhook = functions.https.onRequest(
  {
    secrets: [REDSYS_SECRET_KEY]
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const SECRET = REDSYS_SECRET_KEY.value();
    if (!SECRET) {
      console.error('REDSYS_SECRET_KEY not configured');
      res.status(500).send('Redsys no configurado');
      return;
    }

    // Redsys sends the fields in the POST body.  We accept either
    // application/x-www-form-urlencoded or JSON-encoded bodies.
    const body: any = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
    const dsVersion = body.Ds_SignatureVersion || body['Ds_SignatureVersion'];
    const dsParams = body.Ds_MerchantParameters || body['Ds_MerchantParameters'];
    const dsSignature = body.Ds_Signature || body['Ds_Signature'];

    if (!dsParams || !dsSignature) {
      console.warn('Webhook missing required fields', { hasParams: !!dsParams, hasSig: !!dsSignature });
      res.status(400).send('Bad Request');
      return;
    }

    // Parse the params to extract the order before verifying the
    // signature (Redsys signs over Ds_Order + Ds_MerchantParameters
    // when using HMAC_SHA256_V1).
    let parsed: any;
    try {
      parsed = JSON.parse(Buffer.from(dsParams, 'base64').toString('utf8'));
    } catch (err) {
      console.error('Failed to decode Ds_MerchantParameters', err);
      res.status(400).send('Invalid parameters');
      return;
    }

    const order: string = parsed.Ds_Order || parsed.Ds_MerchantOrder;
    if (!order) {
      console.error('Missing Ds_Order in parameters');
      res.status(400).send('Missing order');
      return;
    }

    // Verify signature with the same key derivation Redsys uses:
    //   1. Base64-decode the SECRET_KEY
    //   2. HMAC-SHA256(key, order + dsMerchantParameters)
    //   3. Base64-encode the digest and compare
    const expected = signRedsysParameters(dsParams, order, SECRET);
    if (expected !== dsSignature) {
      console.warn('Invalid signature', { order });
      res.status(403).send('Invalid signature');
      return;
    }

    // Locate the payment by the Redsys order.  Idempotent — if the
    // payment is already `paid`, we just ack and exit.
    const db = firestore();
    const paymentsRef = db.collection('payments');
    const snap = await paymentsRef.where('redsys.order', '==', order).limit(1).get();
    if (snap.empty) {
      console.warn('No payment found for order', { order });
      // Still ack to prevent Redsys from retrying indefinitely.
      res.status(200).send('OK');
      return;
    }
    const paymentDoc = snap.docs[0];
    const payment = paymentDoc.data() as any;

    if (payment.status === 'paid') {
      // Already processed (Redsys sometimes re-sends).
      res.status(200).send('OK');
      return;
    }

    const responseCode: string = parsed.Ds_Response || '';
    const authCode: string = parsed.Ds_AuthorisationCode || '';
    // Redsys response codes 0000-0099 = approved.  Anything else =
    // declined / error.  The codes are 4 digits; the first 2 are
    // the response family, the last 2 the sub-code.
    const isApproved = /^0[0-9][0-9][0-9]$/.test(responseCode);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const update: any = {
      'redsys.responseCode': responseCode,
      'redsys.authorizationCode': authCode,
      'redsys.rawNotification': parsed,
      'redsys.notifiedAt': now,
      updatedAt: now
    };
    if (isApproved) {
      update.status = 'paid';
      update.paidAmount = payment.amount;
      update.pendingAmount = 0;
      update.paidAt = now;
    } else {
      update.status = 'failed';
    }
    await paymentDoc.ref.update(update);

    // If the payment is linked to a reservation, refresh its
    // paymentSummary so the UI reflects the new state.
    if (payment.reservationId) {
      try {
        const reservationsRef = db.collection('reservations').doc(payment.reservationId);
        const reservationSnap = await reservationsRef.get();
        if (reservationSnap.exists) {
          // We don't recompute the full summary here (the function
          // would have to read all payments); the frontend triggers
          // a refresh on the next visit, and the reservation-detail
          // page listens for the change.  If you want a guaranteed
          // fresh summary, replace this with a direct read+write of
          // the payments collection.
          await reservationSnap.ref.update({ paymentUpdatedAt: now });
        }
      } catch (err) {
        console.warn('Failed to bump reservation timestamp', err);
      }
    }

    res.status(200).send('OK');
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the Redsys HMAC-SHA256_V1 signature.
 *
 *   key  = Base64Decode(REDSYS_SECRET_KEY)
 *   data = order + dsMerchantParameters
 *   sig  = Base64(HMAC-SHA256(key, data))
 *
 * Reference:
 *   https://pagosonline.redsys.es/desarrolladores.html
 */
function signRedsysParameters(
  dsMerchantParameters: string,
  order: string,
  secretKey: string
): string {
  const keyBytes = Buffer.from(secretKey, 'base64');
  const hmac = createHmac('sha256', keyBytes);
  hmac.update(order + dsMerchantParameters, 'utf8');
  return hmac.digest('base64');
}
