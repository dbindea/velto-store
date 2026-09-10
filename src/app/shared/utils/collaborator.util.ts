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
  CollaboratorSale,
  CommissionStatus
} from '@shared/models/collaborator.model';
import { FieldProblems } from '@shared/utils/form-problems.util';
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

  const pct = Number(c.commissionPercent);
  if (!Number.isFinite(pct) || pct <= 0) {
    problems['commissionPercent'] = 'collaborators.problems.percentRequired';
  } else if (pct > MAX_COMMISSION_PERCENT) {
    problems['commissionPercent'] = 'collaborators.problems.percentTooHigh';
  }

  // El correo solo si lo hay: no es obligatorio, pero uno mal escrito no sirve
  // de nada y solo se descubre el día que hace falta.
  if (c.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) {
    problems['email'] = 'collaborators.problems.emailInvalid';
  }

  return problems;
}
