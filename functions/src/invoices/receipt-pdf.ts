/**
 * El recibo de cobro.
 *
 * Es lo que Dorel hacía a mano en Word cuando alguien le daba la señal: un
 * justificante de dinero recibido. Sale de un documento de `payments`, que ya
 * es la única fuente de verdad del dinero que entra, así que no inventa ninguna
 * cifra.
 *
 * ⚠️ **Todo el diseño de este documento consiste en que NO parezca una
 * factura.** Un cliente que se dedujera el IVA con un recibo tendría un
 * problema, y quien se lo dio también. Por eso, y en contra de lo que sería
 * cómodo, **no reutiliza `buildInvoicePdf`**: comparte el `PdfBuilder` —la
 * marca es la misma— pero no la tabla de líneas, ni el desglose de base y
 * cuota, ni el bloque de forma de pago con el IBAN. Lo que le falta a este
 * documento es lo que lo hace correcto:
 *
 * - **no lleva número de serie fiscal.** La referencia `REC-…` es aleatoria y
 *   sin contador, como la de la proforma: un contador invita a pensar que hay
 *   una serie, y una serie invita a preguntarse por sus huecos;
 * - **no desglosa IVA.** Importe recibido y ya;
 * - **lleva impreso, y no en letra pequeña, que no es una factura.** Va arriba,
 *   debajo del título, porque un aviso al pie lo lee quien ya se ha formado una
 *   opinión del documento.
 */

import { PDFDocument } from 'pdf-lib';
import { PdfBuilder, companyFooterLines, companyHeaderLines, formatMoney } from '../contracts/pdf';
import type { ContractLocale } from '../contracts/contract-types';

export interface ReceiptPdfCompany {
  brandName: string;
  legalName: string;
  taxId: string;
  /** Domicilio social: solo lo usa el pie legal, junto al NIF. */
  address: string;
  /** La oficina, que es lo que va en la cabecera. */
  officeAddress?: string;
  phone?: string;
  email: string;
  registry?: string;
}

export interface ReceiptPdfInput {
  locale: ContractLocale;
  company: ReceiptPdfCompany;
  /** `REC-8QPB4E2A`. No fiscal, aleatoria y sin contador. */
  reference: string;
  /** De quién se recibió el dinero. */
  payerName: string;
  /** Lo efectivamente cobrado, no lo esperado. */
  amount: number;
  /** Fecha del cobro. Si el pago no la trae, la de emisión del recibo. */
  paidAt: Date;
  /** Emisión del documento, para el pie de página. */
  issuedAt: Date;
  /** Clave del método (`cash`, `bank_transfer`, …), ya validada arriba. */
  method?: string;
  /** Clave del tipo de pago (`initial_payment`, `deposit`, …). */
  paymentType?: string;
  /** El texto que escribió el operador, si añade algo al tipo. */
  concept?: string;
  /** `R-P2RJP0`, el mismo que imprime el justificante de reserva. */
  reservationLocator?: string;
  vehicleLabel?: string;
  /**
   * Lo que sigue debiéndose de este mismo concepto.
   *
   * Se imprime cuando el cobro fue parcial: sin esa línea, un recibo por
   * 100 € de una señal de 300 € parece dejar el concepto saldado.
   */
  pendingAmount?: number;
  /**
   * Se imprime «la factura se emitirá al finalizar el alquiler» solo si de
   * verdad va a haber factura. Se factura **a petición**, así que prometerla
   * en todo recibo sería afirmar algo que muchas veces es falso.
   */
  invoiceExpected?: boolean;
  /**
   * Si la factura ya existe, el hecho manda sobre la promesa: se imprime su
   * número en vez de anunciar una futura que ya se emitió.
   */
  issuedInvoiceNumber?: string;
  /** Gancho de los tests de maquetación, igual que en los otros documentos. */
  onLayout?: (b: PdfBuilder) => void;
}

function labels(loc: ContractLocale) {
  const en = loc === 'en';
  const ro = loc === 'ro';
  return {
    title: en ? 'RECEIPT' : ro ? 'CHITANȚĂ' : 'RECIBO',
    /**
     * El aviso. **Es el motivo por el que este documento existe tal y como
     * es**, así que va en negrita, a cuerpo de texto normal y arriba.
     */
    disclaimer: en
      ? 'Informational document with no tax validity. This is NOT an invoice and does not entitle the holder to deduct VAT.'
      : ro
        ? 'Document informativ, fără valabilitate fiscală. NU este o factură și nu dă dreptul la deducerea TVA.'
        : 'Documento informativo, sin validez fiscal. NO es una factura y no da derecho a deducir el IVA.',
    receiptData: en ? 'Receipt details' : ro ? 'Datele chitanței' : 'Datos del recibo',
    receivedFrom: en ? 'Received from' : ro ? 'Primit de la' : 'Recibido de',
    paidDate: en ? 'Payment date' : ro ? 'Data încasării' : 'Fecha del cobro',
    method: en ? 'Payment method' : ro ? 'Modalitate de plată' : 'Forma de pago',
    reservation: en ? 'Booking' : ro ? 'Rezervare' : 'Reserva',
    vehicle: en ? 'Vehicle' : ro ? 'Vehicul' : 'Vehículo',
    concept: en ? 'Description' : ro ? 'Descriere' : 'Concepto',
    amountReceived: en ? 'Amount received' : ro ? 'Sumă primită' : 'Importe recibido',
    stillPending: en
      ? 'Still outstanding for this item'
      : ro
        ? 'Rest de plată pentru acest concept'
        : 'Pendiente de este concepto',
    /**
     * ⚠️ La fianza no es un ingreso por el alquiler: es un depósito en
     * garantía. Un recibo que no lo diga deja al cliente creyendo que ha pagado
     * 300 € más de alquiler, y a esos 300 € no se les factura nunca.
     */
    depositNote: en
      ? 'Received as a security deposit, held in guarantee. It is not payment for the rental and is returned when the vehicle comes back, less any charges that apply.'
      : ro
        ? 'Primită cu titlu de garanție, păstrată în depozit. Nu reprezintă plata închirierii și se restituie la returnarea vehiculului, mai puțin eventualele costuri aplicabile.'
        : 'Cantidad recibida en concepto de fianza, en depósito y en garantía. No es un importe del alquiler y se devuelve al finalizar, descontados los cargos que procedan.',
    invoiceToCome: en
      ? 'The invoice will be issued at the end of the rental.'
      : ro
        ? 'Factura se va emite la finalul închirierii.'
        : 'La factura se emitirá al finalizar el alquiler.',
    invoiceIssued: en ? 'Invoice already issued' : ro ? 'Factură deja emisă' : 'Factura ya emitida'
  };
}

/**
 * Los métodos de pago, traducidos.
 *
 * ⚠️ Llegan **crudos de Firestore** (`bank_transfer`, `physical_pos`) y no son
 * texto libre: son códigos. Pintarlos tal cual es el mismo fallo que sacaba
 * `diesel` y `manual` en la ficha de vehículo del contrato.
 */
const METHODS: Record<string, Record<ContractLocale, string>> = {
  cash: { es: 'Efectivo', en: 'Cash', ro: 'Numerar' },
  bank_transfer: { es: 'Transferencia bancaria', en: 'Bank transfer', ro: 'Transfer bancar' },
  bizum: { es: 'Bizum', en: 'Bizum', ro: 'Bizum' },
  physical_pos: { es: 'TPV', en: 'Card terminal', ro: 'POS' },
  redsys: { es: 'Tarjeta', en: 'Card', ro: 'Card' },
  manual_card: { es: 'Tarjeta', en: 'Card', ro: 'Card' },
  other: { es: 'Otro', en: 'Other', ro: 'Altul' }
};

/**
 * Los conceptos, traducidos.
 *
 * El `concept` guardado en el pago es texto en español —«Señal reserva»,
 * «Fianza»— porque lo escribe la aplicación al sembrar las filas. Imprimirlo
 * tal cual en un recibo rumano deja media frase en el idioma equivocado, así
 * que el titular del concepto sale de aquí y el texto del operador va debajo,
 * solo si añade algo.
 */
const TYPES: Record<string, Record<ContractLocale, string>> = {
  initial_payment: { es: 'Señal de la reserva', en: 'Booking deposit', ro: 'Avans rezervare' },
  remaining_payment: { es: 'Resto del alquiler', en: 'Rental balance', ro: 'Rest închiriere' },
  rental_payment: { es: 'Alquiler', en: 'Rental', ro: 'Închiriere' },
  deposit: { es: 'Fianza', en: 'Security deposit', ro: 'Garanție' },
  extra_fuel: { es: 'Combustible', en: 'Fuel', ro: 'Combustibil' },
  refuel_penalty: {
    es: 'Penalización por no repostar',
    en: 'Refuelling penalty',
    ro: 'Penalizare pentru nealimentare'
  },
  extra_cleaning: { es: 'Limpieza', en: 'Cleaning', ro: 'Curățenie' },
  extra_km: { es: 'Kilómetros extra', en: 'Extra mileage', ro: 'Kilometri suplimentari' },
  extra_damage: { es: 'Daños', en: 'Damage', ro: 'Daune' },
  extra_fine: { es: 'Multa', en: 'Fine', ro: 'Amendă' },
  extra_other: { es: 'Otros cargos', en: 'Other charges', ro: 'Alte costuri' },
  free_payment: { es: 'Cobro', en: 'Payment', ro: 'Încasare' }
};

export function methodLabel(value: string | undefined, loc: ContractLocale): string {
  const entry = value ? METHODS[value] : undefined;
  return entry ? entry[loc] : '—';
}

export function paymentTypeLabel(value: string | undefined, loc: ContractLocale): string {
  const entry = value ? TYPES[value] : undefined;
  return entry ? entry[loc] : '';
}

/**
 * ¿El concepto que escribió el operador añade algo al titular traducido?
 *
 * Las filas que siembra la aplicación llevan «Señal reserva», «Resto alquiler»
 * y «Fianza», que es casi palabra por palabra lo que ya dice el titular. Sin
 * esta comprobación, el recibo más normal de todos salía repitiéndose:
 *
 *     Señal de la reserva
 *     Señal reserva
 *
 * Se compara por palabras y sin tildes en vez de por igualdad de cadenas,
 * porque el titular es una frase («Señal **de la** reserva») y el concepto
 * guardado es su versión corta. Lo que sí aporta —«Fianza del alquiler,
 * entregada a cuenta en la oficina»— trae palabras que el titular no tiene, y
 * se imprime.
 *
 * ⚠️ **Se compara contra los tres idiomas, no solo contra el del documento.**
 * Lo que la aplicación siembra está en español, así que un recibo en rumano
 * ponía «Avans rezervare» y debajo «Señal reserva»: media línea en el idioma
 * equivocado que no añadía nada. El concepto no aporta si no dice más que el
 * nombre del tipo **en cualquiera** de los idiomas que la aplicación habla.
 */
export function conceptAddsDetail(concept: string, headings: string | string[]): boolean {
  const palabras = (s: string) =>
    s
      .toLowerCase()
      // Descompone y quita los diacríticos: «señal» y «senal» son la misma
      // palabra a estos efectos. Con `\p{Diacritic}` en vez del rango de
      // marcas combinantes, que en el código fuente son caracteres invisibles.
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);

  const delConcepto = palabras(concept);
  if (!delConcepto.length) return false;

  const lista = Array.isArray(headings) ? headings : [headings];
  // Basta con que UN titular lo cubra: si el concepto es la versión corta del
  // nombre en español, no aporta aunque el documento salga en rumano.
  return !lista.some((titular) => {
    const delTitular = new Set(palabras(titular));
    return delConcepto.every((w) => delTitular.has(w));
  });
}

function formatDayOnly(d: Date | null | undefined, loc: ContractLocale): string {
  if (!d) return '—';
  const tag = loc === 'en' ? 'en-GB' : loc === 'ro' ? 'ro-RO' : 'es-ES';
  return d.toLocaleDateString(tag, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: process.env.VELTO_TIME_ZONE || 'Europe/Madrid'
  });
}

export async function buildReceiptPdf(input: ReceiptPdfInput): Promise<Uint8Array> {
  const loc = input.locale;
  const L = labels(loc);
  const company = input.company;

  const doc = await PDFDocument.create();
  // ⚠️ Ni el título del documento ni el asunto pueden decir «factura»: los
  // metadatos son lo que se ve al abrirlo en el móvil, antes que el contenido.
  doc.setTitle(`${company.brandName} — ${L.title} ${input.reference}`);
  doc.setAuthor(company.brandName);
  doc.setSubject(`${L.title} ${input.reference}`);
  doc.setCreator(company.brandName);
  doc.setProducer(`${company.brandName} · pdf-lib`);

  const b = new PdfBuilder(doc);
  await b.init(L.title, input.reference, companyFooterLines(company));

  b.documentHeader({
    // La marca y la oficina, como el resto de documentos que le hablan al
    // cliente. El domicilio social y la razón social se quedan en el pie legal,
    // que es donde acompañan al NIF.
    companyName: company.brandName,
    companyLines: companyHeaderLines(company),
    title: L.title,
    reference: input.reference
  });

  // El aviso, lo primero que se lee después del título.
  b.text(L.disclaimer, { size: 9.2, bold: true, gap: 4 });
  b.separator();

  const izquierda: { label?: string; value: string; strong?: boolean }[] = [
    { label: L.paidDate, value: formatDayOnly(input.paidAt, loc) },
    { label: L.method, value: methodLabel(input.method, loc) }
  ];
  if (input.reservationLocator) {
    izquierda.push({ label: L.reservation, value: input.reservationLocator });
  }
  if (input.vehicleLabel) izquierda.push({ label: L.vehicle, value: input.vehicleLabel });

  /**
   * ⚠️ **Con etiqueta.** Un recibo dice de quién se recibió el dinero, y un
   * nombre suelto en una columna no lo dice: se lee como un dato más. Salía
   * así —destacado y sin explicar— mientras la etiqueta ya estaba escrita y
   * traducida en los tres idiomas sin que nadie la pintara.
   *
   * Envuelve en vez de encoger: una razón social larga es lo que identifica al
   * pagador, y abreviarla deja el documento sin decir de quién habla.
   */
  const derecha: { label?: string; value: string; strong?: boolean; wrap?: boolean }[] = [
    { label: L.receivedFrom, value: input.payerName || '—', wrap: true }
  ];

  b.section(L.receiptData, { lead: 6 });
  b.y += 4;
  b.infoColumns(izquierda, derecha, { size: 8.2 });

  // El concepto: el titular traducido y, debajo, lo que escribió el operador
  // **solo si añade algo**. Con `free_payment` el titular es genérico a
  // propósito y el texto de al lado es el que lleva el significado.
  const titular = paymentTypeLabel(input.paymentType, loc);
  const detalle = (input.concept || '').trim();
  const enTodosLosIdiomas = input.paymentType
    ? Object.values(TYPES[input.paymentType] || {})
    : [];
  const detalleAporta =
    !!detalle && (!titular || conceptAddsDetail(detalle, enTodosLosIdiomas));
  b.y -= 6;
  b.section(L.concept, { lead: 6 });
  if (titular) b.text(titular, { size: 9.5, bold: true, gap: detalleAporta ? 1 : 2 });
  if (detalleAporta) {
    b.text(detalle, { size: 8.6, color: [0.35, 0.35, 0.35], gap: 2 });
  }

  b.y -= 10;

  /**
   * El importe.
   *
   * **Una sola fila**, sin base ni cuota: el bloque que la factura usa para su
   * desglose aquí solo dice cuánto entró. Es la diferencia visible entre los
   * dos documentos puestos uno al lado del otro.
   */
  b.totalsBlock([
    { label: L.amountReceived, value: formatMoney(input.amount, loc), total: true }
  ]);

  b.y -= 12;

  /**
   * Lo que sigue debiéndose, si el cobro fue parcial.
   *
   * ⚠️ **Fuera del bloque de totales, y a propósito.** Ahí dentro las filas se
   * leen como sumandos —así funciona la factura, base + cuota = total— y el
   * importe recibido no es la suma de nada: 100 € recibidos con 50 € pendientes
   * daban un bloque que parecía cuadrar y no cuadraba. Como línea de texto es
   * lo que es: una advertencia de que el concepto no queda saldado.
   */
  const pendiente = Math.round((Number(input.pendingAmount) || 0) * 100) / 100;
  if (pendiente > 0) {
    b.text(`${L.stillPending}: ${formatMoney(pendiente, loc)}`, {
      size: 8.6,
      bold: true,
      gap: 4
    });
  }

  if (input.paymentType === 'deposit') {
    b.text(L.depositNote, { size: 8.4, gap: 3 });
  }

  /**
   * Lo que pasa con la factura, y **solo si es cierto**.
   *
   * Si ya existe, se dice cuál: anunciar una futura cuando la que había ya se
   * emitió es la misma clase de mentira impresa que la frase del presupuesto
   * sobre el IVA incluido, solo que en la otra dirección.
   */
  if (input.issuedInvoiceNumber) {
    b.text(`${L.invoiceIssued}: ${input.issuedInvoiceNumber}`, { size: 8.4, gap: 2 });
  } else if (input.invoiceExpected) {
    b.text(L.invoiceToCome, { size: 8.4, gap: 2 });
  }

  b.finalizeFooters();
  input.onLayout?.(b);
  return await doc.save();
}
