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
  /** Tariff price before any discount: totalDays × pricePerDay. */
  basePrice: number;
  /**
   * The client's loyalty discount, frozen at creation, as a PERCENTAGE
   * (5 = 5 %). Withdrawing the discount later must not move this reservation.
   */
  loyaltyDiscountPercent?: number;
  /** Money taken off by the loyalty discount. Negative, or absent. */
  loyaltyDiscount?: number;
  /**
   * Signed difference between the price agreed by hand and the tariff *after*
   * the loyalty discount. Kept apart from `loyaltyDiscount` so the contract can
   * justify each line separately.
   */
  manualAdjustment?: number;
  /**
   * Taxable base actually agreed, after both discounts. This is the round
   * number the operator negotiates, and what a customer who wants no invoice
   * pays. Absent on reservations created when tariffs were VAT-inclusive.
   */
  netPrice?: number;
  /** What the customer pays: `netPrice` plus VAT. */
  finalPrice: number;
  /**
   * VAT rate frozen at creation, as a FRACTION (0.21 = 21 %).
   * Absent on reservations created before VAT was introduced.
   */
  vatRate?: number;
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

/**
 * Internal note added by an operator (Velto staff) on a reservation.
 * Notes are NOT shown to the customer and are NOT included in the
 * contract PDF body — they live in the backoffice only.
 *
 * Notes are append-only: existing entries are never edited, only
 * new ones appended.  This preserves an audit trail per reservation.
 */
export interface ReservationNote {
  id: string;
  text: string;
  createdAt: any;
  createdBy?: string;
  createdByEmail?: string;
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
  /** Cargos extra **cobrados**. Ojo: no es lo que el cliente debe. */
  extrasTotal: number;
  /** Cargos extra **devengados**, cobrados o no. */
  extrasRequired: number;
  /** Cargos extra que quedan por cobrar. Es deuda viva del cliente. */
  extrasPending: number;
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

  /**
   * Append-only internal notes log.  Distinct from the legacy
   * `notes` scalar (which is a free-form single string used as a
   * quick summary).  Each entry is timestamped + authored so the
   * reservation-detail page can show a chronological feed.
   */
  internalNotes?: ReservationNote[];

  createdAt?: any;
  updatedAt?: any;
}

// Status labels for display
// i18n KEYS, never display text — see the note in vehicle.model.ts.
//
// The two maps below are named for the reservation's own view of payment and
// contract state. They deliberately do NOT reuse the names in payment.model.ts
// and contract.model.ts, which describe the payment and contract entities and
// have different value sets. Importing both under one name is what forced the
// `PAYMENT_STATUS_LABELS_PAYMENT` alias in client-detail.

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  reserved: 'reservations.status.reserved',
  confirmed: 'reservations.status.confirmed',
  delivered: 'reservations.status.delivered',
  returned: 'reservations.status.returned',
  closed: 'reservations.status.closed',
  cancelled: 'reservations.status.cancelled'
};

export const RESERVATION_PAYMENT_STATUS_LABELS: Record<ReservationPaymentStatus, string> = {
  pending: 'reservations.paymentStatus.pending',
  partial: 'reservations.paymentStatus.partial',
  paid: 'reservations.paymentStatus.paid',
  settled: 'reservations.paymentStatus.settled',
  refunded: 'reservations.paymentStatus.refunded'
};

/**
 * Deposit status. This map was missing entirely, so reservation-detail rendered
 * `reservation.deposit.status` raw — the operator saw the Firestore value
 * "pending" in English regardless of the selected language.
 */
export const RESERVATION_DEPOSIT_STATUS_LABELS: Record<ReservationDeposit['status'], string> = {
  pending: 'reservations.depositStatus.pending',
  paid: 'reservations.depositStatus.paid',
  partial_returned: 'reservations.depositStatus.partialReturned',
  returned: 'reservations.depositStatus.returned',
  retained: 'reservations.depositStatus.retained',
  waived: 'reservations.depositStatus.waived'
};

export const RESERVATION_CONTRACT_STATUS_LABELS: Record<ReservationContractStatus, string> = {
  pending: 'reservations.contractStatus.pending',
  generated: 'reservations.contractStatus.generated',
  pending_signature: 'reservations.contractStatus.pendingSignature',
  signed: 'reservations.contractStatus.signed',
  cancelled: 'reservations.contractStatus.cancelled',
  expired: 'reservations.contractStatus.expired'
};

// Statuses that block availability (vehicle is considered "in use")
export const BLOCKING_STATUSES: ReservationStatus[] = ['reserved', 'confirmed', 'delivered'];

// Statuses that do not block availability
export const NON_BLOCKING_STATUSES: ReservationStatus[] = ['returned', 'closed', 'cancelled'];