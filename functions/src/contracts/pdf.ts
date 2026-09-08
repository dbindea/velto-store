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

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, PDFImage, RGB } from 'pdf-lib';
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
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  FOOTER_RESERVE,
  FONT_FILES,
  loadLogo,
  readAsset,
  type Logo
} from './brand';
import { buildQrMatrix, qrRects, type QrMatrix } from './qr';

const BOX_BORDER = rgb(0.8, 0.8, 0.8);

/**
 * The size every document title is set at, in every language.
 *
 * It is the size of the tightest case — the Spanish contract title beside its
 * reference — so no document has to shrink to match the others. Raising it
 * silently re-introduces the old inconsistency: the long titles would fit down
 * again while the short ones stayed big.
 */
const TITLE_SIZE = 12.5;

/** Which family a run of text belongs to. */
export type FontRole = 'body' | 'bodyBold' | 'bodyItalic' | 'display' | 'displayMedium';

/** One line inside an `infoColumns` block. */
export interface InfoEntry {
  label?: string;
  value: string;
  /** Render as a feature line (larger, brand colour) instead of label + value. */
  strong?: boolean;
  /**
   * Parte en varias líneas en vez de truncar con puntos suspensivos.
   *
   * Para los datos que **no se pueden abreviar**: un domicilio fiscal es
   * contenido obligatorio de la factura (art. 6.1.c), y «Pol. Ind. Las Monjas,
   * nave 7, 28850 Torrejón de Ard…» es un domicilio incompleto. Misma razón por
   * la que el nombre legal ya encoge y envuelve en vez de truncarse.
   *
   * ⚠️ **Parte por las comas, no por donde se acabe el ancho.** Estos valores
   * son datos de ficha —un domicilio, una razón social—, y una dirección
   * escrita se lee por sus comas: cortarla por ancho da «Pol. Ind. Las Monjas,
   * nave 7, 28850 Torrejón / de Ardoz (Madrid)», que parte un topónimo en dos.
   * Solo se recurre al corte por palabras cuando un tramo entre comas no cabe
   * ni él solo.
   */
  wrap?: boolean;
}

/**
 * Reparte un texto en líneas **cortando por las comas**.
 *
 * Vive fuera de `PdfBuilder`, y suelta, por el mismo motivo que `qrRects()`:
 * así se puede probar sin montar un PDF ni cargar una fuente. Quien llama pone
 * el `cabe` —que es lo único que sabe de tipografía— y el `porPalabras` para
 * los tramos que no quepan ni solos.
 *
 * El criterio, en dos reglas:
 *
 * 1. **Si cabe entera, una línea.** No se trocea una dirección corta solo
 *    porque tenga comas: «C/ María Zambrano, 4» son tres líneas absurdas.
 * 2. **Cuando no cabe, el salto va después de una coma**, juntando tramos
 *    mientras quepan. La coma se queda al final de la línea: es parte del dato
 *    que tecleó el operador, y en una factura el domicilio es contenido
 *    obligatorio — no se le quitan caracteres para maquetar.
 */
export function wrapPreferringCommas(
  s: string,
  cabe: (candidate: string) => boolean,
  porPalabras: (chunk: string) => string[]
): string[] {
  const texto = (s || '').trim();
  if (!texto) return [];
  if (cabe(texto)) return [texto];

  // La coma se queda pegada al tramo que la precede.
  const tramos = texto
    .split(/(?<=,)\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tramos.length < 2) return porPalabras(texto);

  const lineas: string[] = [];
  let linea = '';
  for (const tramo of tramos) {
    const candidata = linea ? `${linea} ${tramo}` : tramo;
    if (cabe(candidata)) {
      linea = candidata;
      continue;
    }
    if (linea) lineas.push(linea);
    if (cabe(tramo)) {
      linea = tramo;
    } else {
      // Un tramo que no cabe ni él solo se parte por palabras, como siempre.
      const partes = porPalabras(tramo);
      lineas.push(...partes.slice(0, -1));
      linea = partes[partes.length - 1] ?? '';
    }
  }
  if (linea) lineas.push(linea);
  return lineas;
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
 * Algo dibujado que no es texto, con su caja en coordenadas de página.
 *
 * `y` es el borde **inferior**, como en pdf-lib, y no la línea base: un
 * rectángulo no tiene línea base.
 */
export interface GraphicBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
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
    /** Marca, para todo lo que le habla al cliente. Ver `company-config.ts`. */
    brandName: string;
    /** Razón social, solo donde comparece junto al NIF. */
    legalName: string;
    taxId: string;
    registry?: string;
    /** Domicilio social: solo junto al NIF —arrendador, firma y pie legal—. */
    address: string;
    /** Domicilio comercial: la oficina. Va en la cabecera, que es la que le
     * habla al cliente. Cae a `address` si no está. */
    officeAddress?: string;
    phone?: string;
    email: string;
    website?: string;
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
  /**
   * Conductores autorizados además del arrendatario.
   *
   * La cláusula 2 exige que estén «identificados nominalmente», así que sin
   * este bloque un alquiler con dos conductores incumplía su propio contrato.
   */
  additionalDrivers?: Array<{
    fullName: string;
    documentNumber?: string;
    drivingLicenseNumber?: string;
  }>;
  vehicle: {
    brand: string;
    model: string;
    version?: string;
    plateNumber: string;
    year?: number;
    fuelType?: string;
    transmission?: string;
    /**
     * Si el coche lleva localizador GPS.
     *
     * Decide si el contrato imprime el aviso de geolocalización: informar de
     * que el vehículo se localiza es una obligación cuando es cierto, y una
     * afirmación falsa cuando no lo es.
     */
    hasGpsTracker?: boolean;
    /**
     * Seguro y asistencia, **del coche**.
     *
     * Estuvieron un día en el bloque de empresa, y era un error de modelo: cada
     * vehículo tiene su póliza, a veces con compañías distintas, y se renuevan
     * por separado. Con un solo valor de empresa, el segundo coche de la flota
     * ya habría salido con la póliza del primero.
     */
    insurerName?: string;
    insurancePolicy?: string;
    roadsideAssistancePhone?: string;
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
    /** Taxable base actually agreed. Drives the split when the tariff is net. */
    netPrice?: number;
    /** VAT rate frozen on the reservation, as a FRACTION (0.21 = 21 %). */
    vatRate?: number;
    /**
     * Kilometraje pactado, congelado en la reserva.
     *
     * ⚠️ Sin esto el contrato no decía nada de kilómetros y la aplicación sí
     * sabía cobrarlos: un cargo que el documento firmado no menciona es un
     * cargo que el cliente discute con razón.
     */
    includedKmPerDay?: number;
    extraKmPrice?: number;
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
   * True si el PDF se va a sellar con el certificado de la empresa.
   *
   * Gobierna **una sola cosa**: si se imprime «Firmado digitalmente con
   * certificado digital» en la casilla del arrendador. El documento no puede
   * prometer una firma que no va a llevar, que es lo que hacía hasta N-8.
   */
  willBeDigitallySigned?: boolean;
  /**
   * Código Seguro de Verificación y su QR, en la casilla del arrendador (N-9).
   *
   * ⚠️ **Va DENTRO del PDF que se sella**, así que se dibuja antes de firmar. Y
   * lo que resuelve es el papel: una copia impresa no se puede comprobar de
   * ninguna otra forma. **No valida la firma electrónica** —eso lo hace Adobe o
   * VALIDe abriendo el fichero— y ningún texto de aquí debe dar a entender que
   * sí, que es exactamente el error que ya se cometió una vez con la frase de
   * la firma digital.
   */
  verification?: {
    /** Tal y como se imprime: `VLT-3F7K-9QD2-XR84`. */
    code: string;
    /** La URL que codifica el QR. */
    url: string;
    /** La misma sin esquema, para que se pueda teclear a mano. */
    urlLabel: string;
  };
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

/**
 * Fuel type and gearbox, per language.
 *
 * These arrive from Firestore as the raw enum — `diesel`, `manual` — because
 * that is what the vehicle form stores, and the contract printed them exactly
 * like that: lower case, in English, next to Spanish labels. They are not
 * free text an operator could capitalise on entry; they are codes, and the
 * document has to translate them.
 */
const VEHICLE_FUEL_TYPES: Record<ContractLocale, Record<string, string>> = {
  es: { diesel: 'Diésel', petrol: 'Gasolina', hybrid: 'Híbrido', electric: 'Eléctrico' },
  en: { diesel: 'Diesel', petrol: 'Petrol', hybrid: 'Hybrid', electric: 'Electric' },
  ro: { diesel: 'Motorină', petrol: 'Benzină', hybrid: 'Hibrid', electric: 'Electric' }
};

const TRANSMISSIONS: Record<ContractLocale, Record<string, string>> = {
  es: { manual: 'Manual', automatic: 'Automático' },
  en: { manual: 'Manual', automatic: 'Automatic' },
  ro: { manual: 'Manuală', automatic: 'Automată' }
};

/** Capitalise whatever we were given, so an unknown code still reads properly. */
function capitalise(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function fuelTypeLabel(value: string, loc: ContractLocale): string {
  return VEHICLE_FUEL_TYPES[loc]?.[value.toLowerCase()] ?? capitalise(value);
}

export function transmissionLabel(value: string, loc: ContractLocale): string {
  return TRANSMISSIONS[loc]?.[value.toLowerCase()] ?? capitalise(value);
}

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
 * The tax split of a rental.
 *
 * ⚠️ **Tariffs are NET: VAT is added on top.** A vehicle at 30 €/day means 30 €
 * of taxable base and the customer pays 36,30 €. `netPrice` is the number that
 * was agreed, so it drives the split — never `finalPrice`, which is derived
 * from it.
 *
 * `vat` is derived by subtraction so `base + vat === total` to the cent;
 * rounding both independently drifts, and a contract that does not add up is
 * the kind of detail a customer notices.
 *
 * Mirrors `vatBreakdownOf()` in `src/app/shared/utils/pricing.util.ts`. The
 * duplication is deliberate — separate tsconfigs — so both sides move together.
 */
export function vatBreakdownOf(pricing: {
  netPrice?: number;
  vatRate?: number;
}): { base: number; vat: number; total: number; percent: number } {
  const round = (n: number) => Math.round(n * 100) / 100;
  const rate =
    typeof pricing.vatRate === 'number' && isFinite(pricing.vatRate) && pricing.vatRate >= 0
      ? pricing.vatRate
      : DEFAULT_VAT_RATE;
  const net = typeof pricing.netPrice === 'number' && pricing.netPrice > 0
    ? round(pricing.netPrice)
    : 0;
  const total = round(net * (1 + rate));

  return { base: net, vat: round(total - net), total, percent: Math.round(rate * 100) };
}

export function formatMoney(n?: number, locale: ContractLocale = 'es'): string {
  if (n === undefined || n === null) return '—';
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : locale === 'ro' ? 'ro-RO' : 'es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      /**
       * ⚠️ **`always`, porque el CLDR español NO agrupa cuatro dígitos.**
       *
       * `Intl` en español da «7000,00» y solo pone el punto a partir de cinco
       * cifras: es correcto para prosa, pero no es como se escribe una cantidad
       * en una factura. La que emite la empresa pone «3.000,00 €», y un importe
       * de cuatro dígitos sin separador se lee peor justo donde más importa.
       *
       * `true` y no `'always'`: son equivalentes por spec —`true` se normaliza
       * a `always`— y `'always'` es ES2023, que los tipos de este target
       * todavía no conocen.
       */
      useGrouping: true
    }).format(n) + ' €';
  } catch {
    return `${n.toFixed(2)} €`;
  }
}

/**
 * Un entero con separador de miles según el idioma del documento: `1.500` en
 * español y rumano, `1,500` en inglés.
 *
 * Aparte de `formatMoney` porque los kilómetros no llevan decimales ni símbolo:
 * «1.500,00 € km» no es una cifra que nadie escriba.
 */
export function formatNumber(n?: number, locale: ContractLocale = 'es'): string {
  if (n === undefined || n === null) return '—';
  try {
    return new Intl.NumberFormat(
      locale === 'en' ? 'en-GB' : locale === 'ro' ? 'ro-RO' : 'es-ES',
      { maximumFractionDigits: 0 }
    ).format(n);
  } catch {
    return String(Math.round(n));
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

  /**
   * Lo que se dibuja y no es texto: hoy solo el QR de verificación.
   *
   * `assertNoOverlaps()` compara runs de texto entre sí, así que un símbolo
   * gráfico le era invisible: se le podía imprimir una línea encima sin que
   * ningún test dijera nada, y un QR con texto atravesado no se lee. Registrarlo
   * aquí es lo que convierte «no se solapa» en algo comprobable también para él.
   */
  readonly graphics: GraphicBox[] = [];

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

  /**
   * Pinta un QR, con `x`,`y` en la esquina inferior izquierda y `size`
   * incluyendo la zona de silencio.
   *
   * La geometría vive en `qrRects()` y no aquí: así se puede comprobar que el
   * símbolo se lee de verdad, que es lo único que importa de un QR y lo que no
   * se ve mirando el PDF.
   */
  private drawQr(qr: QrMatrix, x: number, y: number, size: number): void {
    for (const r of qrRects(qr, x, y, size)) {
      this.page.drawRectangle({ ...r, color: INK });
    }
    this.graphics.push({ page: this.pageNumber, x, y, width: size, height: size, label: 'QR' });
  }

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
   * Break to a new page unless `height` still fits below the cursor.
   *
   * Every drawing primitive protects its own line, which is not the same as
   * protecting a block: a section label would fit, its rows would not, and the
   * heading was left stranded alone at the foot of the page with its contents
   * overleaf. Call this before a group that has to stay whole.
   */
  keepTogether(height: number): void {
    this.ensureSpace(height);
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
    const size = opts.size ?? 9;
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

  /**
   * Alto que ocupará un texto si se compone ahora, con el mismo salto de línea
   * que usa `text()`.
   *
   * Existe para poder reservar sitio a un grupo **medido** en vez de estimado.
   * Un párrafo de aceptación cabe en cinco líneas en español y puede pedir seis
   * en rumano, así que un número escrito a mano acierta en un idioma y sobra o
   * falta en los otros.
   */
  heightOfText(s: string, opts: { size?: number; role?: FontRole; gap?: number } = {}): number {
    const size = opts.size ?? 9;
    const font = this.fontFor(opts.role ?? 'body', s);
    return this.wrap(s, size, font).length * size * 1.4 + (opts.gap ?? 0);
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
    // One line, always, and the SAME size on every document in every language.
    //
    // The size used to be "as big as fits", which is not a size at all: the
    // quote and the booking confirmation came out at 24pt while the Spanish
    // contract — the longest title, next to the longest reference — was fitted
    // down to 12.5, and the English contract landed at 18. Three documents the
    // customer reads side by side, three different mastheads. TITLE_SIZE is the
    // size the tightest of them can hold, so nothing has to shrink to agree.
    const titleSize = this.fitSize(title, 'display', TITLE_SIZE, 9, titleMax);
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
   * Un QR con su leyenda al lado, en el flujo del documento.
   *
   * Lo usa la factura para el código de cotejo de VeriFactu. El texto va **a la
   * derecha y nunca debajo**, por el mismo motivo que en el contrato: bajo el
   * QR, una frase larga en rumano acaba tocándolo, y un QR con texto encima no
   * se escanea.
   */
  qrWithCaption(url: string, caption: string[], opts: { size?: number } = {}): void {
    const size = opts.size ?? 62;
    this.ensureSpace(size + 8);
    const top = this.y;
    this.drawQr(buildQrMatrix(url), this.margin, top - size, size);

    const textX = this.margin + size + 10;
    const textW = this.pageWidth - this.margin * 2 - size - 10;
    let ty = top - 10;
    for (const line of caption) {
      const font = this.fontFor('body', line);
      for (const parte of this.wrap(line, 7.4, font, textW)) {
        this.put(parte, textX, ty, 7.4, font, MUTED);
        ty -= 9.5;
      }
      ty -= 2;
    }

    this.y = Math.min(top - size, ty) - 6;
  }

  /**
   * La rejilla de fotografías del parte de entrega y devolución.
   *
   * ⚠️ **Estas fotos son la prueba.** Desde que el contrato dejó de exigir la
   * firma del parte, lo que sostiene un cargo por combustible, kilómetros o
   * dotación es esto: el estado del coche fotografiado con su fecha. Así que
   * las fotos no son decoración del documento, son su contenido.
   *
   * Cada imagen se ajusta **dentro** de su celda conservando la proporción: un
   * coche estirado para llenar un hueco es una foto que no acredita nada. La
   * celda de la etiqueta se reserva antes de dibujar, de modo que el pie nunca
   * cae sobre la imagen siguiente.
   */
  photoGrid(
    items: { img: PDFImage; width: number; height: number; label?: string }[],
    opts: { columns?: number; gap?: number; cellHeight?: number } = {}
  ): void {
    if (!items.length) return;

    const columns = opts.columns ?? 3;
    const gap = opts.gap ?? 8;
    const labelSize = 7;
    const labelRoom = labelSize * 1.6;
    const usable = this.pageWidth - this.margin * 2;
    const cellW = (usable - gap * (columns - 1)) / columns;
    const cellH = opts.cellHeight ?? cellW * 0.72;
    const rowH = cellH + labelRoom + gap;

    for (let i = 0; i < items.length; i += columns) {
      const row = items.slice(i, i + columns);
      // La fila entera cabe o salta: media rejilla al pie de una página se lee
      // como si faltaran fotos.
      this.ensureSpace(rowH);
      const top = this.y;

      row.forEach((item, col) => {
        const x = this.margin + col * (cellW + gap);
        const ratio = Math.min(cellW / item.width, cellH / item.height);
        const w = item.width * ratio;
        const h = item.height * ratio;
        // Centrada en su celda: con fotos verticales y horizontales mezcladas,
        // pegarlas a un borde deja la rejilla en diagonal.
        const ix = x + (cellW - w) / 2;
        const iy = top - cellH + (cellH - h) / 2;

        this.page.drawImage(item.img, { x: ix, y: iy, width: w, height: h });
        this.graphics.push({
          page: this.pageNumber,
          x: ix,
          y: iy,
          width: w,
          height: h,
          label: 'foto'
        });

        if (item.label) {
          const font = this.fontFor('body', item.label);
          this.put(
            this.truncate(item.label, font, labelSize, cellW),
            x,
            top - cellH - labelSize - 2,
            labelSize,
            font,
            MUTED
          );
        }
      });

      this.y = top - rowH;
    }
  }

  /**
   * Small letter-spaced teal caps, the way the invoice labels each block.
   * Replaces the old 11pt bold heading: same call sites, quieter type.
   */
  section(title: string, opts: { numbered?: number; size?: number; lead?: number } = {}): void {
    this.y -= opts.lead ?? 10;
    const label =
      opts.numbered !== undefined
        ? `${opts.numbered}. ${title.toUpperCase()}`
        : title.toUpperCase();
    this.text(label, {
      size: opts.size ?? 9.5,
      role: 'display',
      color: BRAND,
      tracking: 0.6,
      gap: 4
    });
  }

  /** Sub-section title (smaller). */
  subsection(title: string): void {
    this.y -= 4;
    this.text(title, { size: 8.8, role: 'displayMedium', color: INK, gap: 2 });
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
  twoColumn(
    left: string,
    right: string,
    leftBold = false,
    rightBold = false,
    opts: { size?: number; leading?: number } = {}
  ): void {
    const size = opts.size ?? 8.2;
    const leading = opts.leading ?? 1.6;
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

    this.ensureSpace(size * leading);
    this.put(
      this.truncate(left, lf, size, available),
      this.margin,
      this.y - size,
      size,
      lf,
      left.endsWith(':') || leftBold ? BODY : MUTED
    );
    this.put(right, this.pageWidth - this.margin - rightWidth, this.y - size, size, rf, BODY);
    this.y -= size * leading;
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
    const size = opts.size ?? 8.2;
    const lineHeight = size * 1.5;
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
          // Por las comas también: una razón social larga se parte mejor en
          // «EUROCONSTRUCCIONES … 2020,» / «SOCIEDAD LIMITADA UNIPERSONAL» que
          // por donde se acabe la columna. Va en el mismo bloque que el
          // domicilio, y las dos mitades del mismo dato no pueden partirse con
          // criterios distintos.
          const lineasNombre = wrapPreferringCommas(
            entry.value,
            (t) => font.widthOfTextAtSize(t, featureSize) <= colWidth,
            (t) => this.wrap(t, featureSize, font, colWidth)
          );
          for (const line of lineasNombre) {
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
        if (entry.value && entry.wrap) {
          // Parte en varias líneas: hay datos que no se pueden abreviar. Y el
          // corte va por las comas, porque una dirección se lee por sus comas
          // y no por donde se acabe la columna.
          const ancho = colWidth - labelWidth;
          const lineas = wrapPreferringCommas(
            entry.value,
            (t) => this.font.widthOfTextAtSize(t, size) <= ancho,
            (t) => this.wrap(t, size, this.font, ancho)
          );
          lineas.forEach((ln, i) => {
            this.put(ln, x + (i === 0 ? labelWidth : 0), cy, size, this.font, BODY);
            if (i < lineas.length - 1) cy -= lineHeight;
          });
        } else if (entry.value) {
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
   * The totals stack the invoice puts bottom-right: hairline above each row.
   *
   * The total line is the SAME SIZE as the rows above it and stands out by
   * colour and weight alone. Set larger it shouted, and it does not need to
   * shout: it is visibly the sum of the two lines directly above.
   */
  totalsBlock(
    rows: { label: string; value: string; total?: boolean }[],
    opts: { size?: number; leading?: number } = {}
  ): void {
    const width = (this.pageWidth - this.margin * 2) * 0.62;
    const x = this.pageWidth - this.margin - width;
    const size = opts.size ?? 8.8;
    const leading = opts.leading ?? 2;

    for (const row of rows) {
      const height = size * leading;
      this.ensureSpace(height);

      this.page.drawLine({
        start: { x, y: this.y },
        end: { x: this.pageWidth - this.margin, y: this.y },
        thickness: row.total ? 0.8 : 0.4,
        color: row.total ? INK : RULE
      });

      // Same face and size throughout; the total is told apart by colour.
      const labelFont = this.fontFor(row.total ? 'display' : 'bodyBold', row.label);
      const valueFont = row.total ? this.fontFor('display', row.value) : this.bold;
      const valueWidth = valueFont.widthOfTextAtSize(row.value, size);
      const baseline = this.y - size - 4;

      this.put(
        this.truncate(row.label.toUpperCase(), labelFont, size, width - valueWidth - 10),
        x,
        baseline,
        size,
        labelFont,
        row.total ? BRAND : MUTED
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
   * El detalle de una factura: UDS · DESCRIPCIÓN · BASE · IVA · IMPORTE.
   *
   * Está calcado de la factura que la empresa ya emite —cabecera en versalitas
   * grises, filete fino encima y debajo del bloque, importes alineados a la
   * derecha— porque ese documento es la referencia visual de todo lo demás.
   *
   * La descripción es la única columna que envuelve: es donde va «Alquiler de
   * vehículo sin conductor Dacia Duster, matrícula 4928 LKL, según contrato
   * C-KX7TH9-2026», que son tres líneas. Las otras cuatro son cifras cortas y
   * anchura fija.
   *
   * ⚠️ **La cabecera se repite si la tabla salta de página.** Una segunda hoja
   * con cifras y sin columnas no se puede leer, y una factura de veinte líneas
   * es perfectamente posible.
   */
  lineItemsTable(
    headers: { units: string; description: string; base: string; vat: string; amount: string },
    rows: { units: string; description: string; base: string; vat: string; amount: string }[],
    opts: { size?: number } = {}
  ): void {
    const size = opts.size ?? 8;
    const lineHeight = size * 1.45;
    const left = this.margin;
    const right = this.pageWidth - this.margin;
    const width = right - left;

    // Anchos fijos para las cifras; la descripción se queda con el resto.
    const wUnits = 26;
    const wBase = 68;
    const wVat = 42;
    const wAmount = 74;
    const wDesc = width - wUnits - wBase - wVat - wAmount - 16;
    const xUnits = left;
    const xDesc = left + wUnits + 4;
    const xBase = xDesc + wDesc + 6;
    const xVat = xBase + wBase;
    const xAmount = xVat + wVat;

    const derecha = (text: string, x: number, w: number, baseline: number, bold = false) => {
      const font = bold ? this.bold : this.font;
      const tw = font.widthOfTextAtSize(text, size);
      this.put(text, x + w - tw, baseline, size, font, BODY);
    };

    const drawHeader = () => {
      this.ensureSpace(lineHeight * 2);
      const baseline = this.y - size;
      this.put(headers.units, xUnits, baseline, size - 0.6, this.font, MUTED);
      this.put(headers.description, xDesc, baseline, size - 0.6, this.font, MUTED);
      const cab = (t: string, x: number, w: number) => {
        const tw = this.font.widthOfTextAtSize(t, size - 0.6);
        this.put(t, x + w - tw, baseline, size - 0.6, this.font, MUTED);
      };
      cab(headers.base, xBase, wBase);
      cab(headers.vat, xVat, wVat);
      cab(headers.amount, xAmount, wAmount);
      this.y -= lineHeight * 0.9;
      this.page.drawLine({
        start: { x: left, y: this.y },
        end: { x: right, y: this.y },
        thickness: 0.6,
        color: RULE
      });
      this.y -= 6;
    };

    drawHeader();

    for (const row of rows) {
      const lines = this.wrap(row.description, size, this.font, wDesc);
      const alto = lineHeight * Math.max(1, lines.length) + 6;

      // Si la fila no cabe entera, salta con su cabecera: partir una
      // descripción entre dos páginas deja huérfano el importe.
      if (this.y - alto < this.floor) {
        this.newPage();
        drawHeader();
      }

      const primera = this.y - size;
      // La cantidad se alinea con la PRIMERA línea de la descripción, no con
      // el centro del bloque: si no, una descripción de tres líneas deja el «1»
      // flotando en mitad de la nada.
      this.put(row.units, xUnits, primera, size, this.font, BODY);
      lines.forEach((ln, i) => {
        this.put(ln, xDesc, this.y - size - i * lineHeight, size, this.font, BODY);
      });
      derecha(row.base, xBase, wBase, primera);
      derecha(row.vat, xVat, wVat, primera);
      derecha(row.amount, xAmount, wAmount, primera, true);

      this.y -= alto;
    }

    this.page.drawLine({
      start: { x: left, y: this.y + 2 },
      end: { x: right, y: this.y + 2 },
      thickness: 0.6,
      color: RULE
    });
    this.y -= 6;
  }

  /**
   * Two-column row where the right value wraps over several lines.
   *
   * The wrap width is now derived from the label rather than fixed at 320pt:
   * a long label used to leave the value nowhere to go and the two ran
   * together on the first line.
   */
  twoColumnWrap(
    left: string,
    right: string,
    leftBold = false,
    rightWidth?: number,
    opts: { size?: number; leading?: number } = {}
  ): void {
    const size = opts.size ?? 8.2;
    const lf = leftBold ? this.bold : this.font;
    const gap = 12;
    const labelWidth = lf.widthOfTextAtSize(left, size);
    const maxRight = this.pageWidth - this.margin * 2 - labelWidth - gap;
    const width = Math.max(120, Math.min(rightWidth ?? maxRight, maxRight));

    const lines = this.wrap(right, size, this.font, width);
    const lineHeight = size * (opts.leading ?? 1.5);
    this.ensureSpace(lineHeight * Math.max(1, lines.length) + 2);
    // The label's allowance is derived from a wrap width that was itself
    // derived from the label, so recomputing it lands a hair BELOW the label's
    // own measured width in floating point — and the ellipsis machinery then
    // ate two characters off a label that fits. "Lugar de entre…" on a line
    // with room to spare, on a PDF where there is no tooltip to reveal the
    // rest. Only truncate when the label genuinely does not fit, which now
    // only happens once the 120pt floor above has claimed the room.
    const labelMax = this.pageWidth - this.margin * 2 - width - gap;
    // Misma regla de color que `twoColumn`: una etiqueta de ficha —la que
    // termina en dos puntos— va en tinta de cuerpo, y solo el texto suelto de
    // la columna izquierda va apagado. Sin ella «Domicilio:» era la única
    // etiqueta gris de una lista de etiquetas negras, porque es la única que
    // envuelve y por tanto la única que pasa por aquí.
    this.put(
      labelWidth <= labelMax + 0.25 ? left : this.truncate(left, lf, size, labelMax),
      this.margin,
      this.y - size,
      size,
      lf,
      left.endsWith(':') || leftBold ? BODY : MUTED
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

  /**
   * One of the front-page highlights: a number, the text, a hairline under it.
   *
   * It used to be a tinted, bordered box with the number reversed out of a
   * solid green square — nine of those stacked read as a warning notice rather
   * than a summary, and the squares were the loudest thing on the page. The
   * quiet version keeps the same information and the same reading order: the
   * number in brand colour does the counting, the rule does the separating.
   *
   * The text is also smaller than it was (11.5 → 9.2, the clause size), so the
   * summary no longer looks more important than the contract it summarises.
   */
  highlightBox(index: number, text: string, opts: { size?: number; gap?: number } = {}): void {
    const size = opts.size ?? 9.2;
    const numberColumn = 16;
    const lineHeight = size * 1.45;
    const gapAfter = opts.gap ?? 7;

    const lines = this.wrap(
      text,
      size,
      this.font,
      this.pageWidth - this.margin * 2 - numberColumn
    );
    const blockHeight = lineHeight * lines.length + gapAfter;
    this.ensureSpace(blockHeight + 4);

    const numStr = String(index);
    const numFont = this.fontFor('display', numStr);
    const firstBaseline = this.y - size;
    this.put(numStr, this.margin, firstBaseline, size, numFont, BRAND);

    const tx = this.margin + numberColumn;
    let ty = firstBaseline;
    for (const ln of lines) {
      this.put(ln, tx, ty, size, this.font, BODY);
      ty -= lineHeight;
    }

    this.y = ty - gapAfter * 0.5;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.pageWidth - this.margin, y: this.y },
      thickness: 0.4,
      color: RULE
    });
    this.y -= gapAfter * 0.5;
  }

  /**
   * Clause block: title in the brand face, then justified paragraphs.
   *
   * Three deliberate choices, all about how a page of legal text reads:
   *
   *   - **Condensed.** DejaVu is a wide face and set at 10pt it sprawled.
   *     9.2pt over a 1.38 line brings the measure back to something you can
   *     actually read a column of.
   *   - **Justified.** Legal text with a ragged right edge reads like a draft.
   *   - **Air between paragraphs.** They used to run into each other with 2pt
   *     between them, so a clause looked like one undifferentiated block.
   */
  clause(clauseNumber: number, title: string, paragraphs: string[]): void {
    const size = 9.2;
    const titleSize = 10;
    /**
     * Interlineado 1,5, no 1,38.
     *
     * A 9,2 pt y con la línea ocupando el ancho completo de la caja, 1,38 deja
     * los renglones tan juntos que el ojo pierde el sitio al saltar de uno a
     * otro. Un pliego de condiciones compuesto por alguien va entre 1,45 y
     * 1,55; por debajo se lee como un volcado de texto.
     */
    const lineHeight = size * 1.5;
    /**
     * Y el párrafo respira **más** que la línea, no menos.
     *
     * Con 0,75× el cuerpo, la separación entre párrafos era inferior a un
     * renglón: la cláusula se leía como un bloque continuo y había que buscar
     * dónde empieza cada idea.
     */
    const paragraphGap = size * 0.95;
    const width = this.pageWidth - this.margin * 2;

    // Title — strip any existing "N. " prefix from the schema-stored title
    // (we render the number ourselves), and uppercase for the legal style.
    const cleaned = title.replace(/^\d+\.\s*/, '').toUpperCase();
    const titleStr = `${clauseNumber}. ${cleaned}`;
    /**
     * El título nunca se queda solo al pie de la página.
     *
     * Reservando sitio únicamente para él, un salto podía dejar «9. DAÑOS AL
     * VEHÍCULO» como última línea y su primer párrafo al principio de la hoja
     * siguiente. Se reservan además **dos renglones** de cuerpo: si no caben,
     * la cláusula entera empieza en la página nueva.
     */
    this.ensureSpace(titleSize * 1.6 + lineHeight * 2);
    this.text(titleStr, { size: titleSize, role: 'display', color: INK, gap: 4 });

    // Body — each line goes through ensureSpace so a paragraph that reaches
    // the bottom breaks onto the next page instead of over the legal footer.
    for (const para of paragraphs) {
      const lines = this.wrap(para, size, this.font, width);
      lines.forEach((ln, i) => {
        /**
         * Viudas y huérfanas.
         *
         * Con `ensureSpace(lineHeight)` a secas, un párrafo podía dejar su
         * primera línea sola al pie —huérfana— o arrastrar la última sola a la
         * página siguiente —viuda—. Las dos se leen como un fallo de
         * impresión.
         *
         * Se pide sitio para dos renglones cuando quedan dos o más por
         * componer: así el salto cae siempre con al menos dos líneas a cada
         * lado. Con una sola línea pendiente no hay nada que hacer, y pedir el
         * doble abriría un hueco sin motivo.
         */
        const quedanDos = i < lines.length - 1;
        this.ensureSpace(quedanDos ? lineHeight * 2 : lineHeight);
        // The last line of a paragraph keeps its natural width; justifying it
        // would stretch two words across the page.
        const isLast = i === lines.length - 1;
        if (isLast) {
          this.put(ln, this.margin, this.y - size, size, this.font, BODY);
        } else {
          this.putJustified(ln, this.margin, this.y - size, size, this.font, BODY, width);
        }
        this.y -= lineHeight;
      });
      this.y -= paragraphGap;
    }
    this.y -= 2;
  }

  /**
   * Draw a line of text stretched to exactly `targetWidth` by widening the
   * spaces between words.
   *
   * pdf-lib has no justification, so the words are placed one by one. A line
   * with a single word is left alone — there is nowhere to put the slack.
   */
  private putJustified(
    line: string,
    x: number,
    baselineY: number,
    size: number,
    font: PDFFont,
    color: RGB,
    targetWidth: number
  ): void {
    const words = line.split(' ').filter((w) => w.length);
    if (words.length < 2) {
      this.put(line, x, baselineY, size, font, color);
      return;
    }

    const wordsWidth = words.reduce((sum, w) => sum + font.widthOfTextAtSize(w, size), 0);
    const slack = targetWidth - wordsWidth;
    const gap = slack / (words.length - 1);

    // A wrapped line should never need to shrink; if the maths says otherwise,
    // fall back rather than overlapping words.
    if (gap <= 0) {
      this.put(line, x, baselineY, size, font, color);
      return;
    }

    /**
     * ⚠️ **Una línea no se estira sin límite.**
     *
     * Justificar a ciegas es lo que más delata a un documento hecho por una
     * máquina: cuando la última palabra que cabía es larga, la línea queda
     * corta y el hueco se reparte entre pocas palabras, abriendo esos «ríos» de
     * blanco que atraviesan el párrafo. Una caja de composición de verdad
     * renuncia a justificar antes que hacer eso.
     *
     * El tope es el ancho natural del espacio: si hay que meter más de ese
     * ancho **extra** en cada hueco —es decir, doblar el espaciado— la línea se
     * deja en bandera. Se nota mucho menos un renglón que acaba antes que un
     * párrafo agujereado.
     */
    const spaceWidth = font.widthOfTextAtSize(' ', size);
    if (gap > spaceWidth * 2) {
      this.put(line, x, baselineY, size, font, color);
      return;
    }

    let cx = x;
    for (const word of words) {
      this.page.drawText(word, { x: cx, y: baselineY, size, font, color });
      cx += font.widthOfTextAtSize(word, size) + gap;
    }
    this.boxes.push({
      page: this.pageNumber,
      x,
      y: baselineY,
      width: targetWidth,
      height: size,
      text: line,
      font,
      isChrome: this.drawingChrome
    });
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
    /** Wording for the lessor's digital signature. */
    digitallySignedLabel: string;
    /**
     * QR y Código Seguro de Verificación, en la casilla del arrendador (N-9).
     *
     * Convive con `digitallySignedLabel` en vez de sustituirla: son dos hechos
     * distintos y cada uno es cierto por su cuenta. La frase dice que el PDF
     * lleva el sello del certificado de la empresa; el QR sirve para comprobar
     * **una copia impresa**, que es donde no hay firma electrónica que valer.
     * Si el sellado falla, desaparece la frase y el QR se queda.
     */
    verification?: {
      code: string;
      url: string;
      urlLabel: string;
      /** «Verifica la autenticidad de este contrato en:», ya traducido. */
      prompt: string;
    };
    /**
     * «Firmado el {fecha} por {nombre}», bajo la columna del ARRENDATARIO.
     *
     * Viaja aquí y no como una línea suelta después del bloque porque el texto
     * normal del builder arranca en el margen izquierdo, que es la columna del
     * arrendador: la frase acababa debajo de la casilla de la empresa,
     * atribuyéndole a ella la firma que había hecho el cliente.
     */
    renterSignedNote?: string;
  }): void {
    const boxH = opts.boxHeight ?? 90;
    const innerW = this.pageWidth - this.margin * 2 - 30;
    const colW = innerW / 2;
    this.y -= 6;
    this.ensureSpace(boxH + 60);
    const topY = this.y;
    const leftX = this.margin;
    const rightX = this.margin + colW + 30;

    // Only the renter gets a box: it is the one that has to be filled in.
    this.page.drawRectangle({
      x: rightX,
      y: topY - boxH,
      width: colW,
      height: boxH,
      borderColor: BOX_BORDER,
      borderWidth: 0.5
    });

    /**
     * The lessor does not sign here.
     *
     * VELTO MOBILITY signs with a digital certificate, so an empty ruled box on
     * its side was asking for a handwritten signature that is never coming —
     * and an unsigned-looking box on a contract reads badly.
     *
     * ⚠️ **La línea solo se imprime si el PDF se va a sellar de verdad.**
     * Antes salía siempre, con un TODO al lado admitiendo que el certificado no
     * se aplicaba: el contrato afirmaba al cliente una firma digital que no
     * existía. Ahora quien lo decide es `isSigningConfigured()`, así que sin
     * certificado la casilla queda solo con la razón social y el NIF — cierto,
     * aunque diga menos.
     */
    if (opts.verification) {
      /**
       * QR a la izquierda, texto a su derecha, en una sola columna.
       *
       * Nada se pinta **debajo** del QR a propósito: ahí el texto quedaría a
       * la altura de la última línea de la derecha, y una frase larga en
       * rumano bastaría para que las dos se tocaran. Con una sola columna de
       * texto el solape es imposible por construcción, no por suerte.
       */
      const qrSize = 68;
      const qrTop = topY - 4;
      this.drawQr(buildQrMatrix(opts.verification.url), leftX, qrTop - qrSize, qrSize);

      const textX = leftX + qrSize + 10;
      const textW = colW - qrSize - 10;
      let ty = qrTop - 14;

      if (opts.digitallySignedLabel) {
        const labelFont = this.fontFor('displayMedium', opts.digitallySignedLabel);
        for (const line of this.wrap(opts.digitallySignedLabel, 7, labelFont, textW)) {
          this.put(line, textX, ty, 7, labelFont, BRAND);
          ty -= 9;
        }
        ty -= 5;
      }

      for (const line of this.wrap(opts.verification.prompt, 6.8, this.font, textW)) {
        this.put(line, textX, ty, 6.8, this.font, MUTED);
        ty -= 8.5;
      }
      this.put(this.truncate(opts.verification.urlLabel, this.font, 7, textW), textX, ty, 7, this.font, BODY);
      ty -= 12;
      // El código va en negrita y algo mayor: es lo único de este bloque que
      // alguien va a teclear a mano desde un papel.
      this.put(this.truncate(opts.verification.code, this.bold, 9, textW), textX, ty, 9, this.bold, INK);
    } else if (opts.digitallySignedLabel) {
      this.put(
        opts.digitallySignedLabel,
        leftX,
        topY - 46,
        8,
        this.fontFor('displayMedium', opts.digitallySignedLabel),
        BRAND
      );
    }

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

    // La constancia de la firma, en la columna de quien firmó. Se parte en
    // varias líneas en vez de truncarse: lleva dentro el nombre del firmante,
    // y un nombre cortado con puntos suspensivos en una constancia de firma no
    // vale para nada.
    if (opts.renterSignedNote) {
      const noteFont = this.italic;
      for (const line of this.wrap(opts.renterSignedNote, 8, noteFont, colW)) {
        this.put(line, rightX, this.y - 8, 8, noteFont, MUTED);
        this.y -= 10;
      }
      this.y -= 2;
    }
  }

  skip(dy: number): void {
    this.y -= dy;
  }
}

/** Company data as it appears under the name in the masthead. */
export function companyHeaderLines(company: {
  taxId?: string;
  address?: string;
  officeAddress?: string;
  phone?: string;
  email?: string;
}): string[] {
  return [
    company.taxId ? `NIF ${company.taxId.toUpperCase()}` : '',
    /**
     * La **oficina**, no el domicilio social.
     *
     * Esta cabecera es la marca hablándole al cliente: el teléfono y el correo
     * de al lado son los que va a usar, y la dirección tiene que ser la misma
     * lógica — dónde encuentra a alguien. El domicilio social sigue en el pie
     * legal de cada página y en el bloque del arrendador, que es donde es un
     * dato registral y no una indicación de cómo llegar.
     *
     * Cae al social si no hay comercial: para una empresa cuya oficina es su
     * domicilio social, las dos son la misma y no hay nada que distinguir.
     */
    company.officeAddress || company.address || '',
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
    authorisedDrivers:
      loc === 'en'
        ? 'Additional authorised drivers'
        : loc === 'ro'
          ? 'Conducători autorizați suplimentari'
          : 'Conductores autorizados adicionales',
    driverDoc: loc === 'en' ? 'ID' : loc === 'ro' ? 'Act de identitate' : 'DNI/NIE',
    driverLic: loc === 'en' ? 'Licence' : loc === 'ro' ? 'Permis' : 'Permiso',
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
    // No "(VAT incl.)": it sits directly under the base and the tax, so the
    // sum is self-evident and the qualifier only made the line longer.
    rentalTotal:
      loc === 'en' ? 'Total rental' : loc === 'ro' ? 'Total închiriere' : 'Total alquiler',
    deposit: loc === 'en' ? 'Security deposit' : loc === 'ro' ? 'Garanție (fianță)' : 'Fianza',
    includedKm:
      loc === 'en'
        ? 'Included mileage'
        : loc === 'ro'
          ? 'Kilometraj inclus'
          : 'Kilometraje incluido',
    extraKmPrice:
      loc === 'en'
        ? 'Additional kilometre'
        : loc === 'ro'
          ? 'Kilometru suplimentar'
          : 'Kilómetro adicional',
    unlimitedKm:
      loc === 'en' ? 'Unlimited' : loc === 'ro' ? 'Nelimitat' : 'Ilimitado',
    noFranchise:
      loc === 'en'
        ? 'No excess: the renter does not bear a deductible for covered damage'
        : loc === 'ro'
          ? 'Fără franșiză: locatarul nu suportă o franșiză pentru daunele acoperite'
          : 'Sin franquicia: el arrendatario no soporta franquicia por los daños cubiertos',
    franchise: loc === 'en' ? 'Excess' : loc === 'ro' ? 'Franșiză' : 'Franquicia',
    insurer: loc === 'en' ? 'Insurer' : loc === 'ro' ? 'Asigurător' : 'Aseguradora',
    roadside:
      loc === 'en'
        ? 'Roadside assistance'
        : loc === 'ro'
          ? 'Asistență rutieră'
          : 'Asistencia en carretera',
    gpsFitted:
      loc === 'en'
        ? 'Fitted with a GPS tracking device'
        : loc === 'ro'
          ? 'Dotat cu dispozitiv de localizare GPS'
          : 'Equipado con localizador GPS',
    noDeposit: loc === 'en' ? 'Not required' : loc === 'ro' ? 'Nu se solicită' : 'No se solicita',
    digitallySigned:
      loc === 'en'
        ? 'Digitally signed with a qualified certificate'
        : loc === 'ro'
          ? 'Semnat digital cu certificat calificat'
          : 'Firmado digitalmente con certificado digital',
    /**
     * ⚠️ **«Comprueba» y no «valida la firma».** El QR confirma que este
     * contrato existe y que el fichero es el que emitimos; la firma electrónica
     * la valida Adobe o VALIDe abriendo el PDF. Prometer lo segundo sería
     * repetir el error de la frase que afirmaba una firma que no existía.
     */
    verifyPrompt:
      loc === 'en'
        ? 'Check this contract at:'
        : loc === 'ro'
          ? 'Verifică acest contract la:'
          : 'Comprueba este contrato en:',
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
    transmission: loc === 'en' ? 'Transmission' : loc === 'ro' ? 'Transmisie' : 'Transmisión'
  };

  const doc = await PDFDocument.create();
  // Metadatos: marca. El título del PDF es lo que el cliente ve en la pestaña
  // del navegador y en el nombre de la descarga.
  doc.setTitle(`${input.company.brandName} — ${L.headerLabel} ${input.contractNumber || ''}`.trim());
  doc.setAuthor(input.company.brandName);
  doc.setSubject(`${L.headerLabel} — ${input.contractNumber || ''}`);
  doc.setCreator(input.company.brandName);
  doc.setProducer(`${input.company.brandName} · pdf-lib`);

  const b = new PdfBuilder(doc);
  await b.init(L.headerLabel, input.contractNumber || '', companyFooterLines(input.company));

  // -------------------------------------------------------------------------
  // PAGE 1 — COVER + FRONT-PAGE SUMMARY
  // -------------------------------------------------------------------------
  b.documentHeader({
    // Cabecera: marca. Los datos fiscales van justo debajo, en `companyLines`,
    // y la razón social completa en el pie legal de cada página.
    companyName: input.company.brandName,
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

  // La portada NO repite la ficha del arrendador. La llevaba entera —razón
  // social, NIF, domicilio, teléfono, email— y las mismas seis líneas vuelven a
  // salir una página después en REUNIDOS, además de estar ya en la cabecera de
  // esta misma página y en el pie legal de todas. Tres copias del mismo dato a
  // la vista es lo que delata un documento montado por una máquina: quien
  // maqueta a mano no repite la ficha del emisor dos veces seguidas. La póliza
  // que colgaba de aquí tampoco se pierde: se imprime en «Datos del vehículo»,
  // que es donde la cláusula del seguro dice que está.

  // -------------------------------------------------------------------------
  // PAGE 2 — DATOS DE LA OPERACIÓN
  // -------------------------------------------------------------------------
  b.newPage();
  b.section(L.partiesHeader);
  // Lessor (Company) block
  b.subsection(L.company);
  b.twoColumn(L.legalName + ':', input.company.legalName, false, true);
  b.twoColumn(L.taxId + ':', input.company.taxId);
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

  /**
   * Conductores autorizados, si los hay.
   *
   * Va pegado al arrendatario y no en una sección propia a propósito: son una
   * extensión de quién puede conducir, no un apartado del contrato. Se imprime
   * una línea por persona, con su documento y su permiso, que es lo que la
   * cláusula 2 pide para identificarlas nominalmente.
   */
  if (input.additionalDrivers?.length) {
    b.y -= 2;
    b.subsection(L.authorisedDrivers);
    for (const driver of input.additionalDrivers) {
      const detalle = [
        driver.documentNumber ? `${L.driverDoc} ${driver.documentNumber}` : '',
        driver.drivingLicenseNumber ? `${L.driverLic} ${driver.drivingLicenseNumber}` : ''
      ]
        .filter(Boolean)
        .join(' · ');
      // El nombre en la etiqueta y los identificadores en el valor: así una
      // cuadrilla de cuatro se lee como una lista y no como un párrafo.
      b.twoColumnWrap(driver.fullName + (detalle ? ':' : ''), detalle);
    }
  }

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
  if (input.vehicle.fuelType) b.twoColumn(L.fuel + ':', fuelTypeLabel(input.vehicle.fuelType, loc));
  if (input.vehicle.transmission) b.twoColumn(L.transmission + ':', transmissionLabel(input.vehicle.transmission, loc));

  /**
   * Seguro y asistencia, **aquí y no en el bloque del arrendador**.
   *
   * La cláusula de accidentes dice literalmente que la aseguradora, el número
   * de póliza y el teléfono de asistencia «constan en la sección Datos del
   * vehículo». No constaban: se pintaban con los datos de la empresa, o no se
   * pintaban en absoluto. Un contrato que remite a un dato que no está es un
   * contrato que no se puede ejecutar cuando hace falta — y hace falta
   * justamente el día del accidente.
   */
  if (input.vehicle.insurerName) b.twoColumn(L.insurer + ':', input.vehicle.insurerName);
  if (input.vehicle.insurancePolicy) {
    b.twoColumn(L.insurance + ':', input.vehicle.insurancePolicy);
  }
  if (input.vehicle.roadsideAssistancePhone) {
    b.twoColumn(L.roadside + ':', input.vehicle.roadsideAssistancePhone, true, true);
  }
  // El aviso de geolocalización va donde el cliente mira el coche, no escondido
  // entre las cláusulas: informar de que el vehículo se localiza es una
  // obligación, no una letra pequeña.
  if (input.vehicle.hasGpsTracker) b.twoColumn(L.gpsFitted, '');

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
  // ⚠️ Everything down to the taxable base is NET, including the tariff and
  // both discounts. VAT is ADDED on top of `netPrice`; extracting it from the
  // total instead would shrink every contract by 21 %.
  b.section(L.priceDeposit);

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

  const vat = vatBreakdownOf(input.reservation);
  b.totalsBlock([
    { label: L.vatBase, value: formatMoney(vat.base, loc) },
    { label: `${L.vat} (${vat.percent} %)`, value: formatMoney(vat.vat, loc) },
    { label: L.rentalTotal, value: formatMoney(vat.total, loc), total: true },
    // Not every rental carries a deposit. Printing "0,00 €" against "Fianza"
    // reads like something failed to load; saying it is not required does not.
    {
      label: input.reservation.depositAmount ? L.depositVatNote : L.deposit,
      value: input.reservation.depositAmount
        ? formatMoney(input.reservation.depositAmount, loc)
        : L.noDeposit
    },
    /**
     * El kilometraje va aquí, junto al dinero, porque es un pacto económico:
     * de él sale el cargo por kilómetros de la devolución.
     *
     * Se imprime el total del alquiler —incluidos/día × días— y no la cifra
     * diaria: es la que el cliente tiene que vigilar, y la que se compara con
     * la lectura del cuadro al devolver.
     */
    ...(input.reservation.includedKmPerDay && input.reservation.totalDays
      ? [
          {
            label: L.includedKm,
            value: `${formatNumber(
              input.reservation.includedKmPerDay * input.reservation.totalDays,
              loc
            )} km`
          }
        ]
      : [{ label: L.includedKm, value: L.unlimitedKm }]),
    ...(input.reservation.includedKmPerDay && input.reservation.extraKmPrice
      ? [
          {
            label: L.extraKmPrice,
            value: `${formatMoney(input.reservation.extraKmPrice, loc)}/km`
          }
        ]
      : []),
    // Sin franquicia es un dato, no una ausencia: las cláusulas de seguro la
    // mencionan y el cliente tiene que saber que no responde de nada.
    { label: L.franchise, value: L.noFranchise }
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

  /**
   * Notas finales. El sitio se **mide**, no se adivina: el `b.y < 200` que
   * había aquí era un número a ojo que no sabía cuántas notas venían ni en qué
   * idioma, así que unas veces sobraba media página y otras partía el bloque.
   */
  const notasSize = 8.5;
  const alturaNotas =
    17 + bundle.footerNotes.reduce((h, n) => h + b.heightOfText(n, { size: notasSize, gap: 7 }), 0);
  b.keepTogether(alturaNotas);
  b.y -= 4;
  b.subsection(
    loc === 'en' ? 'Final notes' : loc === 'ro' ? 'Note finale' : 'Notas finales'
  );
  for (const note of bundle.footerNotes) {
    // El mismo criterio que en las cláusulas: entre dos notas hay más aire que
    // entre dos renglones de la misma nota. Con `gap: 2` —un sexto de línea—
    // las tres se leían como un párrafo corrido y había que buscar dónde
    // empieza cada una.
    b.text(note, { size: notasSize, color: [0.3, 0.3, 0.3], gap: 7 });
  }

  // -------------------------------------------------------------------------
  // FIRMAS
  // -------------------------------------------------------------------------
  /**
   * Las firmas van **a continuación**, no en una hoja aparte por decreto.
   *
   * Con un `newPage()` incondicional aquí, las notas finales terminaban a un
   * tercio de la página y el contrato gastaba la hoja entera para no poner
   * nada, con las firmas solas en la siguiente. Dos páginas medio vacías
   * seguidas es de las cosas que más delatan un documento montado por una
   * máquina: nadie que maquete a mano deja ese hueco.
   *
   * Lo que sí importa es que el grupo no se parta —el epígrafe en una página y
   * la casilla de firma en la otra sería peor que el hueco—, así que se reserva
   * su altura completa: epígrafe, párrafo de aceptación medido en el idioma que
   * toque, y el bloque de casillas. Si no cabe, salta entero.
   */
  const alturaFirmas =
    24 +
    b.heightOfText(L.acknowledgement, { size: 9.5, role: 'bodyItalic', gap: 8 }) +
    156;
  b.keepTogether(alturaFirmas);
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
    renterPng,
    // Solo se anuncia la firma digital si el documento va a llevarla. Quien lo
    // sabe es quien construye el PDF, así que llega como dato de entrada.
    digitallySignedLabel: input.willBeDigitallySigned ? L.digitallySigned : '',
    verification: input.verification
      ? { ...input.verification, prompt: L.verifyPrompt }
      : undefined,
    renterSignedNote:
      signed && input.signedAt
        ? `${L.signedOn} ${formatDate(input.signedAt, loc)} ${L.by} ${
            input.signerName || input.client.fullName
          }`
        : undefined
  });

  // The company's identity block used to be repeated here, under the
  // signatures. It is already on the footer of every page, this one included,
  // so it said the same thing twice within a few centimetres.

  // Stamp page numbers
  b.finalizeFooters();
  input.onLayout?.(b);

  return await doc.save();
}
