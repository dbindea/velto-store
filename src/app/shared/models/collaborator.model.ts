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
   *
   * ⚠️ **El 0 % es válido y significa «no trae clientes»** (decisión de Dorel,
   * 12 de septiembre de 2026). Desde que un colaborador puede ser solo el dueño
   * de un coche, exigir una comisión de captación mayor que cero obligaba a
   * inventarse un número para alguien que no trae a nadie — y un número
   * inventado que vive en la ficha acaba aplicándose el día que se le asigne una
   * venta por error. Cero es la respuesta correcta, y se puede teclear.
   */
  commissionPercent: number;

  /**
   * Su reparto habitual **como propietario de un coche**, en porcentaje
   * (`75` = 75 %). Lo que se lleva él; Velto se queda el resto.
   *
   * ⚠️ **Es otra cosa que `commissionPercent`, y por eso es otro campo.** Aquel
   * es lo que cobra por traer un cliente; este, por ceder un vehículo. Un mismo
   * colaborador puede cobrar los dos por la misma reserva, y con un solo
   * porcentaje habría que elegir cuál miente.
   *
   * ⚠️ Y como aquel, es **la propuesta, no lo que manda**: cada coche guarda el
   * suyo y cada reserva lo congela.
   */
  ownerSharePercent?: number;

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
/**
 * Por qué se le debe dinero a un colaborador.
 *
 * ⚠️ **Dos motivos distintos que NO se suman en el mismo apunte.** Un mismo
 * colaborador puede traer un cliente **y** poner el coche de la misma reserva:
 * entonces son dos líneas, no una mayor. Sin este campo, «lo que se le debe a
 * Juan» mezclaría una comisión de captación con el reparto por ceder un
 * vehículo — dos conceptos que se pactan distinto, se calculan distinto y se
 * justifican distinto ante Hacienda.
 *
 * - `referral`: trajo al cliente. Porcentaje sobre el neto del alquiler.
 * - `vehicle_owner`: el coche es suyo. Reparto sobre el neto del alquiler,
 *   devengado **al cerrar la reserva**, cuando los importes ya son definitivos.
 */
export type CommissionKind = 'referral' | 'vehicle_owner';

export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
  referral: 'collaborators.kind.referral',
  vehicle_owner: 'collaborators.kind.vehicleOwner'
};

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

  /**
   * Por qué se le debe: por traer al cliente o por poner el coche.
   *
   * ⚠️ **Obligatorio, sin valor por defecto.** Nació opcional porque había
   * cuatro comisiones antiguas sin él y la ausencia se leía como `referral`; al
   * vaciarse la base de desarrollo el 12 de septiembre de 2026 ya no existe
   * ninguna, así que el campo se exige y **el compilador obliga a contestar**.
   * Un valor por defecto aquí sería peor que un hueco: apuntaría como comisión
   * de captación lo que en realidad es el reparto de un coche cedido, y las dos
   * se pactan, se liquidan y se justifican distinto.
   */
  kind: CommissionKind;

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
  /**
   * **Lo que se le paga.** Es la única cifra que suma en los balances.
   *
   * ⚠️ Normalmente es `netAmount × commissionPercent / 100`, pero **se puede
   * cambiar a mano**: a veces se paga de más, a veces de menos, y a veces se
   * redondea para que la cuenta sea fácil. Decisión de Dorel del 10 de
   * septiembre de 2026.
   */
  commissionAmount: number;
  /**
   * Lo que dio el porcentaje, guardado aunque el importe se haya cambiado.
   *
   * ⚠️ **Sin esto, un importe ajustado es un número que nadie puede explicar.**
   * Si se pagan 50 € donde el 25 % de 189 daba 47,25, dentro de seis meses la
   * cifra no cuadra con nada y no hay forma de saber si fue un acuerdo o un
   * error. Con las dos delante, la fila se explica sola.
   *
   * Ausente en las ventas creadas antes de que el importe fuera editable: ahí
   * el importe **es** el calculado.
   */
  calculatedAmount?: number;
  /** Por qué se cambió. Opcional: redondear no necesita explicación. */
  adjustmentReason?: string;

  status: CommissionStatus;

  // --- Solo cuando está pagada -------------------------------------------
  paidAt?: any;
  paidMethod?: CommissionPaymentMethod;
  paidNote?: string;

  /** Por qué dejó de devengar. Se rellena solo al cancelarse la reserva. */
  cancelledReason?: string;

  /**
   * La factura del propietario que cubre este apunte, si ya ha llegado.
   *
   * ⚠️ **Su ausencia significa «pendiente de recibir factura», y eso NO es «no
   * hay que facturar»** (Dorel lo dijo con esas palabras). Son dos cosas muy
   * distintas: la primera es un trámite que falta, la segunda sería una exención
   * que aquí no existe. Cualquier texto que pinte este estado tiene que decir la
   * primera, porque un «sin factura» a secas se lee como la segunda y entonces
   * nadie la reclama.
   *
   * ⚠️ **Y se puede pagar sin ella.** Cobrar y justificar van por caminos
   * separados: al propietario se le paga cuando toca, y su factura llega cuando
   * llega. Atar el pago a la factura dejaría a alguien sin cobrar por un papel.
   */
  receivedInvoiceId?: string;

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

/**
 * La factura que **manda el propietario** por ceder su coche.
 *
 * ⚠️ **No confundir con `invoices`, que son las de VELTO.** Aquellas las emite
 * la empresa, son inmutables, consumen número de serie y van a la AEAT por
 * VERI\*FACTU. Esta es un documento que llega de fuera: si se teclea mal, se
 * corrige; si se registra por error, se borra. Nada de lo que hace inmutable a
 * una factura emitida aplica aquí, porque el hecho que acredita no lo ha
 * declarado Velto.
 *
 * ⚠️ **Es una colección propia y no unos campos dentro del apunte** (decisión de
 * Dorel, 12 de septiembre de 2026). Una sola factura suele cubrir **varias**
 * reservas —la liquidación del mes—, así que metida en cada apunte habría que
 * teclearla tantas veces como repartos cubra, con el mismo número repetido y
 * sin que su importe total constara en ninguna parte. Es la excepción razonada
 * a «no hay colección de liquidaciones»: aquello era derivable de los pagos, y
 * un número de factura no se deriva de nada.
 *
 * ⚠️ **Y registrarla no la convierte en un gasto todavía.** Decisión del mismo
 * día, coherente con las comisiones: esto sigue siendo un registro interno y no
 * escribe en `expenses`. Queda anotado que con factura delante el reparto sí es
 * un gasto deducible, y que el día que se quiera contabilizar están aquí los
 * cuatro datos que hacen falta.
 */
export interface CollaboratorInvoice {
  id?: string;

  collaboratorId: string;
  /** Copiado, para que la factura se pueda leer sin resolver la ficha. */
  collaboratorName: string;

  /** El número que trae impreso el documento. El suyo, no uno nuestro. */
  number: string;
  /** La fecha del documento, que no es la de cuando se registra. */
  date: any;
  /** El total de la factura, tal y como viene. */
  amount: number;

  /** El PDF o la foto, en Storage. */
  fileUrl?: string;
  filePath?: string;

  notes?: string;

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
