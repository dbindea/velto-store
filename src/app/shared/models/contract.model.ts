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

export interface Contract {
  id?: string;

  reservationId: string;
  clientId: string;
  vehicleId: string;

  status: ContractStatus;

  contractNumber?: string;

  reservationSnapshot: ContractReservationSnapshot;
  clientSnapshot: ContractClientSnapshot;
  vehicleSnapshot: ContractVehicleSnapshot;
  inspectionSnapshot?: ContractInspectionSnapshot;
  paymentSnapshot?: ContractPaymentSnapshot;

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

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Borrador',
  generated: 'Generado',
  pending_signature: 'Pendiente de firma',
  signed: 'Firmado',
  cancelled: 'Cancelado',
  expired: 'Caducado'
};

export const CONTRACT_STATUS_COLORS: Record<ContractStatus, string> = {
  draft: 'status-draft',
  generated: 'status-info',
  pending_signature: 'status-warning',
  signed: 'status-success',
  cancelled: 'status-muted',
  expired: 'status-error'
};
