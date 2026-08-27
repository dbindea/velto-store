/**
 * Company details that go on every customer-facing document.
 *
 * These were declared as loose constants at the top of
 * `contracts/generateContractPdf.ts`. Once the quote and the booking
 * confirmation needed the same block, a single source stopped being optional:
 * three copies of the same env-var names drift, and the drift only shows up on
 * a document already in a customer's hands.
 */

export interface CompanyConfig {
  legalName: string;
  taxId: string;
  registry: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  insurancePolicy: string;
  representativeName: string;
  representativeNie: string;
}

/**
 * Read at call time rather than at module load: Cloud Functions resolves
 * secrets after the module graph is built, and reading them too early is what
 * broke the deploy once already (F-12).
 */
export function companyConfig(): CompanyConfig {
  return {
    legalName: process.env.VELTO_COMPANY_NAME || COMPANY_LEGAL_NAME,
    taxId: process.env.VELTO_COMPANY_TAX_ID || 'B88866900',
    registry: process.env.VELTO_COMPANY_REGISTRY || COMPANY_REGISTRY,
    address: process.env.VELTO_COMPANY_ADDRESS || COMPANY_ADDRESS,
    phone: process.env.VELTO_COMPANY_PHONE || '+34 623 766 181',
    email: process.env.VELTO_COMPANY_EMAIL || 'reservas@veltorent.com',
    website: process.env.VELTO_COMPANY_WEBSITE || 'www.veltorent.com',
    insurancePolicy: process.env.VELTO_COMPANY_INSURANCE || '',
    representativeName: process.env.VELTO_COMPANY_REP_NAME || '',
    representativeNie: process.env.VELTO_COMPANY_REP_NIE || ''
  };
}

/**
 * Written in capitals on purpose. The name is set this way on every document
 * the company issues, so it is stored uppercase rather than uppercased at each
 * render — otherwise one template forgets and the branding goes soft.
 */
export const COMPANY_LEGAL_NAME = 'VELTO MOBILITY, S.L.';

export const COMPANY_ADDRESS = 'C/ Vereda del Melero, 3 · 28500 Arganda del Rey (Madrid)';

/**
 * Registry line, copied from the invoice footer.
 *
 * ⚠️ This replaces what the code carried before —"Tomo 45067, Folio 44, Hoja
 * M-793170"— which does not match the invoice ("Hoja M-893718 · IRUS
 * 1000477431057"). The invoice is the document that actually goes to
 * customers, so it wins; worth a second look with the gestoría.
 */
export const COMPANY_REGISTRY =
  'Sociedad Limitada inscrita en el Registro Mercantil de Madrid · Hoja M-893718 · ' +
  'IRUS: 1000477431057 · Folio electrónico inscripción: 1';
