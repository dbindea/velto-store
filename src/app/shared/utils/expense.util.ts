/**
 * Aritmética de los gastos.
 *
 * ⚠️ **Aquí el IVA se EXTRAE del total. En `pricing.util.ts` se SUMA al neto.**
 * Las dos direcciones conviven a propósito y por eso viven en ficheros
 * distintos con nombres explícitos:
 *
 * - Un **alquiler** se negocia por el neto —30 €/día— y el IVA va encima.
 * - Un **gasto** llega como una factura de 60,50 € y hay que sacarle la base.
 *
 * Confundirlas no da un error, da una cifra creíble y equivocada, que es la
 * peor clase de fallo con dinero. Si alguna vez alguien unifica los dos
 * módulos, esta nota es la razón por la que no se debe.
 */

import { roundMoney } from '@shared/utils/payment-summary.util';
import { DEFAULT_VAT_RATE } from '@shared/utils/pricing.util';
import {
  Expense,
  ExpenseCategory,
  ExpenseRow,
  ExpenseScope
} from '@shared/models/expense.model';
import { VehicleMaintenance } from '@shared/models/vehicle-maintenance.model';
import { FieldProblems } from '@shared/utils/form-problems.util';

export interface ExpenseVatSplit {
  /** El tipo aplicado, como fracción. */
  rate: number;
  /** Base imponible. */
  net: number;
  /** El impuesto. */
  vat: number;
  /** Lo pagado. Siempre `net + vat`, al céntimo. */
  gross: number;
}

/**
 * Saca la base y el IVA de un importe **que ya lo lleva dentro**.
 *
 * La base se redondea y el IVA se obtiene **por resta**, no multiplicando: así
 * `net + vat` cuadra exactamente con lo que pone el ticket. Redondear las dos
 * partes por separado desvía un céntimo con frecuencia suficiente como para que
 * un gasto no cuadre con su factura, y eso lo detecta la gestoría, no nosotros.
 */
export function extractVatFromGross(
  gross: number,
  rate: number = DEFAULT_VAT_RATE
): ExpenseVatSplit {
  const safeGross = isFinite(gross) && gross > 0 ? roundMoney(gross) : 0;
  const safeRate = isFinite(rate) && rate > 0 ? rate : 0;
  const net = roundMoney(safeGross / (1 + safeRate));

  return {
    rate: safeRate,
    net,
    vat: roundMoney(safeGross - net),
    gross: safeGross
  };
}

/**
 * Los tipos que se pueden elegir, como fracciones.
 *
 * El 0 no es un hueco: **una multa no lleva IVA** —es una sanción repercutida,
 * no un servicio—, igual que la fianza en el lado de los ingresos.
 */
export const EXPENSE_VAT_RATES = [0.21, 0.1, 0.04, 0] as const;

/** Las categorías que nunca llevan IVA, para no dejarlo a la memoria. */
const VAT_FREE_CATEGORIES: ExpenseCategory[] = ['fine'];

/** El tipo que corresponde por defecto a una categoría. */
export function defaultVatRateFor(category: ExpenseCategory): number {
  return VAT_FREE_CATEGORIES.includes(category) ? 0 : DEFAULT_VAT_RATE;
}

/** Convierte lo que sea que traiga Firestore en una fecha, o `null`. */
export function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Un mantenimiento **realizado y con coste** visto como una fila de gasto.
 *
 * ⚠️ **Solo cuenta lo `completed` con coste mayor que cero.** Una ITV agendada
 * para dentro de tres meses no es dinero que haya salido; meterla en el total de
 * gastos sería contar como gastado algo que todavía no se ha pagado, y el
 * módulo dejaría de servir para lo único que sirve: saber cuánto llevas puesto.
 *
 * El desglose de IVA se deja **vacío a propósito**: el coste de mantenimiento se
 * teclea como un importe suelto, sin tipo, y suponerle un 21 % sería fabricar
 * una base imponible que después alguien daría por buena.
 */
export function maintenanceToExpenseRow(m: VehicleMaintenance): ExpenseRow | null {
  if (m.status !== 'completed') return null;
  if (typeof m.cost !== 'number' || !isFinite(m.cost) || m.cost <= 0) return null;

  return {
    id: m.id || '',
    origin: 'maintenance',
    scope: 'vehicle',
    category: maintenanceCategory(m.type),
    concept: m.title,
    amount: roundMoney(m.cost),
    date: toDate(m.performedAtDate) || toDate(m.completedAt) || toDate(m.createdAt),
    vehicleId: m.vehicleId,
    vehiclePlate: m.vehicleSnapshot?.plateNumber,
    supplier: m.provider,
    sourceVehicleId: m.vehicleId
  };
}

/** El tipo de mantenimiento, traducido a categoría de gasto. */
function maintenanceCategory(type: VehicleMaintenance['type']): ExpenseCategory {
  switch (type) {
    case 'insurance':
      return 'insurance';
    case 'itv':
      return 'itv';
    case 'tires':
      return 'tires';
    case 'cleaning':
      return 'cleaning';
    // Aceite, frenos, batería, avería y revisión general son todos, a efectos
    // de gasto, lo mismo: dinero puesto en arreglar el coche.
    default:
      return 'repair';
  }
}

/** Un gasto de la colección visto como fila. */
export function expenseToRow(e: Expense): ExpenseRow {
  return {
    id: e.id || '',
    origin: 'expense',
    scope: e.scope,
    category: e.category,
    concept: e.concept,
    amount: roundMoney(e.amount),
    netAmount: typeof e.netAmount === 'number' ? roundMoney(e.netAmount) : undefined,
    vatAmount: typeof e.vatAmount === 'number' ? roundMoney(e.vatAmount) : undefined,
    date: toDate(e.date),
    vehicleId: e.vehicleId,
    vehiclePlate: e.vehicleSnapshot?.plateNumber,
    reservationId: e.reservationId,
    supplier: e.supplier
  };
}

/**
 * Las dos fuentes en una sola lista, de más reciente a más antigua.
 *
 * Las filas sin fecha van al final: no se sabe cuándo pasaron, así que no pueden
 * colarse arriba fingiendo que fue hoy.
 */
export function buildExpenseRows(
  expenses: Expense[],
  maintenance: VehicleMaintenance[] = []
): ExpenseRow[] {
  const rows: ExpenseRow[] = [
    ...expenses.map(expenseToRow),
    ...maintenance
      .map(maintenanceToExpenseRow)
      .filter((r): r is ExpenseRow => r !== null)
  ];

  return rows.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.getTime() - a.date.getTime();
  });
}

export interface ExpenseTotals {
  /** Todo lo que ha salido, con IVA. */
  gross: number;
  /** Base imponible, **solo de las filas que tienen desglose**. */
  net: number;
  /** IVA soportado, sobre esas mismas filas. */
  vat: number;
  /** Cuántas filas aportan desglose y cuántas hay en total. */
  withVatBreakdown: number;
  count: number;
  /** El total por cada imputación, para el desglose de la cabecera. */
  byScope: Record<ExpenseScope, number>;
}

/**
 * Los totales de un conjunto de filas.
 *
 * ⚠️ **`net` y `vat` NO cuadran con `gross`, y es correcto.** Un coste de
 * mantenimiento entra en el bruto pero no tiene base ni IVA conocidos, así que
 * la suma de bases es menor que el total. Por eso van `withVatBreakdown` y
 * `count`: la pantalla tiene que poder decir «IVA soportado sobre 7 de 9
 * gastos» en vez de enseñar tres números que no encajan y dejar al operador
 * pensando que la aplicación se equivoca.
 */
export function totalsOf(rows: ExpenseRow[]): ExpenseTotals {
  const totals: ExpenseTotals = {
    gross: 0,
    net: 0,
    vat: 0,
    withVatBreakdown: 0,
    count: rows.length,
    byScope: { vehicle: 0, reservation: 0, general: 0 }
  };

  for (const row of rows) {
    totals.gross = roundMoney(totals.gross + row.amount);
    totals.byScope[row.scope] = roundMoney(totals.byScope[row.scope] + row.amount);
    if (typeof row.netAmount === 'number' && typeof row.vatAmount === 'number') {
      totals.net = roundMoney(totals.net + row.netAmount);
      totals.vat = roundMoney(totals.vat + row.vatAmount);
      totals.withVatBreakdown++;
    }
  }

  return totals;
}

/**
 * Lo que impide guardar un gasto: **campo → clave de i18n**.
 *
 * La misma función la usa la pantalla, para marcar el campo en rojo y resumir
 * junto al botón, y el servicio, antes de escribir. Una sola, no dos: dos
 * acaban discrepando y entonces la pantalla deja guardar algo que el servicio
 * rechaza.
 *
 * El orden de las comprobaciones es el de los campos en el formulario, para que
 * el resumen se lea de arriba abajo igual que la pantalla.
 */
export function validateExpense(expense: Partial<Expense>): FieldProblems {
  const problems: FieldProblems = {};

  // Un gasto imputado a un coche sin coche no es un gasto de vehículo: es un
  // gasto general mal etiquetado, y falsearía el coste por coche.
  if (expense.scope === 'vehicle' && !expense.vehicleId) {
    problems['vehicleId'] = 'expenses.errors.vehicleRequired';
  }
  if (expense.scope === 'reservation' && !expense.reservationId) {
    problems['reservationId'] = 'expenses.errors.reservationRequired';
  }
  if (!expense.concept || !expense.concept.trim()) {
    problems['concept'] = 'expenses.errors.conceptRequired';
  }
  if (typeof expense.amount !== 'number' || !isFinite(expense.amount) || expense.amount <= 0) {
    problems['amount'] = 'expenses.errors.amountRequired';
  }
  if (!expense.date) {
    problems['date'] = 'expenses.errors.dateRequired';
  }

  return problems;
}
