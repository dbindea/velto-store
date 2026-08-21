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
 * file and the artwork in src/assets/brand/.  The contract PDF does
 * NOT render a logo today, so there is nothing to keep in sync on the
 * Cloud Functions side.
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

  /**
   * Brand artwork, in light/dark pairs.
   *
   * Naming is by the BACKGROUND the asset sits on, not by its ink colour:
   * `onDark` is the white-ink file, meant for dark surfaces. Naming them
   * `logo-light` / `logo-dark` invites exactly the inversion bug this
   * replaces — the old single isologo.svg had white ink and was rendered
   * on the light login card, where it was invisible.
   *
   * The two files in a pair MUST be geometrically identical; only the ink
   * colour changes. Otherwise the logo jumps when the theme is toggled.
   */

  /** Full lockup (isologo + wordmark) — sidebar, sign-contract, og:image. */
  logo: {
    onLight: 'assets/brand/logo-on-light.svg',
    onDark: 'assets/brand/logo-on-dark.svg',
  },

  /** Isologo only (the V) — login, compact places, apple-touch-icon. */
  isologo: {
    onLight: 'assets/brand/isologo-on-light.svg',
    onDark: 'assets/brand/isologo-on-dark.svg',
  },

  /**
   * Favicon. Single file: it adapts internally via `prefers-color-scheme`,
   * because browser chrome follows the OS theme rather than the app's own
   * light/dark toggle.
   */
  faviconPath: 'assets/brand/favicon.svg',

  /** <meta name="theme-color"> for mobile browsers. */
  themeColor: '#20A48F',
} as const;

export type BrandConfig = typeof BRAND_CONFIG;
