/**
 * generateReceipt — el justificante de un cobro.
 *
 * Callable con autenticación. **Lo puede pedir cualquier usuario autorizado**,
 * no solo un administrador: quien coge la señal en efectivo con el cliente
 * delante es exactamente quien tiene que poder darle el papel, y un recibo no
 * es un documento fiscal ni enseña nada que ese usuario no vea ya en la ficha
 * del pago.
 *
 * ⚠️ **El importe no viaja en la petición: se lee del pago.** Es la regla que
 * sostiene el documento. `payments` es la única fuente de verdad del dinero que
 * entra, y un recibo que aceptara la cifra que le manden sería un papel firmado
 * por la empresa diciendo que recibió algo que quizá no recibió.
 *
 * ⚠️ **No escribe NADA en Firestore.** Como el presupuesto, la proforma y el
 * justificante de reserva: es un documento informativo, no un paso del flujo.
 * Lo único que queda es el PDF, que es lo que el enlace necesita.
 */

import * as functions from 'firebase-functions';
import { randomUUID } from 'crypto';
import { firestore } from '../admin-guard';
import { companyConfig } from '../company-config';
import { uploadPdf } from '../documents/storage';
import { documentLinkUrl, shortIdFor } from '../documents/documentLink';
import { reservationLocator } from '../documents/locator';
import { buildReceiptPdf } from './receipt-pdf';
import { receiptProblem } from './receipt-core';
import type { ContractLocale } from '../contracts/contract-types';

interface ReceiptRequest {
  paymentId: string;
  /**
   * «El cliente ha pedido factura». Lo marca el operador, porque es lo único
   * que la aplicación no sabe: se factura **a petición**.
   */
  invoiceExpected?: boolean;
  locale?: string;
}

interface ReceiptResponse {
  reference: string;
  /** URL larga de Storage, la que abre el operador. */
  pdfUrl: string;
  /** La corta del dominio propio, que es la que se pega en WhatsApp. */
  shortUrl: string;
}

const LOCALES: ContractLocale[] = ['es', 'en', 'ro'];

function resolveLocale(value?: string): ContractLocale {
  return LOCALES.includes(value as ContractLocale) ? (value as ContractLocale) : 'es';
}

/**
 * Las fechas de Firestore llegan de tres formas distintas y una de ellas ya
 * costó una factura sin periodo: `Timestamp`, `Date` y el `{ seconds }` crudo
 * del SDK web. `new Date({seconds})` da fecha inválida **en silencio**.
 */
function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const anyValue = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof anyValue.toDate === 'function') {
    const d = anyValue.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const seconds = anyValue.seconds ?? anyValue._seconds;
  if (typeof seconds === 'number') return new Date(seconds * 1000);
  const parsed = new Date(value as string);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * `REC-8QPB4E2A`: referencia **no fiscal**, aleatoria y sin contador.
 *
 * Misma decisión que la proforma y por el mismo motivo: un contador invita a
 * pensar que hay una serie, y una serie invita a preguntarse por sus huecos.
 * Aquí no hay serie que cuidar, porque un recibo no se declara.
 */
function receiptReference(): string {
  return `REC-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export const generateReceipt = functions.https.onCall(
  async (request): Promise<ReceiptResponse> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }

    const data = request.data as ReceiptRequest;
    const paymentId = (data?.paymentId || '').trim();
    if (!paymentId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'payments.receipt.problems.paymentRequired'
      );
    }

    const db = firestore();
    const snap = await db.collection('payments').doc(paymentId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'payments.receipt.problems.notFound');
    }
    // ⚠️ `data()` no incluye el id del documento. Olvidarlo es el despiste de
    // M-29 y M-41.
    const payment: Record<string, any> = {
      ...(snap.data() as Record<string, any>),
      id: snap.id
    };

    /**
     * La misma comprobación que hace la pantalla, repetida aquí.
     *
     * No es desconfianza del formulario: es que lo que se imprime en un papel
     * que sale de la empresa no puede depender de que la pantalla estuviera
     * bien. Es la regla de «bloquear en UI y validar en el servicio».
     */
    const problema = receiptProblem(payment);
    if (problema) {
      throw new functions.https.HttpsError('failed-precondition', problema);
    }

    const locale = resolveLocale(data?.locale);
    const company = companyConfig();
    const reference = receiptReference();

    const paidAmount = Math.round((Number(payment['paidAmount']) || 0) * 100) / 100;
    const pendingAmount = Math.round((Number(payment['pendingAmount']) || 0) * 100) / 100;

    const payerName =
      payment['clientSnapshot']?.fullName || payment['payerName'] || '';

    const vehicle = payment['vehicleSnapshot'];
    const vehicleLabel = vehicle
      ? [[vehicle.brand, vehicle.model].filter(Boolean).join(' '), vehicle.plateNumber]
          .filter(Boolean)
          .join(' · ')
      : undefined;

    const reservationId: string | undefined = payment['reservationId'] || undefined;

    /**
     * ¿Existe ya la factura de este alquiler?
     *
     * Si existe, el recibo dice cuál en vez de prometer una futura. Se consulta
     * **sin `orderBy`** a propósito: ordenar por un campo deja fuera a los
     * documentos que no lo tienen, y aquí no hay índice compuesto que declarar
     * para una igualdad sola.
     */
    let issuedInvoiceNumber: string | undefined;
    if (reservationId) {
      try {
        const facturas = await db
          .collection('invoices')
          .where('reservationId', '==', reservationId)
          .get();
        const emitida = facturas.docs
          .map((d) => d.data() as Record<string, any>)
          .find((f) => f['status'] === 'issued' && f['kind'] === 'invoice' && f['fullNumber']);
        issuedInvoiceNumber = emitida?.['fullNumber'];
      } catch (err) {
        // Un recibo no se queda sin emitir porque la consulta de facturas
        // falle: se imprime sin esa línea, que es información de más.
        functions.logger.warn('generateReceipt: no se pudo consultar la factura', { err });
      }
    }

    const pdf = await buildReceiptPdf({
      locale,
      company: {
        brandName: company.brandName,
        legalName: company.legalName,
        taxId: company.taxId,
        address: company.address,
        officeAddress: company.officeAddress,
        phone: company.phone,
        email: company.email,
        registry: company.registry
      },
      reference,
      payerName,
      amount: paidAmount,
      paidAt: toDate(payment['paidAt']) || toDate(payment['updatedAt']) || new Date(),
      issuedAt: new Date(),
      method: payment['method'],
      paymentType: payment['type'],
      concept: payment['concept'],
      reservationLocator: reservationId ? reservationLocator(reservationId) : undefined,
      vehicleLabel,
      pendingAmount,
      invoiceExpected: !!data?.invoiceExpected,
      issuedInvoiceNumber
    });

    /**
     * El id del enlace corto es **aleatorio, no el del pago**.
     *
     * Con `paymentId` dentro, cualquiera con el enlace de pago reenviado
     * —`/pay/:paymentId`, que se manda por WhatsApp— podría descargarse el
     * recibo, y ahí sí está el nombre del cliente. `getPaymentCheckout` está
     * escrito justo para no revelar con quién trabaja la empresa; el recibo no
     * puede ser la puerta de atrás de esa decisión.
     */
    const shortId = shortIdFor('receipt', randomUUID().replace(/-/g, '').slice(0, 16));
    const subido = await uploadPdf(`receipts/${shortId.slice(1)}/receipt.pdf`, pdf);

    functions.logger.info('Receipt generated', {
      paymentId,
      reference,
      amount: paidAmount
    });

    return {
      reference,
      pdfUrl: subido.pdfUrl,
      shortUrl: documentLinkUrl(shortId)
    };
  }
);
