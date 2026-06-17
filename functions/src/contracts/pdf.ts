/**
 * PDF generation for the rental contract.
 *
 * Layout (4 A4 pages):
 *   1. Cover + Front-page SUMMARY ("Lo principal a tener en cuenta")
 *      — 9 big-font bullet points, boxed, no legalese.
 *   2. DATOS DE LA OPERACIÓN — parties, vehicle, period, pricing,
 *      deposit, inspection.
 *   3. CLÁUSULAS — 14 numbered legal clauses in detail.
 *   4. FIRMAS — acknowledgement, signature blocks (lessor + renter),
 *      footer notes.
 *
 * The signed variant embeds the signature PNG and timestamp on page 4.
 *
 * Style notes:
 *   - Brand color: deep teal-green (Velto Rent).
 *   - Headings: 12-14pt bold caps.
 *   - Body: 9.5-10pt regular.
 *   - Tight margins (50pt) for ~12% more text per page.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
// @ts-ignore — the @types/fontkit default export is a namespace, not a
// callable object, but pdf-lib accepts the runtime value as a fontkit.
import fontkit from 'fontkit';
import * as fs from 'fs';
import * as path from 'path';
import * as functions from 'firebase-functions';
import type {
  ContractClauses,
  ContractClauseBundle,
  ContractLocale
} from './contract-types';

const BRAND = rgb(0.10, 0.42, 0.32); // Velto deep teal
const BRAND_DARK = rgb(0.06, 0.28, 0.21);
const MUTED = rgb(0.45, 0.45, 0.45);
const LIGHT_GREY = rgb(0.92, 0.92, 0.92);
const BOX_BORDER = rgb(0.80, 0.80, 0.80);

/**
 * Resolve a TTF file path next to this compiled module. Tries:
 *   1. Same dir as pdf.js (e.g. lib/contracts/DejaVuSans.ttf)
 *   2. ../src/contracts/ relative to pdf.js (dev mode, tsc output side-by-side)
 *   3. process.cwd()/src/contracts/ (legacy fallback)
 */
function resolveFontPath(filename: string): string {
  const candidates: string[] = [
    path.join(__dirname, filename),
    path.join(__dirname, '..', 'src', 'contracts', filename),
    path.join(process.cwd(), 'src', 'contracts', filename),
    path.join(process.cwd(), 'functions', 'src', 'contracts', filename)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Cannot locate TTF font ${filename}. Searched: ${candidates.join(', ')}`
  );
}

export interface ContractPdfInput {
  contractNumber?: string;
  company: {
    legalName: string;
    taxId: string;
    registry?: string;
    address: string;
    phone?: string;
    email: string;
    website?: string;
    insurancePolicy?: string;
    representativeName?: string;
    representativeNie?: string;
  };
  client: {
    fullName: string;
    documentType?: string;
    documentNumber?: string;
    phone?: string;
    email?: string;
    address?: string;
    drivingLicenseNumber?: string;
  };
  vehicle: {
    brand: string;
    model: string;
    version?: string;
    plateNumber: string;
    year?: number;
    fuelType?: string;
    transmission?: string;
  };
  reservation: {
    pickupDateTime?: Date;
    returnDateTime?: Date;
    totalDays?: number;
    pickupLocation?: string;
    returnLocation?: string;
    finalPrice?: number;
    depositAmount?: number;
  };
  inspection?: {
    pickupKm?: number;
    pickupFuelLevel?: string;
    returnKm?: number;
    returnFuelLevel?: string;
  };
  payment?: {
    rentalTotal?: number;
    depositRequired?: number;
    depositPaid?: number;
    totalPaid?: number;
  };
  /** Multilingual clauses, picked by locale. */
  clauses: ContractClauses;
  /** Preferred contract body locale. Falls back to clauses.defaultLocale. */
  preferredLocale?: ContractLocale;
  generatedAt?: Date;
  signaturePng?: Uint8Array | null;
  signedAt?: Date;
  signerName?: string;
}

const FUEL_LABELS_ES: Record<string, string> = {
  empty: 'Vacío',
  quarter: '1/4',
  half: '1/2',
  three_quarters: '3/4',
  full: 'Lleno'
};

const FUEL_LABELS_EN: Record<string, string> = {
  empty: 'Empty',
  quarter: '1/4',
  half: '1/2',
  three_quarters: '3/4',
  full: 'Full'
};

function pickBundle(
  input: ContractPdfInput
): { locale: ContractLocale; bundle: ContractClauseBundle; fuelLabels: Record<string, string> } {
  const order: ContractLocale[] = ['es', 'en', 'ro'];
  const pref = input.preferredLocale;
  if (pref && input.clauses.t[pref]) {
    return {
      locale: pref,
      bundle: input.clauses.t[pref]!,
      fuelLabels: pref === 'en' ? FUEL_LABELS_EN : FUEL_LABELS_ES
    };
  }
  for (const loc of order) {
    if (input.clauses.t[loc]) {
      return {
        locale: loc,
        bundle: input.clauses.t[loc]!,
        fuelLabels: loc === 'en' ? FUEL_LABELS_EN : FUEL_LABELS_ES
      };
    }
  }
  // Last resort: cast as es. Should never happen because CONTRACT_CLAUSES
  // always provides es.
  return {
    locale: 'es',
    bundle: input.clauses.t.es!,
    fuelLabels: FUEL_LABELS_ES
  };
}

function formatDate(d?: Date, locale: ContractLocale = 'es'): string {
  if (!d) return '—';
  try {
    const tag = locale === 'en' ? 'en-GB' : locale === 'ro' ? 'ro-RO' : 'es-ES';
    return d.toLocaleString(tag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

function formatMoney(n?: number, locale: ContractLocale = 'es'): string {
  if (n === undefined || n === null) return '—';
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : locale === 'ro' ? 'ro-RO' : 'es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n) + ' €';
  } catch {
    return `${n.toFixed(2)} €`;
  }
}

class PdfBuilder {
  private page!: PDFPage;
  y = 0;
  private font!: PDFFont;
  private bold!: PDFFont;
  private italic!: PDFFont;
  private doc: PDFDocument;
  private margin = 50;
  private pageWidth = 595.28; // A4
  private pageHeight = 841.89;
  /** Current page number (1-based) for the footer. */
  private pageNumber = 1;
  /** Total pages, set after document is fully built. */
  private totalPages = 1;
  private contractNumber = '';
  /** Per-page header band (drawn on pages 2+). */
  private headerLabel = '';

  constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  async init(headerLabel: string, contractNumber: string): Promise<void> {
    // We embed DejaVu Sans (TTF) for Romanian diacritics. If the font files
    // are missing (e.g. local dev where copy-fonts didn't run), fall back
    // to standard Helvetica which covers Latin-1.
    try {
      this.doc.registerFontkit(fontkit);
      const regular = fs.readFileSync(resolveFontPath('DejaVuSans.ttf'));
      const bold = fs.readFileSync(resolveFontPath('DejaVuSans-Bold.ttf'));
      const italic = fs.readFileSync(resolveFontPath('DejaVuSans-Oblique.ttf'));
      this.font = await this.doc.embedFont(regular);
      this.bold = await this.doc.embedFont(bold);
      this.italic = await this.doc.embedFont(italic);
      functions.logger.info('Embedded DejaVu Sans for multilingual support');
    } catch (err) {
      functions.logger.warn(
        'Falling back to Helvetica (Latin-1 only — Romanian chars will fail): ' +
          (err as Error).message
      );
      this.font = await this.doc.embedFont(StandardFonts.Helvetica);
      this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
      this.italic = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    }
    this.headerLabel = headerLabel;
    this.contractNumber = contractNumber;
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([this.pageWidth, this.pageHeight]);
    this.pageNumber = this.doc.getPageCount();
    this.y = this.pageHeight - this.margin;
    this.drawHeader();
  }

  /** Draw the small header band at the top of every page (page 2+). */
  private drawHeader(): void {
    if (this.pageNumber === 1) return;
    this.page.drawLine({
      start: { x: this.margin, y: this.pageHeight - this.margin + 6 },
      end: { x: this.pageWidth - this.margin, y: this.pageHeight - this.margin + 6 },
      thickness: 0.4,
      color: LIGHT_GREY
    });
    this.page.drawText(this.headerLabel, {
      x: this.margin,
      y: this.pageHeight - this.margin + 12,
      size: 7,
      font: this.font,
      color: MUTED
    });
    if (this.contractNumber) {
      const w = this.font.widthOfTextAtSize(this.contractNumber, 7);
      this.page.drawText(this.contractNumber, {
        x: this.pageWidth - this.margin - w,
        y: this.pageHeight - this.margin + 12,
        size: 7,
        font: this.font,
        color: MUTED
      });
    }
    this.y -= 8;
  }

  /** Draw the page footer with page number. */
  private drawFooter(): void {
    const txt = `${this.pageNumber} / ${this.totalPages}`;
    const w = this.font.widthOfTextAtSize(txt, 7);
    this.page.drawText(txt, {
      x: this.pageWidth - this.margin - w,
      y: this.margin - 14,
      size: 7,
      font: this.font,
      color: MUTED
    });
  }

  /** Stamp page numbers on every page. Call this after building everything. */
  finalizeFooters(): void {
    this.totalPages = this.doc.getPageCount();
    for (let i = 0; i < this.totalPages; i++) {
      const page = this.doc.getPage(i);
      this.page = page;
      this.pageNumber = i + 1;
      this.drawFooter();
    }
  }

  private ensureSpace(h: number): void {
    if (this.y - h < this.margin + 10) this.newPage();
  }

  text(
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      italic?: boolean;
      color?: [number, number, number];
      gap?: number;
      align?: 'left' | 'center' | 'right';
      maxWidth?: number;
    } = {}
  ): void {
    const size = opts.size ?? 10;
    const font = opts.bold
      ? this.bold
      : opts.italic
      ? this.italic
      : this.font;
    const color = opts.color
      ? rgb(opts.color[0], opts.color[1], opts.color[2])
      : rgb(0, 0, 0);
    const lines = this.wrap(s, size, font, opts.maxWidth);
    const lineHeight = size * 1.4;
    for (const ln of lines) {
      this.ensureSpace(lineHeight);
      let x = this.margin;
      if (opts.align === 'center') {
        const w = font.widthOfTextAtSize(ln, size);
        x = (this.pageWidth - w) / 2;
      } else if (opts.align === 'right') {
        const w = font.widthOfTextAtSize(ln, size);
        x = this.pageWidth - this.margin - w;
      }
      this.page.drawText(ln, { x, y: this.y - size, size, font, color });
      this.y -= lineHeight;
    }
    if (opts.gap) this.y -= opts.gap;
  }

  private wrap(s: string, size: number, font: PDFFont, maxWidth?: number): string[] {
    const limit = maxWidth ?? this.pageWidth - this.margin * 2;
    const words = s.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      const width = font.widthOfTextAtSize(test, size);
      if (width > limit) {
        if (line) lines.push(line);
        if (font.widthOfTextAtSize(w, size) > limit) {
          let buf = '';
          for (const ch of w) {
            if (font.widthOfTextAtSize(buf + ch, size) > limit) {
              if (buf) lines.push(buf);
              buf = ch;
            } else {
              buf += ch;
            }
          }
          line = buf;
        } else {
          line = w;
        }
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  separator(thickness = 0.5): void {
    this.y -= 4;
    this.ensureSpace(8);
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.pageWidth - this.margin, y: this.y },
      thickness,
      color: thickness >= 1 ? BRAND : LIGHT_GREY
    });
    this.y -= 8;
  }

  /** Big section title (all caps, brand color). */
  section(title: string, opts: { numbered?: number } = {}): void {
    this.y -= 6;
    const label = opts.numbered !== undefined
      ? `${opts.numbered}. ${title.toUpperCase()}`
      : title.toUpperCase();
    this.text(label, { size: 11, bold: true, color: [0.1, 0.42, 0.32], gap: 3 });
  }

  /** Sub-section title (smaller). */
  subsection(title: string): void {
    this.y -= 4;
    this.text(title, { size: 10, bold: true, color: [0.1, 0.42, 0.32], gap: 2 });
  }

  twoColumn(
    left: string,
    right: string,
    leftBold = false,
    rightBold = false
  ): void {
    const size = 9.5;
    const lf = leftBold ? this.bold : this.font;
    const rf = rightBold ? this.bold : this.font;
    this.ensureSpace(size * 1.6);
    this.page.drawText(left, {
      x: this.margin,
      y: this.y - size,
      size,
      font: lf
    });
    const rightWidth = rf.widthOfTextAtSize(right, size);
    this.page.drawText(right, {
      x: this.pageWidth - this.margin - rightWidth,
      y: this.y - size,
      size,
      font: rf
    });
    this.y -= size * 1.6;
  }

  /** Two-column row where the right value can wrap to multiple lines. */
  twoColumnWrap(
    left: string,
    right: string,
    leftBold = false,
    rightWidth = 320
  ): void {
    const size = 9.5;
    const lf = leftBold ? this.bold : this.font;
    const lines = this.wrap(right, size, this.font, rightWidth);
    const lineHeight = size * 1.5;
    this.ensureSpace(lineHeight * Math.max(1, lines.length) + 2);
    this.page.drawText(left, {
      x: this.margin,
      y: this.y - size,
      size,
      font: lf
    });
    let cy = this.y - size;
    for (const ln of lines) {
      this.page.drawText(ln, {
        x: this.pageWidth - this.margin - this.font.widthOfTextAtSize(ln, size),
        y: cy,
        size,
        font: this.font
      });
      cy -= lineHeight;
    }
    this.y -= lineHeight * Math.max(1, lines.length) + 2;
  }

  /** Render a highlight box (numbered, big-font, bordered). */
  highlightBox(index: number, text: string): void {
    const size = 11.5;
    const padX = 8;
    const padY = 8;
    const numW = 28;
    const lineHeight = size * 1.35;
    const lines = this.wrap(
      text,
      size,
      this.font,
      this.pageWidth - this.margin * 2 - numW - padX * 3
    );
    const boxH = padY * 2 + lineHeight * lines.length;
    this.ensureSpace(boxH + 4);

    // Background
    this.page.drawRectangle({
      x: this.margin,
      y: this.y - boxH,
      width: this.pageWidth - this.margin * 2,
      height: boxH,
      color: rgb(0.97, 0.99, 0.98),
      borderColor: BOX_BORDER,
      borderWidth: 0.5
    });

    // Number badge
    const badgeSize = 18;
    const badgeX = this.margin + padX;
    const badgeY = this.y - padY - badgeSize;
    this.page.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeSize,
      height: badgeSize,
      color: BRAND
    });
    const numStr = String(index);
    const numTextWidth = this.bold.widthOfTextAtSize(numStr, 12);
    this.page.drawText(numStr, {
      x: badgeX + (badgeSize - numTextWidth) / 2,
      y: badgeY + 3,
      size: 12,
      font: this.bold,
      color: rgb(1, 1, 1)
    });

    // Body text
    let tx = badgeX + badgeSize + padX;
    let ty = this.y - padY - size;
    for (const ln of lines) {
      this.page.drawText(ln, { x: tx, y: ty, size, font: this.font, color: rgb(0.1, 0.1, 0.1) });
      ty -= lineHeight;
    }

    this.y -= boxH + 4;
  }

  /** Clause block: bold title + paragraph body. */
  clause(clauseNumber: number, title: string, paragraphs: string[]): void {
    const size = 10;
    const titleSize = 10.5;
    const lineHeight = size * 1.45;
    // Title — strip any existing "N. " prefix from the schema-stored title
    // (we render the number ourselves), and uppercase for the legal style.
    const cleaned = title.replace(/^\d+\.\s*/, '').toUpperCase();
    const titleStr = `${clauseNumber}. ${cleaned}`;
    this.ensureSpace(titleSize * 1.6);
    this.text(titleStr, { size: titleSize, bold: true, color: [0.1, 0.42, 0.32], gap: 2 });
    // Body
    for (const para of paragraphs) {
      const lines = this.wrap(para, size, this.font, this.pageWidth - this.margin * 2);
      const h = lineHeight * lines.length;
      this.ensureSpace(h + 2);
      for (const ln of lines) {
        this.page.drawText(ln, {
          x: this.margin,
          y: this.y - size,
          size,
          font: this.font
        });
        this.y -= lineHeight;
      }
      this.y += 2;
    }
    this.y += 2;
  }

  /** Render an empty signature block with a line. */
  signatureBlock(
    role: string,
    name: string,
    identifier: string,
    png: any | null,
    pngW?: number,
    pngH?: number
  ): void {
    const boxWidth = (this.pageWidth - this.margin * 2 - 30) / 2;
    const startX = this.margin;
    this.y -= 6;
    this.ensureSpace(80);
    const boxY = this.y;
    const boxH = 90;
    // Frame
    this.page.drawRectangle({
      x: startX,
      y: boxY - boxH,
      width: boxWidth,
      height: boxH,
      borderColor: BOX_BORDER,
      borderWidth: 0.5
    });
    if (png) {
      const maxW = boxWidth - 20;
      const maxH = 50;
      const ratio = Math.min(maxW / pngW!, maxH / pngH!);
      const w = pngW! * ratio;
      const h = pngH! * ratio;
      this.page.drawImage(png, {
        x: startX + (boxWidth - w) / 2,
        y: boxY - 12 - h,
        width: w,
        height: h
      });
    } else {
      // Signature line
      this.page.drawLine({
        start: { x: startX + 12, y: boxY - 50 },
        end: { x: startX + boxWidth - 12, y: boxY - 50 },
        thickness: 0.6,
        color: rgb(0.3, 0.3, 0.3)
      });
      this.page.drawText('Firma / Signature / Semnătura', {
        x: startX + 12,
        y: boxY - 60,
        size: 7,
        font: this.italic,
        color: MUTED
      });
    }
    // Role + name + id (below the box)
    this.text(role, { size: 9, bold: true, gap: 0 });
    this.text(name, { size: 9, gap: 0 });
    if (identifier) this.text(identifier, { size: 8, color: [0.4, 0.4, 0.4] });
  }

  /**
   * Render the two-column signature blocks (lessor + renter) on the same
   * page row, with role+name+id captions under each.
   *
   * If `renterPng` is provided, it is embedded in the renter block;
   * otherwise a blank signature line is drawn.
   */
  signatureBlocks(opts: {
    lessorRole: string;
    lessorName: string;
    lessorId: string;
    renterRole: string;
    renterName: string;
    renterId: string;
    renterPng?: { img: any; w: number; h: number } | null;
    boxHeight?: number;
  }): void {
    const boxH = opts.boxHeight ?? 90;
    const innerW = this.pageWidth - this.margin * 2 - 30;
    const colW = innerW / 2;
    this.y -= 6;
    this.ensureSpace(boxH + 60);
    const topY = this.y;
    const leftX = this.margin;
    const rightX = this.margin + colW + 30;

    // Boxes
    this.page.drawRectangle({
      x: leftX,
      y: topY - boxH,
      width: colW,
      height: boxH,
      borderColor: BOX_BORDER,
      borderWidth: 0.5
    });
    this.page.drawRectangle({
      x: rightX,
      y: topY - boxH,
      width: colW,
      height: boxH,
      borderColor: BOX_BORDER,
      borderWidth: 0.5
    });

    // Lessor block: empty signature line (we sign via sello / already-signed company)
    this.page.drawLine({
      start: { x: leftX + 12, y: topY - 50 },
      end: { x: leftX + colW - 12, y: topY - 50 },
      thickness: 0.6,
      color: rgb(0.3, 0.3, 0.3)
    });
    this.page.drawText('Firma / Signature / Semnătura', {
      x: leftX + 12,
      y: topY - 60,
      size: 7,
      font: this.italic,
      color: MUTED
    });

    // Renter block: signature image if provided, else empty line
    if (opts.renterPng) {
      const { img, w, h } = opts.renterPng;
      const maxW = colW - 20;
      const maxH = 50;
      const ratio = Math.min(maxW / w, maxH / h);
      const dw = w * ratio;
      const dh = h * ratio;
      this.page.drawImage(img, {
        x: rightX + (colW - dw) / 2,
        y: topY - 12 - dh,
        width: dw,
        height: dh
      });
    } else {
      this.page.drawLine({
        start: { x: rightX + 12, y: topY - 50 },
        end: { x: rightX + colW - 12, y: topY - 50 },
        thickness: 0.6,
        color: rgb(0.3, 0.3, 0.3)
      });
      this.page.drawText('Firma / Signature / Semnătura', {
        x: rightX + 12,
        y: topY - 60,
        size: 7,
        font: this.italic,
        color: MUTED
      });
    }
    this.y -= boxH + 4;

    // Role captions
    this.page.drawText(opts.lessorRole, {
      x: leftX,
      y: this.y - 10,
      size: 9,
      font: this.bold
    });
    this.page.drawText(opts.renterRole, {
      x: rightX,
      y: this.y - 10,
      size: 9,
      font: this.bold
    });
    this.y -= 14;
    // Names
    this.page.drawText(opts.lessorName, {
      x: leftX,
      y: this.y - 9,
      size: 9,
      font: this.font
    });
    this.page.drawText(opts.renterName, {
      x: rightX,
      y: this.y - 9,
      size: 9,
      font: this.font
    });
    this.y -= 12;
    if (opts.lessorId) {
      this.page.drawText(opts.lessorId, {
        x: leftX,
        y: this.y - 8,
        size: 8,
        font: this.font,
        color: MUTED
      });
    }
    if (opts.renterId) {
      this.page.drawText(opts.renterId, {
        x: rightX,
        y: this.y - 8,
        size: 8,
        font: this.font,
        color: MUTED
      });
    }
    this.y -= 12;
  }

  skip(dy: number): void {
    this.y -= dy;
  }
}

/**
 * Build the unsigned or signed contract PDF.
 */
export async function buildContractPdf(
  input: ContractPdfInput,
  signed: boolean
): Promise<Uint8Array> {
  const { locale, bundle, fuelLabels } = pickBundle(input);
  const loc = locale;

  // Localised section labels
  const L = {
    headerLabel:
      loc === 'en' ? 'RENTAL AGREEMENT WITHOUT DRIVER' : loc === 'ro' ? 'CONTRACT DE ÎNCHIRIERE FĂRĂ ȘOFER' : 'CONTRATO DE ALQUILER DE VEHÍCULO SIN CONDUCTOR',
    pageSummary:
      loc === 'en' ? 'Summary — what you need to know' : loc === 'ro' ? 'Rezumat — ce trebuie să știți' : 'Resumen — Lo principal a tener en cuenta',
    partiesHeader:
      loc === 'en' ? 'PARTIES' : loc === 'ro' ? 'PĂRȚI' : 'REUNIDOS',
    company: loc === 'en' ? 'Lessor (Company)' : loc === 'ro' ? 'Locator (Societate)' : 'Arrendador (Sociedad)',
    renter: loc === 'en' ? 'Lessee (Renter)' : loc === 'ro' ? 'Locatar' : 'Arrendatario',
    taxId: loc === 'en' ? 'Tax ID' : loc === 'ro' ? 'CIF' : 'NIF/CIF',
    registry: loc === 'en' ? 'Registry data' : loc === 'ro' ? 'Date Registrul Comerțului' : 'Datos registrales',
    address: loc === 'en' ? 'Address' : loc === 'ro' ? 'Adresă' : 'Domicilio',
    phone: loc === 'en' ? 'Phone' : loc === 'ro' ? 'Telefon' : 'Teléfono',
    email: loc === 'en' ? 'Email' : loc === 'ro' ? 'Email' : 'Email',
    website: loc === 'en' ? 'Website' : loc === 'ro' ? 'Website' : 'Web',
    insurance: loc === 'en' ? 'Insurance policy' : loc === 'ro' ? 'Poliță de asigurare' : 'Póliza de seguro',
    clientData: loc === 'en' ? 'Lessee data' : loc === 'ro' ? 'Datele locatarului' : 'Datos del arrendatario',
    fullName: loc === 'en' ? 'Full name' : loc === 'ro' ? 'Nume și prenume' : 'Nombre y apellidos',
    legalName: loc === 'en' ? 'Legal name' : loc === 'ro' ? 'Denumire socială' : 'Razón social',
    document: loc === 'en' ? 'ID document' : loc === 'ro' ? 'Document de identitate' : 'Documento de identidad',
    drivingLic: loc === 'en' ? 'Driving licence' : loc === 'ro' ? 'Permis de conducere' : 'Carnet de conducir',
    vehData: loc === 'en' ? 'Vehicle data' : loc === 'ro' ? 'Datele vehiculului' : 'Datos del vehículo',
    vehicle: loc === 'en' ? 'Vehicle' : loc === 'ro' ? 'Vehicul' : 'Vehículo',
    plate: loc === 'en' ? 'Plate' : loc === 'ro' ? 'Număr de înmatriculare' : 'Matrícula',
    resData: loc === 'en' ? 'Reservation data' : loc === 'ro' ? 'Datele rezervării' : 'Datos de la reserva',
    pickup: loc === 'en' ? 'Pickup date & time' : loc === 'ro' ? 'Data și ora predării' : 'Fecha y hora de entrega',
    ret: loc === 'en' ? 'Return date & time' : loc === 'ro' ? 'Data și ora returnării' : 'Fecha y hora de devolución',
    days: loc === 'en' ? 'Duration' : loc === 'ro' ? 'Durată' : 'Duración',
    pickupLoc: loc === 'en' ? 'Pickup location' : loc === 'ro' ? 'Locul predării' : 'Lugar de entrega',
    retLoc: loc === 'en' ? 'Return location' : loc === 'ro' ? 'Locul returnării' : 'Lugar de devolución',
    priceDeposit: loc === 'en' ? 'Price and deposit' : loc === 'ro' ? 'Preț și garanție' : 'Precio y fianza',
    rentalAmt: loc === 'en' ? 'Rental amount' : loc === 'ro' ? 'Suma închiriere' : 'Importe alquiler',
    deposit: loc === 'en' ? 'Security deposit' : loc === 'ro' ? 'Garanție (fianță)' : 'Fianza',
    vehState: loc === 'en' ? 'Vehicle condition' : loc === 'ro' ? 'Starea vehiculului' : 'Estado del vehículo',
    kmPickup: loc === 'en' ? 'Pickup km' : loc === 'ro' ? 'Km la predare' : 'Km salida',
    kmReturn: loc === 'en' ? 'Return km' : loc === 'ro' ? 'Km la returnare' : 'Km devolución',
    fuelPickup: loc === 'en' ? 'Pickup fuel' : loc === 'ro' ? 'Combustibil predare' : 'Combustible salida',
    fuelReturn: loc === 'en' ? 'Return fuel' : loc === 'ro' ? 'Combustibil returnare' : 'Combustible devolución',
    clausesHeader:
      loc === 'en' ? 'General and particular conditions' : loc === 'ro' ? 'Condiții generale și particulare' : 'Condiciones generales y particulares',
    sigHeader:
      loc === 'en' ? 'Acceptance and signatures' : loc === 'ro' ? 'Acceptare și semnături' : 'Aceptación y firmas',
    acknowledgement: bundle.acknowledgement,
    signedOn: loc === 'en' ? 'Signed on' : loc === 'ro' ? 'Semnat la' : 'Firmado el',
    by: loc === 'en' ? 'by' : loc === 'ro' ? 'de' : 'por',
    contractNum: loc === 'en' ? 'Contract no.' : loc === 'ro' ? 'Nr. contract' : 'Nº de contrato',
    generatedOn: loc === 'en' ? 'Generated' : loc === 'ro' ? 'Generat' : 'Generado',
    signedAtLabel: loc === 'en' ? 'Signed' : loc === 'ro' ? 'Semnat' : 'Firmado',
    docType: loc === 'en' ? 'Passport / ID' : loc === 'ro' ? 'Pașaport / CI' : 'DNI / NIE / Pasaporte',
    year: loc === 'en' ? 'Year' : loc === 'ro' ? 'An fabricație' : 'Año',
    fuel: loc === 'en' ? 'Fuel' : loc === 'ro' ? 'Combustibil' : 'Combustible',
    transmission: loc === 'en' ? 'Transmission' : loc === 'ro' ? 'Transmisie' : 'Transmisión',
    lessorDetails:
      loc === 'en'
        ? 'Company details (lessor):'
        : loc === 'ro'
        ? 'Datele locatorului:'
        : 'Datos del arrendador (Sociedad):'
  };

  const doc = await PDFDocument.create();
  doc.setTitle(`${input.company.legalName} — ${L.headerLabel} ${input.contractNumber || ''}`.trim());
  doc.setAuthor(input.company.legalName);
  doc.setSubject(`${L.headerLabel} — ${input.contractNumber || ''}`);
  doc.setCreator('Velto Rent');
  doc.setProducer('Velto Rent · pdf-lib');

  const b = new PdfBuilder(doc);
  await b.init(L.headerLabel, input.contractNumber || '');

  // -------------------------------------------------------------------------
  // PAGE 1 — COVER + FRONT-PAGE SUMMARY
  // -------------------------------------------------------------------------
  // Brand block
  b.text(input.company.legalName, {
    size: 22,
    bold: true,
    color: [0.1, 0.42, 0.32],
    gap: 2
  });
  b.text(L.headerLabel, { size: 13, bold: true, color: [0.1, 0.1, 0.1], gap: 4 });
  b.separator();
  // Contract meta
  if (input.contractNumber) {
    b.twoColumn(L.contractNum + ':', input.contractNumber, true, true);
  }
  b.twoColumn(L.generatedOn + ':', formatDate(input.generatedAt, loc));
  if (signed && input.signedAt) {
    b.twoColumn(L.signedAtLabel + ':', formatDate(input.signedAt, loc));
  }
  b.y -= 8;

  // Section: front-page summary
  b.section(L.pageSummary);
  const hlIntro =
    loc === 'en'
      ? 'The following are the most important conditions of this contract. Read them carefully. The full clauses are detailed on the following pages.'
      : loc === 'ro'
      ? 'În continuare sunt cele mai importante condiții ale acestui contract. Citiți-le cu atenție. Clauzele complete sunt detaliate în paginile următoare.'
      : 'A continuación se detallan las condiciones más importantes de este contrato. Léalas con atención. Las cláusulas completas se detallan en las páginas siguientes.';
  b.text(hlIntro, { size: 9.5, italic: true, color: [0.3, 0.3, 0.3], gap: 6 });

  // Highlight boxes
  bundle.highlights.forEach((line, i) => {
    b.highlightBox(i + 1, line);
  });

  b.y -= 4;
  b.separator();
  b.text(L.lessorDetails, { size: 9, bold: true });
  b.twoColumn(L.company + ':', input.company.legalName, false, true);
  b.twoColumn(L.taxId + ':', input.company.taxId);
  if (input.company.registry) b.twoColumnWrap(L.registry + ':', input.company.registry);
  b.twoColumnWrap(L.address + ':', input.company.address);
  if (input.company.phone) b.twoColumn(L.phone + ':', input.company.phone);
  b.twoColumn(L.email + ':', input.company.email);
  if (input.company.website) b.twoColumn(L.website + ':', input.company.website);
  if (input.company.insurancePolicy) {
    b.twoColumnWrap(L.insurance + ':', input.company.insurancePolicy);
  }

  // -------------------------------------------------------------------------
  // PAGE 2 — DATOS DE LA OPERACIÓN
  // -------------------------------------------------------------------------
  b.newPage();
  b.section(L.partiesHeader);
  // Lessor (Company) block
  b.subsection(L.company);
  b.twoColumn(L.legalName + ':', input.company.legalName, false, true);
  b.twoColumn(L.taxId + ':', input.company.taxId);
  if (input.company.registry) b.twoColumn(L.registry + ':', input.company.registry);
  b.twoColumnWrap(L.address + ':', input.company.address);
  if (input.company.phone) b.twoColumn(L.phone + ':', input.company.phone);
  b.twoColumn(L.email + ':', input.company.email);
  if (input.company.representativeName) {
    b.twoColumn(
      loc === 'en' ? 'Represented by' : loc === 'ro' ? 'Reprezentată de' : 'Representada por',
      `${input.company.representativeName}${input.company.representativeNie ? ' · ' + input.company.representativeNie : ''}`,
      false,
      true
    );
  }
  b.y -= 2;
  // Lessee (Renter) block
  b.subsection(L.renter);
  b.twoColumn(L.fullName + ':', input.client.fullName, true, true);
  if (input.client.documentType || input.client.documentNumber) {
    b.twoColumn(
      L.document + ':',
      `${input.client.documentType || ''} ${input.client.documentNumber || ''}`.trim(),
      false,
      true
    );
  }
  if (input.client.drivingLicenseNumber) {
    b.twoColumn(L.drivingLic + ':', input.client.drivingLicenseNumber, false, true);
  }
  if (input.client.phone) b.twoColumn(L.phone + ':', input.client.phone);
  if (input.client.email) b.twoColumn(L.email + ':', input.client.email);
  if (input.client.address) b.twoColumnWrap(L.address + ':', input.client.address);

  // Vehicle
  b.section(L.vehData);
  b.twoColumn(
    L.vehicle + ':',
    `${input.vehicle.brand} ${input.vehicle.model}${input.vehicle.version ? ' ' + input.vehicle.version : ''}`,
    true,
    true
  );
  b.twoColumn(L.plate + ':', input.vehicle.plateNumber, false, true);
  if (input.vehicle.year) b.twoColumn(L.year + ':', String(input.vehicle.year));
  if (input.vehicle.fuelType) b.twoColumn(L.fuel + ':', input.vehicle.fuelType);
  if (input.vehicle.transmission) b.twoColumn(L.transmission + ':', input.vehicle.transmission);

  // Reservation
  b.section(L.resData);
  b.twoColumn(L.pickup + ':', formatDate(input.reservation.pickupDateTime, loc), true, true);
  b.twoColumn(L.ret + ':', formatDate(input.reservation.returnDateTime, loc), true, true);
  if (input.reservation.totalDays) {
    b.twoColumn(
      L.days + ':',
      `${input.reservation.totalDays} ${loc === 'en' ? 'day(s)' : loc === 'ro' ? 'zi(le)' : 'día(s)'}`,
      false,
      true
    );
  }
  if (input.reservation.pickupLocation) {
    b.twoColumnWrap(L.pickupLoc + ':', input.reservation.pickupLocation);
  }
  if (input.reservation.returnLocation) {
    b.twoColumnWrap(L.retLoc + ':', input.reservation.returnLocation);
  }

  // Price and deposit
  b.section(L.priceDeposit);
  b.twoColumn(L.rentalAmt + ':', formatMoney(input.reservation.finalPrice, loc), true, true);
  b.twoColumn(L.deposit + ':', formatMoney(input.reservation.depositAmount, loc), true, true);

  // Vehicle condition
  if (input.inspection) {
    b.section(L.vehState);
    if (input.inspection.pickupKm !== undefined) {
      b.twoColumn(L.kmPickup + ':', String(input.inspection.pickupKm));
    }
    if (input.inspection.pickupFuelLevel) {
      b.twoColumn(
        L.fuelPickup + ':',
        fuelLabels[input.inspection.pickupFuelLevel] || input.inspection.pickupFuelLevel
      );
    }
    if (input.inspection.returnKm !== undefined) {
      b.twoColumn(L.kmReturn + ':', String(input.inspection.returnKm));
    }
    if (input.inspection.returnFuelLevel) {
      b.twoColumn(
        L.fuelReturn + ':',
        fuelLabels[input.inspection.returnFuelLevel] || input.inspection.returnFuelLevel
      );
    }
  }

  // -------------------------------------------------------------------------
  // PAGE 3 — CLÁUSULAS
  // -------------------------------------------------------------------------
  b.newPage();
  b.section(L.clausesHeader);
  bundle.clauses.forEach((c, i) => {
    b.clause(i + 1, c.title, c.body);
  });

  // Footer notes (still on clauses page if space; otherwise new page)
  if (b.y < 200) b.newPage();
  b.y -= 4;
  b.subsection(
    loc === 'en' ? 'Final notes' : loc === 'ro' ? 'Note finale' : 'Notas finales'
  );
  for (const note of bundle.footerNotes) {
    b.text(note, { size: 8.5, color: [0.3, 0.3, 0.3], gap: 2 });
  }

  // -------------------------------------------------------------------------
  // PAGE 4 — FIRMAS
  // -------------------------------------------------------------------------
  b.newPage();
  b.section(L.sigHeader);
  b.text(L.acknowledgement, { size: 9.5, italic: true, color: [0.2, 0.2, 0.2], gap: 8 });

  // Prepare the signature image once
  let renterPng: { img: any; w: number; h: number } | null = null;
  if (signed && input.signaturePng) {
    try {
      const img = await doc.embedPng(input.signaturePng);
      renterPng = { img, w: img.width, h: img.height };
    } catch (err) {
      functions.logger.warn('Failed to embed signature image:', err);
      renterPng = null;
    }
  }

  const lessorId =
    `${L.taxId} ${input.company.taxId}` +
    (input.company.representativeName
      ? ` · ${input.company.representativeName}` +
        (input.company.representativeNie ? ` (${input.company.representativeNie})` : '')
      : '');
  const renterId = input.client.documentNumber
    ? `${L.docType} ${input.client.documentNumber}`
    : '';
  b.signatureBlocks({
    lessorRole: L.company,
    lessorName: input.company.legalName,
    lessorId,
    renterRole: L.renter,
    renterName: input.client.fullName,
    renterId,
    renterPng
  });

  if (signed && input.signedAt) {
    b.text(
      `${L.signedOn} ${formatDate(input.signedAt, loc)} ${L.by} ${
        input.signerName || input.client.fullName
      }`,
      { size: 9, italic: true, color: [0.3, 0.3, 0.3], gap: 6 }
    );
  }

  b.separator();
  // Final small print — document metadata
  b.text(
    `${input.company.legalName} · ${L.taxId} ${input.company.taxId} · ${input.company.address} · ${input.company.email}${
      input.company.phone ? ' · ' + input.company.phone : ''
    }`,
    { size: 7, color: [0.4, 0.4, 0.4] }
  );

  // Stamp page numbers
  b.finalizeFooters();

  return await doc.save();
}
