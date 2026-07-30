/**
 * Centralised brand configuration for Velto.
 *
 * Single source of truth for the company name, colours, contact
 * details and asset paths.  All components and Cloud Functions that
 * need to render the brand (sidebar, sign-contract page, contract
 * PDF, Resend emails) should import this constant instead of
 * hardcoding values.
 *
 * To swap brand identity (e.g. white-label reseller), change this
 * file only.  Make sure to also update src/assets/brand/* and
 * functions/src/contracts/pdf.ts (which has its own embedded logo
 * because pdf-lib cannot read runtime paths reliably).
 */
export const BRAND_CONFIG = {
  /** Short product name (sidebar / favicon title). */
  name: 'Velto',
  /** Full legal name used in invoices, contracts and email footers. */
  legalName: 'Velto Mobility, S.L.',
  /** Public tax id shown in contracts and footer. */
  taxId: 'B88866900',
  /** Public contact email for support and reservations. */
  email: 'reservas@veltorent.com',
  /** Public phone shown on contracts and sign-contract page. */
  phone: '+34 623 766 181',
  /** Public website shown on contract and email. */
  website: 'https://www.veltorent.com',

  /** Primary brand colour (Pantone-inspired Velto green). */
  primaryColor: '#20A48F',
  /** Secondary / text colour. */
  blackColor: '#000000',
  /** Surface / paper colour. */
  whiteColor: '#FFFFFF',

  /** Wordmark (isologo + wordmark) — used in login, sign-contract, PDF. */
  logoPath: 'assets/brand/logo.svg',
  /** Isologo only (the V) — used in favicon, compact places. */
  isologoPath: 'assets/brand/isologo.svg',
  /** Favicon — used by index.html and meta theme-color. */
  faviconPath: 'assets/brand/favicon.svg',

  /** <meta name="theme-color"> for mobile browsers. */
  themeColor: '#20A48F',
} as const;

export type BrandConfig = typeof BRAND_CONFIG;
