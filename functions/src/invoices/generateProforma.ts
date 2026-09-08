/**
 * La proforma.
 *
 * ⚠️ **No es una factura, y por eso es barata.** No devenga IVA, no se declara,
 * no se registra y no entra en VeriFactu: es una oferta con pinta de factura
 * para que el cliente pueda tramitar el pago.
 *
 * Tres reglas la mantienen inofensiva, y las tres importan:
 *
 * 1. ⚠️ **NUNCA consume número de la serie fiscal.** Si una proforma cogiera el
 *    `2026/0007` y luego no se convirtiera en factura, dejaría un hueco en la
 *    serie — y un hueco es justo lo que el art. 6.1.a) no permite. Lleva su
 *    propia referencia `P-…`, que no es fiscal y puede saltar sin consecuencias.
 * 2. **No se llama «factura» en ninguna parte** del documento: va titulada
 *    «PROFORMA» y lleva impreso que no lo es.
 * 3. **No escribe NADA en Firestore.** Igual que el presupuesto: lo único que
 *    queda es el PDF, que es lo que el enlace necesita. Convertirla en factura
 *    crea una factura nueva; la proforma se queda como estaba.
 */

import * as functions from 'firebase-functions';
import { randomUUID } from 'crypto';
import { companyConfig } from '../company-config';
import { buildInvoicePdf } from './invoice-pdf';
import { calculateInvoiceTotals, InvoiceLineInput } from './invoice-core';
import { uploadPdf } from '../documents/storage';
import type { ContractLocale } from '../contracts/contract-types';

interface ProformaRequest {
  recipient: {
    type?: 'individual' | 'company';
    name: string;
    taxId: string;
    address: string;
    email?: string;
  };
  lines: InvoiceLineInput[];
  paymentMethod?: 'paid' | 'transfer' | 'card' | 'cash';
  operationDate?: string;
  operationPeriodStart?: string;
  operationPeriodEnd?: string;
  contractNumber?: string;
  vehicleLabel?: string;
  notes?: string;
  locale?: string;
}

interface ProformaResponse {
  reference: string;
  pdfUrl: string;
}

const LOCALES: ContractLocale[] = ['es', 'en', 'ro'];

function resolveLocale(value?: string): ContractLocale {
  return LOCALES.includes(value as ContractLocale) ? (value as ContractLocale) : 'es';
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Los textos que dejan claro que esto no es una factura, en los tres idiomas.
 *
 * El aviso no es letra pequeña: un cliente que intentara deducirse el IVA con
 * una proforma tendría un problema, y quien se la dio también.
 */
const TEXTS: Record<string, Record<ContractLocale, string>> = {
  title: { es: 'PROFORMA', en: 'PRO FORMA', ro: 'PROFORMĂ' },
  disclaimer: {
    es: 'Documento proforma sin validez fiscal. NO es una factura y no da derecho a deducir el IVA. La factura se emitirá al confirmarse la operación.',
    en: 'Pro forma document with no tax validity. This is NOT an invoice and does not entitle the holder to deduct VAT. The invoice will be issued once the transaction is confirmed.',
    ro: 'Document proformă fără valabilitate fiscală. NU este o factură și nu dă dreptul la deducerea TVA. Factura se va emite la confirmarea operațiunii.'
  }
};

/**
 * `P-A1B2C3D4`: referencia **no fiscal**, aleatoria y sin contador.
 *
 * Sin contador a propósito: un contador invita a pensar que hay una serie, y
 * una serie invita a preguntarse por sus huecos. Aquí no hay serie que cuidar.
 */
function proformaReference(): string {
  return `P-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export const generateProforma = functions.https.onCall(
  async (request): Promise<ProformaResponse> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }

    const data = request.data as ProformaRequest;
    if (!data?.recipient?.name?.trim()) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'invoices.problems.recipientNameRequired'
      );
    }
    if (!data?.lines?.length) {
      throw new functions.https.HttpsError('invalid-argument', 'invoices.problems.linesRequired');
    }

    /**
     * ⚠️ La proforma **no se valida como una factura**.
     *
     * Es una oferta: puede no llevar todavía el NIF del cliente ni su domicilio
     * fiscal, que es justo lo que se le pide cuando acepta. Exigirlos aquí
     * obligaría a inventarlos para poder mandar un presupuesto formal.
     */
    const locale = resolveLocale(data.locale);
    const company = companyConfig();
    const reference = proformaReference();
    const totals = calculateInvoiceTotals(data.lines);
    const issueDate = new Date();

    const pdf = await buildInvoicePdf({
      locale,
      company: {
        brandName: company.brandName,
        legalName: company.legalName,
        taxId: company.taxId,
        address: company.address,
        phone: company.phone,
        email: company.email,
        website: company.website,
        registry: company.registry
      },
      recipient: data.recipient,
      fullNumber: reference,
      issueDate,
      operationDate: toDate(data.operationDate) || null,
      operationPeriodStart: toDate(data.operationPeriodStart) || null,
      operationPeriodEnd: toDate(data.operationPeriodEnd) || null,
      lines: data.lines,
      totals,
      paymentMethod: data.paymentMethod || 'transfer',
      bankName: process.env.VELTO_BANK_NAME,
      iban: process.env.VELTO_BANK_IBAN,
      contractNumber: data.contractNumber,
      vehicleLabel: data.vehicleLabel,
      notes: data.notes,
      // El aviso va con las menciones, que es donde el ojo ya busca la letra
      // que matiza el documento.
      mentions: [TEXTS['disclaimer'][locale]],
      proformaTitle: TEXTS['title'][locale]
    });

    const subido = await uploadPdf(`proformas/${reference}/proforma.pdf`, pdf);

    functions.logger.info('Proforma generated', { reference, total: totals.total });
    return { reference, pdfUrl: subido.pdfUrl };
  }
);
