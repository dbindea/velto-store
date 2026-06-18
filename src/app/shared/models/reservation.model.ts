/**
 * Reservation model for vehicle rental management.
 *
 * State machine (ReservationStatus):
 *   reserved   → reservation created, vehicle blocked
 *   confirmed  → initial payment (signal) collected
 *   delivered  → pickup inspection completed, vehicle handed over
 *   returned   → return inspection completed, awaiting close
 *   closed     → deposit settled, extras settled, vehicle available again
 *   cancelled  → reservation cancelled before delivery
 *
 * Contract state machine (ReservationContractStatus):
 *   pending           → no PDF yet
 *   generated         → PDF created in Storage
 *   pending_signature → signing link issued
 *   signed            → customer has signed
 *   cancelled | expired → terminal states
 */

export type ReservationStatus =
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
  | 'settled'
  | 'refunded';

export type ReservationContractStatus =
  | 'pending'
  | 'generated'
  | 'pending_signature'
  | 'signed'
  | 'cancelled'
  | 'expired';

export interface ReservationContractInfo {
  contractId?: string;
  contractNumber?: string;
  pdfUrl?: string;
  signedPdfUrl?: string;
  signedAt?: any;
  /** The relative URL path used by the customer to sign the contract. */
  signingUrl?: string;
}

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
  /** Total amount the customer must leave on hold. Can be 0 (waived). */
  requiredAmount: number;
  paidAmount: number;
  returnedAmount: number;
  retainedAmount: number;
  /**
   * If the deposit was waived entirely (requiredAmount === 0 and paidAmount === 0),
   * operators must record why. Surfaced as "Seguro a todo riesgo" or similar.
   */
  waivedReason?: string;
  status: 'pending' | 'paid' | 'partial_returned' | 'returned' | 'retained' | 'waived';
}

/**
 * Operator-authorised exception that allowed the workflow to advance
 * past a guardrail (e.g. delivered without deposit). Required fields:
 * action, reason, createdAt, createdBy.
 */
export interface WorkflowException {
  action: string;
  reason: string;
  createdAt: any;
  createdBy?: string;
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

/**
 * Summary of the financial state of a reservation.
 * Calculated from the payments collection - this is a denormalized
 * cache for fast display, but the payments collection is the source of truth.
 */
export interface ReservationPaymentSummary {
  rentalTotal: number;
  initialPaymentRequired: number;
  initialPaymentPaid: number;
  remainingPaymentRequired: number;
  remainingPaymentPaid: number;
  depositRequired: number;
  depositPaid: number;
  depositReturned: number;
  depositRetained: number;
  extrasTotal: number;
  totalPaid: number;
  totalPending: number;
  balance: number;
  paymentStatus: ReservationPaymentStatus;
}

export interface Reservation {
  id?: string;

  vehicleId: string;
  vehicleSnapshot: {
    brand: string;
    model: string;
    plateNumber: string;
    year?: number;
    acrissCode?: string;
    fuelType?: string;
    transmission?: string;
    seats?: number;
    luggageCapacity?: number;
    currentKm?: number;
    color?: string;
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

  /** Optional inspection snapshots (delivery + return) */
  deliveryInfo?: {
    pickupInspectionId?: string;
    pickupKm?: number;
    pickupFuelLevel?: string;
    pickupCompletedAt?: any;
  };

  returnInfo?: {
    returnInspectionId?: string;
    returnKm?: number;
    returnFuelLevel?: string;
    returnCompletedAt?: any;
    extraChargesTotal?: number;
  };

  /**
   * Aggregated financial state, calculated from the payments collection.
   */
  paymentSummary?: ReservationPaymentSummary;

  /** Denormalized contract status info for quick display in the reservation card. */
  contractInfo?: ReservationContractInfo;

  /**
   * Operator-authorised exceptions that allowed the workflow to advance
   * past a guardrail. See WorkflowException.
   */
  workflowExceptions?: WorkflowException[];

  notes?: string;

  createdAt?: any;
  updatedAt?: any;
}

// Status labels for display
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
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
  settled: 'Liquidado',
  refunded: 'Reembolsado'
};

export const CONTRACT_STATUS_LABELS: Record<ReservationContractStatus, string> = {
  pending: 'Pendiente',
  generated: 'Generado',
  pending_signature: 'Pendiente de firma',
  signed: 'Firmado',
  cancelled: 'Cancelado',
  expired: 'Caducado'
};

// Statuses that block availability (vehicle is considered "in use")
export const BLOCKING_STATUSES: ReservationStatus[] = ['reserved', 'confirmed', 'delivered'];

// Statuses that do not block availability
export const NON_BLOCKING_STATUSES: ReservationStatus[] = ['returned', 'closed', 'cancelled'];