/**
 * La comisión de un colaborador: cuánto es, cuándo se debe y qué se le adeuda.
 *
 * ⚠️ **Es la única autoridad sobre el importe de una comisión**, igual que
 * `pricing.util.ts` lo es sobre el precio. La pantalla la usa para enseñar la
 * cifra y el servicio la vuelve a usar antes de escribir: si cada uno hiciera su
 * cuenta, el día que discrepen nadie sabría cuál es la buena — y aquí la
 * diferencia se la lleva o se la come una persona.
 */

import {
  Collaborator,
  CollaboratorBalance,
  CollaboratorInvoice,
  CollaboratorSale,
  CommissionStatus
} from '@shared/models/collaborator.model';
import { FieldProblems } from '@shared/utils/form-problems.util';
import { ownerSharePercentProblem } from '@shared/utils/owner-share.util';
import { roundMoney } from '@shared/utils/payment-summary.util';

/**
 * Más de esto no es una comisión, es un socio.
 *
 * No es una regla legal: es un tope de cordura para que un dedo torpe no
 * convierta un 25 en un 250 y deje una deuda de mil euros por un alquiler de
 * cien. Misma idea que el 30 % máximo del descuento de fidelidad.
 */
export const MAX_COMMISSION_PERCENT = 50;

/**
 * El importe de una comisión.
 *
 * ⚠️ **La base es el NETO, sin IVA.** El IVA no es dinero de la empresa: es
 * dinero de Hacienda que la empresa cobra y entrega. Comisionar sobre el total
 * sería pagarle al colaborador un porcentaje de un impuesto — con un 21 % de IVA
 * y un 25 % de comisión, 5,25 € de más por cada cien euros de alquiler.
 *
 * ⚠️ **Y se redondea.** `100 * 25 / 100` da 25, pero `108.9 * 25 / 100` da
 * 27.224999999999998. Todo importe derivado pasa por `roundMoney()` antes de
 * enseñarse o escribirse; ya pasó con el resto de un pago sembrado.
 */
export function commissionAmount(netAmount: number, commissionPercent: number): number {
  const neto = Number(netAmount) || 0;
  const pct = Number(commissionPercent) || 0;
  return roundMoney((neto * pct) / 100);
}

/**
 * ¿Se le ha cambiado el importe a mano?
 *
 * ⚠️ **Se compara con lo calculado, no se deduce del porcentaje.** Recalcular
 * aquí daría «ajustada» a cualquier venta cuyo porcentaje se haya movido después
 * en la ficha del colaborador — y lo que se congeló en la venta no cambió.
 *
 * Una venta sin `calculatedAmount` es anterior a que el importe fuera editable:
 * ahí el importe **es** el calculado, así que no está ajustada.
 */
export function isAdjusted(sale: CollaboratorSale): boolean {
  if (typeof sale?.calculatedAmount !== 'number') return false;
  return roundMoney(sale.calculatedAmount) !== roundMoney(sale.commissionAmount);
}

/** Cuánto se ha subido (positivo) o bajado (negativo) respecto a lo calculado. */
export function adjustmentDelta(sale: CollaboratorSale): number {
  if (!isAdjusted(sale)) return 0;
  return roundMoney((Number(sale.commissionAmount) || 0) - (Number(sale.calculatedAmount) || 0));
}

/**
 * ¿Vale este importe escrito a mano?
 *
 * ⚠️ **No se pone tope por arriba a propósito.** Dorel dijo que a veces paga
 * más, y un límite inventado convertiría un incentivo legítimo en un error que
 * la pantalla rechaza. Lo que sí se impide es lo que no significa nada: un
 * importe vacío, negativo o que no es un número. Que una cifra sea rara se ve
 * —la fila enseña lo calculado al lado—, y verlo es mejor que prohibirlo.
 */
export function amountProblem(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return 'collaborators.problems.amountRequired';
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return 'collaborators.problems.amountInvalid';
  if (n < 0) return 'collaborators.problems.amountNegative';
  return null;
}

/**
 * ¿Vale esta fecha de pago?
 *
 * ⚠️ **El día en que salió el dinero no es el día en que se apunta.** A un
 * colaborador se le paga en efectivo el martes y se anota el jueves, así que la
 * fecha se elige. Lo que no se admite es una **futura**: marcar como pagado algo
 * que todavía no ha salido hace que el balance diga que no se le debe nada a
 * alguien a quien sí se le debe, y eso se descubre cuando él lo reclama.
 *
 * Se compara contra el **final del día de hoy** porque el operador teclea un
 * día, no un instante: con `new Date()` a secas, apuntar un pago de esta misma
 * tarde a las nueve de la mañana sería «futuro».
 */
export function paidAtProblem(fecha: Date | null | undefined): string | null {
  if (!fecha) return null;
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) {
    return 'collaborators.problems.paidAtInvalid';
  }
  const finDeHoy = new Date();
  finDeHoy.setHours(23, 59, 59, 999);
  if (fecha.getTime() > finDeHoy.getTime()) {
    return 'collaborators.problems.paidAtFuture';
  }
  return null;
}

/**
 * ¿Se puede asignar esta reserva a un colaborador?
 *
 * ⚠️ **Una reserva cancelada no genera comisión, y tampoco se le asigna una.**
 * Lo primero lo resuelve `estadoSegunReserva()`; esto evita crearla ya muerta,
 * que solo sirve para ensuciar la lista.
 */
/**
 * ⚠️ **El campo es `reservationStatus`, no `status`.** La reserva tiene los dos
 * nombres rondando —`status` existe dentro de la fianza y de los tramos de
 * pago—, y escribirlo mal aquí no da error de compilación si el campo es
 * opcional: simplemente **nunca coincide**, y una reserva cancelada pasaría el
 * filtro y generaría comisión. Por eso el tipo es obligatorio y no opcional: sin
 * él, el compilador se calla.
 */
export type ReservationForCommission = {
  reservationStatus: string;
  pricingSnapshot?: { netPrice?: number } | null;
};

export function saleProblem(
  reserva: ReservationForCommission | null | undefined,
  colaborador: Collaborator | null | undefined
): string | null {
  if (!colaborador?.id) return 'collaborators.problems.collaboratorRequired';
  if (!colaborador.active) return 'collaborators.problems.collaboratorInactive';
  if (!reserva) return 'collaborators.problems.reservationRequired';
  if (reserva.reservationStatus === 'cancelled') {
    return 'collaborators.problems.reservationCancelled';
  }
  /**
   * ⚠️ Sin neto no hay base, y una comisión de cero no es una comisión: es una
   * venta mal asignada que después nadie entiende. Mejor no dejar crearla.
   */
  if (!(Number(reserva.pricingSnapshot?.netPrice) > 0)) {
    return 'collaborators.problems.reservationWithoutNet';
  }
  return null;
}

/**
 * El estado que le corresponde a una comisión según cómo esté su reserva.
 *
 * ⚠️ **Una comisión ya PAGADA no se anula sola.** El dinero salió: cancelar la
 * reserva después no lo devuelve, y marcarla como anulada haría cuadrar el
 * balance mintiendo. Si hay que recuperarlo, eso es una conversación con el
 * colaborador, no un cambio de estado automático.
 */
export function estadoSegunReserva(
  actual: CommissionStatus,
  reservationStatus: string | undefined
): CommissionStatus {
  if (actual === 'paid') return 'paid';
  if (reservationStatus === 'cancelled') return 'cancelled';
  // Una anulada que resucita —la reserva deja de estar cancelada— vuelve a deber.
  return 'pending';
}

/**
 * Lo que se le debe a un colaborador.
 *
 * ⚠️ **Lo cancelado se cuenta aparte y no se suma a nada.** Enseñar solo el
 * pendiente y el pagado deja al colaborador preguntando por una venta que él
 * recuerda y que aquí no aparece por ningún lado.
 */
export function balanceOf(sales: CollaboratorSale[]): CollaboratorBalance {
  const suma = (estado: CommissionStatus) =>
    roundMoney(
      sales
        .filter((s) => s.status === estado)
        .reduce((total, s) => total + (Number(s.commissionAmount) || 0), 0)
    );

  return {
    pending: suma('pending'),
    paid: suma('paid'),
    cancelled: suma('cancelled'),
    sales: sales.filter((s) => s.status !== 'cancelled').length
  };
}

// ---------------------------------------------------------------------------
// Análisis: cuánto ha generado, cuánto se le ha pagado y cuándo
// ---------------------------------------------------------------------------

/**
 * La fecha por la que se ordena y se filtra una comisión.
 *
 * ⚠️ **Es la del ALQUILER, no la de cuando se apuntó la venta.** Decisión de
 * Dorel del 10 de septiembre de 2026: «¿cuánto me trajo Juan en 2026?» se
 * responde con cuándo ocurrió el alquiler, que es lo que los dos recuerdan. Si
 * se le asigna en enero una reserva de diciembre, cuenta en diciembre.
 *
 * ⚠️ Y se convierte aquí, en un solo sitio: llega como `Timestamp` y compararlo
 * con un `Date` da siempre falso sin convertir. Es la trampa que hizo invisible
 * una ITV y que dejó en blanco la fecha de una declaración.
 */
export function saleDate(sale: CollaboratorSale): Date | null {
  const v = sale?.reservationSnapshot?.pickupDate;
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = v as { toDate?: () => Date; seconds?: number };
  if (typeof d.toDate === 'function') return d.toDate();
  if (typeof d.seconds === 'number') return new Date(d.seconds * 1000);
  return null;
}

/** Cuándo se pagó una comisión. `null` si aún no se ha pagado. */
export function paidDate(sale: CollaboratorSale): Date | null {
  const v = sale?.paidAt;
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = v as { toDate?: () => Date; seconds?: number };
  if (typeof d.toDate === 'function') return d.toDate();
  if (typeof d.seconds === 'number') return new Date(d.seconds * 1000);
  return null;
}

export interface CommissionPeriod {
  /** `null` = todos los ejercicios. */
  year: number | null;
  /** Desde, inclusive. */
  from: Date | null;
  /** Hasta, **inclusive el día entero**. */
  to: Date | null;
}

export const ALL_TIME: CommissionPeriod = { year: null, from: null, to: null };

export function hasPeriod(p: CommissionPeriod): boolean {
  return p.year !== null || p.from !== null || p.to !== null;
}

/**
 * ¿Cae esta fecha dentro del periodo?
 *
 * ⚠️ **«Hasta el 30» incluye el 30 entero.** Un `<input type="date">` da la
 * medianoche; comparar contra eso deja fuera todo lo de ese día, que es justo el
 * que se acaba de teclear. Mismo cuidado que en el filtro de facturas.
 */
function dentro(fecha: Date | null, p: CommissionPeriod): boolean {
  if (!fecha) return false;
  if (p.year !== null && fecha.getFullYear() !== p.year) return false;
  if (p.from) {
    const desde = new Date(p.from);
    desde.setHours(0, 0, 0, 0);
    if (fecha < desde) return false;
  }
  if (p.to) {
    const hasta = new Date(p.to);
    hasta.setHours(23, 59, 59, 999);
    if (fecha > hasta) return false;
  }
  return true;
}

/** Las comisiones cuyo alquiler cae en el periodo. Sin periodo, todas. */
export function salesInPeriod(
  sales: CollaboratorSale[],
  period: CommissionPeriod
): CollaboratorSale[] {
  if (!hasPeriod(period)) return [...sales];
  return sales.filter((s) => dentro(saleDate(s), period));
}

export interface PeriodSummary {
  /** Lo devengado por los alquileres del periodo, pagado o no. */
  generated: number;
  /** De eso, lo que ya se le ha pagado. */
  paid: number;
  /** De eso, lo que queda. */
  pending: number;
  /** Lo anulado, aparte y sin sumar a nada. */
  cancelled: number;
  /** Cuántas ventas cuentan, sin las anuladas. */
  sales: number;
}

/**
 * El resumen de un periodo.
 *
 * ⚠️ **`pending` aquí es lo pendiente DE ESE PERIODO**, no lo que se le debe en
 * total. Son dos preguntas distintas y la pantalla enseña las dos por separado:
 * filtrar a 2025 y leer «pendiente: 0» haría creer que no se le debe nada,
 * cuando lo que se debe es todo lo de 2026 que sigue sin pagar. Lo que se debe
 * se debe, mire uno el año que mire — para eso está `balanceOf()`.
 */
export function periodSummary(
  sales: CollaboratorSale[],
  period: CommissionPeriod
): PeriodSummary {
  const enPeriodo = salesInPeriod(sales, period);
  const b = balanceOf(enPeriodo);
  return {
    generated: roundMoney(b.pending + b.paid),
    paid: b.paid,
    pending: b.pending,
    cancelled: b.cancelled,
    sales: b.sales
  };
}

export interface YearTotals {
  year: number;
  generated: number;
  paid: number;
  pending: number;
  sales: number;
}

/**
 * Lo acumulado año a año, del más reciente al más antiguo.
 *
 * ⚠️ **Los años salen de los datos.** Un rango inventado llena la tabla de
 * ejercicios vacíos, y una lista fija se queda corta el 1 de enero.
 */
export function yearlyTotals(sales: CollaboratorSale[]): YearTotals[] {
  const años = new Set<number>();
  for (const s of sales) {
    const d = saleDate(s);
    if (d) años.add(d.getFullYear());
  }
  return [...años]
    .sort((a, b) => b - a)
    .map((year) => {
      const r = periodSummary(sales, { year, from: null, to: null });
      return { year, generated: r.generated, paid: r.paid, pending: r.pending, sales: r.sales };
    });
}

export interface Settlement {
  /** El día en que se pagó, a medianoche: es la clave de agrupación. */
  date: Date;
  method: CollaboratorSale['paidMethod'];
  amount: number;
  /** Cuántas comisiones entraron en ese pago. */
  count: number;
}

/**
 * El histórico de pagos: qué se le pagó, cuándo y cómo.
 *
 * ⚠️ **No hay una colección de «liquidaciones», y es deliberado.** Cada comisión
 * ya guarda cuándo y cómo se pagó; una colección aparte sería una segunda fuente
 * de verdad para el mismo euro, y la primera vez que discreparan no habría forma
 * de saber cuál manda. Aquí se agrupa al pintar por **día y forma de pago**, que
 * es como se paga de verdad: una transferencia por varias comisiones a la vez.
 */
export function settlements(sales: CollaboratorSale[]): Settlement[] {
  const grupos = new Map<string, Settlement>();

  for (const s of sales) {
    if (s.status !== 'paid') continue;
    const cuando = paidDate(s);
    if (!cuando) continue;
    const dia = new Date(cuando);
    dia.setHours(0, 0, 0, 0);
    const clave = `${dia.getTime()}|${s.paidMethod || ''}`;

    const previo = grupos.get(clave);
    if (previo) {
      previo.amount = roundMoney(previo.amount + (Number(s.commissionAmount) || 0));
      previo.count += 1;
    } else {
      grupos.set(clave, {
        date: dia,
        method: s.paidMethod,
        amount: roundMoney(Number(s.commissionAmount) || 0),
        count: 1
      });
    }
  }

  return [...grupos.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * Todo lo que impide guardar un colaborador, campo a campo.
 *
 * **Una sola función**, la misma que consulta la pantalla y la que ejecuta el
 * servicio antes de escribir. El orden es el de los campos en el formulario,
 * para que el resumen se lea de arriba abajo igual que la pantalla.
 */
export function validateCollaborator(input: Partial<Collaborator> | null): FieldProblems {
  const problems: FieldProblems = {};
  const c = input || {};

  if (!c.name?.trim()) {
    problems['name'] = 'collaborators.problems.nameRequired';
  }

  /**
   * ⚠️ **El 0 % se admite y significa «no trae clientes»** (decisión de Dorel,
   * 12 de septiembre de 2026). Antes se exigía mayor que cero, y eso era cierto
   * cuando un colaborador solo podía ser un comercial; desde que uno puede ser
   * únicamente el dueño de un coche cedido, exigirlo obligaba a inventarse una
   * comisión de captación para alguien que no trae a nadie.
   *
   * ⚠️ **Lo que sigue sin admitirse es el hueco.** `Number(null)` y
   * `Number('')` son **0**, no `NaN`, así que un campo vacío pasaría como un
   * 0 % perfectamente legítimo y nadie se enteraría — es exactamente el fallo
   * que ya salió con `ownerSharePercent`. Por eso la ausencia se comprueba
   * antes de convertir.
   */
  if (c.commissionPercent === null || c.commissionPercent === undefined ||
      (c.commissionPercent as unknown) === '') {
    problems['commissionPercent'] = 'collaborators.problems.percentRequired';
  } else {
    const pct = Number(c.commissionPercent);
    if (!Number.isFinite(pct) || pct < 0) {
      problems['commissionPercent'] = 'collaborators.problems.percentRequired';
    } else if (pct > MAX_COMMISSION_PERCENT) {
      problems['commissionPercent'] = 'collaborators.problems.percentTooHigh';
    }
  }

  /**
   * Su reparto habitual como propietario. **Solo si se ha rellenado**: un
   * colaborador que nunca va a ceder un coche no tiene por qué contestarlo, y
   * el que manda en un alquiler no es este de todas formas, sino el del coche.
   */
  if (c.ownerSharePercent !== null && c.ownerSharePercent !== undefined &&
      (c.ownerSharePercent as unknown) !== '') {
    const problema = ownerSharePercentProblem(c.ownerSharePercent);
    if (problema) problems['ownerSharePercent'] = problema;
  }

  // El correo solo si lo hay: no es obligatorio, pero uno mal escrito no sirve
  // de nada y solo se descubre el día que hace falta.
  if (c.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) {
    problems['email'] = 'collaborators.problems.emailInvalid';
  }

  return problems;
}

// ---------------------------------------------------------------------------
// La factura que manda el propietario
// ---------------------------------------------------------------------------

/**
 * Lo que impide guardar una factura recibida, campo a campo.
 *
 * **Una sola función**, la misma que consulta la pantalla y la que ejecuta el
 * servicio antes de escribir. El orden es el de los campos en el formulario.
 *
 * ⚠️ **El importe NO se compara con lo que cubre, a propósito.** Una factura
 * puede traer IRPF retenido, redondeos o conceptos que aquí no están, así que
 * exigir que cuadre al céntimo rechazaría facturas perfectamente correctas. La
 * diferencia **se enseña** —ver `invoiceMismatch()`— porque verla es útil y
 * prohibirla es falso.
 */
export function validateCollaboratorInvoice(
  input: Partial<CollaboratorInvoice> | null
): FieldProblems {
  const problems: FieldProblems = {};
  const f = input || {};

  if (!f.number?.trim()) {
    problems['number'] = 'collaborators.problems.invoiceNumberRequired';
  }

  if (!f.date) {
    problems['date'] = 'collaborators.problems.invoiceDateRequired';
  }

  /**
   * ⚠️ **La ausencia se comprueba antes de convertir**, como en todos los
   * importes de esta casa: `Number(null)` y `Number('')` son **0**, no `NaN`, y
   * una factura de 0 € pasaría por válida sin que nada chirriara.
   */
  if (f.amount === null || f.amount === undefined || (f.amount as unknown) === '') {
    problems['amount'] = 'collaborators.problems.invoiceAmountRequired';
  } else {
    const n = Number(f.amount);
    if (!Number.isFinite(n)) problems['amount'] = 'collaborators.problems.invoiceAmountRequired';
    else if (n <= 0) problems['amount'] = 'collaborators.problems.invoiceAmountPositive';
  }

  return problems;
}

/**
 * La diferencia entre lo que dice la factura y lo que cubre, o `0` si cuadra.
 *
 * ⚠️ **Se enseña, no se impide.** Una factura con IRPF retenido trae menos de lo
 * que suman los repartos y es correcta; una que cubre algo más, también. Lo que
 * no puede pasar es que la diferencia quede escondida: con las dos cifras
 * delante se explica sola, y sin ellas alguien la descubre dentro de un año
 * cuadrando el ejercicio.
 */
export function invoiceMismatch(invoiceAmount: number, coveredAmount: number): number {
  const diferencia = roundMoney((Number(invoiceAmount) || 0) - (Number(coveredAmount) || 0));
  /**
   * ⚠️ **El cero negativo se normaliza aquí.** Restar dos cifras que cuadran en
   * coma flotante —`0.3 - (0.1 + 0.2)`— da `-0`, y aunque `-0 === 0` sea cierto,
   * `Intl.NumberFormat` lo escribe **«-0,00 €»**. Un aviso de descuadre que dice
   * que el descuadre es de menos cero es peor que no avisar.
   */
  return diferencia === 0 ? 0 : diferencia;
}

/** Lo que suman los apuntes que cubre una factura. */
export function coveredByInvoice(sales: CollaboratorSale[], invoiceId: string): number {
  return roundMoney(
    (sales || [])
      .filter((s) => s.receivedInvoiceId === invoiceId && s.status !== 'cancelled')
      .reduce((total, s) => total + (Number(s.commissionAmount) || 0), 0)
  );
}

/**
 * Los repartos que **siguen esperando factura del propietario**.
 *
 * ⚠️ **Solo los de `vehicle_owner`.** Una comisión de captación no lleva factura
 * detrás en este negocio —es un registro interno, decisión del 10 de septiembre
 * de 2026—, así que meterla aquí dejaría a la vista una deuda documental que no
 * existe y que nadie iba a resolver nunca.
 *
 * ⚠️ **Y lo anulado queda fuera.** Un reparto que dejó de devengar no necesita
 * justificante de nada.
 */
export function awaitingInvoice(sales: CollaboratorSale[]): CollaboratorSale[] {
  return (sales || []).filter(
    (s) => s.kind === 'vehicle_owner' && s.status !== 'cancelled' && !s.receivedInvoiceId
  );
}

/** Cuánto está pendiente de justificar con una factura del propietario. */
export function awaitingInvoiceTotal(sales: CollaboratorSale[]): number {
  return roundMoney(
    awaitingInvoice(sales).reduce((total, s) => total + (Number(s.commissionAmount) || 0), 0)
  );
}

// ---------------------------------------------------------------------------
// Las dos clases de apunte
// ---------------------------------------------------------------------------

/*
 * Aquí vivía `kindOf()`, que leía la ausencia de `kind` como una comisión de
 * captación. Desapareció el 12 de septiembre de 2026 al vaciarse la base de
 * desarrollo: sin apuntes antiguos, el campo es obligatorio y quien crea una
 * venta tiene que decir por qué se debe. Se quita la función entera y no solo su
 * tolerancia, porque una que devuelve su argumento tal cual es indirección que
 * invita a creer que resuelve algo.
 */

/**
 * Lo que se le debe, separado por motivo.
 *
 * ⚠️ **Separado y no sumado, que es la petición entera.** «Le debo 300 €» no
 * dice si son por traer clientes o por sus coches, y son dos cosas que se
 * pactan, se liquidan y se justifican distinto — una acaba en una factura suya
 * por la cesión del vehículo, la otra no necesariamente. El total sigue estando
 * disponible para quien lo quiera, pero hay que pedirlo.
 */
export function balanceByKind(ventas: CollaboratorSale[]): {
  referral: { pending: number; paid: number };
  vehicleOwner: { pending: number; paid: number };
  total: { pending: number; paid: number };
} {
  const cero = () => ({ pending: 0, paid: 0 });
  const acc = { referral: cero(), vehicleOwner: cero(), total: cero() };

  for (const v of ventas) {
    if (v.status === 'cancelled') continue;
    const importe = Number(v.commissionAmount) || 0;
    const donde = v.kind === 'vehicle_owner' ? acc.vehicleOwner : acc.referral;
    const campo = v.status === 'paid' ? 'paid' : 'pending';
    donde[campo] += importe;
    acc.total[campo] += importe;
  }

  const r = (x: { pending: number; paid: number }) => ({
    pending: roundMoney(x.pending),
    paid: roundMoney(x.paid)
  });
  return { referral: r(acc.referral), vehicleOwner: r(acc.vehicleOwner), total: r(acc.total) };
}
