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

/**
 * El reparto con el dueño del coche, tal y como se pactó **el día de la
 * reserva**.
 *
 * La aritmética vive en `owner-share.util.ts`, que es la única autoridad sobre
 * qué entra en la base: el alquiler sin IVA, sin fianzas y sin cargos extra.
 */
export interface ReservationOwnerShare {
  collaboratorId: string;
  /** Copiado a propósito: una liquidación de hace meses tiene que explicarse
   *  sin depender de que la ficha siga existiendo ni de que se llame igual. */
  collaboratorName: string;
  /** Lo que se lleva el propietario, en porcentaje (`75` = 75 %). */
  sharePercent: number;
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
  /**
   * Kilómetros incluidos por día y precio del kilómetro que se pase de ahí,
   * **congelados como el precio**.
   *
   * ⚠️ Estaban solo en la ficha del vehículo, y el cargo por km extra de la
   * devolución los leía de allí: cambiar los kilómetros de un coche
   * **recalculaba el cargo de alquileres ya cerrados**. Es el mismo motivo por
   * el que el precio vive en este snapshot y no se lee de la tarifa vigente.
   *
   * Y son lo que el contrato imprime: un cargo por kilómetros que no está
   * pactado por escrito es un cargo que el cliente puede discutir con razón.
   */
  includedKmPerDay?: number;
  extraKmPrice?: number;
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
 * Una persona autorizada a conducir el vehículo además del arrendatario.
 *
 * ⚠️ **Esto no es un adorno del backoffice: la cláusula 2 del contrato lo
 * exige.** «Únicamente podrán conducir el vehículo las personas expresamente
 * declaradas por el ARRENDADOR al inicio del alquiler, que deberán ser
 * identificadas nominalmente». Hasta ahora no había dónde declararlas, así que
 * un alquiler con dos conductores incumplía su propio contrato.
 *
 * El caso real no es el segundo conductor puntual: son **cuadrillas** que
 * alquilan un coche entre varios y se turnan al volante. Por eso es una lista y
 * no un campo.
 *
 * `clientId` está cuando se eligió de la ficha de un cliente ya dado de alta
 * —lo normal con una cuadrilla que repite— y ausente cuando se tecleó a mano.
 * Los datos se copian igualmente: son un **snapshot**, como el del arrendatario,
 * y no deben moverse si mañana esa ficha cambia.
 */
export interface AdditionalDriver {
  /** Ficha de origen, si se eligió de la lista de clientes. */
  clientId?: string;
  fullName: string;
  documentNumber?: string;
  drivingLicenseNumber?: string;
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
  /**
   * ⚠️ **`waived` no es «cobrada»: es que no se pide.** Misma distinción que en
   * la fianza, y por el mismo motivo — una señal de 0 € en `pending` es una
   * deuda de cero euros que nadie puede cobrar nunca, así que la reserva se
   * quedaba en `reserved` para siempre y la ficha decía «Señal 0,00 € ·
   * Pendiente». Con `waived` la reserva nace confirmada y la pantalla dice «No
   * se solicita».
   *
   * ⚠️ **A diferencia de la fianza, aquí NO se exige motivo.** El de la fianza
   * no es papeleo: sin él `isDepositSettled()` no da la fianza por resuelta y la
   * reserva no se puede cerrar. La señal no gobierna ningún cierre — el precio
   * entero sigue exigido en `remainingPayment`, y `canStartPickup` no entrega el
   * coche sin cobrarlo. No se perdona dinero, solo se cobra más tarde.
   *
   * Valor añadido el 18 de septiembre de 2026. Es aditivo: las reservas
   * anteriores siguen leyéndose, porque ninguna lo lleva.
   */
  status: 'pending' | 'paid' | 'waived';
}

/**
 * Entrega y recogida a domicilio.
 *
 * El negocio lo entrega gratis en un radio corto alrededor de Arganda; fuera de
 * ahí se pacta un suplemento, y los dos trayectos son **independientes**: hay
 * clientes que recogen en oficina y solo piden que se les vaya a buscar.
 *
 * ⚠️ **Los importes son NETOS**, como todo lo que se negocia en esta aplicación:
 * el operador teclea el número redondo que dijo por teléfono y el IVA se suma
 * encima con el tipo congelado de la reserva. Con la casilla «sin IVA» el
 * cliente paga exactamente lo tecleado. Ver `deliveryFeeBreakdown()`.
 *
 * ⚠️ **Vive FUERA de `pricingSnapshot`, y no es colocación casual.** El reparto
 * con el dueño del coche se calcula sobre `pricingSnapshot.netPrice`
 * (`owner-share.util.ts`), y llevar el coche a 30 km es un servicio que pone la
 * agencia con su furgoneta y su hora — no lo pone el coche. Metido en el
 * snapshot, el propietario cobraría un porcentaje del desplazamiento sin que
 * nadie lo hubiera decidido. Es la misma razón por la que los cargos extra son
 * de Velto.
 *
 * ⚠️ **Y por eso tampoco son `extra_*`:** un cargo extra nace de la inspección
 * de devolución y cubre un perjuicio. Esto se pacta al reservar y se imprime en
 * el contrato, que es lo que permite cobrarlo.
 *
 * Campo opcional y aditivo: las reservas anteriores al 19 de septiembre de 2026
 * no lo llevan y se leen como «sin servicio a domicilio».
 */
export interface ReservationDeliveryFees {
  /** Lo que se cobra por llevarle el coche. Neto. 0 o ausente = no se cobra. */
  pickupFee: number;
  /** Lo que se cobra por ir a recogerlo. Neto. 0 o ausente = no se cobra. */
  returnFee: number;
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
  /**
   * Entrega y recogida a domicilio: lo **devengado**, lo cobrado y lo que falta.
   *
   * ⚠️ **Tienen su propia línea y no se suman a los cargos extra**, aunque
   * ahorraría tres campos. Un cargo extra es un perjuicio que se descubre al
   * devolver el coche y se puede cubrir con la fianza; esto es un servicio
   * pactado al reservar. Juntos, la ficha diría «Cargos extra 20 €» de una
   * reserva sin un solo daño, y el reparto de la retención de fianza se llevaría
   * por delante el desplazamiento.
   */
  servicesRequired: number;
  servicesPaid: number;
  servicesPending: number;
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
    /**
     * La versión comercial: «Journey TCe 130».
     *
     * Va en el snapshot para que el contrato identifique el coche igual que la
     * oferta que el cliente aceptó (D-2). El presupuesto ya la decía y el
     * contrato no, porque solo el snapshot del contrato la tenía y lo copiaba
     * de aquí, donde no existía.
     */
    version?: string;
    plateNumber: string;
    year?: number;
    acrissCode?: string;
    fuelType?: string;
    transmission?: string;
    seats?: number;
    luggageCapacity?: number;
    currentKm?: number;
    color?: string;
    /** Decide si el contrato imprime el aviso de geolocalización. */
    hasGpsTracker?: boolean;
  };

  clientId: string;
  clientSnapshot: {
    fullName: string;
    phone?: string;
    email?: string;
    documentNumber?: string;
  };

  /**
   * Conductores autorizados además del arrendatario (cláusula 2).
   *
   * Se imprimen en el contrato y se le enseñan al arrendatario en la pantalla
   * de firma: **su firma es el acuerdo** sobre quién puede conducir. Por eso
   * solo se pueden tocar mientras el contrato no esté firmado — después, el
   * documento ya no puede cambiar.
   */
  additionalDrivers?: AdditionalDriver[];

  pickupDateTime: any;
  returnDateTime: any;

  pickupLocation?: string;
  returnLocation?: string;

  totalDays: number;

  pricingSnapshot: ReservationPricingSnapshot;

  /**
   * El reparto con el dueño del coche, **congelado al crear la reserva**.
   *
   * Solo lo llevan las reservas de un vehículo cedido por un colaborador; en un
   * coche de Velto no existe.
   *
   * ⚠️ **Congelado, como el precio y como el tipo de IVA.** Cambiarle mañana el
   * porcentaje al coche —o cederlo a otro propietario— no puede mover lo que se
   * pactó por un alquiler de la semana pasada. Es literalmente el mismo motivo
   * por el que `pricingSnapshot` existe.
   *
   * ⚠️ **Y no es lo mismo que una comisión de captación.** Aquella se asigna a
   * mano desde la ficha del colaborador y puede no haberla; esta viene del coche
   * y se pone sola. Si el mismo colaborador trae el cliente y pone el coche,
   * cobra las dos cosas, por separado.
   */
  ownerShareSnapshot?: ReservationOwnerShare;

  initialPayment: ReservationInitialPayment;
  remainingPayment: ReservationRemainingPayment;
  /**
   * Entrega y recogida a domicilio, si se pactaron. Ver
   * `ReservationDeliveryFees`: importes NETOS y fuera de `pricingSnapshot` a
   * propósito, para que no entren en el reparto con el dueño del coche.
   */
  deliveryFees?: ReservationDeliveryFees;
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
/**
 * Estado de la señal. Existe por lo mismo que el de la fianza: la plantilla
 * pintaba `status === 'paid' ? 'Cobrada' : 'Pendiente'` a pelo, así que el
 * tercer estado —`waived`, no se pide— habría salido como «Pendiente».
 */
export const RESERVATION_INITIAL_PAYMENT_STATUS_LABELS: Record<
  ReservationInitialPayment['status'],
  string
> = {
  pending: 'reservations.paymentStatus.pending',
  paid: 'reservations.paymentStatus.paid',
  waived: 'reservations.initialPayment.waived'
};

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