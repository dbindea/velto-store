/**
 * El PDF de la factura.
 *
 * Es el documento del que salió toda la identidad visual de la aplicación: el
 * `PdfBuilder` copió de aquí las versalitas turquesa, los filetes finos, el
 * bloque de totales y el pie legal repetido. Así que esto no inventa nada —
 * vuelve a montar el original con las piezas que ya existen.
 *
 * ⚠️ **La cabecera lleva el domicilio SOCIAL, no el comercial.** Es la
 * excepción a la regla del resto de documentos: el art. 6.1.c) exige el
 * domicilio del expedidor y ahí es un dato registral, no una indicación de cómo
 * llegar a la oficina. La factura es exactamente el sitio donde la empresa
 * comparece como persona jurídica.
 */

import { PDFDocument } from 'pdf-lib';
import { PdfBuilder, companyFooterLines, formatMoney } from '../contracts/pdf';
import type { ContractLocale } from '../contracts/contract-types';
import type { InvoiceTotals } from './invoice-core';

export interface InvoicePdfCompany {
  brandName: string;
  legalName: string;
  taxId: string;
  /** Domicilio **social**. En una factura va este, no el de la oficina. */
  address: string;
  phone?: string;
  email: string;
  website?: string;
  registry?: string;
}

export interface InvoicePdfRecipient {
  name: string;
  taxId: string;
  address: string;
  email?: string;
}

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

export interface InvoicePdfInput {
  locale: ContractLocale;
  company: InvoicePdfCompany;
  recipient: InvoicePdfRecipient;
  fullNumber: string;
  issueDate: Date;
  /** Solo si difiere de la de expedición (art. 6.1.f). */
  operationDate?: Date | null;
  operationPeriodStart?: Date | null;
  operationPeriodEnd?: Date | null;
  lines: InvoicePdfLine[];
  totals: InvoiceTotals;
  paymentMethod: 'paid' | 'transfer' | 'card' | 'cash';
  /** IBAN y banco, para la forma de pago por transferencia. */
  bankName?: string;
  iban?: string;
  amountAlreadyPaid?: number;
  contractNumber?: string;
  vehicleLabel?: string;
  notes?: string;
}

function labels(loc: ContractLocale) {
  const en = loc === 'en';
  const ro = loc === 'ro';
  return {
    title: en ? 'INVOICE' : ro ? 'FACTURĂ' : 'FACTURA',
    invoiceData: en ? 'Invoice details' : ro ? 'Datele facturii' : 'Datos de la factura',
    billTo: en ? 'Bill to' : ro ? 'Facturat către' : 'Facturar a',
    issueDate: en ? 'Issue date' : ro ? 'Data emiterii' : 'Fecha de expedición',
    operationDate: en ? 'Date of supply' : ro ? 'Data prestării' : 'Fecha de la operación',
    period: en ? 'Period' : ro ? 'Perioadă' : 'Periodo',
    contract: en ? 'Contract' : ro ? 'Contract' : 'Contrato',
    vehicle: en ? 'Vehicle' : ro ? 'Vehicul' : 'Vehículo',
    units: en ? 'QTY' : ro ? 'BUC.' : 'UDS.',
    description: en ? 'DESCRIPTION' : ro ? 'DESCRIERE' : 'DESCRIPCIÓN',
    base: en ? 'BASE' : ro ? 'BAZĂ' : 'BASE',
    vat: en ? 'VAT' : ro ? 'TVA' : 'IVA',
    amount: en ? 'AMOUNT' : ro ? 'VALOARE' : 'IMPORTE',
    taxBase: en ? 'Taxable base' : ro ? 'Bază impozabilă' : 'Base imponible',
    total: en ? 'Total invoice' : ro ? 'Total factură' : 'Total factura',
    paymentMethod: en ? 'Payment method' : ro ? 'Modalitate de plată' : 'Forma de pago',
    transfer: en ? 'Bank transfer' : ro ? 'Transfer bancar' : 'Transferencia bancaria',
    card: en ? 'Card / POS' : ro ? 'Card / POS' : 'Tarjeta / TPV',
    cash: en ? 'Cash' : ro ? 'Numerar' : 'Efectivo',
    paid: en ? 'INVOICE PAID' : ro ? 'FACTURĂ ACHITATĂ' : 'FACTURA PAGADA',
    alreadyPaid: en ? 'Advance received' : ro ? 'Avans primit' : 'Anticipo recibido',
    outstanding: en ? 'Outstanding' : ro ? 'De plată' : 'Pendiente de pago',
    vatNote: en
      ? 'Transaction subject to and not exempt from VAT.'
      : ro
        ? 'Operațiune supusă și nescutită de TVA.'
        : 'Operación sujeta y no exenta de IVA.',
    vatRateNote: en
      ? 'VAT rate applied'
      : ro
        ? 'Cota de TVA aplicată'
        : 'Tipo impositivo aplicado'
  };
}

/** `0.21` → `21 %`. El tipo se imprime como porcentaje, no como fracción. */
function vatPercent(rate: number): string {
  const pct = Math.round((Number(rate) || 0) * 10000) / 100;
  return `${String(pct).replace('.', ',')} %`;
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

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const loc = input.locale;
  const L = labels(loc);
  const company = input.company;

  const doc = await PDFDocument.create();
  doc.setTitle(`${company.brandName} — ${L.title} ${input.fullNumber}`);
  doc.setAuthor(company.brandName);
  doc.setSubject(`${L.title} ${input.fullNumber}`);
  doc.setCreator(company.brandName);
  doc.setProducer(`${company.brandName} · pdf-lib`);

  const b = new PdfBuilder(doc);
  await b.init(L.title, input.fullNumber, companyFooterLines(company));

  b.documentHeader({
    companyName: company.brandName,
    // ⚠️ Domicilio social, no el de la oficina: ver la nota de arriba.
    companyLines: [
      company.taxId ? `NIF ${company.taxId.toUpperCase()}` : '',
      company.address,
      [company.phone, company.email].filter(Boolean).join(' · ')
    ].filter(Boolean),
    title: L.title,
    reference: input.fullNumber
  });

  // «DATOS DE LA FACTURA» contra «FACTURAR A», igual que en el original.
  const izquierda: { label?: string; value: string; strong?: boolean }[] = [
    { label: L.issueDate, value: formatDayOnly(input.issueDate, loc) }
  ];
  // La fecha de operación solo se imprime si difiere: ponerla siempre repetiría
  // la misma fecha dos veces.
  if (
    input.operationDate &&
    input.operationDate.toDateString() !== input.issueDate.toDateString()
  ) {
    izquierda.push({ label: L.operationDate, value: formatDayOnly(input.operationDate, loc) });
  }
  if (input.operationPeriodStart && input.operationPeriodEnd) {
    izquierda.push({
      label: L.period,
      value: `${formatDayOnly(input.operationPeriodStart, loc)} - ${formatDayOnly(
        input.operationPeriodEnd,
        loc
      )}`
    });
  }
  if (input.contractNumber) izquierda.push({ label: L.contract, value: input.contractNumber });
  if (input.vehicleLabel) izquierda.push({ label: L.vehicle, value: input.vehicleLabel });

  const derecha: { label?: string; value: string; strong?: boolean }[] = [
    { value: input.recipient.name, strong: true },
    { value: input.recipient.taxId },
    { value: input.recipient.address }
  ];
  if (input.recipient.email) derecha.push({ value: input.recipient.email });

  b.section(L.invoiceData, { lead: 6 });
  b.y += 4;
  b.infoColumns(izquierda, derecha, { size: 8.2 });
  b.y -= 10;

  b.lineItemsTable(
    {
      units: L.units,
      description: L.description,
      base: L.base,
      vat: L.vat,
      amount: L.amount
    },
    input.lines.map((l) => {
      const base = Math.round(l.quantity * l.unitPrice * 100) / 100;
      return {
        units: String(l.quantity),
        description: l.description,
        base: formatMoney(base, loc),
        vat: vatPercent(l.vatRate),
        amount: formatMoney(base, loc)
      };
    })
  );

  b.y -= 6;

  // Los totales, con un subtotal por tipo impositivo: el art. 6.1.g) exige la
  // cuota consignada por separado, y con varios tipos hace falta una línea por
  // cada uno.
  const filas: { label: string; value: string; total?: boolean }[] = [
    { label: L.taxBase, value: formatMoney(input.totals.base, loc) }
  ];
  for (const t of input.totals.byVatRate) {
    filas.push({
      label: `${L.vat} ${vatPercent(t.vatRate)}`,
      value: formatMoney(t.vat, loc)
    });
  }
  filas.push({ label: L.total, value: formatMoney(input.totals.total, loc), total: true });
  b.totalsBlock(filas);

  // Forma de pago. Si ya está cobrada no se piden datos bancarios: no hay nada
  // que pedirle al cliente.
  b.y -= 10;
  b.section(L.paymentMethod, { lead: 6 });
  if (input.paymentMethod === 'paid') {
    b.text(L.paid, { size: 9.5, bold: true, gap: 2 });
  } else {
    const nombre =
      input.paymentMethod === 'transfer'
        ? [L.transfer, input.bankName].filter(Boolean).join(' · ')
        : input.paymentMethod === 'card'
          ? L.card
          : L.cash;
    b.text(nombre, { size: 9, bold: true, gap: 2 });
    if (input.paymentMethod === 'transfer' && input.iban) {
      b.text(`IBAN  ${input.iban}`, { size: 8.6, gap: 2 });
    }
    if (input.amountAlreadyPaid && input.amountAlreadyPaid > 0) {
      const pendiente =
        Math.round((input.totals.total - input.amountAlreadyPaid) * 100) / 100;
      // Las dos cifras, para que el cliente no pague dos veces la señal.
      b.text(`${L.alreadyPaid}: ${formatMoney(input.amountAlreadyPaid, loc)}`, {
        size: 8.6,
        gap: 1
      });
      b.text(`${L.outstanding}: ${formatMoney(pendiente, loc)}`, { size: 8.6, bold: true, gap: 2 });
    }
  }

  if (input.notes) {
    b.y -= 8;
    b.text(input.notes, { size: 8, color: [0.35, 0.35, 0.35], gap: 2 });
  }

  // El pie fiscal del original.
  b.y -= 10;
  const tipos = input.totals.byVatRate.map((t) => vatPercent(t.vatRate)).join(', ');
  b.text(`${L.vatNote} ${L.vatRateNote}: ${tipos || '—'}.`, {
    size: 7.6,
    color: [0.4, 0.4, 0.4]
  });

  b.finalizeFooters();
  return await doc.save();
}
