/**
 * Contract types — shared between Angular frontend and Cloud Functions.
 *
 * Lives in functions/ because the clauses bundle is generated server-side
 * and the contract PDF renderer is a Cloud Function.
 *
 * The Angular app has its own copy of these types in
 * src/app/shared/models/contract.model.ts — they are intentionally kept in
 * sync because the two compilation units (Angular ngc and tsc for
 * functions) do not share a tsconfig path-mapping.
 *
 * IMPORTANT: do not import from @shared/* or any other Angular alias
 * here — this file is consumed by Node, not by ngc.
 */

export type ContractLocale = 'es' | 'en' | 'ro';

export interface ContractClauseItem {
  /** Stable id for diffing/audit. */
  id: string;
  /** Short title (all caps in print). */
  title: string;
  /** One or more paragraphs. Each entry is a paragraph. */
  body: string[];
  /** When true, this clause must be presented in the front-page summary. */
  highlight?: boolean;
}

export interface ContractClauseBundle {
  /** Big-text 1-liner used on the front-page "Resumen". */
  highlights: string[];
  /** Full numbered legal clauses, in order. */
  clauses: ContractClauseItem[];
  /** Closing acknowledgement line above the signature block. */
  acknowledgement: string;
  /** Footer legal notes (LOPD/RGPD, jurisdiction, etc.). */
  footerNotes: string[];
}

export interface ContractClauses {
  version: number;
  defaultLocale: ContractLocale;
  available: ContractLocale[];
  t: Partial<Record<ContractLocale, ContractClauseBundle>>;
}
