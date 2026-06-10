/**
 * Client model for customer management.
 * 
 * Compatible with simple clients created from Reservas (only fullName + phone/email).
 */

export type ClientDocumentType = 
  | 'dni' 
  | 'nie' 
  | 'passport' 
  | 'other';

export type ClientTrustLevel = 
  | 'new' 
  | 'known' 
  | 'regular' 
  | 'risk' 
  | 'blocked';

export type DrivingLicenseCountry = 
  | 'ES' 
  | 'RO' 
  | 'EU' 
  | 'OTHER';

export type ClientDocumentType_File = 
  | 'document_front' 
  | 'document_back' 
  | 'driving_license_front' 
  | 'driving_license_back' 
  | 'other';

export interface ClientDocumentFile {
  id?: string;
  type: ClientDocumentType_File;
  label?: string;
  url: string;
  path: string;
  fileName?: string;
  size?: number;
  contentType?: string;
  uploadedAt?: any;
}

export interface Client {
  id?: string;
  fullName: string;
  phone?: string;
  email?: string;
  
  documentType?: ClientDocumentType;
  documentNumber?: string;
  
  address?: string;
  birthDate?: any;
  
  drivingLicenseNumber?: string;
  drivingLicenseIssueDate?: any;
  drivingLicenseExpiryDate?: any;
  drivingLicenseCountry?: DrivingLicenseCountry;
  
  trustLevel: ClientTrustLevel;
  
  notes?: string;
  
  documents?: ClientDocumentFile[];
  
  createdAt?: any;
  updatedAt?: any;
}

export interface QuickClientData {
  fullName: string;
  phone?: string;
  email?: string;
  documentNumber?: string;
}

export const CLIENT_DOCUMENT_TYPE_LABELS: Record<ClientDocumentType, string> = {
  dni: 'clients.documentTypes.dni',
  nie: 'clients.documentTypes.nie',
  passport: 'clients.documentTypes.passport',
  other: 'clients.documentTypes.other'
};

export const CLIENT_TRUST_LEVEL_LABELS: Record<ClientTrustLevel, string> = {
  new: 'clients.trustLevel.new',
  known: 'clients.trustLevel.known',
  regular: 'clients.trustLevel.regular',
  risk: 'clients.trustLevel.risk',
  blocked: 'clients.trustLevel.blocked'
};

export const CLIENT_TRUST_LEVEL_COLORS: Record<ClientTrustLevel, string> = {
  new: 'trust-new',
  known: 'trust-known',
  regular: 'trust-regular',
  risk: 'trust-risk',
  blocked: 'trust-blocked'
};

export const DRIVING_LICENSE_COUNTRY_LABELS: Record<DrivingLicenseCountry, string> = {
  ES: 'España',
  RO: 'România',
  EU: 'UE',
  OTHER: 'Otro'
};

export const CLIENT_FILE_TYPE_LABELS: Record<ClientDocumentType_File, string> = {
  document_front: 'clients.documents.documentFront',
  document_back: 'clients.documents.documentBack',
  driving_license_front: 'clients.documents.drivingLicenseFront',
  driving_license_back: 'clients.documents.drivingLicenseBack',
  other: 'clients.documents.other'
};