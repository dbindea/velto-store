/**
 * Reservation model for vehicle rental management.
 * 
 * Key design decisions:
 * - Stores snapshots of vehicle and client data to preserve historical accuracy
 * - Uses pricingSnapshot to freeze price calculation at creation time
 * - Supports multi-step payment tracking (signal + remainder)
 * - Separates reservation status from payment and contract status
 */

export type ReservationStatus = 
  | 'quote' 
  | 'reserved' 
  | 'confirmed' 
  | 'delivered' 
  | 'returned' 
  | 'closed' 
  | 'cancelled';

export type ReservationPaymentStatus = 
  | 'pending' 
  | 'partial' 
  | 'paid' 
  | 'refunded';

export type ReservationContractStatus = 
  | 'pending' 
  | 'signed' 
  | 'completed' 
  | 'cancelled';

export interface ReservationPricingSnapshot {
  totalDays: number;
  appliedRule: {
    minDays: number;
    maxDays: number | null;
    pricePerDay: number;
    label?: string;
  } | null;
  pricePerDay: number;
  basePrice: number;
  manualAdjustment?: number;
  finalPrice: number;
}

export interface ReservationDeposit {
  requiredAmount: number;
  paidAmount: number;
  returnedAmount: number;
  retainedAmount: number;
  status: 'pending' | 'paid' | 'partial_returned' | 'returned' | 'retained';
}

export interface ReservationInitialPayment {
  requiredAmount: number;
  paidAmount: number;
  dueDate?: any;
  status: 'pending' | 'paid';
}

export interface ReservationRemainingPayment {
  requiredAmount: number;
  paidAmount: number;
  dueDate?: any;
  status: 'pending' | 'paid';
}

export interface Reservation {
  id?: string;

  vehicleId: string;
  vehicleSnapshot: {
    brand: string;
    model: string;
    plateNumber: string;
    acrissCode?: string;
    mainImageUrl?: string;
  };

  clientId: string;
  clientSnapshot: {
    fullName: string;
    phone?: string;
    email?: string;
    documentNumber?: string;
  };

  pickupDateTime: any;
  returnDateTime: any;

  pickupLocation?: string;
  returnLocation?: string;

  totalDays: number;

  pricingSnapshot: ReservationPricingSnapshot;

  initialPayment: ReservationInitialPayment;
  remainingPayment: ReservationRemainingPayment;
  deposit: ReservationDeposit;

  paymentStatus: ReservationPaymentStatus;
  contractStatus: ReservationContractStatus;
  reservationStatus: ReservationStatus;

  notes?: string;

  createdAt?: any;
  updatedAt?: any;
}

// Status labels for display
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  quote: 'Presupuesto',
  reserved: 'Reservado',
  confirmed: 'Confirmado',
  delivered: 'Entregado',
  returned: 'Devuelto',
  closed: 'Cerrado',
  cancelled: 'Cancelado'
};

export const PAYMENT_STATUS_LABELS: Record<ReservationPaymentStatus, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  refunded: 'Reembolsado'
};

export const CONTRACT_STATUS_LABELS: Record<ReservationContractStatus, string> = {
  pending: 'Pendiente',
  signed: 'Firmado',
  completed: 'Completado',
  cancelled: 'Cancelado'
};

// Statuses that block availability (vehicle is considered "in use")
export const BLOCKING_STATUSES: ReservationStatus[] = ['reserved', 'confirmed', 'delivered'];

// Statuses that do not block availability
export const NON_BLOCKING_STATUSES: ReservationStatus[] = ['quote', 'returned', 'closed', 'cancelled'];