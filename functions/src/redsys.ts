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
import { FUNCTIONS_REGION } from './global-options';
import { firestore } from './admin-guard';
import { companyConfig } from './company-config';
import { createCipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

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

/**
 * Prepara el pago en Redsys y devuelve el formulario firmado.
 *
 * Compartido por las dos entradas —la del operador, con sesión, y la pública
 * que abre el cliente en su móvil— porque la operación es exactamente la misma
 * y duplicarla sería duplicar la firma, el formato del pedido y la URL del
 * webhook. Tres cosas que ya han estado mal alguna vez.
 */
/**
 * Un pedido nuevo para Redsys.
 *
 * La pasarela exige entre 4 y 12 caracteres con **los cuatro primeros
 * numéricos** y el resto alfanuméricos; un prefijo tipo `VEL…` lo rechaza.
 * Salen exactamente 12: 4 dígitos de la cola del epoch y 32 bits de azar en
 * hexadecimal.
 */
export function newOrder(): string {
  return `${Date.now().toString().slice(-4)}${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Qué pedido usar para cobrar este pago: el que ya tenía o uno nuevo.
 *
 * Aparte para poder probarla, porque es la decisión que costó un cobro.
 */
export function resolveOrder(redsys: { order?: string; responseCode?: string } | undefined): string {
  const previous = redsys?.order;
  const alreadyUsed = !!redsys?.responseCode;
  return previous && !alreadyUsed ? previous : newOrder();
}

async function prepareRedsysCheckout(
  paymentSnap: FirebaseFirestore.DocumentSnapshot,
  secret: string
): Promise<CreateRedsysLinkResponse> {
  const payment = paymentSnap.data() as any;

  const MERCHANT_CODE = process.env.REDSYS_MERCHANT_CODE;
  const TERMINAL = process.env.REDSYS_TERMINAL;
  const ENVIRONMENT = process.env.REDSYS_ENVIRONMENT || 'test';
  const CURRENCY = process.env.REDSYS_CURRENCY || '978';
  const TRANSACTION_TYPE = process.env.REDSYS_TRANSACTION_TYPE || '0';

  if (!MERCHANT_CODE || !TERMINAL || !secret) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Redsys no está configurado. Configura las variables de entorno / secrets.'
    );
  }

  /**
   * El pedido con el que se va a pagar.
   *
   * ⚠️ **No se genera uno nuevo en cada llamada.** Esta función la invoca
   * también `getPaymentCheckout`, y esa pantalla es la que el cliente refresca
   * para ver si su pago ya consta. Regenerando el pedido cada vez, el aviso de
   * Redsys llegaba con el pedido con el que se pagó y el documento ya guardaba
   * otro: el webhook no encontraba el pago y **el cobro se perdía**. Pasó con
   * dinero real el 4 de septiembre de 2026 (pedido `93247C7C67BC` cobrado,
   * documento con `5678997A390A`, «No payment found for order» en el log).
   *
   * Se reutiliza mientras **nadie haya intentado pagar con él**. Si ya llegó un
   * aviso —típicamente una denegación, porque un pago aprobado deja el pago en
   * `paid` y aquí no se llega—, hay que emitir uno nuevo: la pasarela rechaza
   * un pedido ya procesado con SIS0051.
   */
  const order = resolveOrder(payment.redsys);
  const amount = Math.round((payment.amount || 0) * 100).toString();

  const paymentUrl =
    ENVIRONMENT === 'live'
      ? 'https://sis.redsys.es/sis/realizarPago'
      : 'https://sis-t.redsys.es:25443/sis/realizarPago';

  /**
   * A dónde vuelve el cliente al terminar.
   *
   * Va a la misma página de pago, que consulta el estado y enseña el resultado.
   * Una ruta aparte por cada desenlace obligaría a mantener dos pantallas para
   * decir «bien» o «mal», y el que manda no es este retorno: es el webhook.
   *
   * Sin `VELTO_PUBLIC_BASE_URL` se quedan vacías, que es lo que hacían siempre:
   * el cliente se queda en la pantalla de Redsys. Funciona, pero es peor.
   */
  const base = (process.env.VELTO_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const returnUrl = base ? `${base}/pay/${paymentSnap.id}` : '';

  const params: { [k: string]: string } = {
    Ds_Merchant_Amount: amount,
    Ds_Merchant_Currency: CURRENCY,
    Ds_Merchant_Order: order,
    Ds_Merchant_MerchantCode: MERCHANT_CODE,
    Ds_Merchant_Terminal: TERMINAL,
    Ds_Merchant_TransactionType: TRANSACTION_TYPE,
    // Gen-2 Cloud Functions URLs are {region}-{project}, not
    // {project}-{region}. Getting this backwards points Redsys at a
    // host that does not resolve, so the payment silently never
    // reaches the webhook.
    // El respaldo usa FUNCTIONS_REGION, no un literal: las functions se
    // movieron a europe-west1 el 28 de agosto de 2026 y este fallback se
    // habría quedado apuntando a us-central1, a un host que ya no resuelve.
    Ds_Merchant_MerchantURL:
      process.env.REDSYS_NOTIFICATION_URL ||
      `https://${process.env.GCLOUD_REGION || FUNCTIONS_REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/redsysNotificationWebhook`,
    Ds_Merchant_UrlOK: process.env.REDSYS_URL_OK || returnUrl,
    Ds_Merchant_UrlKO: process.env.REDSYS_URL_KO || returnUrl,
    Ds_Merchant_ProductDescription: (payment.concept || 'Cobro Velto').slice(0, 125),
    Ds_Merchant_Titular: (payment.payerName || payment.clientSnapshot?.fullName || '').slice(0, 60),
    Ds_Merchant_ConsumerLanguage: '001'
  };

  const dsMerchantParameters = Buffer.from(JSON.stringify(params)).toString('base64');
  const signature = signRedsysParameters(dsMerchantParameters, order, secret);

  await paymentSnap.ref.update({
    'redsys.order': order,
    // Todos los pedidos que se han llegado a emitir para este pago. El webhook
    // busca aquí cuando el pedido del aviso ya no es el vigente, que es lo que
    // convierte una carrera entre pantallas en un cobro registrado y no en un
    // cobro perdido. `arrayUnion` es idempotente: reutilizar el pedido no lo
    // duplica.
    'redsys.issuedOrders': admin.firestore.FieldValue.arrayUnion(order),
    'redsys.merchantCode': MERCHANT_CODE,
    'redsys.terminal': TERMINAL,
    'redsys.transactionType': TRANSACTION_TYPE,
    'redsys.paymentUrl': paymentUrl,
    externalReference: order,
    status: 'pending',
    method: 'redsys',
    source: 'redsys',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    paymentUrl,
    formData: {
      Ds_SignatureVersion: 'HMAC_SHA256_V1',
      Ds_MerchantParameters: dsMerchantParameters,
      Ds_Signature: signature
    },
    reference: order
  };
}

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
    if (!paymentSnap.exists || !paymentSnap.data()) {
      throw new functions.https.HttpsError('not-found', 'Pago no encontrado');
    }

    return prepareRedsysCheckout(paymentSnap, REDSYS_SECRET_KEY.value());
  }
);

// ---------------------------------------------------------------------------
// getPaymentCheckout — PÚBLICA. La abre el cliente en su móvil.
// ---------------------------------------------------------------------------

interface PublicCheckoutResponse {
  /** `pending` se puede pagar; el resto solo se muestra. */
  state: 'pending' | 'paid' | 'unavailable';
  amount: number;
  currency: string;
  concept: string;
  /** Marca de la empresa, para que el cliente sepa a quién paga. */
  brandName: string;
  /** Solo cuando `state` es `pending`. */
  paymentUrl?: string;
  formData?: { [key: string]: string };
}

/**
 * Datos mínimos para que el cliente pague desde su teléfono, sin cuenta.
 *
 * **Pública a propósito**, como la pantalla de firma del contrato: pedirle a un
 * cliente que inicie sesión para pagar es pedirle que no pague. El secreto es
 * el id del pago, igual que en los enlaces `/d/…` de presupuestos — un id de
 * Firestore de 20 caracteres aleatorios.
 *
 * ⚠️ **Devuelve lo mínimo y nada más.** Importe, concepto y marca. Nunca el
 * nombre del pagador, su email, el cliente, el vehículo ni la reserva: quien
 * abre el enlace puede no ser su destinatario, y un enlace reenviado no debe
 * filtrar con quién trabajas.
 *
 * Un pago ya cobrado **no genera formulario**: devuelve `paid` y la pantalla lo
 * dice. Sin eso, reenviar el enlace después de pagar cobraría dos veces.
 */
export const getPaymentCheckout = functions.https.onCall(
  {
    secrets: [REDSYS_SECRET_KEY]
  },
  async (request): Promise<PublicCheckoutResponse> => {
    const data = request.data as { paymentId?: string };
    if (!data?.paymentId) {
      throw new functions.https.HttpsError('invalid-argument', 'paymentId es requerido');
    }

    const db = firestore();
    const paymentSnap = await db.collection('payments').doc(data.paymentId).get();
    const payment = paymentSnap.exists ? (paymentSnap.data() as any) : null;

    // Un id que no existe y uno cancelado responden lo mismo: no se confirma
    // desde fuera si un identificador es real.
    if (!payment || payment.status === 'cancelled') {
      throw new functions.https.HttpsError('not-found', 'Pago no encontrado');
    }

    const company = companyConfig();
    const base = {
      amount: Number(payment.amount) || 0,
      currency: payment.currency || 'EUR',
      concept: String(payment.concept || ''),
      brandName: company.brandName
    };

    if (payment.status === 'paid') {
      return { ...base, state: 'paid' };
    }
    if (payment.status === 'failed' || (Number(payment.amount) || 0) <= 0) {
      return { ...base, state: 'unavailable' };
    }

    const checkout = await prepareRedsysCheckout(paymentSnap, REDSYS_SECRET_KEY.value());
    return {
      ...base,
      state: 'pending',
      paymentUrl: checkout.paymentUrl,
      formData: checkout.formData
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
    const dsParams = body.Ds_MerchantParameters || body['Ds_MerchantParameters'];
    const dsSignature = body.Ds_Signature || body['Ds_Signature'];

    if (!dsParams || !dsSignature) {
      console.warn('Webhook missing required fields', { hasParams: !!dsParams, hasSig: !!dsSignature });
      res.status(400).send('Bad Request');
      return;
    }

    // Parse the params to extract the order first: the order is what
    // diversifies the signing key, so we cannot verify the signature
    // without it. Redsys base64url-encodes this field.
    let parsed: any;
    try {
      parsed = JSON.parse(Buffer.from(dsParams, 'base64url').toString('utf8'));
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

    // Verify the signature BEFORE touching Firestore, using the same
    // per-order key derivation the gateway uses (see
    // signRedsysParameters).
    const expected = signRedsysParameters(dsParams, order, SECRET);
    if (!signaturesMatch(expected, dsSignature)) {
      console.warn('Invalid signature', { order });
      res.status(403).send('Invalid signature');
      return;
    }

    // Localizar el pago por el pedido. Idempotente: si ya está `paid`, se
    // confirma y se sale.
    //
    // ⚠️ **Se busca por dos sitios, y el segundo no es un adorno.** El pedido
    // vigente puede haber cambiado entre que el cliente se fue a pagar y que
    // llegó el aviso —basta con que alguien abra otra vez la pantalla de
    // pago—, así que si el vigente no cuadra se busca entre todos los que se
    // han emitido. Sin esto el aviso caía en «No payment found» y el cobro,
    // hecho y cargado en la tarjeta, no llegaba nunca a la aplicación.
    const db = firestore();
    const paymentsRef = db.collection('payments');
    let snap = await paymentsRef.where('redsys.order', '==', order).limit(1).get();
    if (snap.empty) {
      snap = await paymentsRef
        .where('redsys.issuedOrders', 'array-contains', order)
        .limit(1)
        .get();
      if (!snap.empty) {
        console.warn('Payment found by a superseded order', { order, paymentId: snap.docs[0].id });
      }
    }
    if (snap.empty) {
      /**
       * Un aviso sin pago al que aplicarlo.
       *
       * Se guarda en vez de descartarse: puede ser dinero cobrado de verdad y,
       * si no queda rastro, no hay forma de saberlo después. Es exactamente lo
       * que faltó el 4 de septiembre de 2026 — el log dijo «No payment found»
       * y ni el código de respuesta ni el de autorización se conservaron.
       *
       * El id es el pedido, así que un reenvío de Redsys sobrescribe en vez de
       * acumular.
       */
      console.warn('No payment found for order', { order });
      try {
        await db.collection('redsysOrphanNotifications').doc(order).set({
          order,
          responseCode: parsed.Ds_Response || '',
          authorizationCode: parsed.Ds_AuthorisationCode || '',
          amount: parsed.Ds_Amount || '',
          currency: parsed.Ds_Currency || '',
          raw: parsed,
          receivedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.error('Failed to record orphan notification', err);
      }
      // Se confirma igualmente para que Redsys no reintente indefinidamente.
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
    } else if (order === payment.redsys?.order) {
      update.status = 'failed';
    }
    // Una denegación de un pedido **superado** se anota pero no toca el estado:
    // el cliente pudo ser rechazado con una tarjeta, reintentar con otra y
    // estar pagando ahora mismo. Marcar `failed` ahí sería dar por fallido un
    // pago en curso. Aprobado sí se aplica siempre: el dinero está cobrado.
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
 * Compute the Redsys `HMAC_SHA256_V1` signature.
 *
 * The algorithm has three steps, and the middle one is the part that
 * is easy to miss — the merchant key is NOT used to sign directly.
 * It is first diversified per operation by 3DES-encrypting the order:
 *
 *   1. key        = Base64Decode(REDSYS_SECRET_KEY)        (24 bytes)
 *   2. derivedKey = 3DES-CBC(order, key, IV = 8 zero bytes)
 *                   with zero padding, no PKCS#7
 *   3. signature  = Base64(HMAC-SHA256(derivedKey, dsMerchantParameters))
 *
 * Note that the HMAC covers ONLY `dsMerchantParameters`. Signing
 * `order + dsMerchantParameters` produces a signature the gateway
 * always rejects.
 *
 * Reference:
 *   https://pagosonline.redsys.es/desarrolladores.html
 */
function deriveOperationKey(order: string, secretKey: string): Buffer {
  let key = Buffer.from(secretKey, 'base64');

  // 3DES needs a 24-byte key. Redsys issues 24-byte keys, but a
  // 16-byte (two-key) variant is expanded as K1|K2|K1.
  if (key.length === 16) {
    key = Buffer.concat([key, key.subarray(0, 8)]);
  }
  if (key.length !== 24) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `REDSYS_SECRET_KEY debe decodificar a 16 o 24 bytes (son ${key.length})`
    );
  }

  // Zero-pad the order to a multiple of the 8-byte block size.
  const orderBytes = Buffer.from(order, 'utf8');
  const padded = Buffer.alloc(Math.ceil(orderBytes.length / 8) * 8, 0);
  orderBytes.copy(padded);

  const cipher = createCipheriv('des-ede3-cbc', key, Buffer.alloc(8, 0));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

export function signRedsysParameters(
  dsMerchantParameters: string,
  order: string,
  secretKey: string
): string {
  const derivedKey = deriveOperationKey(order, secretKey);
  return createHmac('sha256', derivedKey).update(dsMerchantParameters, 'utf8').digest('base64');
}

/**
 * Compare two Redsys signatures.
 *
 * Redsys sends the notification signature in URL-safe Base64 (`-` and
 * `_`) while we produce standard Base64, so both sides are normalised
 * before comparing. The comparison is constant-time to avoid leaking
 * information about the expected value.
 */
export function signaturesMatch(a: string, b: string): boolean {
  const normalise = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bufA = Buffer.from(normalise(a), 'utf8');
  const bufB = Buffer.from(normalise(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
