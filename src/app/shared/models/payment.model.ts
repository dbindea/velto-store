/**
 * Payment model for the rental business.
 * 
 * Each payment belongs to a reservation and optionally references a client and vehicle.
 * Payments can be:
 * - Manual (cash, bank transfer, Bizum, physical POS, etc.)
 * - Automatic (Redsys via Cloud Function)
 * - System-generated (deposits, refunds, etc.)
 * 
 * The full payment list is the source of truth.
 * A summary is also stored in the reservation for quick display.
 *
 * PaymentType keeps the categories narrow on purpose: only those the UI
 * actually surfaces. Anything else goes through `extra_other`.
 */

export type PaymentType =
  | 'initial_payment'      // Señal inicial al reservar
  | 'remaining_payment'    // Resto del alquiler
  | 'rental_payment'       // Pago completo del alquiler
  | 'deposit'              // Fianza cobrada
  | 'deposit_refund'       // Devolución de fianza
  | 'deposit_retention'    // Retención de fianza
  | 'extra_fuel'           // Combustible faltante
  | 'refuel_penalty'       // Penalización por no repostar
  | 'extra_cleaning'       // Limpieza especial
  | 'extra_km'             // Kilómetros extra
  | 'extra_damage'         // Daños nuevos
  | 'extra_fine'           // Multas
  | 'extra_other'          // Otros cargos
  | 'free_payment';        // Cobro libre (sin reserva)

export type PaymentDirection =
  | 'income'      // Cobro al cliente (pagos normales, fianza)
  | 'refund'      // Devolución al cliente (fianza devuelta, refunds)
  | 'retention'   // Retención (parte de fianza que se queda)
  | 'charge';     // Cargo al cliente (cargos extra)

export type PaymentMethod =
  | 'cash'
  | 'bank_transfer'
  | 'bizum'
  | 'physical_pos'
  | 'redsys'
  | 'manual_card'
  | 'other';

export type PaymentStatus =
  | 'pending'   // Esperando cobro
  | 'paid'      // Totalmente cobrado
  | 'partial'   // Parcialmente cobrado
  | 'failed'    // Falló el cobro
  | 'cancelled' // Cancelado
  | 'refunded'; // Devuelto

export type PaymentSource =
  | 'manual'        // Introducido manualmente
  | 'redsys'        // Generado vía Redsys
  | 'system'        // Generado por el sistema
  | 'whatsapp_ai';  // Generado por agente IA WhatsApp (futuro)

export interface Payment {
  id?: string;

  /**
   * Optional reservation link. Free payments (cobros libres) leave
   * this null and set `isFreePayment: true`.
   */
  reservationId?: string;
  /** Optional client link. Free payments may set this when the
   *  payer happens to be an existing client. */
  clientId?: string;
  /** Optional vehicle link. */
  vehicleId?: string;

  /** True when this payment is a "cobro libre" — not attached to any
   *  reservation. UI filters and lists use this to bucket payments. */
  isFreePayment?: boolean;
  /** Free-form payer name for cobros libres. */
  payerName?: string;
  /** Free-form payer email (used to send the Redsys link). */
  payerEmail?: string;
  /** Free-form payer phone. */
  payerPhone?: string;

  // Snapshots to preserve historical data
  reservationSnapshot?: {
    pickupDateTime?: any;
    returnDateTime?: any;
    totalDays?: number;
    finalPrice?: number;
  };

  clientSnapshot?: {
    fullName: string;
    phone?: string;
    email?: string;
    documentNumber?: string;
  };

  vehicleSnapshot?: {
    brand: string;
    model: string;
    plateNumber: string;
    acrissCode?: string;
    mainImageUrl?: string;
  };

  type: PaymentType;
  direction: PaymentDirection;
  method: PaymentMethod;
  source: PaymentSource;
  status: PaymentStatus;

  amount: number;          // Importe total esperado
  paidAmount: number;      // Importe realmente cobrado
  pendingAmount: number;   // amount - paidAmount (calculado, no confiar en almacenado)

  currency: 'EUR';

  dueDate?: any;
  paidAt?: any;

  concept: string;
  notes?: string;

  externalReference?: string;   // Redsys u otros proveedores
  internalReference: string;    // Identificador único interno

  redsys?: {
    order?: string;
    merchantCode?: string;
    terminal?: string;
    transactionType?: string;
    paymentUrl?: string;
    responseCode?: string;
    authorizationCode?: string;
    rawNotification?: any;
    notifiedAt?: any;
  };

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
}

// Labels for translation
export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  initial_payment: 'payments.types.initialPayment',
  remaining_payment: 'payments.types.remainingPayment',
  rental_payment: 'payments.types.rentalPayment',
  deposit: 'payments.types.deposit',
  deposit_refund: 'payments.types.depositRefund',
  deposit_retention: 'payments.types.depositRetention',
  extra_fuel: 'payments.types.extraFuel',
  refuel_penalty: 'payments.types.refuelPenalty',
  extra_cleaning: 'payments.types.extraCleaning',
  extra_km: 'payments.types.extraKm',
  extra_damage: 'payments.types.extraDamage',
  extra_fine: 'payments.types.extraFine',
  extra_other: 'payments.types.extraOther',
  free_payment: 'payments.types.freePayment'
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'payments.methods.cash',
  bank_transfer: 'payments.methods.bankTransfer',
  bizum: 'payments.methods.bizum',
  physical_pos: 'payments.methods.physicalPos',
  redsys: 'payments.methods.redsys',
  manual_card: 'payments.methods.manualCard',
  other: 'payments.methods.other'
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'payments.status.pending',
  paid: 'payments.status.paid',
  partial: 'payments.status.partial',
  failed: 'payments.status.failed',
  cancelled: 'payments.status.cancelled',
  refunded: 'payments.status.refunded'
};

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  pending: 'status-pending',
  paid: 'status-paid',
  partial: 'status-partial',
  failed: 'status-failed',
  cancelled: 'status-cancelled',
  refunded: 'status-refunded'
};

// Method icons (PrimeIcons)
export const PAYMENT_METHOD_ICONS: Record<PaymentMethod, string> = {
  cash: 'pi pi-money-bill',
  bank_transfer: 'pi pi-building',
  bizum: 'pi pi-mobile',
  physical_pos: 'pi pi-credit-card',
  redsys: 'pi pi-credit-card',
  manual_card: 'pi pi-credit-card',
  other: 'pi pi-question-circle'
};
