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
 * Style: see brand.ts. The reference is the invoice VELTO MOBILITY already
 * sends — Gotham headings, teal letter-spaced section labels, hairline rules,
 * grey legal footer — so the contract, the quote and the booking confirmation
 * all look like the same company wrote them.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, RGB } from 'pdf-lib';
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
import {
  BRAND,
  INK,
  BODY,
  MUTED,
  RULE,
  TINT,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  FOOTER_RESERVE,
  FONT_FILES,
  loadLogo,
  readAsset,
  type Logo
} from './brand';

const BOX_BORDER = rgb(0.8, 0.8, 0.8);

/** Which family a run of text belongs to. */
export type FontRole = 'body' | 'bodyBold' | 'bodyItalic' | 'display' | 'displayMedium';

/** One line inside an `infoColumns` block. */
export interface InfoEntry {
  label?: string;
  value: string;
  /** Render as a feature line (larger, brand colour) instead of label + value. */
  strong?: boolean;
}

/** A drawn text run, kept so the overlap check can inspect the layout. */
export interface TextBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** The font it was set in, for the missing-glyph check. */
  font?: PDFFont;
  /** Running head / footer, which live outside the body area by design. */
  isChrome?: boolean;
}

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
    /** VAT-INCLUSIVE total of the rental. */
    finalPrice?: number;
    depositAmount?: number;
    /** Tariff before any discount. Only printed when a discount moved it. */
    tariffPrice?: number;
    /** Loyalty percentage frozen on the reservation (5 = 5 %). */
    loyaltyDiscountPercent?: number;
    /** Money taken off by the loyalty discount. Negative. */
    loyaltyDiscount?: number;
    /** Signed difference agreed by hand, on top of the loyalty discount. */
    manualAdjustment?: number;
    /** VAT rate frozen on the reservation, as a FRACTION (0.21 = 21 %). */
    vatRate?: number;
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
  /**
   * Diagnostics seam: called with the builder once the document is laid out,
   * so a test can check where every run of text ended up. Never set in
   * production code.
   */
  onLayout?: (builder: PdfBuilder) => void;
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

/**
 * Timezone the rental operates in.
 *
 * Cloud Functions run with TZ=UTC, so formatting without an explicit zone
 * printed every contract two hours early in summer: a pickup booked for 12:00
 * appeared as 10:00 on the signed PDF. This is the legally binding document,
 * so the zone has to be pinned rather than inherited from the runtime.
 */
export const CONTRACT_TIME_ZONE = process.env.VELTO_TIME_ZONE || 'Europe/Madrid';

export function formatDate(d?: Date, locale: ContractLocale = 'es'): string {
  if (!d) return '—';
  try {
    const tag = locale === 'en' ? 'en-GB' : locale === 'ro' ? 'ro-RO' : 'es-ES';
    return d.toLocaleString(tag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: CONTRACT_TIME_ZONE
    });
  } catch {
    return '—';
  }
}

/** Same as `formatDate` but without the time — for validity dates. */
export function formatDayOnly(d?: Date, locale: ContractLocale = 'es'): string {
  if (!d) return '—';
  try {
    const tag = locale === 'en' ? 'en-GB' : locale === 'ro' ? 'ro-RO' : 'es-ES';
    return d.toLocaleDateString(tag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: CONTRACT_TIME_ZONE
    });
  } catch {
    return '—';
  }
}

/**
 * Spanish standard VAT rate, as a FRACTION (0.21 = 21 %).
 *
 * Mirrors `DEFAULT_VAT_RATE` in `src/app/shared/utils/pricing.util.ts`. The app
 * and the functions build under separate tsconfigs and cannot share a module,
 * so the constant and the arithmetic are duplicated here on purpose. If the
 * rate ever changes, both sides move — and old reservations keep theirs,
 * because the rate they were created with is frozen in their snapshot.
 */
const DEFAULT_VAT_RATE = 0.21;

/**
 * Split a VAT-INCLUSIVE amount into base and tax.
 *
 * `vat` is derived by subtraction so `base + vat === total` to the cent;
 * rounding both independently drifts, and a contract that does not add up is
 * the kind of detail a customer notices.
 *
 * A reservation created before VAT was recorded has no rate in its snapshot.
 * It falls back to the general rate, which is the one its price always
 * included — the field records the rate, it never changed it.
 */
export function extractVat(
  total?: number,
  rate?: number
): { base: number; vat: number; total: number; percent: number } {
  const safeTotal = typeof total === 'number' && isFinite(total) && total > 0 ? total : 0;
  const safeRate = typeof rate === 'number' && isFinite(rate) && rate >= 0 ? rate : DEFAULT_VAT_RATE;
  const round = (n: number) => Math.round(n * 100) / 100;

  const roundedTotal = round(safeTotal);
  const base = round(roundedTotal / (1 + safeRate));

  return {
    base,
    vat: round(roundedTotal - base),
    total: roundedTotal,
    percent: Math.round(safeRate * 100)
  };
}

export function formatMoney(n?: number, locale: ContractLocale = 'es'): string {
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

export class PdfBuilder {
  private page!: PDFPage;
  y = 0;
  private font!: PDFFont;
  private bold!: PDFFont;
  private italic!: PDFFont;
  /** Brand font. Headings only — it has no €, ă, ș or ț. */
  private display: PDFFont | null = null;
  private displayMedium: PDFFont | null = null;
  /** Code points each font can actually render, for the fallback check. */
  private coverage = new Map<PDFFont, (cp: number) => boolean>();
  private doc: PDFDocument;
  private margin = MARGIN;
  private pageWidth = PAGE_WIDTH;
  private pageHeight = PAGE_HEIGHT;
  /** Current page number (1-based) for the footer. */
  private pageNumber = 1;
  /** Total pages, set after document is fully built. */
  private totalPages = 1;
  private documentReference = '';
  /** Per-page running head (drawn on pages 2+). */
  private headerLabel = '';
  /** Two grey lines repeated at the foot of every page. */
  private legalFooterLines: string[] = [];
  private logo: Logo | null = null;

  /**
   * Every text run drawn, in page coordinates. `assertNoOverlaps()` reads this;
   * it is also what makes "check the text doesn't collide" a test rather than
   * an opinion.
   */
  readonly boxes: TextBox[] = [];

  constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  async init(
    headerLabel: string,
    documentReference: string,
    legalFooterLines: string[] = []
  ): Promise<void> {
    // DejaVu Sans is the body face: it is the only one here that covers the
    // Romanian diacritics AND the euro sign. If the files are missing (local
    // dev without copy-fonts) fall back to Helvetica, which is Latin-1 only.
    try {
      this.doc.registerFontkit(fontkit);
      const regular = fs.readFileSync(resolveFontPath(FONT_FILES.body));
      const bold = fs.readFileSync(resolveFontPath(FONT_FILES.bodyBold));
      const italic = fs.readFileSync(resolveFontPath(FONT_FILES.bodyItalic));
      this.font = await this.doc.embedFont(regular);
      this.bold = await this.doc.embedFont(bold);
      this.italic = await this.doc.embedFont(italic);
      this.registerCoverage(this.font, regular);
      this.registerCoverage(this.bold, bold);
      this.registerCoverage(this.italic, italic);
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

    // Gotham is optional: without it the documents still render, just in the
    // body face throughout.
    try {
      const displayBytes = readAsset(FONT_FILES.display);
      const mediumBytes = readAsset(FONT_FILES.displayMedium);
      if (displayBytes) {
        this.display = await this.doc.embedFont(displayBytes);
        this.registerCoverage(this.display, displayBytes);
      }
      if (mediumBytes) {
        this.displayMedium = await this.doc.embedFont(mediumBytes);
        this.registerCoverage(this.displayMedium, mediumBytes);
      }
    } catch (err) {
      functions.logger.warn('Gotham not embedded, headings use the body face: ' + (err as Error).message);
    }

    this.logo = loadLogo();
    this.headerLabel = headerLabel;
    this.documentReference = documentReference;
    this.legalFooterLines = legalFooterLines;
    this.newPage();
  }

  /**
   * Record which code points a font can render.
   *
   * pdf-lib happily draws a missing glyph as a blank box, so nothing throws
   * and nothing looks wrong until a Romanian contract or any price reaches a
   * customer. Asking fontkit up front is the only way to catch it.
   */
  private registerCoverage(pdfFont: PDFFont, bytes: Buffer): void {
    try {
      const parsed: any = (fontkit as any).create(bytes);
      this.coverage.set(pdfFont, (cp: number) => !!parsed.hasGlyphForCodePoint(cp));
    } catch {
      // Unknown coverage: assume complete rather than falling back needlessly.
      this.coverage.set(pdfFont, () => true);
    }
  }

  private covers(pdfFont: PDFFont, text: string): boolean {
    const test = this.coverage.get(pdfFont);
    if (!test) return true;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === undefined || cp === 0x20 || cp === 0x0a) continue;
      if (!test(cp)) return false;
    }
    return true;
  }

  /**
   * The font to set a given run in.
   *
   * Display roles degrade to the body face when Gotham cannot render the
   * string — a Romanian section label, or anything with an amount in it.
   */
  fontFor(role: FontRole, text: string): PDFFont {
    if (role === 'display' || role === 'displayMedium') {
      const wanted = role === 'display' ? this.display : this.displayMedium;
      if (wanted && this.covers(wanted, text)) return wanted;
      return this.bold;
    }
    if (role === 'bodyBold') return this.bold;
    if (role === 'bodyItalic') return this.italic;
    return this.font;
  }

  /**
   * The single place text reaches the page. Everything else routes through
   * here so `boxes` stays a complete record of the layout.
   */
  private put(
    text: string,
    x: number,
    baselineY: number,
    size: number,
    font: PDFFont,
    color: RGB
  ): void {
    if (!text) return;
    this.page.drawText(text, { x, y: baselineY, size, font, color });
    this.boxes.push({
      page: this.pageNumber,
      x,
      y: baselineY,
      width: font.widthOfTextAtSize(text, size),
      height: size,
      text,
      font,
      isChrome: this.drawingChrome
    });
  }

  /** True while the running head or the footer is being drawn. */
  private drawingChrome = false;

  newPage(): void {
    this.page = this.doc.addPage([this.pageWidth, this.pageHeight]);
    this.pageNumber = this.doc.getPageCount();
    this.y = this.pageHeight - this.margin;
    this.drawRunningHead();
  }

  /** Small running head repeated on pages 2+. */
  private drawRunningHead(): void {
    if (this.pageNumber === 1) return;
    this.drawingChrome = true;
    this.page.drawLine({
      start: { x: this.margin, y: this.pageHeight - this.margin + 6 },
      end: { x: this.pageWidth - this.margin, y: this.pageHeight - this.margin + 6 },
      thickness: 0.4,
      color: RULE
    });
    const headY = this.pageHeight - this.margin + 12;
    const label = this.headerLabel;
    const refFont = this.fontFor('display', this.documentReference);
    const refWidth = this.documentReference
      ? refFont.widthOfTextAtSize(this.documentReference, 7)
      : 0;
    // Clip the label so a long title never runs into the reference on the right.
    const labelMax = this.pageWidth - this.margin * 2 - refWidth - 12;
    this.put(
      this.truncate(label, this.fontFor('displayMedium', label), 7, labelMax),
      this.margin,
      headY,
      7,
      this.fontFor('displayMedium', label),
      MUTED
    );
    if (this.documentReference) {
      this.put(
        this.documentReference,
        this.pageWidth - this.margin - refWidth,
        headY,
        7,
        refFont,
        MUTED
      );
    }
    this.y -= 8;
    this.drawingChrome = false;
  }

  /**
   * Legal footer plus page number, on every page.
   *
   * The lines come from the company's registry data, exactly as they appear on
   * the invoice.
   */
  private drawFooter(): void {
    this.drawingChrome = true;
    const baseY = this.margin - 12;
    this.page.drawLine({
      start: { x: this.margin, y: this.margin - 4 },
      end: { x: this.pageWidth - this.margin, y: this.margin - 4 },
      thickness: 0.4,
      color: RULE
    });

    const pageLabel = `${this.pageNumber} / ${this.totalPages}`;
    const pageWidth = this.font.widthOfTextAtSize(pageLabel, 7);
    this.put(
      pageLabel,
      this.pageWidth - this.margin - pageWidth,
      baseY,
      7,
      this.font,
      MUTED
    );

    const available = this.pageWidth - this.margin * 2 - pageWidth - 10;
    let ly = baseY;
    for (const line of this.legalFooterLines.slice(0, 2)) {
      this.put(this.truncate(line, this.font, 6.2, available), this.margin, ly, 6.2, this.font, MUTED);
      ly -= 8;
    }
    this.drawingChrome = false;
  }

  /** Stamp footers on every page. Call after building everything. */
  finalizeFooters(): void {
    this.totalPages = this.doc.getPageCount();
    for (let i = 0; i < this.totalPages; i++) {
      const page = this.doc.getPage(i);
      this.page = page;
      this.pageNumber = i + 1;
      this.drawFooter();
    }
  }

  /**
   * Largest size between `max` and `min` at which `text` fits `maxWidth`.
   *
   * Used for the totals line: "TOTAL ALQUILER (IVA INCL.)" does not fit at
   * 14pt and was coming out as "TOTAL ALQUILER (IV…". Shrinking a heading a
   * point or two is invisible; truncating the word "TOTAL" on an invoice-like
   * document is not.
   */
  private fitSize(
    text: string,
    role: FontRole,
    max: number,
    min: number,
    maxWidth: number
  ): number {
    const font = this.fontFor(role, text);
    let size = max;
    while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) {
      size -= 0.5;
    }
    return size;
  }

  /** Cut a string to fit `maxWidth`, adding an ellipsis when it does not. */
  private truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) > maxWidth) {
      out = out.slice(0, -1);
    }
    return out + '…';
  }

  /**
   * Bottom limit for body content.
   *
   * It reserves the footer strip. Without that reserve a paragraph reaching the
   * end of a page printed straight over the legal lines.
   */
  private get floor(): number {
    return this.margin + FOOTER_RESERVE;
  }

  private ensureSpace(h: number): void {
    if (this.y - h < this.floor) this.newPage();
  }

  /**
   * Every run of text that was set in a font missing one of its glyphs.
   *
   * pdf-lib does not complain: it draws a blank box. That is how "€" or a
   * Romanian "ț" would reach a customer as an empty rectangle, so the check
   * has to be explicit.
   */
  assertNoMissingGlyphs(): string[] {
    const problems: string[] = [];
    for (const box of this.boxes) {
      const font = box.font;
      if (!font) continue;
      const test = this.coverage.get(font);
      if (!test) continue;
      const missing = [...box.text].filter((ch) => {
        const cp = ch.codePointAt(0);
        return cp !== undefined && cp !== 0x20 && cp !== 0x0a && !test(cp);
      });
      if (missing.length) {
        problems.push(`p${box.page}: "${box.text}" is missing ${[...new Set(missing)].join(' ')}`);
      }
    }
    return problems;
  }

  /**
   * Every run that fell outside the printable area — past the right margin, or
   * down into the strip reserved for the legal footer.
   */
  assertInsideMargins(): string[] {
    const problems: string[] = [];
    const right = this.pageWidth - this.margin;
    for (const box of this.boxes) {
      if (box.x + box.width > right + 0.5) {
        problems.push(
          `p${box.page}: "${box.text}" runs ${(box.x + box.width - right).toFixed(1)}pt past the right margin`
        );
      }
      // The footer draws itself below this line, so only body content counts.
      if (!box.isChrome && box.y < this.floor) {
        problems.push(`p${box.page}: "${box.text}" sits in the footer strip`);
      }
    }
    return problems;
  }

  /**
   * Assert that no two text runs on the same page overlap.
   *
   * Text is drawn at absolute coordinates, so a long label and a
   * right-aligned value can silently print on top of each other. This turns
   * that into something a test can catch.
   */
  assertNoOverlaps(tolerance = 0.5): string[] {
    const problems: string[] = [];
    const byPage = new Map<number, TextBox[]>();
    for (const b of this.boxes) {
      const list = byPage.get(b.page) ?? [];
      list.push(b);
      byPage.set(b.page, list);
    }

    for (const [page, list] of byPage) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          // Same visual line? Baselines closer together than half the smaller
          // cap height count as sharing a row.
          const sameLine = Math.abs(a.y - b.y) < Math.min(a.height, b.height) * 0.5;
          if (!sameLine) continue;
          const overlap =
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          if (overlap > tolerance) {
            problems.push(
              `p${page}: "${a.text}" overlaps "${b.text}" by ${overlap.toFixed(1)}pt`
            );
          }
        }
      }
    }
    return problems;
  }

  text(
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      italic?: boolean;
      role?: FontRole;
      color?: [number, number, number] | RGB;
      gap?: number;
      align?: 'left' | 'center' | 'right';
      maxWidth?: number;
      /** Extra space between glyphs, for the small caps labels. */
      tracking?: number;
    } = {}
  ): void {
    const size = opts.size ?? 10;
    const role: FontRole =
      opts.role ?? (opts.bold ? 'bodyBold' : opts.italic ? 'bodyItalic' : 'body');
    const font = this.fontFor(role, s);
    const color = Array.isArray(opts.color)
      ? rgb(opts.color[0], opts.color[1], opts.color[2])
      : (opts.color as RGB) ?? BODY;
    const lines = this.wrap(s, size, font, opts.maxWidth);
    const lineHeight = size * 1.4;
    for (const ln of lines) {
      this.ensureSpace(lineHeight);
      const w = opts.tracking
        ? this.trackedWidth(ln, font, size, opts.tracking)
        : font.widthOfTextAtSize(ln, size);
      let x = this.margin;
      if (opts.align === 'center') x = (this.pageWidth - w) / 2;
      else if (opts.align === 'right') x = this.pageWidth - this.margin - w;

      if (opts.tracking) {
        this.putTracked(ln, x, this.y - size, size, font, color, opts.tracking);
      } else {
        this.put(ln, x, this.y - size, size, font, color);
      }
      this.y -= lineHeight;
    }
    if (opts.gap) this.y -= opts.gap;
  }

  private trackedWidth(text: string, font: PDFFont, size: number, tracking: number): number {
    return font.widthOfTextAtSize(text, size) + Math.max(0, [...text].length - 1) * tracking;
  }

  /**
   * Letter-spaced run, glyph by glyph.
   *
   * pdf-lib has no character-spacing option, and the invoice's small caps
   * labels depend on it. Recorded as one box so the overlap check still sees
   * a single run.
   */
  private putTracked(
    text: string,
    x: number,
    baselineY: number,
    size: number,
    font: PDFFont,
    color: RGB,
    tracking: number
  ): void {
    let cx = x;
    for (const ch of text) {
      this.page.drawText(ch, { x: cx, y: baselineY, size, font, color });
      cx += font.widthOfTextAtSize(ch, size) + tracking;
    }
    this.boxes.push({
      page: this.pageNumber,
      x,
      y: baselineY,
      width: cx - x - tracking,
      height: size,
      text,
      // Recording the font matters most here: tracked runs are the section
      // labels, which are exactly where Gotham is used and where a missing
      // Romanian glyph would show up.
      font,
      isChrome: this.drawingChrome
    });
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
      color: thickness >= 1 ? INK : RULE
    });
    this.y -= 8;
  }

  /**
   * The masthead of page 1: company block on the left, logo on the right, then
   * the document title with its reference and a rule underneath.
   *
   * This is the invoice's opening, and it is what was missing from the
   * contract — it went out with no logo at all.
   */
  documentHeader(opts: {
    companyName: string;
    companyLines: string[];
    title: string;
    reference?: string;
  }): void {
    const top = this.y;

    // Logo first: it sets how much width the company block may use.
    const logoWidth = 168;
    let logoBottom = top;
    if (this.logo) {
      const scale = logoWidth / this.logo.viewBoxWidth;
      const logoHeight = this.logo.viewBoxHeight * scale;
      const x = this.pageWidth - this.margin - logoWidth;
      for (const p of this.logo.paths) {
        this.page.drawSvgPath(p.d, {
          x,
          y: top,
          scale,
          color: p.brand ? BRAND : INK
        });
      }
      logoBottom = top - logoHeight;
    }

    const companyMax = this.pageWidth - this.margin * 2 - logoWidth - 20;

    // Company name, uppercase, in the brand face.
    const nameSize = 13;
    const nameFont = this.fontFor('display', opts.companyName);
    this.put(
      this.truncate(opts.companyName, nameFont, nameSize, companyMax),
      this.margin,
      top - nameSize,
      nameSize,
      nameFont,
      INK
    );
    let cy = top - nameSize - 12;
    for (const line of opts.companyLines) {
      this.put(this.truncate(line, this.font, 8, companyMax), this.margin, cy, 8, this.font, MUTED);
      cy -= 10;
    }

    this.y = Math.min(cy, logoBottom) - 18;

    // Document title + reference on one row, sized so they cannot collide.
    //
    // The title shrinks to fit and, failing that, wraps onto a second line.
    // It must never be clipped: "CONTRATO DE ALQUILER DE VEHÍCULO SIN
    // CONDUCTOR" does not fit at 26pt and was printing as "CONTRATO DE
    // ALQUILER …", which is not the name of any document.
    const refSize = 12;
    const refFont = this.fontFor('display', opts.reference ?? '');
    const refWidth = opts.reference ? refFont.widthOfTextAtSize(opts.reference, refSize) : 0;
    const titleMax = this.pageWidth - this.margin * 2 - refWidth - 16;
    const title = opts.title.toUpperCase();
    const titleFont = this.fontFor('display', title);
    const titleSize = this.fitSize(title, 'display', 26, 15, titleMax);
    const titleLines = this.wrap(title, titleSize, titleFont, titleMax);

    this.ensureSpace(titleSize * 1.4 * titleLines.length + 8);
    const firstBaseline = this.y - titleSize;
    let ty = firstBaseline;
    for (const line of titleLines) {
      this.put(line, this.margin, ty, titleSize, titleFont, INK);
      ty -= titleSize * 1.2;
    }
    if (opts.reference) {
      this.put(
        opts.reference,
        this.pageWidth - this.margin - refWidth,
        firstBaseline + (titleSize - refSize) * 0.15,
        refSize,
        refFont,
        BRAND
      );
    }
    this.y = ty - titleSize * 0.1;

    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.pageWidth - this.margin, y: this.y },
      thickness: 1.2,
      color: INK
    });
    this.y -= 16;
  }

  /**
   * Small letter-spaced teal caps, the way the invoice labels each block.
   * Replaces the old 11pt bold heading: same call sites, quieter type.
   */
  section(title: string, opts: { numbered?: number } = {}): void {
    this.y -= 10;
    const label =
      opts.numbered !== undefined
        ? `${opts.numbered}. ${title.toUpperCase()}`
        : title.toUpperCase();
    this.text(label, { size: 7.5, role: 'display', color: BRAND, tracking: 0.7, gap: 4 });
  }

  /** Sub-section title (smaller). */
  subsection(title: string): void {
    this.y -= 4;
    this.text(title, { size: 9.5, role: 'displayMedium', color: INK, gap: 2 });
  }

  /**
   * Label on the left, value flush right.
   *
   * Both sides used to be drawn at fixed positions with no width check, so a
   * long label and a long value printed on top of each other — exactly the
   * kind of collision that only shows up on somebody's real data. Now the
   * value keeps its place and the label is clipped to whatever room is left;
   * if the value alone would not fit, the pair wraps onto two lines instead.
   */
  twoColumn(left: string, right: string, leftBold = false, rightBold = false): void {
    const size = 9.5;
    const lf = leftBold ? this.bold : this.font;
    const rf = rightBold ? this.bold : this.font;
    const gap = 12;

    const rightWidth = rf.widthOfTextAtSize(right, size);
    const available = this.pageWidth - this.margin * 2 - rightWidth - gap;

    // No sensible room for the label: stack instead of colliding.
    if (available < 60) {
      this.text(left, { size, bold: leftBold, color: BODY });
      this.text(right, { size, bold: rightBold, align: 'right', color: BODY });
      return;
    }

    this.ensureSpace(size * 1.6);
    this.put(
      this.truncate(left, lf, size, available),
      this.margin,
      this.y - size,
      size,
      lf,
      left.endsWith(':') || leftBold ? BODY : MUTED
    );
    this.put(right, this.pageWidth - this.margin - rightWidth, this.y - size, size, rf, BODY);
    this.y -= size * 1.6;
  }

  /**
   * Two independent blocks side by side, as the invoice sets "DATOS DE LA
   * FACTURA" against "FACTURAR A".
   *
   * Entries are `{ label, value }` pairs rather than pre-joined strings: the
   * label has to be measured on its own to know where the value starts, and
   * guessing that boundary by splitting on the first space breaks on every
   * two-word label.
   */
  infoColumns(
    left: InfoEntry[],
    right: InfoEntry[],
    opts: { size?: number } = {}
  ): void {
    const size = opts.size ?? 9;
    const lineHeight = size * 1.55;
    const gutter = 24;
    const colWidth = (this.pageWidth - this.margin * 2 - gutter) / 2;
    const rows = Math.max(left.length, right.length);

    // A feature name can wrap, so reserve a spare line before committing.
    this.ensureSpace(lineHeight * (rows + 1) + 4);
    const top = this.y;

    const drawColumn = (entries: InfoEntry[], x: number): number => {
      let cy = top - size;
      for (const entry of entries) {
        if (entry.strong) {
          // A feature line (the customer's name) takes the whole column. It
          // shrinks and then wraps: a legal name is not something to abbreviate
          // on a contract — "EUROCONSTRUCCIONES 2020, SOC…" is nobody.
          const font = this.fontFor('display', entry.value);
          const featureSize = this.fitSize(entry.value, 'display', size + 3, size - 0.5, colWidth);
          for (const line of this.wrap(entry.value, featureSize, font, colWidth)) {
            this.put(line, x, cy, featureSize, font, BRAND);
            cy -= featureSize * 1.25;
          }
          cy -= 3;
          continue;
        }

        const label = entry.label ? `${entry.label}: ` : '';
        const labelWidth = label ? this.bold.widthOfTextAtSize(label, size) : 0;
        if (label) {
          this.put(this.truncate(label, this.bold, size, colWidth), x, cy, size, this.bold, BODY);
        }
        if (entry.value) {
          this.put(
            this.truncate(entry.value, this.font, size, colWidth - labelWidth),
            x + labelWidth,
            cy,
            size,
            this.font,
            BODY
          );
        }
        cy -= lineHeight;
      }
      return cy;
    };

    // Both columns are laid out from the same top; the block ends wherever the
    // taller one does, so a wrapped name cannot push into what follows.
    const leftEnd = drawColumn(left, this.margin);
    const rightEnd = drawColumn(right, this.margin + colWidth + gutter);
    this.y = Math.min(leftEnd, rightEnd) - 4;
  }

  /**
   * The totals stack the invoice puts bottom-right: hairline above each row,
   * the final line larger and in brand colour.
   */
  totalsBlock(rows: { label: string; value: string; total?: boolean }[]): void {
    const width = (this.pageWidth - this.margin * 2) * 0.62;
    const x = this.pageWidth - this.margin - width;

    for (const row of rows) {
      const size = row.total
        ? this.fitSize(row.label.toUpperCase(), 'display', 14, 10, width * 0.62)
        : 9.5;
      const height = size * 2;
      this.ensureSpace(height);

      this.page.drawLine({
        start: { x, y: this.y },
        end: { x: this.pageWidth - this.margin, y: this.y },
        thickness: row.total ? 0.8 : 0.4,
        color: row.total ? INK : RULE
      });

      const labelRole: FontRole = row.total ? 'display' : 'bodyBold';
      const labelFont = this.fontFor(labelRole, row.label);
      const valueFont = row.total ? this.fontFor('display', row.value) : this.bold;
      const valueWidth = valueFont.widthOfTextAtSize(row.value, size);
      const baseline = this.y - size - 4;

      this.put(
        this.truncate(row.label.toUpperCase(), labelFont, size, width - valueWidth - 10),
        x,
        baseline,
        size,
        labelFont,
        row.total ? INK : MUTED
      );
      this.put(
        row.value,
        this.pageWidth - this.margin - valueWidth,
        baseline,
        size,
        valueFont,
        row.total ? BRAND : BODY
      );
      this.y -= height;
    }
  }

  /**
   * Two-column row where the right value wraps over several lines.
   *
   * The wrap width is now derived from the label rather than fixed at 320pt:
   * a long label used to leave the value nowhere to go and the two ran
   * together on the first line.
   */
  twoColumnWrap(left: string, right: string, leftBold = false, rightWidth?: number): void {
    const size = 9.5;
    const lf = leftBold ? this.bold : this.font;
    const gap = 12;
    const labelWidth = lf.widthOfTextAtSize(left, size);
    const maxRight = this.pageWidth - this.margin * 2 - labelWidth - gap;
    const width = Math.max(120, Math.min(rightWidth ?? maxRight, maxRight));

    const lines = this.wrap(right, size, this.font, width);
    const lineHeight = size * 1.5;
    this.ensureSpace(lineHeight * Math.max(1, lines.length) + 2);
    this.put(
      this.truncate(left, lf, size, this.pageWidth - this.margin * 2 - width - gap),
      this.margin,
      this.y - size,
      size,
      lf,
      leftBold ? BODY : MUTED
    );
    let cy = this.y - size;
    for (const ln of lines) {
      this.put(
        ln,
        this.pageWidth - this.margin - this.font.widthOfTextAtSize(ln, size),
        cy,
        size,
        this.font,
        BODY
      );
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
      color: TINT,
      borderColor: RULE,
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
    const numFont = this.fontFor('display', numStr);
    const numTextWidth = numFont.widthOfTextAtSize(numStr, 11);
    this.page.drawText(numStr, {
      x: badgeX + (badgeSize - numTextWidth) / 2,
      y: badgeY + 4,
      size: 11,
      font: numFont,
      color: rgb(1, 1, 1)
    });

    // Body text
    const tx = badgeX + badgeSize + padX;
    let ty = this.y - padY - size;
    for (const ln of lines) {
      this.put(ln, tx, ty, size, this.font, BODY);
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
    this.text(titleStr, { size: titleSize, role: 'display', color: INK, gap: 3 });
    // Body — each line goes through ensureSpace so a paragraph that reaches
    // the bottom breaks onto the next page instead of over the legal footer.
    for (const para of paragraphs) {
      const lines = this.wrap(para, size, this.font, this.pageWidth - this.margin * 2);
      for (const ln of lines) {
        this.ensureSpace(lineHeight);
        this.put(ln, this.margin, this.y - size, size, this.font, BODY);
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

    // Captions under each box. Everything is clipped to its own column: a long
    // legal name used to run straight across the gutter into the other party's
    // block.
    const roleFont = this.fontFor('displayMedium', opts.lessorRole + opts.renterRole);
    this.put(this.truncate(opts.lessorRole, roleFont, 9, colW), leftX, this.y - 10, 9, roleFont, INK);
    this.put(this.truncate(opts.renterRole, roleFont, 9, colW), rightX, this.y - 10, 9, roleFont, INK);
    this.y -= 14;

    this.put(this.truncate(opts.lessorName, this.font, 9, colW), leftX, this.y - 9, 9, this.font, BODY);
    this.put(this.truncate(opts.renterName, this.font, 9, colW), rightX, this.y - 9, 9, this.font, BODY);
    this.y -= 12;

    if (opts.lessorId) {
      this.put(this.truncate(opts.lessorId, this.font, 8, colW), leftX, this.y - 8, 8, this.font, MUTED);
    }
    if (opts.renterId) {
      this.put(this.truncate(opts.renterId, this.font, 8, colW), rightX, this.y - 8, 8, this.font, MUTED);
    }
    this.y -= 12;
  }

  skip(dy: number): void {
    this.y -= dy;
  }
}

/** Company data as it appears under the name in the masthead. */
export function companyHeaderLines(company: {
  taxId?: string;
  address?: string;
  phone?: string;
  email?: string;
}): string[] {
  return [
    company.taxId ? `NIF ${company.taxId.toUpperCase()}` : '',
    company.address || '',
    [company.phone, company.email].filter(Boolean).join(' · ')
  ].filter(Boolean);
}

/**
 * The two grey lines repeated at the foot of every page, exactly as on the
 * invoice: identity on the first, registry data on the second.
 */
export function companyFooterLines(company: {
  legalName: string;
  taxId?: string;
  address?: string;
  registry?: string;
}): string[] {
  const identity = [
    company.legalName,
    company.taxId ? `NIF ${company.taxId.toUpperCase()}` : '',
    company.address
  ]
    .filter(Boolean)
    .join(' · ');
  return [identity, company.registry || ''].filter(Boolean);
}

/**
 * "DNI 12345678Z", "NIE X1234567L", "PASAPORTE …".
 *
 * The type arrives from Firestore as the raw enum (`dni`, `nie`, `passport`),
 * and it used to be printed straight onto the contract in lower case next to
 * an upper-case number. Identity document types are always written in caps.
 */
export function formatIdDocument(type?: string, numberValue?: string): string {
  const labels: Record<string, string> = {
    dni: 'DNI',
    nie: 'NIE',
    nif: 'NIF',
    cif: 'CIF',
    passport: 'PASAPORTE',
    other: ''
  };
  const key = (type || '').trim().toLowerCase();
  const label = labels[key] ?? type?.toUpperCase() ?? '';
  return [label, (numberValue || '').toUpperCase()].filter(Boolean).join(' ').trim();
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
    tariffAmt:
      loc === 'en'
        ? 'Rental amount (tariff)'
        : loc === 'ro'
          ? 'Suma închiriere (tarif)'
          : 'Importe alquiler (tarifa)',
    loyaltyDisc:
      loc === 'en' ? 'Loyalty discount' : loc === 'ro' ? 'Reducere fidelitate' : 'Descuento fidelidad',
    agreedAdj:
      loc === 'en' ? 'Agreed adjustment' : loc === 'ro' ? 'Ajustare convenită' : 'Ajuste acordado',
    vatBase: loc === 'en' ? 'Taxable base' : loc === 'ro' ? 'Bază impozabilă' : 'Base imponible',
    vat: loc === 'en' ? 'VAT' : loc === 'ro' ? 'TVA' : 'IVA',
    rentalTotal:
      loc === 'en' ? 'Total rental (VAT incl.)' : loc === 'ro' ? 'Total închiriere (TVA inclus)' : 'Total alquiler (IVA incl.)',
    deposit: loc === 'en' ? 'Security deposit' : loc === 'ro' ? 'Garanție (fianță)' : 'Fianza',
    depositVatNote:
      loc === 'en'
        ? 'Security deposit (not subject to VAT)'
        : loc === 'ro'
          ? 'Garanție (nesupusă TVA)'
          : 'Fianza (no sujeta a IVA)',
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
  doc.setCreator(input.company.legalName);
  doc.setProducer(`${input.company.legalName} · pdf-lib`);

  const b = new PdfBuilder(doc);
  await b.init(L.headerLabel, input.contractNumber || '', companyFooterLines(input.company));

  // -------------------------------------------------------------------------
  // PAGE 1 — COVER + FRONT-PAGE SUMMARY
  // -------------------------------------------------------------------------
  b.documentHeader({
    companyName: input.company.legalName,
    companyLines: companyHeaderLines(input.company),
    title: L.headerLabel,
    reference: input.contractNumber
  });

  // Contract meta, side by side as on the invoice.
  b.infoColumns(
    [
      ...(input.contractNumber ? [{ label: L.contractNum, value: input.contractNumber }] : []),
      { label: L.generatedOn, value: formatDate(input.generatedAt, loc) },
      ...(signed && input.signedAt
        ? [{ label: L.signedAtLabel, value: formatDate(input.signedAt, loc) }]
        : [])
    ],
    [
      { value: input.client.fullName, strong: true },
      ...(input.client.documentNumber
        ? [{ label: L.document, value: formatIdDocument(input.client.documentType, input.client.documentNumber) }]
        : []),
      ...(input.client.phone ? [{ label: L.phone, value: input.client.phone }] : [])
    ]
  );
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
      formatIdDocument(input.client.documentType, input.client.documentNumber),
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
  //
  // The tariff and the two discounts are only printed when they moved the
  // price: a rental with no discount reads exactly as it did before.
  //
  // ⚠️ The price is already VAT-inclusive. The base is EXTRACTED from it
  // (base = total / 1.21). Adding the tax on top instead would inflate every
  // contract by 21 %.
  b.section(L.priceDeposit);

  const finalPrice = input.reservation.finalPrice;
  const loyaltyDiscount = input.reservation.loyaltyDiscount;
  const manualAdjustment = input.reservation.manualAdjustment;
  const hasDiscounts = !!loyaltyDiscount || !!manualAdjustment;

  if (hasDiscounts && input.reservation.tariffPrice !== undefined) {
    b.twoColumn(L.tariffAmt + ':', formatMoney(input.reservation.tariffPrice, loc), false, true);
    if (loyaltyDiscount) {
      const percent = input.reservation.loyaltyDiscountPercent;
      const label = percent ? `${L.loyaltyDisc} (${percent} %)` : L.loyaltyDisc;
      b.twoColumn(label + ':', formatMoney(loyaltyDiscount, loc), false, true);
    }
    if (manualAdjustment) {
      b.twoColumn(L.agreedAdj + ':', formatMoney(manualAdjustment, loc), false, true);
    }
  }

  const vat = extractVat(finalPrice, input.reservation.vatRate);
  b.totalsBlock([
    { label: L.vatBase, value: formatMoney(vat.base, loc) },
    { label: `${L.vat} (${vat.percent} %)`, value: formatMoney(vat.vat, loc) },
    { label: L.rentalTotal, value: formatMoney(vat.total, loc), total: true },
    { label: L.depositVatNote, value: formatMoney(input.reservation.depositAmount, loc) }
  ]);

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
  input.onLayout?.(b);

  return await doc.save();
}
