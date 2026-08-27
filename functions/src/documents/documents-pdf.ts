/**
 * The two short customer-facing documents that are NOT the contract:
 *
 *   - Quote (`buildQuotePdf`)               — before any reservation exists.
 *   - Booking confirmation (`buildBookingConfirmationPdf`) — after the signal
 *     is collected, while the contract is still unsigned.
 *
 * Both reuse `PdfBuilder` and the money/date/VAT helpers from the contract
 * renderer, so the three documents look like they came from the same company.
 *
 * ⚠️ Neither of these is the rental contract, and neither may ever behave like
 * one. They carry no clauses, no signature block, and generating them writes
 * nothing to the reservation: the workflow guards remain the only thing that
 * decides whether a car can be handed over. A customer holding one of these
 * PDFs must not be able to advance the rental by a single step.
 */

import { PDFDocument } from 'pdf-lib';
import {
  PdfBuilder,
  companyFooterLines,
  companyHeaderLines,
  extractVat,
  formatDate,
  formatDayOnly,
  formatIdDocument,
  formatMoney,
  fuelTypeLabel,
  transmissionLabel,
  type InfoEntry
} from '../contracts/pdf';
import type { ContractLocale } from '../contracts/contract-types';

export interface DocumentCompany {
  legalName: string;
  taxId: string;
  address: string;
  phone?: string;
  email: string;
  website?: string;
  /** Registry line for the legal footer. */
  registry?: string;
}

export interface DocumentClient {
  fullName: string;
  documentNumber?: string;
  phone?: string;
  email?: string;
}

export interface DocumentVehicle {
  brand: string;
  model: string;
  version?: string;
  plateNumber: string;
  year?: number;
  fuelType?: string;
  transmission?: string;
}

export interface DocumentRental {
  pickupDateTime?: Date;
  returnDateTime?: Date;
  totalDays?: number;
  pickupLocation?: string;
  returnLocation?: string;
}

/**
 * Same shape the contract renderer uses. `finalPrice` is VAT-INCLUSIVE; the
 * breakdown extracts the tax rather than adding it.
 */
export interface DocumentPricing {
  finalPrice?: number;
  depositAmount?: number;
  tariffPrice?: number;
  loyaltyDiscountPercent?: number;
  loyaltyDiscount?: number;
  manualAdjustment?: number;
  vatRate?: number;
}

export interface DocumentPayments {
  initialRequired?: number;
  initialPaid?: number;
  remainingRequired?: number;
  remainingPaid?: number;
  remainingDueDate?: Date;
  depositRequired?: number;
  depositPaid?: number;
}

/**
 * Diagnostics seam: called with the builder once the document is laid out, so
 * a test can inspect where every run of text ended up. Never set in
 * production code.
 */
export type LayoutInspector = (builder: PdfBuilder) => void;

export interface QuotePdfInput {
  company: DocumentCompany;
  client?: DocumentClient;
  vehicle: DocumentVehicle;
  rental: DocumentRental;
  pricing: DocumentPricing;
  locale: ContractLocale;
  generatedAt: Date;
  validUntil: Date;
  onLayout?: LayoutInspector;
}

export interface BookingConfirmationPdfInput {
  company: DocumentCompany;
  client: DocumentClient;
  vehicle: DocumentVehicle;
  rental: DocumentRental;
  pricing: DocumentPricing;
  payments: DocumentPayments;
  /** Human-readable reference the customer can quote over the phone. */
  locator: string;
  /** Drives the "what is still pending" list. */
  contractSigned: boolean;
  locale: ContractLocale;
  generatedAt: Date;
  onLayout?: LayoutInspector;
}

// ---------------------------------------------------------------------------
// Labels
//
// Inline trilingual ternaries, matching the style of contracts/pdf.ts. These
// documents are customer-facing but not legal text, so they live here rather
// than in clauses.ts.
// ---------------------------------------------------------------------------

function labels(loc: ContractLocale) {
  const en = loc === 'en';
  const ro = loc === 'ro';

  return {
    quoteTitle: en ? 'RENTAL QUOTE' : ro ? 'OFERTĂ DE ÎNCHIRIERE' : 'PRESUPUESTO DE ALQUILER',
    bookingTitle: en
      ? 'BOOKING CONFIRMATION'
      : ro
        ? 'CONFIRMARE REZERVARE'
        : 'JUSTIFICANTE DE RESERVA',
    issuedOn: en ? 'Issued on' : ro ? 'Emis la' : 'Fecha de emisión',
    validUntil: en ? 'Valid until' : ro ? 'Valabil până la' : 'Válido hasta',
    locator: en ? 'Booking reference' : ro ? 'Cod rezervare' : 'Localizador',

    lessor: en ? 'Lessor' : ro ? 'Locator' : 'Arrendador',
    taxId: en ? 'Tax ID' : ro ? 'CIF' : 'CIF',
    address: en ? 'Address' : ro ? 'Adresă' : 'Dirección',
    phone: en ? 'Phone' : ro ? 'Telefon' : 'Teléfono',
    email: en ? 'Email' : ro ? 'Email' : 'Email',
    website: en ? 'Website' : ro ? 'Site web' : 'Web',

    clientData: en ? 'Customer' : ro ? 'Client' : 'Cliente',
    name: en ? 'Name' : ro ? 'Nume' : 'Nombre',
    document: en ? 'ID document' : ro ? 'Document' : 'Documento',

    vehicleData: en ? 'Vehicle' : ro ? 'Vehicul' : 'Vehículo',
    vehicle: en ? 'Vehicle' : ro ? 'Vehicul' : 'Vehículo',
    plate: en ? 'Plate' : ro ? 'Număr de înmatriculare' : 'Matrícula',
    year: en ? 'Year' : ro ? 'An fabricație' : 'Año',
    fuel: en ? 'Fuel' : ro ? 'Combustibil' : 'Combustible',
    transmission: en ? 'Transmission' : ro ? 'Transmisie' : 'Transmisión',

    rentalData: en ? 'Rental conditions' : ro ? 'Condițiile închirierii' : 'Condiciones del alquiler',
    pickup: en ? 'Pickup date & time' : ro ? 'Data și ora predării' : 'Fecha y hora de entrega',
    ret: en ? 'Return date & time' : ro ? 'Data și ora returnării' : 'Fecha y hora de devolución',
    days: en ? 'Duration' : ro ? 'Durată' : 'Duración',
    dayUnit: en ? 'day(s)' : ro ? 'zi(le)' : 'día(s)',
    pickupLoc: en ? 'Pickup location' : ro ? 'Locul predării' : 'Lugar de entrega',
    retLoc: en ? 'Return location' : ro ? 'Locul returnării' : 'Lugar de devolución',

    priceSection: en ? 'Price and deposit' : ro ? 'Preț și garanție' : 'Precio y fianza',
    tariffAmt: en
      ? 'Rental amount (tariff)'
      : ro
        ? 'Suma închiriere (tarif)'
        : 'Importe alquiler (tarifa)',
    loyaltyDisc: en ? 'Loyalty discount' : ro ? 'Reducere fidelitate' : 'Descuento fidelidad',
    agreedAdj: en ? 'Agreed adjustment' : ro ? 'Ajustare convenită' : 'Ajuste acordado',
    vatBase: en ? 'Taxable base' : ro ? 'Bază impozabilă' : 'Base imponible',
    vat: en ? 'VAT' : ro ? 'TVA' : 'IVA',
    rentalTotal: en
      ? 'Total rental (VAT incl.)'
      : ro
        ? 'Total închiriere (TVA inclus)'
        : 'Total alquiler (IVA incl.)',
    depositVatNote: en
      ? 'Security deposit (not subject to VAT)'
      : ro
        ? 'Garanție (nesupusă TVA)'
        : 'Fianza (no sujeta a IVA)',

    paymentsSection: en ? 'Payment status' : ro ? 'Starea plăților' : 'Estado de los pagos',
    signal: en ? 'Deposit paid on booking' : ro ? 'Avans' : 'Señal',
    remaining: en ? 'Outstanding balance' : ro ? 'Rest de plată' : 'Resto pendiente',
    deposit: en ? 'Security deposit' : ro ? 'Garanție' : 'Fianza',
    paidOf: en ? 'paid of' : ro ? 'plătit din' : 'pagado de',
    dueOn: en ? 'due on' : ro ? 'scadent la' : 'a pagar antes del',

    pendingSection: en ? 'What is still pending' : ro ? 'Ce a mai rămas de făcut' : 'Qué falta por hacer',
    pendingSign: en
      ? 'Sign the rental agreement. We will send you a link to sign it from your phone.'
      : ro
        ? 'Semnați contractul de închiriere. Vă vom trimite un link pentru a-l semna de pe telefon.'
        : 'Firmar el contrato de alquiler. Te enviaremos un enlace para firmarlo desde el móvil.',
    pendingPay: en
      ? 'Pay the outstanding balance before picking the vehicle up.'
      : ro
        ? 'Achitați restul de plată înainte de a prelua vehiculul.'
        : 'Abonar el resto pendiente antes de recoger el vehículo.',
    pendingDeposit: en
      ? 'Leave the security deposit at pickup. It is returned after the vehicle is checked on return.'
      : ro
        ? 'Depuneți garanția la preluare. Se restituie după verificarea vehiculului la returnare.'
        : 'Dejar la fianza en la entrega. Se devuelve tras revisar el vehículo en la devolución.',
    pendingIdDocs: en
      ? 'Bring your ID document and driving licence to the pickup.'
      : ro
        ? 'Aduceți actul de identitate și permisul de conducere la preluare.'
        : 'Traer el documento de identidad y el carnet de conducir a la entrega.',

    quoteDisclaimer: en
      ? 'This quote is non-binding and does NOT reserve the vehicle: availability is confirmed only once the booking is made and the deposit is paid. Prices include VAT at the rate in force on the issue date.'
      : ro
        ? 'Această ofertă nu este obligatorie și NU rezervă vehiculul: disponibilitatea se confirmă doar după efectuarea rezervării și plata avansului. Prețurile includ TVA la cota în vigoare la data emiterii.'
        : 'Este presupuesto no es vinculante y NO reserva el vehículo: la disponibilidad se confirma solo al formalizar la reserva y abonar la señal. Los precios incluyen IVA al tipo vigente en la fecha de emisión.',
    bookingDisclaimer: en
      ? 'This document confirms your booking. It is NOT the rental agreement: the vehicle can only be handed over once the rental agreement has been signed and the outstanding amounts have been paid.'
      : ro
        ? 'Acest document confirmă rezervarea dvs. NU este contractul de închiriere: vehiculul poate fi predat doar după semnarea contractului și achitarea sumelor restante.'
        : 'Este documento confirma tu reserva. NO es el contrato de alquiler: el vehículo solo puede entregarse una vez firmado el contrato y abonados los importes pendientes.',

    questions: en
      ? 'Questions? Reply to this message or call us.'
      : ro
        ? 'Întrebări? Răspundeți la acest mesaj sau sunați-ne.'
        : '¿Dudas? Responde a este mensaje o llámanos.'
  };
}

type Labels = ReturnType<typeof labels>;

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

async function startDocument(
  title: string,
  company: DocumentCompany,
  reference: string
): Promise<{ doc: PDFDocument; b: PdfBuilder }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${company.legalName} — ${title}${reference ? ' ' + reference : ''}`.trim());
  doc.setAuthor(company.legalName);
  doc.setSubject(title);
  doc.setCreator(company.legalName);
  doc.setProducer(`${company.legalName} · pdf-lib`);

  const b = new PdfBuilder(doc);
  await b.init(title, reference, companyFooterLines(company));

  b.documentHeader({
    companyName: company.legalName,
    companyLines: companyHeaderLines(company),
    title,
    reference
  });

  return { doc, b };
}

/**
 * The customer, as the invoice sets "FACTURAR A": name in brand type with the
 * contact lines underneath, in the right-hand column of the header.
 *
 * It used to be repeated — once here and again in a "CLIENTE" section further
 * down — which pushed a one-page quote onto two.
 */
function clientColumn(L: Labels, client?: DocumentClient): InfoEntry[] {
  if (!client) return [];
  return [
    { value: client.fullName, strong: true },
    ...(client.documentNumber
      ? [{ label: L.document, value: formatIdDocument(undefined, client.documentNumber) }]
      : []),
    ...(client.phone ? [{ label: L.phone, value: client.phone }] : []),
    ...(client.email ? [{ label: L.email, value: client.email }] : [])
  ];
}

function drawVehicleBlock(
  b: PdfBuilder,
  L: Labels,
  vehicle: DocumentVehicle,
  loc: ContractLocale
): void {
  b.section(L.vehicleData);
  b.twoColumn(
    L.vehicle + ':',
    `${vehicle.brand} ${vehicle.model}${vehicle.version ? ' ' + vehicle.version : ''}`,
    false,
    true
  );
  b.twoColumn(L.plate + ':', vehicle.plateNumber, false, true);
  if (vehicle.year) b.twoColumn(L.year + ':', String(vehicle.year));
  // Raw enums from Firestore ('diesel', 'manual') translated into the document
  // language, rather than printed as stored.
  if (vehicle.fuelType) b.twoColumn(L.fuel + ':', fuelTypeLabel(vehicle.fuelType, loc));
  if (vehicle.transmission) {
    b.twoColumn(L.transmission + ':', transmissionLabel(vehicle.transmission, loc));
  }
}

function drawRentalBlock(
  b: PdfBuilder,
  L: Labels,
  rental: DocumentRental,
  loc: ContractLocale
): void {
  b.section(L.rentalData);
  b.twoColumn(L.pickup + ':', formatDate(rental.pickupDateTime, loc), true, true);
  b.twoColumn(L.ret + ':', formatDate(rental.returnDateTime, loc), true, true);
  if (rental.totalDays) {
    b.twoColumn(L.days + ':', `${rental.totalDays} ${L.dayUnit}`, false, true);
  }
  if (rental.pickupLocation) b.twoColumnWrap(L.pickupLoc + ':', rental.pickupLocation);
  if (rental.returnLocation) b.twoColumnWrap(L.retLoc + ':', rental.returnLocation);
}

/**
 * Identical breakdown to the contract's, on purpose: the customer must be able
 * to lay the quote, the confirmation and the contract side by side and read the
 * same numbers. The tariff and discount lines only appear when they moved the
 * price.
 */
function drawPriceBlock(
  b: PdfBuilder,
  L: Labels,
  pricing: DocumentPricing,
  loc: ContractLocale
): void {
  b.section(L.priceSection);

  const hasDiscounts = !!pricing.loyaltyDiscount || !!pricing.manualAdjustment;
  if (hasDiscounts && pricing.tariffPrice !== undefined) {
    b.twoColumn(L.tariffAmt + ':', formatMoney(pricing.tariffPrice, loc), false, true);
    if (pricing.loyaltyDiscount) {
      const pct = pricing.loyaltyDiscountPercent;
      const label = pct ? `${L.loyaltyDisc} (${pct} %)` : L.loyaltyDisc;
      b.twoColumn(label + ':', formatMoney(pricing.loyaltyDiscount, loc), false, true);
    }
    if (pricing.manualAdjustment) {
      b.twoColumn(L.agreedAdj + ':', formatMoney(pricing.manualAdjustment, loc), false, true);
    }
  }

  const vat = extractVat(pricing.finalPrice, pricing.vatRate);
  b.totalsBlock([
    { label: L.vatBase, value: formatMoney(vat.base, loc) },
    { label: `${L.vat} (${vat.percent} %)`, value: formatMoney(vat.vat, loc) },
    { label: L.rentalTotal, value: formatMoney(vat.total, loc), total: true },
    { label: L.depositVatNote, value: formatMoney(pricing.depositAmount, loc) }
  ]);
}

/** Contact details. The legal identity is already on every page footer. */
function drawContactBlock(b: PdfBuilder, L: Labels, company: DocumentCompany): void {
  b.section(L.lessor);
  b.twoColumn(L.name + ':', company.legalName, false, true);
  if (company.phone) b.twoColumn(L.phone + ':', company.phone);
  if (company.email) b.twoColumnWrap(L.email + ':', company.email);
  if (company.website) b.twoColumn(L.website + ':', company.website);
}

function drawDisclaimer(b: PdfBuilder, text: string): void {
  b.y -= 8;
  b.separator();
  b.text(text, { size: 8.5, italic: true, color: [0.35, 0.35, 0.35], gap: 4 });
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export async function buildQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const loc = input.locale;
  const L = labels(loc);

  const { doc, b } = await startDocument(L.quoteTitle, input.company, '');

  b.infoColumns(
    [
      { label: L.issuedOn, value: formatDate(input.generatedAt, loc) },
      { label: L.validUntil, value: formatDayOnly(input.validUntil, loc) }
    ],
    clientColumn(L, input.client)
  );
  b.y -= 8;

  drawVehicleBlock(b, L, input.vehicle, loc);
  drawRentalBlock(b, L, input.rental, loc);
  drawPriceBlock(b, L, input.pricing, loc);

  drawDisclaimer(b, L.quoteDisclaimer);
  drawContactBlock(b, L, input.company);
  b.text(L.questions, { size: 9, italic: true, color: [0.3, 0.3, 0.3] });

  b.finalizeFooters();
  input.onLayout?.(b);
  return doc.save();
}

// ---------------------------------------------------------------------------
// Booking confirmation
// ---------------------------------------------------------------------------

export async function buildBookingConfirmationPdf(
  input: BookingConfirmationPdfInput
): Promise<Uint8Array> {
  const loc = input.locale;
  const L = labels(loc);
  const p = input.payments;

  const { doc, b } = await startDocument(L.bookingTitle, input.company, input.locator);

  b.infoColumns(
    [
      { label: L.locator, value: input.locator },
      { label: L.issuedOn, value: formatDate(input.generatedAt, loc) }
    ],
    clientColumn(L, input.client)
  );
  b.y -= 8;

  drawVehicleBlock(b, L, input.vehicle, loc);
  drawRentalBlock(b, L, input.rental, loc);
  drawPriceBlock(b, L, input.pricing, loc);

  // Payment status
  b.section(L.paymentsSection);
  b.twoColumn(
    L.signal + ':',
    `${formatMoney(p.initialPaid ?? 0, loc)} ${L.paidOf} ${formatMoney(p.initialRequired ?? 0, loc)}`,
    false,
    true
  );
  const remainingPending = Math.max(0, (p.remainingRequired ?? 0) - (p.remainingPaid ?? 0));
  const remainingText = p.remainingDueDate
    ? `${formatMoney(remainingPending, loc)} — ${L.dueOn} ${formatDayOnly(p.remainingDueDate, loc)}`
    : formatMoney(remainingPending, loc);
  b.twoColumn(L.remaining + ':', remainingText, false, true);
  b.twoColumn(
    L.deposit + ':',
    `${formatMoney(p.depositPaid ?? 0, loc)} ${L.paidOf} ${formatMoney(p.depositRequired ?? 0, loc)}`,
    false,
    true
  );

  // What is still pending — only the steps that really are.
  const pending: string[] = [];
  if (!input.contractSigned) pending.push(L.pendingSign);
  if (remainingPending > 0) pending.push(L.pendingPay);
  if ((p.depositRequired ?? 0) > (p.depositPaid ?? 0)) pending.push(L.pendingDeposit);
  pending.push(L.pendingIdDocs);

  if (pending.length) {
    b.y -= 4;
    b.section(L.pendingSection);
    pending.forEach((line, i) => b.highlightBox(i + 1, line));
  }

  drawDisclaimer(b, L.bookingDisclaimer);
  drawContactBlock(b, L, input.company);
  b.text(L.questions, { size: 9, italic: true, color: [0.3, 0.3, 0.3] });

  b.finalizeFooters();
  input.onLayout?.(b);
  return doc.save();
}
