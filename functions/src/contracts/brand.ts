/**
 * Visual identity for every PDF Velto issues.
 *
 * The reference is the invoice VELTO MOBILITY already sends: Gotham for the
 * brand and the headings, a light sans for the body, teal section labels in
 * small letter-spaced caps, hairline rules, and a grey legal footer. The
 * quote, the booking confirmation and the contract all pull from here so the
 * three read as one company.
 *
 * ⚠️ Gotham cannot render body text. It is missing the Romanian diacritics
 * (ă ș ț) AND the euro sign, so a price or a Romanian sentence set in Gotham
 * comes out as empty boxes. `pickFont()` below detects that per string and
 * falls back to DejaVu, which covers everything. This mirrors the rule the web
 * app states in styles.scss: Gotham is for headings and brand marks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { rgb, RGB } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Palette — taken from the brand SVGs and the invoice
// ---------------------------------------------------------------------------

/** Velto teal, #20A48F. Section labels, totals, the logo mark. */
export const BRAND: RGB = rgb(0x20 / 255, 0xa4 / 255, 0x8f / 255);
/** Headings and the company name. */
export const INK: RGB = rgb(0, 0, 0);
/** Body copy: not pure black, which prints harshly. */
export const BODY: RGB = rgb(0.13, 0.13, 0.13);
/** Secondary data and the legal footer. */
export const MUTED: RGB = rgb(0.45, 0.45, 0.45);
/** Hairline rules between rows and blocks. */
export const RULE: RGB = rgb(0.85, 0.85, 0.85);
/** Background of the highlight boxes. */
export const TINT: RGB = rgb(0.955, 0.98, 0.972);

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const PAGE_WIDTH = 595.28; // A4
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 50;
/**
 * Reserved strip at the bottom of every page for the legal footer.
 *
 * The footer is two lines of 6.5 pt plus a rule. Body text must stop above it:
 * before this was accounted for, a paragraph that ran to the end of a page
 * printed straight through the footer.
 */
export const FOOTER_RESERVE = 34;

export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * Assets are copied next to the compiled file by scripts/copy-fonts.js. The
 * extra candidates keep local runs working straight from src/.
 */
export function resolveAssetPath(filename: string): string | null {
  const candidates = [
    path.join(__dirname, filename),
    path.join(__dirname, '..', 'contracts', filename),
    path.join(__dirname, '..', '..', 'lib', 'contracts', filename),
    path.join(__dirname, '..', 'src', 'contracts', filename),
    path.join(process.cwd(), 'src', 'contracts', filename),
    path.join(process.cwd(), 'functions', 'src', 'contracts', filename),
    // The brand assets live in the Angular app; functions do not duplicate them.
    path.join(process.cwd(), 'src', 'assets', 'fonts', filename),
    path.join(process.cwd(), '..', 'src', 'assets', 'fonts', filename),
    path.join(process.cwd(), 'src', 'assets', 'brand', filename),
    path.join(process.cwd(), '..', 'src', 'assets', 'brand', filename)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function readAsset(filename: string): Buffer | null {
  const resolved = resolveAssetPath(filename);
  return resolved ? fs.readFileSync(resolved) : null;
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

export interface LogoPath {
  /** SVG path data. */
  d: string;
  /** True when the path is the teal part of the mark. */
  brand: boolean;
}

export interface Logo {
  paths: LogoPath[];
  viewBoxWidth: number;
  viewBoxHeight: number;
}

/**
 * Parse the app's own logo SVG into path data pdf-lib can draw.
 *
 * Reading the real SVG rather than a copied blob means the PDFs follow the
 * brand files: redraw the logo in Illustrator and the contract updates on the
 * next deploy. The file is flat — two groups of `<path>` with an optional
 * `class="cls-1"` for the teal — so a regex is enough and avoids pulling an
 * XML parser into the function bundle.
 */
export function loadLogo(filename = 'logo-on-light.svg'): Logo | null {
  const raw = readAsset(filename)?.toString('utf8');
  if (!raw) return null;

  const viewBox = /viewBox="([\d.\s-]+)"/.exec(raw);
  if (!viewBox) return null;
  const [, , w, h] = viewBox[1].trim().split(/\s+/).map(Number);
  if (!w || !h) return null;

  const paths: LogoPath[] = [];
  const re = /<path([^>]*?)d="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    paths.push({ d: m[2], brand: /class="[^"]*cls-1/.test(m[1]) });
  }

  return paths.length ? { paths, viewBoxWidth: w, viewBoxHeight: h } : null;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

export const FONT_FILES = {
  body: 'DejaVuSans.ttf',
  bodyBold: 'DejaVuSans-Bold.ttf',
  bodyItalic: 'DejaVuSans-Oblique.ttf',
  display: 'GothamBold.ttf',
  displayMedium: 'GothamMedium.ttf'
} as const;
