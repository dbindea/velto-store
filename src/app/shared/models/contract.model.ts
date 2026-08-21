/**
 * Contract model for rental agreements.
 *
 * Lifecycle:
 *   draft → generated → pending_signature → signed
 *   any state → cancelled | expired
 *
 * The PDF and signature are stored in Firebase Storage under
 * `contracts/{reservationId}/` paths. The contract document only
 * references URLs and paths - the binaries live in Storage.
 *
 * Sensitive operations (PDF generation, signing link creation, signature
 * capture, email send) are executed by Cloud Functions. The Angular
 * frontend never sees Resend API keys, signing secrets, or PDF signing
 * internals.
 */

export type ContractStatus =
  | 'draft'
  | 'generated'
  | 'pending_signature'
  | 'signed'
  | 'cancelled'
  | 'expired';

export interface ContractReservationSnapshot {
  pickupDateTime?: any;
  returnDateTime?: any;
  totalDays?: number;
  pickupLocation?: string;
  returnLocation?: string;
  finalPrice?: number;
  depositAmount?: number;
}

export interface ContractClientSnapshot {
  fullName: string;
  phone?: string;
  email?: string;
  documentType?: string;
  documentNumber?: string;
  address?: string;
  drivingLicenseNumber?: string;
  drivingLicenseExpiryDate?: any;
}

export interface ContractVehicleSnapshot {
  brand: string;
  model: string;
  version?: string;
  plateNumber: string;
  acrissCode?: string;
  year?: number;
  fuelType?: string;
  transmission?: string;
  mainImageUrl?: string;
}

export interface ContractInspectionSnapshot {
  pickupKm?: number;
  pickupFuelLevel?: string;
  returnKm?: number;
  returnFuelLevel?: string;
}

export interface ContractPaymentSnapshot {
  rentalTotal?: number;
  depositRequired?: number;
  depositPaid?: number;
  totalPaid?: number;
  totalPending?: number;
}

/**
 * Snapshot of the company (lessor) at the time the contract was generated.
 * Captured so the PDF and email are reproducible even if env vars change.
 */
export interface ContractCompanySnapshot {
  legalName: string;
  taxId: string;
  registry?: string;
  address: string;
  phone?: string;
  email: string;
  website?: string;
  /** Insurance policy reference, if any (for DGT / Guardia Civil). */
  insurancePolicy?: string;
  /** Authorized representatives signing on behalf of the company. */
  representativeName?: string;
  representativeNie?: string;
}

/**
 * Multilingual contract body. The same clause id is used across all
 * locales; the renderer picks the right translation from `t.{locale}`.
 * `defaultLocale` is used when the requested locale is missing.
 */
export type ContractLocale = 'es' | 'en' | 'ro';

export interface ContractClauses {
  version: number;
  defaultLocale: ContractLocale;
  available: ContractLocale[];
  t: Partial<Record<ContractLocale, ContractClauseBundle>>;
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

export interface Contract {
  id?: string;

  reservationId: string;
  clientId: string;
  vehicleId: string;

  status: ContractStatus;

  contractNumber?: string;

  /** Locale of the contract body (drives clause language). */
  locale?: ContractLocale;

  reservationSnapshot: ContractReservationSnapshot;
  clientSnapshot: ContractClientSnapshot;
  vehicleSnapshot: ContractVehicleSnapshot;
  companySnapshot?: ContractCompanySnapshot;
  inspectionSnapshot?: ContractInspectionSnapshot;
  paymentSnapshot?: ContractPaymentSnapshot;

  /** Frozen clause bundle used to render this contract. */
  clauses?: ContractClauses;

  pdfUrl?: string;
  pdfPath?: string;

  signedPdfUrl?: string;
  signedPdfPath?: string;

  signatureUrl?: string;
  signaturePath?: string;

  signingTokenId?: string;
  signingLinkPath?: string;

  signedAt?: any;
  generatedAt?: any;
  emailedAt?: any;

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
}

// i18n KEYS, never display text — see the note in vehicle.model.ts.
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'contracts.status.draft',
  generated: 'contracts.status.generated',
  pending_signature: 'contracts.status.pendingSignature',
  signed: 'contracts.status.signed',
  cancelled: 'contracts.status.cancelled',
  expired: 'contracts.status.expired'
};

export const CONTRACT_STATUS_COLORS: Record<ContractStatus, string> = {
  draft: 'status-draft',
  generated: 'status-info',
  pending_signature: 'status-warning',
  signed: 'status-success',
  cancelled: 'status-muted',
  expired: 'status-error'
};
