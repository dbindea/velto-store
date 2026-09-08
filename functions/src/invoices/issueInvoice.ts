/**
 * Emitir una factura: asignar número y volverla intocable.
 *
 * ⚠️ **Esto vive en el backend y no en el cliente por un motivo concreto**, no
 * por costumbre: `firestore.rules` puede impedir que se edite una factura, pero
 * **no puede impedir que alguien escriba el número que le dé la gana**. Una
 * regla no sabe cuál era el siguiente correlativo. El número de factura es
 * exactamente el dato que no puede quedar al criterio del cliente.
 *
 * Las tres cosas que hace, y las tres tienen que pasar juntas o no pasar:
 *
 * 1. Reserva el siguiente número de la serie, incrementando su contador.
 * 2. Calcula la huella encadenada con la de la última factura emitida.
 * 3. Escribe la factura ya emitida.
 *
 * Todo dentro de una transacción. Si se hiciera en pasos sueltos y fallara el
 * último, el contador habría avanzado sin factura detrás: **un hueco en la
 * serie**, que es justo lo que el art. 6.1.a) del RD 1619/2012 no permite. Es
 * el mismo razonamiento que `commitReservationWithPayments()` en el frontend,
 * donde una escritura suelta dejaba una reserva sin nada que cobrar.
 */

import * as functions from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../admin-guard';
import { companyConfig } from '../company-config';
import { computeRegistroAltaHash, TipoFacturaAeat } from './hash';
import { buildInvoicePdf } from './invoice-pdf';
import { uploadPdf } from '../documents/storage';
import type { ContractLocale } from '../contracts/contract-types';
import {
  calculateInvoiceTotals,
  formatInvoiceNumber,
  invoiceSeriesFor,
  InvoiceLineInput,
  validateInvoiceInput
} from './invoice-core';

interface IssueInvoiceRequest {
  /** Borrador ya creado, o `undefined` para emitir directamente. */
  invoiceId?: string;
  recipient: {
    type: 'individual' | 'company';
    name: string;
    taxId: string;
    address: string;
    email?: string;
    billingProfileId?: string;
  };
  lines: InvoiceLineInput[];
  paymentMethod: 'paid' | 'transfer' | 'card' | 'cash';
  amountAlreadyPaid?: number;
  operationDate?: string;
  operationPeriodStart?: string;
  operationPeriodEnd?: string;
  reservationId?: string;
  vehicleId?: string;
  contractNumber?: string;
  notes?: string;
  vehicleLabel?: string;
  /** Idioma del documento: el que tiene puesto la plataforma al emitir. */
  locale?: string;
  /** Total de la reserva de origen, para dejar constancia si no coincide. */
  reservationTotal?: number;
}

interface IssueInvoiceResponse {
  invoiceId: string;
  fullNumber: string;
  series: string;
  number: number;
  hash: string;
  pdfUrl?: string;
}

/** Documento que guarda el último número usado de cada serie. */
const COUNTERS = 'invoiceCounters';
const INVOICES = 'invoices';

const LOCALES: ContractLocale[] = ['es', 'en', 'ro'];

/** El idioma en el que se habla con este cliente; español si no consta. */
function resolveLocale(value?: string): ContractLocale {
  return LOCALES.includes(value as ContractLocale) ? (value as ContractLocale) : 'es';
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? undefined : d;
}

export const issueInvoice = functions.https.onCall(
  async (request): Promise<IssueInvoiceResponse> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }

    const data = request.data as IssueInvoiceRequest;

    /**
     * ⚠️ **Se revalida aquí aunque la pantalla ya lo haya hecho.**
     *
     * No es desconfianza hacia la UI: es que lo que se congela en un documento
     * fiscal no puede depender de que el formulario estuviera bien. Misma
     * defensa en profundidad que aplican los guards del workflow.
     */
    const problems = validateInvoiceInput({
      recipient: data?.recipient,
      lines: data?.lines,
      paymentMethod: data?.paymentMethod
    });
    const primerProblema = Object.values(problems)[0];
    if (primerProblema) {
      // Viaja como clave i18n, nunca como frase: la capa de avisos del
      // frontend la traduce y decide si ofrece reintentar.
      throw new functions.https.HttpsError('invalid-argument', primerProblema);
    }

    const db = firestore();
    const company = companyConfig();

    /**
     * La fecha de expedición **es ahora**, y no llega en la petición.
     *
     * Retrodatar rompe la correlación cronológica de la serie, y desde 2027 la
     * AEAT tiene la marca de tiempo del registro. Lo que sí puede ser anterior
     * es la fecha de operación, que es campo aparte y para eso está.
     */
    const issueDate = new Date();
    const series = invoiceSeriesFor(issueDate);
    const totals = calculateInvoiceTotals(data.lines);

    const counterRef = db.collection(COUNTERS).doc(series);
    const invoiceRef = data.invoiceId
      ? db.collection(INVOICES).doc(data.invoiceId)
      : db.collection(INVOICES).doc();

    const resultado = await db.runTransaction(async (tx) => {
      /**
       * Todas las lecturas antes de cualquier escritura: Firestore lo exige, y
       * el error que da si no («Firestore transactions require all reads to be
       * executed before all writes») no dice qué lectura sobra.
       */
      const counterSnap = await tx.get(counterRef);

      // Un borrador que ya se emitió no se vuelve a emitir: eso consumiría dos
      // números para la misma factura.
      if (data.invoiceId) {
        const existente = await tx.get(invoiceRef);
        if (existente.exists && existente.data()?.status !== 'draft') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'invoices.errors.alreadyIssued'
          );
        }
      }

      const ultimo = (counterSnap.data()?.lastNumber as number) || 0;
      const number = ultimo + 1;
      const fullNumber = formatInvoiceNumber(series, number);

      /**
       * La huella de la última factura emitida, sea de la serie que sea.
       *
       * ⚠️ **La cadena es única para todo el emisor, no por serie.** Un
       * ejercicio nuevo no reinicia el encadenamiento: la primera factura de
       * 2027 encadena con la última de 2026. Reiniciarlo rompería la
       * continuidad que justifica todo el mecanismo.
       *
       * Se guarda en el propio contador para poder leerlo dentro de la
       * transacción: una consulta `orderBy(...).limit(1)` no está permitida
       * aquí, y ese es exactamente el motivo por el que el dato vive donde se
       * puede leer por id.
       */
      const huellaAnterior = (counterSnap.data()?.lastHash as string) || '';

      const hash = computeRegistroAltaHash({
        idEmisorFactura: company.taxId,
        numSerieFactura: fullNumber,
        fechaExpedicion: issueDate,
        tipoFactura: 'F1' as TipoFacturaAeat,
        cuotaTotal: totals.vat,
        importeTotal: totals.total,
        huellaAnterior,
        fechaHoraGenRegistro: issueDate
      });

      const invoice = {
        kind: 'invoice',
        status: 'issued',
        series,
        number,
        fullNumber,
        issueDate,
        operationDate: toDate(data.operationDate) || null,
        operationPeriodStart: toDate(data.operationPeriodStart) || null,
        operationPeriodEnd: toDate(data.operationPeriodEnd) || null,
        recipient: data.recipient,
        lines: data.lines,
        totals,
        paymentMethod: data.paymentMethod,
        amountAlreadyPaid: data.amountAlreadyPaid ?? 0,
        reservationId: data.reservationId || null,
        vehicleId: data.vehicleId || null,
        contractNumber: data.contractNumber || null,
        notes: data.notes || null,
        hash,
        previousHash: huellaAnterior,
        issuedBy: request.auth?.uid || null,
        issuedByEmail: request.auth?.token?.email || null,
        // Solo se anota si difiere: una factura que cuadra con su reserva no
        // necesita explicación.
        reservationTotalAtIssue:
          typeof data.reservationTotal === 'number' &&
          Math.round(data.reservationTotal * 100) !== Math.round(totals.total * 100)
            ? data.reservationTotal
            : null,
        createdAt: data.invoiceId ? undefined : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };

      tx.set(invoiceRef, invoice, { merge: !!data.invoiceId });
      tx.set(
        counterRef,
        { series, lastNumber: number, lastHash: hash, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );

      return { number, fullNumber, hash };
    });

    functions.logger.info('Invoice issued', {
      invoiceId: invoiceRef.id,
      fullNumber: resultado.fullNumber,
      total: totals.total
    });

    /**
     * El PDF se hace **después** de emitir, y su fallo no deshace nada.
     *
     * Misma regla que el sellado del contrato: perder el sello es un problema,
     * perder la firma del cliente es uno mucho mayor. Aquí es peor todavía —
     * el número ya está consumido y no se puede devolver a la serie—, así que
     * si el PDF falla la factura queda emitida y el documento se regenera. Al
     * revés, tirar la emisión por un fallo de Storage dejaría un hueco.
     *
     * ⚠️ Escribir `pdfUrl` sobre una factura emitida es legítimo y no rompe la
     * inmutabilidad: **no es contenido fiscal** y no entra en la huella, que
     * cubre emisor, número, fecha, tipo, cuota y total. El admin SDK se salta
     * las reglas, así que solo el backend puede hacerlo.
     */
    let pdfUrl: string | undefined;
    try {
      const pdf = await buildInvoicePdf({
        locale: resolveLocale(data.locale),
        company: {
          brandName: company.brandName,
          legalName: company.legalName,
          taxId: company.taxId,
          // Domicilio SOCIAL: en una factura el art. 6.1.c) pide el del
          // expedidor, y ahí es un dato registral. La cabecera del resto de
          // documentos lleva el comercial; esta es la excepción.
          address: company.address,
          phone: company.phone,
          email: company.email,
          website: company.website,
          registry: company.registry
        },
        recipient: data.recipient,
        fullNumber: resultado.fullNumber,
        issueDate,
        operationDate: toDate(data.operationDate) || null,
        operationPeriodStart: toDate(data.operationPeriodStart) || null,
        operationPeriodEnd: toDate(data.operationPeriodEnd) || null,
        lines: data.lines,
        totals,
        paymentMethod: data.paymentMethod,
        bankName: process.env.VELTO_BANK_NAME,
        iban: process.env.VELTO_BANK_IBAN,
        amountAlreadyPaid: data.amountAlreadyPaid,
        contractNumber: data.contractNumber,
        vehicleLabel: data.vehicleLabel,
        notes: data.notes
      });
      const subido = await uploadPdf(`invoices/${invoiceRef.id}/invoice.pdf`, pdf);
      pdfUrl = subido.pdfUrl;
      await invoiceRef.set({ pdfUrl: subido.pdfUrl, pdfPath: subido.pdfPath }, { merge: true });
    } catch (err) {
      functions.logger.error('Invoice issued but PDF failed', {
        invoiceId: invoiceRef.id,
        fullNumber: resultado.fullNumber,
        err
      });
    }

    return {
      invoiceId: invoiceRef.id,
      fullNumber: resultado.fullNumber,
      series,
      number: resultado.number,
      hash: resultado.hash,
      pdfUrl
    };
  }
);
