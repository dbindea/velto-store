/**
 * Facturación.
 *
 * ⚠️ **Una factura emitida no se borra ni se edita. Nunca.** Es la primera
 * colección de esta aplicación que rompe la regla de «los datos son
 * desechables» de CLAUDE.md: un error se corrige emitiendo una **rectificativa**
 * —documento nuevo que referencia al anterior—, y el número consumido queda
 * consumido aunque la operación se anule. Lo impone el art. 15 del RD 1619/2012
 * y, desde 2027, el encadenamiento por huella del RD 1007/2023 (VeriFactu).
 *
 * `firestore.rules` lo hace de verdad: `create` sí, `update` y `delete` para
 * nadie, administrador incluido.
 *
 * El análisis completo, con las fuentes del BOE y de la AEAT, está en
 * `docs/facturacion.md`.
 */

/**
 * Los cinco documentos del módulo, y **solo dos son fiscales**.
 *
 * La diferencia no es cosmética: un `proforma` o un `receipt` no devengan IVA,
 * no se declaran, no entran en VeriFactu y **no consumen número de la serie
 * fiscal**. Si una proforma cogiera el `2026/0007` y luego no se convirtiera en
 * factura, dejaría un hueco en la serie — y un hueco es justo lo que la ley no
 * permite.
 */
export type InvoiceKind =
  | 'invoice'      // Factura. Fiscal
  | 'rectifying'   // Rectificativa. Fiscal, serie propia (fase 2)
  | 'proforma';    // Proforma. NO fiscal (fase 2)

/**
 * Cómo se rectifica, cuando toca (fase 2).
 *
 * Las claves son las de la norma y no se inventan: `S` sustituye el contenido
 * de la factura rectificada, `I` declara solo la diferencia.
 */
export type RectifyingType = 'substitution' | 'difference';

/**
 * Cómo se paga lo que queda pendiente.
 *
 * ⚠️ `cash` tiene un tope legal y no es una preferencia: la Ley 7/2012, en la
 * redacción de la Ley 11/2021, prohíbe pagos **iguales o superiores a 1.000 €**
 * cuando una de las partes actúa como empresario — que en un alquiler de Velto
 * es siempre Velto. Ver `MAX_CASH_PAYMENT`.
 */
export type InvoicePaymentMethod =
  | 'paid'          // Ya cobrada. No se piden datos bancarios
  | 'transfer'      // Transferencia: se imprime el IBAN
  | 'card'          // TPV / enlace de pago
  | 'cash';         // Efectivo, por debajo del tope legal

/**
 * ⚠️ **1.000 €, y es «igual o superior queda prohibido»**, así que el máximo
 * legal es 999,99 €.
 *
 * Y **no se puede trocear la operación**: el límite mira el importe total, no
 * cada entrega. En una reserva, señal y resto son dos cobros de la misma
 * operación, así que si el total llega a 1.000 € ninguno de los dos puede ir en
 * efectivo. La sanción es del 25 % y la pagan las dos partes.
 */
export const MAX_CASH_PAYMENT = 1000;

/** Persona física o empresa. Decide qué datos son obligatorios. */
export type RecipientType = 'individual' | 'company';

/**
 * A quién se factura, que **no siempre es quien conduce**.
 *
 * El caso real son cuadrillas de obreros que comparten coche y una empresa que
 * paga: conducen cuatro, factura la sociedad. `Client` no sirve para esto porque
 * es siempre una persona física —nombre, DNI, carné— y aquí hacen falta razón
 * social, CIF y domicilio fiscal.
 */
export interface BillingProfile {
  id?: string;
  type: RecipientType;
  /** Razón social si es empresa; nombre y apellidos si es persona. */
  name: string;
  /** NIF, CIF o NIE. Obligatorio: el art. 6.1.d) lo exige en toda factura. */
  taxId: string;
  /** Domicilio fiscal completo, también obligatorio (art. 6.1.c). */
  address: string;
  email?: string;
  phone?: string;
  /** Cliente al que se asocia por defecto, si lo hay. */
  clientId?: string;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
}

/**
 * El destinatario **congelado dentro de la factura**.
 *
 * Igual que `clientSnapshot` en la reserva y en el contrato: si la empresa
 * cambia de domicilio, las facturas viejas siguen diciendo lo que decían el día
 * que se emitieron. Una factura emitida no cambia porque cambie una ficha.
 */
export interface InvoiceRecipient {
  type: RecipientType;
  name: string;
  taxId: string;
  address: string;
  email?: string;
  /** De qué perfil se copió, solo para poder volver a él desde la pantalla. */
  billingProfileId?: string;
}

/**
 * Una línea de la factura.
 *
 * ⚠️ **Las líneas son propias, no un espejo de la reserva.** La reserva las
 * *propone* al crear la factura y a partir de ahí la factura vive por su cuenta:
 * se puede facturar por más o por menos de lo que costó el alquiler, que es una
 * función estándar de cualquier programa de facturación y tiene usos legítimos
 * —un precio pactado distinto, un descuento acordado, conceptos refacturados—.
 *
 * Sin líneas propias, cualquier edición sería una pelea contra el recálculo.
 */
export interface InvoiceLine {
  id?: string;
  description: string;
  quantity: number;
  /** Precio unitario **sin IVA**. Ver la nota de `vatRate`. */
  unitPrice: number;
  /**
   * ⚠️ **Fracción, no porcentaje**: `0.21`, no `21`. Misma convención que
   * `pricingSnapshot.vatRate` y por el mismo motivo — confundirlas no da un
   * error, da una cifra creíble y equivocada.
   *
   * Se guarda **por línea** porque una factura puede mezclar tipos: un alquiler
   * al 21 % y un concepto exento conviven en el mismo documento.
   */
  vatRate: number;
}

/** Base, cuota y total de un tipo impositivo. El desglose que exige el art. 6. */
export interface VatSubtotal {
  vatRate: number;
  base: number;
  vat: number;
}

export interface InvoiceTotals {
  /** Suma de bases imponibles. */
  base: number;
  /** Suma de cuotas. */
  vat: number;
  /** Base + IVA. Lo que paga el cliente. */
  total: number;
  /**
   * Un subtotal por tipo impositivo, ordenado de mayor a menor.
   *
   * El art. 6.1.g) exige el tipo aplicado y la cuota **consignada por
   * separado**; con varios tipos en la misma factura hace falta uno por tipo.
   */
  byVatRate: VatSubtotal[];
}

/**
 * Estado del documento.
 *
 * `draft` es lo único que se puede tocar, y **no tiene número**: el número se
 * asigna al emitir y en ese momento la factura se vuelve inmutable.
 */
export type InvoiceStatus = 'draft' | 'issued' | 'rectified' | 'cancelled';

export interface Invoice {
  id?: string;
  kind: InvoiceKind;
  status: InvoiceStatus;

  // ---------------------------------------------------------------------
  // Numeración. Nada de esto existe mientras es borrador.
  // ---------------------------------------------------------------------
  /** El ejercicio: `2026`. Para las rectificativas, `R2026`. */
  series?: string;
  /** Correlativo dentro de la serie, empezando en 1. */
  number?: number;
  /** `2026/0001`, ya compuesto, que es lo que se enseña y se busca. */
  fullNumber?: string;

  // ---------------------------------------------------------------------
  // Fechas. Son dos y no se confunden.
  // ---------------------------------------------------------------------
  /**
   * Cuándo se emitió. **Siempre el día en que se pulsa «Emitir»**, nunca
   * editable: retrodatar rompe la correlación cronológica de la serie y, desde
   * 2027, la AEAT tiene la marca de tiempo del registro.
   */
  issueDate?: any;
  /**
   * Cuándo se prestó el servicio, **si difiere de la de expedición**. El art.
   * 6.1.f) la exige en ese caso, y es lo que permite facturar hoy un alquiler
   * de hace dos meses sin retrodatar nada.
   */
  operationDate?: any;
  /** Periodo del servicio, para alquileres largos: «01/06/2026 a 01/08/2026». */
  operationPeriodStart?: any;
  operationPeriodEnd?: any;

  recipient: InvoiceRecipient;
  lines: InvoiceLine[];
  totals: InvoiceTotals;

  paymentMethod: InvoicePaymentMethod;
  /** Lo ya cobrado al emitir, solo informativo: evita que el cliente pague dos veces. */
  amountAlreadyPaid?: number;

  /**
   * De dónde salió, **si salió de algo**.
   *
   * Opcional a propósito: Velto tiene varios CNAE y factura también la venta de
   * un coche, una limpieza o un cambio de aceite. La reserva es un origen, no
   * el dueño de la factura.
   */
  reservationId?: string;
  vehicleId?: string;
  contractNumber?: string;

  /**
   * Huella SHA-256 encadenada (VeriFactu).
   *
   * ⚠️ **Se calcula desde la primera factura aunque no se envíe nada a la AEAT
   * hasta 2027.** Si la cadena arrancase entonces, arrancaría sobre un histórico
   * que nadie puede acreditar. La obligación de encadenar existe en las **dos**
   * modalidades de VeriFactu, no solo en la que transmite.
   */
  hash?: string;
  /** Huella de la factura inmediatamente anterior. Vacía en la primera. */
  previousHash?: string;

  /** Documento en Storage, para el enlace corto y el reenvío. */
  pdfUrl?: string;
  pdfPath?: string;

  notes?: string;

  // ---------------------------------------------------------------------
  // Rastro. Lo excepcional se anota con autor, como en el resto de la app.
  // ---------------------------------------------------------------------
  createdBy?: string;
  createdByEmail?: string;
  issuedBy?: string;
  issuedByEmail?: string;
  /**
   * El total de la reserva de origen, si lo hubo y **no coincide** con el
   * facturado.
   *
   * No es desconfianza: facturar otro importe es legítimo y a veces necesario,
   * pero deja un descuadre entre Facturas y Pagos que conviene poder explicar
   * sin reconstruirlo de memoria un año después.
   */
  reservationTotalAtIssue?: number;

  createdAt?: any;
  updatedAt?: any;
}

/**
 * Justificante de dinero recibido. **No es una factura y tiene que decirlo.**
 *
 * Es lo que Dorel hacía a mano en Word al cobrar una señal. Sale de un documento
 * de `payments`, que ya es la única fuente de verdad del dinero que entra.
 *
 * ⚠️ **Un recibo no puede parecer una factura**: un cliente que se dedujera el
 * IVA con él tendría un problema, y quien se lo dio también. Por eso no lleva
 * número de serie fiscal, no desglosa IVA y lleva impreso que no tiene validez
 * fiscal. No se guarda en `invoices`: se genera del pago y ya.
 */
export interface ReceiptInput {
  paymentId: string;
  reservationId?: string;
  amount: number;
  concept: string;
  recipientName: string;
  paidAt: any;
}

// Los mapas *_LABELS contienen CLAVES i18n, nunca texto: un mapa con español
// dentro atraviesa el pipe sin cambios y se cuela en la UI inglesa y rumana.

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  invoice: 'invoices.kinds.invoice',
  rectifying: 'invoices.kinds.rectifying',
  proforma: 'invoices.kinds.proforma'
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'invoices.status.draft',
  issued: 'invoices.status.issued',
  rectified: 'invoices.status.rectified',
  cancelled: 'invoices.status.cancelled'
};

export const INVOICE_PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  paid: 'invoices.paymentMethods.paid',
  transfer: 'invoices.paymentMethods.transfer',
  card: 'invoices.paymentMethods.card',
  cash: 'invoices.paymentMethods.cash'
};

export const RECIPIENT_TYPE_LABELS: Record<RecipientType, string> = {
  individual: 'invoices.recipientTypes.individual',
  company: 'invoices.recipientTypes.company'
};
