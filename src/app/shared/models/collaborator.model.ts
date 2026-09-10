/**
 * Colaboradores: comerciales que traen clientes a cambio de una comisión.
 *
 * ⚠️ **NO son usuarios de la aplicación y no entran nunca.** Son fichas, como
 * los clientes: alguien de fuera que trae negocio. Quien accede a la aplicación
 * vive en `authorizedUsers` y eso no cambia — si algún día un colaborador
 * necesita entrar, será dándole de alta allí, no ampliando esto.
 *
 * ⚠️ **Y esto es un registro INTERNO, no contabilidad.** Decisión de Dorel del
 * 10 de septiembre de 2026: las comisiones no generan factura, no entran en
 * VeriFactu y no se escriben en `expenses`. Sirve para saber a quién se le debe
 * cuánto y si ya se le pagó.
 *
 * Dicho eso, y para que conste porque afecta al dinero: una comisión pagada a un
 * comercial suele ser **gasto deducible**, y si el colaborador es autónomo lo
 * normal es que emita factura con retención de IRPF. Llevarlo solo por dentro no
 * rompe nada aquí, pero es una deducción que se pierde. Está pensado para que el
 * día que se quiera convertir un pago en gasto se pueda hacer sin rehacer nada:
 * cada pago guarda su fecha, su importe y su forma.
 */

/** Cómo se le paga a un colaborador. Sin tarjeta: no hay pasarela por medio. */
export type CommissionPaymentMethod = 'cash' | 'transfer';

export const COMMISSION_PAYMENT_METHOD_LABELS: Record<CommissionPaymentMethod, string> = {
  cash: 'collaborators.paymentMethods.cash',
  transfer: 'collaborators.paymentMethods.transfer'
};

export interface Collaborator {
  id?: string;

  /** Nombre y apellidos, o el nombre comercial con el que se le conoce. */
  name: string;
  phone?: string;
  email?: string;
  /** NIF, solo si lo hay. No es obligatorio: esto no emite ningún documento. */
  taxId?: string;
  notes?: string;

  /**
   * Su comisión habitual, en **porcentaje** sobre el neto (`25` = 25 %).
   *
   * ⚠️ **Porcentaje, no fracción.** Misma convención que
   * `loyaltyDiscountPercent` del cliente y por el mismo motivo: es lo que se
   * teclea y lo que se dice en voz alta. El `vatRate` de la reserva sí es
   * fracción, y los nombres son explícitos para que nadie los confunda.
   *
   * ⚠️ **Es el valor POR DEFECTO, no el que manda.** Cada venta congela el suyo,
   * como el precio: subirle la comisión mañana no puede mover lo que ya se
   * pactó por una reserva de la semana pasada.
   */
  commissionPercent: number;

  /** Un colaborador inactivo no sale al asignar ventas nuevas. */
  active: boolean;

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

/**
 * El estado de una comisión.
 *
 * ⚠️ **`cancelled` no es «borrada»**: es una venta que existió y dejó de
 * devengar porque la reserva se canceló. Se queda a la vista, porque explicar
 * por qué un colaborador cobró menos de lo que creía es exactamente para lo que
 * sirve esto.
 */
export type CommissionStatus = 'pending' | 'paid' | 'cancelled';

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: 'collaborators.status.pending',
  paid: 'collaborators.status.paid',
  cancelled: 'collaborators.status.cancelled'
};

/**
 * Una venta traída por un colaborador, con su comisión.
 *
 * ⚠️ **Todo lo que decide el importe va CONGELADO aquí.** El neto de la reserva
 * y el porcentaje se copian al asignar la venta y no se vuelven a leer: es la
 * misma regla que `pricingSnapshot` en la reserva y que el snapshot del cliente
 * en el contrato. Sin ella, recalcular la comisión de hace tres meses daría otra
 * cifra en cuanto cambie el porcentaje del colaborador o alguien toque la
 * reserva, y el colaborador tendría razón al no reconocer el número.
 */
export interface CollaboratorSale {
  id?: string;

  collaboratorId: string;
  /** Para poder listar sin resolver la ficha, y para que sobreviva a un borrado. */
  collaboratorName: string;

  reservationId: string;
  /** Lo justo para reconocer la venta en una lista. */
  reservationSnapshot: {
    clientName: string;
    vehicle: string;
    pickupDate: any;
  };

  /** El neto pactado en la reserva, sin IVA. La base de la comisión. */
  netAmount: number;
  /** El porcentaje aplicado, congelado. */
  commissionPercent: number;
  /** `netAmount × commissionPercent / 100`, ya redondeado. */
  commissionAmount: number;

  status: CommissionStatus;

  // --- Solo cuando está pagada -------------------------------------------
  paidAt?: any;
  paidMethod?: CommissionPaymentMethod;
  paidNote?: string;

  /** Por qué dejó de devengar. Se rellena solo al cancelarse la reserva. */
  cancelledReason?: string;

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

/** Lo que se le debe a un colaborador y lo que ya cobró. */
export interface CollaboratorBalance {
  pending: number;
  paid: number;
  cancelled: number;
  /** Cuántas ventas cuentan, sin las canceladas. */
  sales: number;
}
