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
/**
 * ⚠️ **`import type`, y antes era un import normal por SEIS COLORES.**
 *
 * Este fichero era el único que cargaba `pdf-lib` fuera del subárbol de
 * `pdf.ts`, y lo hacía solo para llamar a `rgb()` en seis constantes de nivel
 * superior. El precio: **156 ms de arranque en cada una de las 34 functions**,
 * porque `index.ts` las reexporta todas y basta que una cadena de imports
 * alcance esto para que el contenedor cargue el generador de PDF entero —
 * también cuando la petición es listar cuatro coches en la web pública.
 *
 * `rgb()` devuelve un **objeto plano**: comprobado, `{type, red, green, blue}`
 * sin prototipo propio. Así que las seis se escriben tal cual y el tipo se
 * importa con `import type`, que **desaparece al compilar**: el JavaScript
 * resultante no menciona `pdf-lib` por ninguna parte.
 *
 * ⚠️ Si algún día hace falta un color nuevo, se escribe igual —el valor de
 * `rgb(r,g,b)` es literalmente `{ type: 'RGB', red: r, green: g, blue: b }`— y
 * **no** se vuelve a importar `rgb`: eso devolvería los 156 ms enteros sin que
 * nada avise. Lo vigila `arranque.spec.ts`.
 */
import type { RGB } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Palette — taken from the brand SVGs and the invoice
// ---------------------------------------------------------------------------

/** Velto teal, #20A48F. Section labels, totals, the logo mark. */
export const BRAND: RGB = { type: 'RGB', red: 0x20 / 255, green: 0xa4 / 255, blue: 0x8f / 255 } as RGB;
/** Headings and the company name. */
export const INK: RGB = { type: 'RGB', red: 0, green: 0, blue: 0 } as RGB;
/** Body copy: not pure black, which prints harshly. */
export const BODY: RGB = { type: 'RGB', red: 0.13, green: 0.13, blue: 0.13 } as RGB;
/** Secondary data and the legal footer. */
export const MUTED: RGB = { type: 'RGB', red: 0.45, green: 0.45, blue: 0.45 } as RGB;
/** Hairline rules between rows and blocks. */
export const RULE: RGB = { type: 'RGB', red: 0.85, green: 0.85, blue: 0.85 } as RGB;
/** Background of the highlight boxes. */
export const TINT: RGB = { type: 'RGB', red: 0.955, green: 0.98, blue: 0.972 } as RGB;

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
