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
 */

export type PaymentType =
  | 'initial_payment'      // Señal inicial al reservar
  | 'remaining_payment'    // Resto del alquiler
  | 'rental_payment'       // Pago completo del alquiler
  | 'deposit'              // Fianza cobrada
  | 'deposit_refund'       // Devolución de fianza
  | 'deposit_retention'    // Retención de fianza
  | 'extra_charge'         // Cargo extra genérico
  | 'fuel_charge'          // Combustible faltante
  | 'cleaning_charge'      // Limpieza especial
  | 'extra_km_charge'      // Kilómetros extra
  | 'penalty'              // Penalización (ej: repostaje)
  | 'fine'                 // Multa
  | 'other';

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

  reservationId: string;
  clientId: string;
  vehicleId: string;

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
  extra_charge: 'payments.types.extraCharge',
  fuel_charge: 'payments.types.fuelCharge',
  cleaning_charge: 'payments.types.cleaningCharge',
  extra_km_charge: 'payments.types.extraKmCharge',
  penalty: 'payments.types.penalty',
  fine: 'payments.types.fine',
  other: 'payments.types.other'
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
