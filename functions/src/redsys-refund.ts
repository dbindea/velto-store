/**
 * Devolver a la tarjeta un cobro hecho con Redsys.
 *
 * ⚠️ **Es el único camino de esta aplicación por el que SALE dinero.** Todo lo
 * demás registra; esto mueve. Y una devolución aceptada por el banco ya está
 * hecha: deshacerla es una llamada al comercio, no un botón. Por eso aquí hay
 * más comprobaciones que en ningún otro sitio y ninguna es decorativa.
 *
 * ⚠️ **No es la misma integración que el cobro.** El cobro va **por
 * formulario**: se le manda el cliente a la pasarela y vuelve. En una devolución
 * no hay cliente delante, así que se habla **de servidor a servidor** con la vía
 * REST del banco (`/sis/rest/trataPeticionREST`). Lo que sí se reutiliza es la
 * firma, que es la misma HMAC_SHA256_V1 ya probada contra un vector congelado.
 *
 * ⚠️ **Y la respuesta se lee con otra regla.** Un cobro aceptado responde
 * `0000`–`0099`; una **devolución** aceptada, `0900`–`0999`. Leerla con la regla
 * del cobro haría que una devolución correcta pareciera un error, y lo que sigue
 * a un error es reintentar: dinero fuera dos veces.
 */

import * as functions from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from './admin-guard';
import { signRedsysParameters } from './redsys';
import {
  RefundablePayment,
  refundAccepted,
  refundProblem,
  refundableAmount,
  roundMoney,
  toRedsysAmount
} from './redsys-refund-core';

const REDSYS_SECRET_KEY = defineSecret('REDSYS_SECRET_KEY');

/**
 * La vía REST, que **no es la misma URL que la del formulario**.
 *
 * Mandar la devolución a `/sis/realizarPago` devuelve una página HTML de la
 * pasarela en lugar de una respuesta, y el error no dice que la URL esté mal.
 */
function restEndpoint(environment: string): string {
  return environment === 'live'
    ? 'https://sis.redsys.es/sis/rest/trataPeticionREST'
    : 'https://sis-t.redsys.es:25443/sis/rest/trataPeticionREST';
}

interface RefundRequest {
  paymentId?: string;
  amount?: number;
  reason?: string;
}

interface RefundResponse {
  refunded: number;
  remaining: number;
  authorizationCode?: string;
  responseCode?: string;
}

/**
 * ¿Es administrador quien llama?
 *
 * ⚠️ **Se lee de Firestore, no del token.** El rol vive en `authorizedUsers` y
 * puede haber cambiado después de que el usuario iniciara sesión: un token
 * emitido cuando era administrador sigue siendo válido durante una hora. Para
 * cobrar eso da igual; para sacar dinero, no.
 */
async function assertAdmin(email: string | undefined): Promise<void> {
  if (!email) {
    throw new functions.https.HttpsError('unauthenticated', 'payments.refund.errors.unauthorized');
  }
  const snap = await firestore().collection('authorizedUsers').doc(email.toLowerCase()).get();
  const data = snap.data();
  if (!snap.exists || data?.['active'] !== true || data?.['role'] !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'payments.refund.errors.unauthorized'
    );
  }
}

export const refundRedsysPayment = functions.https.onCall(
  { secrets: [REDSYS_SECRET_KEY] },
  async (request): Promise<RefundResponse> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'payments.refund.errors.unauthorized');
    }
    await assertAdmin(request.auth.token?.['email'] as string | undefined);

    const data = (request.data || {}) as RefundRequest;
    const paymentId = String(data.paymentId || '').trim();
    if (!paymentId) {
      throw new functions.https.HttpsError('invalid-argument', 'payments.refund.errors.notFound');
    }

    const secret = REDSYS_SECRET_KEY.value();
    const merchantCode = process.env['REDSYS_MERCHANT_CODE'];
    const terminal = process.env['REDSYS_TERMINAL'];
    const environment = process.env['REDSYS_ENVIRONMENT'] || 'test';
    if (!secret || !merchantCode || !terminal) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'payments.refund.errors.notConfigured'
      );
    }

    const db = firestore();
    const ref = db.collection('payments').doc(paymentId);

    /**
     * ⚠️ **Se RESERVA antes de llamar al banco, en una transacción.**
     *
     * Es lo que impide que dos clics —o dos pestañas— hagan dos devoluciones del
     * mismo cobro: la segunda entra cuando `refundedAmount` ya subió y la
     * comprobación del tope la rechaza. Comprobando primero y escribiendo
     * después, las dos pasarían la comprobación y saldría el dinero dos veces.
     *
     * Es la misma lección que costó un cobro real con Redsys (F-32): entre
     * mirar y escribir cabe otra cosa.
     */
    const { importe, order } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'payments.refund.errors.notFound');
      }
      const pago = snap.data() as RefundablePayment;

      const problema = refundProblem(pago, data.amount);
      if (problema) {
        throw new functions.https.HttpsError('failed-precondition', problema);
      }

      const cantidad = roundMoney(Number(data.amount));
      tx.update(ref, {
        refundedAmount: FieldValue.increment(cantidad),
        'redsys.refundInProgress': true,
        updatedAt: FieldValue.serverTimestamp()
      });
      return { importe: cantidad, order: pago.redsys!.order as string };
    });

    // --- La llamada al banco -------------------------------------------------
    const parametros = {
      DS_MERCHANT_ORDER: order,
      DS_MERCHANT_MERCHANTCODE: merchantCode,
      DS_MERCHANT_TERMINAL: terminal,
      DS_MERCHANT_CURRENCY: '978',
      // 3 = Devolución. El cobro usa 0 (autorización).
      DS_MERCHANT_TRANSACTIONTYPE: '3',
      DS_MERCHANT_AMOUNT: toRedsysAmount(importe)
    };
    const merchantParameters = Buffer.from(JSON.stringify(parametros), 'utf8').toString('base64');
    const firma = signRedsysParameters(merchantParameters, order, secret);

    let respuesta: Record<string, unknown> = {};
    let fallo: string | null = null;
    try {
      const res = await fetch(restEndpoint(environment), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Ds_SignatureVersion: 'HMAC_SHA256_V1',
          Ds_MerchantParameters: merchantParameters,
          Ds_Signature: firma
        })
      });
      respuesta = (await res.json()) as Record<string, unknown>;
    } catch (error) {
      fallo = error instanceof Error ? error.message : String(error);
    }

    /**
     * ⚠️ **Una respuesta sin `Ds_MerchantParameters` es un rechazo**, y el banco
     * lo cuenta en `errorCode` (`SIS0xxx`). No es una excepción: llega con un
     * 200 y un cuerpo distinto, así que hay que mirarlo a mano.
     */
    let responseCode: string | undefined;
    let authorizationCode: string | undefined;
    if (!fallo && typeof respuesta['Ds_MerchantParameters'] === 'string') {
      const decodificado = JSON.parse(
        Buffer.from(respuesta['Ds_MerchantParameters'] as string, 'base64').toString('utf8')
      ) as Record<string, string>;
      responseCode = decodificado['Ds_Response'];
      authorizationCode = decodificado['Ds_AuthorisationCode'];
    } else if (!fallo) {
      fallo = String(respuesta['errorCode'] || 'respuesta inesperada de Redsys');
    }

    const aceptada = !fallo && refundAccepted(responseCode);

    if (!aceptada) {
      /**
       * ⚠️ **Se devuelve la reserva, o el cobro se queda marcado como devuelto
       * sin haberlo sido** — y entonces nadie podría reintentarlo y el cliente
       * se quedaría sin su dinero.
       */
      await ref.update({
        refundedAmount: FieldValue.increment(-importe),
        'redsys.refundInProgress': false,
        'redsys.lastRefundError': fallo || `Ds_Response ${responseCode}`,
        updatedAt: FieldValue.serverTimestamp()
      });
      throw new functions.https.HttpsError(
        'aborted',
        'payments.refund.errors.rejected',
        { responseCode, error: fallo }
      );
    }

    // --- Aceptada: se confirma y se deja rastro ------------------------------
    const snapFinal = await ref.get();
    const pagoFinal = snapFinal.data() as RefundablePayment;
    const restante = refundableAmount(pagoFinal);

    await ref.update({
      /**
       * ⚠️ **Solo pasa a `refunded` si no queda nada.** Con una devolución
       * parcial el cobro sigue vivo por el resto, y marcarlo como devuelto
       * entero haría que los informes dejaran de contar un dinero que sí entró.
       */
      ...(restante <= 0 ? { status: 'refunded' } : {}),
      'redsys.refundInProgress': false,
      'redsys.lastRefundError': FieldValue.delete(),
      'redsys.refunds': FieldValue.arrayUnion({
        amount: importe,
        at: new Date(),
        by: (request.auth.token?.['email'] as string) || null,
        reason: (data.reason || '').trim() || null,
        responseCode: responseCode || null,
        authorizationCode: authorizationCode || null
      }),
      updatedAt: FieldValue.serverTimestamp()
    });

    return {
      refunded: importe,
      remaining: restante,
      authorizationCode,
      responseCode
    };
  }
);
