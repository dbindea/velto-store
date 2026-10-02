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
  /**
   * La marca completa, tal y como se le dice a un cliente.
   *
   * ⚠️ **NO es `name` ni es `legalName`.** `name` es el nombre corto que cabe
   * en una barra lateral —«Velto»— y `legalName` es la razón social, que solo
   * aparece junto al NIF. Cuando la empresa se presenta a un cliente por
   * teléfono o por WhatsApp dice **«Velto Mobility»**: ni la abreviatura, que
   * suena a apodo interno, ni la S.L., que suena a notaría.
   *
   * Es el mismo `brandName` que `functions/src/company-config.ts` usa en los
   * documentos, aquí en capitalización normal porque esto se lee dentro de una
   * frase y no como cabecera de un PDF.
   */
  brandName: 'Velto Mobility',
  /**
   * Full legal name used in invoices, contracts and email footers.
   * Stored in capitals: that is how it is set on every document the company
   * issues, and uppercasing at each render is one template away from being
   * forgotten.
   */
  legalName: 'VELTO MOBILITY, S.L.',
  /** Public tax id shown in contracts and footer. */
  taxId: 'B88866900',
  /*
   * ⚠️ **Aquí vivían `email`, `phone` y `website`, y se fueron el 2 de octubre
   * de 2026.** Su propio comentario decía «NO los uses para nada que vea el
   * cliente» y **no los usaba nadie**: eran tres literales esperando a que
   * alguien los pintara.
   *
   * El motivo de la prohibición sigue en pie: este fichero se compila dentro
   * del bundle y la aplicación se construye **igual** para los dos entornos,
   * así que un correo escrito aquí sale idéntico en desarrollo y en
   * producción. Pasó de verdad (F-33): el pie de la pantalla pública de firma
   * llevaba `reservas@veltorent.com` a mano y el cliente de producción veía el
   * correo de desarrollo justo debajo del botón de firmar.
   *
   * Un dato que no se puede usar es mejor que no exista: mientras estuvo,
   * cualquiera podía escribir `BRAND_CONFIG.email` sin leer el aviso. Dónde
   * viven ahora:
   *
   * - el correo y el dominio público → `functions/.env.<proyecto>`
   *   (`VELTO_COMPANY_EMAIL`, `VELTO_PUBLIC_BASE_URL`), y los sirve la function
   *   a quien los necesite — como hace `getContractForSigning`;
   * - lo que imprimen los PDF → `functions/src/company-config.ts`.
   */

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
