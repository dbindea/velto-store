/**
 * Client model for customer management.
 */

export interface Client {
  id?: string;
  fullName: string;
  phone?: string;
  email?: string;
  documentNumber?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface QuickClientData {
  fullName: string;
  phone?: string;
  email?: string;
  documentNumber?: string;
}