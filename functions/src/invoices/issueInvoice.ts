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
import {
  computeRegistroAltaHash,
  formatFechaExpedicion,
  formatFechaHoraHuso,
  TipoFacturaAeat
} from './hash';
import {
  buildQrUrl,
  buildRegistroAlta,
  sistemaInformatico,
  verifactuEnabled
} from './verifactu';
import { buildInvoicePdf } from './invoice-pdf';
import { euRegimesEnabled } from './issueComplianceDeclaration';
import { uploadPdf } from '../documents/storage';
import type { ContractLocale } from '../contracts/contract-types';
import {
  calculateInvoiceTotals,
  formatInvoiceNumber,
  invoiceSeriesFor,
  InvoiceLineInput,
  requiredMentionKeys,
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
    /**
     * ISO 3166-1 alfa-2. Obligatorio cuando el identificador no lleva el país
     * dentro —un pasaporte—: sin él la AEAT rechaza el registro con el `1111` y
     * la factura, ya emitida, no se puede arreglar.
     */
    countryCode?: string;
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

  /**
   * `rectifying` para una rectificativa. Ausente o `invoice` para una normal.
   *
   * La rectificativa entra por aquí y no por una function propia porque
   * comparte **todo** lo que importa: el contador transaccional, la cadena de
   * huellas y el PDF. Lo único que cambia es la serie, el tipo que va al hash y
   * un puñado de campos.
   */
  kind?: 'invoice' | 'rectifying';
  rectifies?: { invoiceId: string; fullNumber: string; issueDate?: string };
  /** `S` por sustitución, `I` por diferencias. */
  rectifyingType?: 'S' | 'I';
  /** `R1`…`R5`: el supuesto del art. 80 LIVA que la justifica. */
  rectifyingReason?: TipoFacturaAeat;
  rectifyingNote?: string;
  /** Solo en `S`: base y cuota de la factura que se sustituye. */
  rectifiedBase?: number;
  rectifiedVat?: number;
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

/**
 * El eslabón vivo de la cadena de huellas, **uno solo para todo el emisor**.
 *
 * Vive en la misma colección que los contadores por comodidad de reglas, con un
 * id que no puede colisionar con ninguna serie: una serie es `2026` o `R2026`,
 * nunca `_chain`.
 */
const CHAIN_DOC = '_chain';
const INVOICES = 'invoices';

/**
 * El estado del envío a la AEAT, **fuera de la factura**.
 *
 * Una factura emitida es inmutable; el envío cambia muchas veces —pendiente,
 * intentado, rechazado, aceptado—, así que guardarlo dentro sería reescribir un
 * documento fiscal cada vez que la Agencia contesta. Mismo id que la factura.
 */
const SUBMISSIONS = 'verifactuSubmissions';

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

/**
 * El texto de cada mención del art. 6.1, en los tres idiomas.
 *
 * ⚠️ **No son descripciones que se puedan reformular.** «Inversión del sujeto
 * pasivo» y «régimen especial de los bienes usados» son los literales que fija
 * la norma; una paráfrasis deja la factura incompleta aunque se entienda igual.
 * Por eso viven aquí y no en los JSON de i18n de la app: los emite el backend,
 * que es quien construye el documento.
 */
const MENTION_TEXTS: Record<string, Record<ContractLocale, string>> = {
  'invoices.mentions.rebu': {
    es: 'Régimen especial de los bienes usados.',
    en: 'Margin scheme — second-hand goods.',
    ro: 'Regim special pentru bunuri second-hand.'
  },
  'invoices.mentions.exemptEu': {
    es: 'Operación exenta conforme al artículo 25 de la Ley 37/1992 (entrega intracomunitaria de bienes).',
    en: 'Exempt intra-Community supply under Article 25 of Spanish VAT Act 37/1992.',
    ro: 'Operațiune scutită conform articolului 25 din Legea 37/1992 (livrare intracomunitară).'
  },
  'invoices.mentions.exemptExport': {
    es: 'Operación exenta conforme al artículo 21 de la Ley 37/1992 (exportación).',
    en: 'Exempt export under Article 21 of Spanish VAT Act 37/1992.',
    ro: 'Operațiune scutită conform articolului 21 din Legea 37/1992 (export).'
  },
  'invoices.mentions.reverseCharge': {
    es: 'Inversión del sujeto pasivo.',
    en: 'Reverse charge.',
    ro: 'Taxare inversă.'
  },
  'invoices.mentions.exemptOther': {
    es: 'Operación exenta de IVA.',
    en: 'VAT-exempt transaction.',
    ro: 'Operațiune scutită de TVA.'
  }
};

function mentionTexts(keys: string[], loc: ContractLocale): string[] {
  return keys.map((k) => MENTION_TEXTS[k]?.[loc] || MENTION_TEXTS[k]?.es || '').filter(Boolean);
}

/**
 * Los textos de la rectificación, en el idioma del documento.
 *
 * Viven aquí por lo mismo que las menciones: los emite quien construye el PDF,
 * y tener una segunda copia en los JSON de la app sería otra pareja de textos
 * legales condenada a divergir.
 */
const RECTIFYING_TEXTS: Record<string, Record<ContractLocale, string>> = {
  title: {
    es: 'FACTURA RECTIFICATIVA',
    en: 'CREDIT NOTE',
    ro: 'FACTURĂ DE STORNARE'
  },
  S: {
    es: 'Por sustitución',
    en: 'By substitution',
    ro: 'Prin substituire'
  },
  I: {
    es: 'Por diferencias',
    en: 'By difference',
    ro: 'Prin diferență'
  },
  R1: {
    es: 'R1 · Error fundado en derecho (art. 80.Uno, Dos y Seis LIVA)',
    en: 'R1 · Error in law (Art. 80.One, Two and Six of the Spanish VAT Act)',
    ro: 'R1 · Eroare de drept (art. 80.Unu, Doi și Șase LIVA)'
  },
  R2: {
    es: 'R2 · Concurso de acreedores (art. 80.Tres LIVA)',
    en: 'R2 · Insolvency proceedings (Art. 80.Three)',
    ro: 'R2 · Procedură de insolvență (art. 80.Trei)'
  },
  R3: {
    es: 'R3 · Crédito incobrable (art. 80.Cuatro LIVA)',
    en: 'R3 · Bad debt (Art. 80.Four)',
    ro: 'R3 · Creanță nerecuperabilă (art. 80.Patru)'
  },
  R4: {
    es: 'R4 · Resto de causas del art. 80 LIVA',
    en: 'R4 · Other grounds under Art. 80',
    ro: 'R4 · Alte cauze prevăzute la art. 80'
  },
  R5: {
    es: 'R5 · Rectificación de factura simplificada',
    en: 'R5 · Correction of a simplified invoice',
    ro: 'R5 · Rectificarea unei facturi simplificate'
  }
};

function rectifyingText(key: string, loc: ContractLocale): string {
  return RECTIFYING_TEXTS[key]?.[loc] || RECTIFYING_TEXTS[key]?.es || key;
}

/**
 * ¿Toda la factura va en REBU?
 *
 * Solo entonces se oculta el desglose de la cuota, que es lo que exige el art.
 * 138 LIVA. Con una factura mixta el desglose sigue haciendo falta para las
 * líneas que sí están en régimen general.
 *
 * ⚠️ **Se mira en las LÍNEAS, no en los totales.** La primera versión preguntaba
 * si la base era cero, y en REBU la base del margen **no** es cero: son 1.239,67
 * de un coche de 7.000. Con esa condición la factura imprimía base y cuota, que
 * es exactamente lo que el art. 138 prohíbe — y solo se vio mirando el PDF.
 */
function soloRebu(lines: InvoiceLineInput[] | undefined): boolean {
  const conContenido = (lines || []).filter((l) => Number(l?.quantity) && Number(l?.unitPrice));
  return conContenido.length > 0 && conContenido.every((l) => l.taxRegime === 'rebu');
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
    const esRectificativa = data?.kind === 'rectifying';

    const problems = validateInvoiceInput({
      recipient: data?.recipient,
      lines: data?.lines,
      paymentMethod: data?.paymentMethod,
      // ⚠️ En una rectificativa **por diferencias los importes van con signo**:
      // así se declara un ajuste a la baja y así se anula una factura entera.
      // La regla de «un negativo es una rectificativa, no una factura» es
      // justamente lo contrario aquí.
      allowNegative: esRectificativa && data?.rectifyingType === 'I',
      /**
       * ⚠️ **Se comprueba ANTES de consumir número**, igual que el país del
       * destinatario y por el mismo motivo: después no tiene arreglo. Sin ROI,
       * una factura con entrega intracomunitaria exenta o inversión del sujeto
       * pasivo deja de repercutir un IVA que sí se debe, y una factura emitida
       * no se edita ni se borra.
       */
      euRegimesEnabled: euRegimesEnabled()
    });
    const primerProblema = Object.values(problems)[0];
    if (primerProblema) {
      // Viaja como clave i18n, nunca como frase: la capa de avisos del
      // frontend la traduce y decide si ofrece reintentar.
      throw new functions.https.HttpsError('invalid-argument', primerProblema);
    }

    if (esRectificativa) {
      // Lo que la norma exige de una rectificativa y no de una factura: a cuál
      // rectifica, cómo y por qué. Sin esto, el registro que iría a la AEAT
      // estaría incompleto.
      if (!data.rectifies?.invoiceId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'invoices.problems.rectifiedInvoiceRequired'
        );
      }
      if (!data.rectifyingType) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'invoices.problems.rectifyingTypeRequired'
        );
      }
      if (!data.rectifyingReason) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'invoices.problems.rectifyingReasonRequired'
        );
      }
      if (!data.rectifyingNote?.trim()) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'invoices.problems.rectifyingNoteRequired'
        );
      }
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
    // ⚠️ Serie propia para las rectificativas: lo exige el art. 6.2, no es una
    // preferencia de organización.
    const series = invoiceSeriesFor(issueDate, esRectificativa);
    const totals = calculateInvoiceTotals(data.lines);

    const counterRef = db.collection(COUNTERS).doc(series);
    const chainRef = db.collection(COUNTERS).doc(CHAIN_DOC);
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
      const chainSnap = await tx.get(chainRef);

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
       * La huella de la última factura emitida, **sea de la serie que sea**.
       *
       * ⚠️ **La cadena es única para todo el emisor, no por serie**, y por eso
       * vive en su propio documento y no en el contador. Estuvo en el contador
       * de cada serie y era un fallo latente que solo se veía al añadir la
       * segunda serie: la primera rectificativa `R2026/0001` habría encadenado
       * con la cadena vacía de `R2026` en vez de con la última factura emitida,
       * partiendo el encadenamiento en dos hilos independientes. Lo mismo
       * habría pasado el 1 de enero al abrir la serie del ejercicio siguiente.
       *
       * Se lee por id dentro de la transacción porque una consulta
       * `orderBy(...).limit(1)` no está permitida aquí — ese es exactamente el
       * motivo por el que el dato vive donde se puede leer por id.
       */
      const huellaAnterior = (chainSnap.data()?.lastHash as string) || '';
      /**
       * ⚠️ **El encadenamiento necesita los CUATRO datos del anterior**, no
       * solo su huella: el registro que irá a la AEAT lleva también su número y
       * su fecha de expedición. La cadena ya los guardaba —`lastFullNumber` y
       * `lastIssueDate`— y nadie los leía; sin ellos, el registro de una
       * factura ya emitida habría que reconstruirlo buscando por huella sobre
       * una colección que no se puede editar.
       */
      const numeroAnterior = (chainSnap.data()?.lastFullNumber as string) || '';
      const fechaAnterior = chainSnap.data()?.lastIssueDate;

      /**
       * La posición en la cadena.
       *
       * ⚠️ **Hace falta para poder enviar en el orden correcto**, y no vale
       * ordenar por fecha de emisión: la fecha se toma al entrar en la function
       * y la cadena se construye al confirmar la transacción, así que dos
       * facturas emitidas a la vez pueden llevar fechas que no respeten el
       * orden en que realmente se encadenaron. Enviar la segunda antes que la
       * primera hace que referencie una huella que la AEAT no tiene todavía, y
       * se rechaza con un error de encadenamiento que parece un fallo del
       * cálculo. Este índice lo escribe **la misma transacción que la huella**,
       * sobre el mismo documento, así que no pueden discrepar.
       */
      const chainIndex = ((chainSnap.data()?.lastIndex as number) || 0) + 1;

      const hash = computeRegistroAltaHash({
        idEmisorFactura: company.taxId,
        numSerieFactura: fullNumber,
        fechaExpedicion: issueDate,
        /**
         * ⚠️ El tipo entra en la huella, así que una rectificativa sella su
         * `R1`…`R5` y no `F1`. Poner el tipo equivocado da una huella válida
         * en apariencia que no coincidirá con la que calcule la AEAT.
         */
        tipoFactura: esRectificativa
          ? (data.rectifyingReason as TipoFacturaAeat)
          : ('F1' as TipoFacturaAeat),
        cuotaTotal: totals.vat,
        importeTotal: totals.total,
        huellaAnterior,
        fechaHoraGenRegistro: issueDate
      });

      /**
       * El registro de facturación de VeriFactu, **guardado desde hoy**.
       *
       * ⚠️ Una factura emitida no se puede editar, así que lo que no se guarde
       * aquí no se podrá añadir en enero de 2027: habría que reconstruir el
       * registro de cada factura de 2026 a partir de lo que quedara. Se
       * construye con los mismos datos que acaban de sellar la huella, dentro
       * de la misma transacción, para que registro y huella no puedan
       * describir cosas distintas.
       */
      const tipoFacturaAeat = esRectificativa
        ? (data.rectifyingReason as TipoFacturaAeat)
        : ('F1' as TipoFacturaAeat);

      const registroVerifactu = buildRegistroAlta({
        emisorNif: company.taxId,
        emisorNombre: company.legalName,
        fullNumber,
        fechaExpedicion: formatFechaExpedicion(issueDate),
        // La fecha de la operación, que en este negocio casi siempre difiere:
        // se factura en agosto un alquiler de junio.
        fechaOperacion: toDate(data.operationDate)
          ? formatFechaExpedicion(toDate(data.operationDate)!)
          : undefined,
        tipoFactura: tipoFacturaAeat,
        tipoRectificativa: esRectificativa ? data.rectifyingType : undefined,
        rectificada:
          esRectificativa && data.rectifies
            ? {
                numSerieFactura: data.rectifies.fullNumber,
                fechaExpedicionFactura: formatFechaExpedicion(
                  toDate(data.rectifies.issueDate) || issueDate
                )
              }
            : undefined,
        importeRectificacion:
          esRectificativa &&
          typeof data.rectifiedBase === 'number' &&
          typeof data.rectifiedVat === 'number'
            ? { baseRectificada: data.rectifiedBase, cuotaRectificada: data.rectifiedVat }
            : undefined,
        // La descripción de la operación sale de los conceptos facturados: es
        // lo que la factura dice que se ha vendido.
        descripcionOperacion: (data.lines || [])
          .map((l) => l.description)
          .filter(Boolean)
          .join('; '),
        destinatario: data.recipient?.name
          ? {
              nombreRazon: data.recipient.name,
              nif: data.recipient.taxId,
              // Obligatorio si el identificador no lleva el país dentro —un
              // pasaporte—, y lo exige `validateInvoiceInput` antes de llegar
              // aquí: sin él la AEAT rechaza el registro con el `1111` y la
              // factura ya no se puede arreglar.
              codigoPais: data.recipient.countryCode
            }
          : undefined,
        lines: data.lines || [],
        desglose: totals.byVatRate,
        exemptTotal: totals.exemptTotal,
        cuotaTotal: totals.vat,
        importeTotal: totals.total,
        anterior: huellaAnterior
          ? {
              numSerieFactura: numeroAnterior,
              fechaExpedicionFactura: formatFechaExpedicion(
                toDate(fechaAnterior) || issueDate
              ),
              huella: huellaAnterior
            }
          : undefined,
        sistema: sistemaInformatico(company.taxId, company.legalName),
        fechaHoraHusoGenRegistro: formatFechaHoraHuso(issueDate),
        huella: hash
      });

      const invoice = {
        kind: esRectificativa ? 'rectifying' : 'invoice',
        status: 'issued',
        /**
         * ⚠️ **El tipo sellado, guardado.** Entra en la huella, así que sin él
         * no se puede verificar el registro después: habría que deducirlo, y
         * deducir mal produce una huella que parece válida y no coincide con la
         * que calcule la AEAT.
         */
        tipoFacturaAeat,
        verifactu: registroVerifactu,
        chainIndex,
        // Lo que solo tiene una rectificativa: a cuál rectifica, cómo y por
        // qué. En una factura ordinaria van todos a `null`.
        rectifies: esRectificativa
          ? {
              invoiceId: data.rectifies!.invoiceId,
              fullNumber: data.rectifies!.fullNumber,
              issueDate: toDate(data.rectifies!.issueDate) || null
            }
          : null,
        rectifyingType: esRectificativa ? data.rectifyingType : null,
        rectifyingReason: esRectificativa ? data.rectifyingReason : null,
        rectifyingNote: esRectificativa ? data.rectifyingNote : null,
        // Solo en `S`. En `I` no se rellenan: el registro que va a la AEAT es
        // otro y estos campos no le corresponden.
        rectifiedBase:
          esRectificativa && data.rectifyingType === 'S' ? (data.rectifiedBase ?? null) : null,
        rectifiedVat:
          esRectificativa && data.rectifyingType === 'S' ? (data.rectifiedVat ?? null) : null,
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
      // El contador guarda el número; la cadena, la huella. Separados porque el
      // número es por serie y la cadena es una sola para todo el emisor.
      tx.set(
        counterRef,
        { series, lastNumber: number, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        chainRef,
        {
          lastHash: hash,
          lastFullNumber: fullNumber,
          lastIssueDate: issueDate,
          lastIndex: chainIndex,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      /**
       * La fila de remisión, **en la misma transacción que la factura**.
       *
       * ⚠️ **Creada siempre, se envíe hoy o no.** Es el registro de que esta
       * factura tiene que llegar a la AEAT, y nace pendiente. Escribirla después
       * y fallar dejaría una factura emitida que nadie va a enviar nunca: no
       * saldría en ninguna lista de pendientes, porque las listas se construyen
       * con estas filas. Es el mismo razonamiento que hace que el número y la
       * huella se escriban juntos.
       *
       * `create` y no `set`: si ya existe, esta factura ya se emitió y volver a
       * sembrarla borraría el acuse de un envío que sí ocurrió.
       */
      tx.create(db.collection(SUBMISSIONS).doc(invoiceRef.id), {
        invoiceId: invoiceRef.id,
        fullNumber,
        chainIndex,
        issueDate,
        estado: 'pendiente',
        /**
         * ⚠️ **Una bandera, y no `estado != 'aceptado'`.** Firestore exige que
         * el primer `orderBy` sea el campo de la desigualdad, así que con `!=`
         * no se puede ordenar por índice de cadena — que es justo el orden en
         * el que hay que enviar. Un booleano se indexa con `chainIndex` y sale
         * la cola ya ordenada.
         */
        pendienteEnvio: true,
        intentos: 0,
        /**
         * A qué entorno corresponde este envío. Un registro aceptado en
         * preproducción **no está presentado**: sin esto, una pantalla que mire
         * el estado diría que sí.
         */
        entorno: process.env.VELTO_VERIFACTU_ENV === 'live' ? 'live' : 'test',
        createdAt: FieldValue.serverTimestamp()
      });

      /**
       * La original queda marcada como rectificada, **en la misma transacción**.
       *
       * Si se hiciera después y fallara, quedaría una rectificativa apuntando a
       * una factura que no sabe que lo está: abriéndola no habría forma de ver
       * que ya no vale, que es justo lo que hay que evitar.
       *
       * ⚠️ Es una escritura sobre una factura emitida, y eso solo lo puede
       * hacer el backend: `firestore.rules` deniega el `update` a todo el
       * mundo. Es legítima porque **no toca contenido fiscal** —ni importes, ni
       * número, ni fechas— y no entra en la huella: es el estado del documento
       * y una referencia al que lo corrige.
       */
      if (esRectificativa && data.rectifies?.invoiceId) {
        tx.set(
          db.collection(INVOICES).doc(data.rectifies.invoiceId),
          {
            status: 'rectified',
            rectifiedBy: { invoiceId: invoiceRef.id, fullNumber },
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }

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
        notes: data.notes,
        /**
         * El QR de cotejo, **solo si el registro se remite de verdad**.
         *
         * ⚠️ Hoy `verifactuEnabled()` es `false` en los dos entornos: el
         * registro se guarda pero no se envía a la AEAT, así que la factura
         * calla. Imprimir la leyenda antes de que el envío funcione sería
         * mandar al cliente a una sede donde su factura no está — el mismo
         * error que la frase que anunciaba una firma digital inexistente.
         */
        verifactu: verifactuEnabled()
          ? {
              url: buildQrUrl({
                nif: company.taxId,
                numSerieFactura: resultado.fullNumber,
                fechaExpedicion: formatFechaExpedicion(issueDate),
                importeTotal: totals.total.toFixed(2)
              })
            }
          : undefined,
        mentions: mentionTexts(requiredMentionKeys(data.lines), resolveLocale(data.locale)),
        hideVatBreakdown: soloRebu(data.lines),
        rectifying:
          esRectificativa && data.rectifies
            ? {
                title: rectifyingText('title', resolveLocale(data.locale)),
                rectifiedNumber: data.rectifies.fullNumber,
                rectifiedDate: toDate(data.rectifies.issueDate) || null,
                typeLabel: rectifyingText(data.rectifyingType!, resolveLocale(data.locale)),
                reasonLabel: rectifyingText(data.rectifyingReason!, resolveLocale(data.locale)),
                note: data.rectifyingNote!
              }
            : undefined
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
