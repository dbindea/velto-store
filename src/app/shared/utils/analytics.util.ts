/**
 * Los números del negocio: qué entra, qué sale y qué queda.
 *
 * ⚠️ **Es la única autoridad sobre qué cuenta como ingreso**, y esa definición
 * es lo más importante de todo el módulo. Una cifra de ingresos mal definida no
 * da un error: da un número creíble y equivocado, que es la peor clase de fallo
 * con dinero — y a partir de ahí todo lo demás miente igual.
 */

import { Payment, PaymentMethod, PaymentType } from '@shared/models/payment.model';
import { Reservation } from '@shared/models/reservation.model';
import { roundMoney } from '@shared/utils/payment-summary.util';
import { toDate } from '@shared/utils/reservation-date.util';

// ---------------------------------------------------------------------------
// Qué es un ingreso
// ---------------------------------------------------------------------------

/**
 * ⚠️ **Una fianza NO es un ingreso.** Es dinero del cliente que la empresa
 * custodia y devuelve: entra en la cuenta y vuelve a salir. Contarla infla los
 * ingresos, y contar además su devolución los infla **otra vez** — una fianza de
 * 300 € cobrada y devuelta sumaba 600 € de «facturación».
 *
 * Eso es exactamente lo que hacía el informe anterior, que sumaba todo pago
 * cobrado sin mirar su tipo. Se corrigió al construir esta pantalla.
 *
 * La **retención** sí es ingreso: es la parte de la fianza que se queda la
 * empresa para cubrir un daño, y no se devuelve.
 */
const NO_SON_INGRESO: PaymentType[] = ['deposit', 'deposit_refund'];

export function isRevenue(payment: Payment): boolean {
  if (payment.status !== 'paid') return false;
  if (NO_SON_INGRESO.includes(payment.type)) return false;
  return (Number(payment.paidAmount) || 0) > 0;
}

/** La fecha en que entró el dinero. Sin ella no se puede situar en un periodo. */
export function paidOn(payment: Payment): Date | null {
  if (!payment.paidAt) return null;
  const d = toDate(payment.paidAt);
  return isNaN(d.getTime()) ? null : d;
}

export interface DateRange {
  from: Date;
  to: Date;
}

/** El rango por defecto: del 1 de enero de este año hasta hoy. */
export function yearToDate(now = new Date()): DateRange {
  const from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/**
 * ⚠️ **El «hasta» incluye el día entero.** Es el mismo cuidado que en los
 * filtros de facturas y de comisiones: comparar contra la medianoche deja fuera
 * todo lo del día que se acaba de teclear.
 */
function dentro(fecha: Date | null, r: DateRange): boolean {
  if (!fecha) return false;
  return fecha >= r.from && fecha <= r.to;
}

/** Los cobros que cuentan como ingreso dentro del rango. */
export function revenuePayments(payments: Payment[], range: DateRange): Payment[] {
  return payments.filter((p) => isRevenue(p) && dentro(paidOn(p), range));
}

export function sumPaid(payments: Payment[]): number {
  return roundMoney(payments.reduce((t, p) => t + (Number(p.paidAmount) || 0), 0));
}

// ---------------------------------------------------------------------------
// IVA
// ---------------------------------------------------------------------------

/**
 * La base imponible de un importe que ya lleva IVA.
 *
 * ⚠️ **Se EXTRAE, no se resta un porcentaje.** Con el 21 %, la base de 121 € son
 * 100 € (121 / 1,21), no 121 − 21 %, que daría 95,59. Es la misma aritmética que
 * `extractVatFromGross()` usa en los gastos, y confundirla no da un error: da una
 * cifra creíble y equivocada.
 */
export function netFromGross(gross: number, vatRate: number): number {
  const rate = Number(vatRate) || 0;
  return roundMoney((Number(gross) || 0) / (1 + rate));
}

/**
 * El tipo congelado en la reserva de la que sale el cobro.
 *
 * ⚠️ **Se lee de la reserva, no se supone.** El tipo se congela en
 * `pricingSnapshot.vatRate` justamente para que una subida futura del general no
 * mueva lo ya pactado. Para un cobro sin reserva —un cobro libre— no hay tipo
 * congelado y se usa el general: por eso la cifra neta se presenta como
 * **estimada** y no como un dato fiscal.
 */
export function vatRateOf(
  payment: Payment,
  reservations: Map<string, Reservation>,
  fallback: number
): number {
  const r = payment.reservationId ? reservations.get(payment.reservationId) : undefined;
  const rate = r?.pricingSnapshot?.vatRate;
  return typeof rate === 'number' ? rate : fallback;
}

// ---------------------------------------------------------------------------
// Series temporales
// ---------------------------------------------------------------------------

export interface MonthPoint {
  /** 0-11. */
  month: number;
  amount: number;
}

/**
 * Los doce meses de un año, **siempre los doce**.
 *
 * ⚠️ Los meses sin ingresos valen 0 y se quedan en la serie. Saltárselos haría
 * que una línea de enero a diciembre con un hueco en agosto se dibujara como si
 * agosto no existiera, uniendo julio con septiembre en una recta que miente.
 */
export function monthlyRevenue(payments: Payment[], year: number): MonthPoint[] {
  const meses: number[] = new Array(12).fill(0);
  for (const p of payments) {
    if (!isRevenue(p)) continue;
    const d = paidOn(p);
    if (!d || d.getFullYear() !== year) continue;
    meses[d.getMonth()] += Number(p.paidAmount) || 0;
  }
  return meses.map((amount, month) => ({ month, amount: roundMoney(amount) }));
}

// ---------------------------------------------------------------------------
// Reparto por método de cobro
// ---------------------------------------------------------------------------

/**
 * Las familias de cobro, que es como se piensa el dinero: tarjeta, banco,
 * efectivo.
 *
 * ⚠️ **Se agrupa a propósito.** `redsys`, `physical_pos` y `manual_card` son tres
 * formas de cobrar con tarjeta, y separarlas en un gráfico obliga a sumarlas
 * mentalmente cada vez. Bizum va aparte de la transferencia porque llega al
 * instante y la transferencia no: no son la misma decisión de negocio.
 */
export type MethodFamily = 'card' | 'transfer' | 'bizum' | 'cash' | 'other';

const FAMILIA: Record<PaymentMethod, MethodFamily> = {
  redsys: 'card',
  physical_pos: 'card',
  manual_card: 'card',
  bank_transfer: 'transfer',
  bizum: 'bizum',
  cash: 'cash',
  other: 'other'
};

export const METHOD_FAMILIES: MethodFamily[] = ['card', 'transfer', 'bizum', 'cash', 'other'];

export interface MethodSlice {
  family: MethodFamily;
  amount: number;
  /** Cuántos cobros, que no es lo mismo que cuánto dinero. */
  count: number;
}

/**
 * Cuánto entra por cada vía.
 *
 * Se devuelven **solo las familias con algo**: una porción de 0 € en un donut es
 * una etiqueta que tapa a las demás sin decir nada.
 */
export function revenueByMethod(payments: Payment[]): MethodSlice[] {
  const acc = new Map<MethodFamily, MethodSlice>();
  for (const p of payments) {
    const familia = FAMILIA[p.method] || 'other';
    const previo = acc.get(familia) || { family: familia, amount: 0, count: 0 };
    previo.amount += Number(p.paidAmount) || 0;
    previo.count += 1;
    acc.set(familia, previo);
  }
  return METHOD_FAMILIES.filter((f) => acc.has(f))
    .map((f) => ({ ...acc.get(f)!, amount: roundMoney(acc.get(f)!.amount) }))
    .filter((s) => s.amount > 0);
}

// ---------------------------------------------------------------------------
// Clientes y vehículos
// ---------------------------------------------------------------------------

export interface ClientTotals {
  clientId: string;
  name: string;
  revenue: number;
  /** Días de alquiler acumulados, de sus reservas dentro del rango. */
  days: number;
  rentals: number;
}

/**
 * Los clientes que más dejan, con los días que han tenido coche.
 *
 * ⚠️ **Se ordena por dinero, no por días.** Un cliente de treinta días a precio
 * bajo no es mejor cliente que uno de diez a precio alto, y la pregunta que
 * responde esta tabla es a quién cuidar.
 *
 * ⚠️ Y los días salen de las **reservas**, no de los cobros: un cliente puede
 * pagar en tres plazos y eso no son tres alquileres.
 */
export function topClients(
  payments: Payment[],
  reservations: Reservation[],
  range: DateRange
): ClientTotals[] {
  const acc = new Map<string, ClientTotals>();

  const asegura = (id: string, nombre: string): ClientTotals => {
    const previo = acc.get(id);
    if (previo) {
      if (previo.name === '—' && nombre !== '—') previo.name = nombre;
      return previo;
    }
    const nuevo: ClientTotals = { clientId: id, name: nombre, revenue: 0, days: 0, rentals: 0 };
    acc.set(id, nuevo);
    return nuevo;
  };

  for (const p of payments) {
    if (!p.clientId) continue;
    const fila = asegura(p.clientId, p.clientSnapshot?.fullName || '—');
    fila.revenue += Number(p.paidAmount) || 0;
  }

  for (const r of reservations) {
    if (!r.clientId) continue;
    // El alquiler cuenta en el periodo en que se recoge el coche.
    const recogida = r.pickupDateTime ? toDate(r.pickupDateTime) : null;
    if (!dentro(recogida, range)) continue;
    if (r.reservationStatus === 'cancelled') continue;
    const fila = asegura(r.clientId, r.clientSnapshot?.fullName || '—');
    fila.days += Number(r.totalDays) || 0;
    fila.rentals += 1;
  }

  return [...acc.values()]
    .map((c) => ({ ...c, revenue: roundMoney(c.revenue) }))
    .filter((c) => c.revenue > 0 || c.rentals > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

export interface VehicleTotals {
  vehicleId: string;
  label: string;
  revenue: number;
  days: number;
}

/** Qué coche factura más, y cuántos días ha estado fuera. */
export function revenueByVehicle(
  payments: Payment[],
  reservations: Reservation[],
  range: DateRange
): VehicleTotals[] {
  const acc = new Map<string, VehicleTotals>();

  const asegura = (id: string, label: string): VehicleTotals => {
    const previo = acc.get(id);
    if (previo) {
      if (previo.label === '—' && label !== '—') previo.label = label;
      return previo;
    }
    const nuevo: VehicleTotals = { vehicleId: id, label, revenue: 0, days: 0 };
    acc.set(id, nuevo);
    return nuevo;
  };

  const etiqueta = (s?: { brand?: string; model?: string; plateNumber?: string }) => {
    if (!s) return '—';
    const n = [s.brand, s.model].filter(Boolean).join(' ');
    return s.plateNumber ? `${n} · ${s.plateNumber}` : n || '—';
  };

  for (const p of payments) {
    if (!p.vehicleId) continue;
    asegura(p.vehicleId, etiqueta(p.vehicleSnapshot)).revenue += Number(p.paidAmount) || 0;
  }

  for (const r of reservations) {
    if (!r.vehicleId || r.reservationStatus === 'cancelled') continue;
    const recogida = r.pickupDateTime ? toDate(r.pickupDateTime) : null;
    if (!dentro(recogida, range)) continue;
    asegura(r.vehicleId, etiqueta(r.vehicleSnapshot)).days += Number(r.totalDays) || 0;
  }

  return [...acc.values()]
    .map((v) => ({ ...v, revenue: roundMoney(v.revenue) }))
    .filter((v) => v.revenue > 0 || v.days > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Ocupación y rendimiento
// ---------------------------------------------------------------------------

/** Días naturales de un rango, contando los dos extremos. */
export function daysInRange(range: DateRange): number {
  const a = new Date(range.from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(range.to);
  b.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
}

/**
 * Qué parte del tiempo ha estado alquilada la flota, en tanto por uno.
 *
 * ⚠️ **El denominador son los coches POR los días del periodo**, no los días a
 * secas. Con tres coches y treinta días hay noventa días-coche disponibles;
 * dividir entre treinta daría un 300 % de ocupación con la flota llena.
 *
 * ⚠️ Y se recorta a 1. Un alquiler que empieza dentro del periodo y acaba fuera
 * aporta todos sus días, así que la cuenta puede pasarse; enseñar «117 %» haría
 * dudar de todo lo demás de la pantalla.
 */
export function occupancy(
  reservations: Reservation[],
  vehicleCount: number,
  range: DateRange
): number {
  if (vehicleCount <= 0) return 0;
  const disponibles = vehicleCount * daysInRange(range);
  const alquilados = reservations
    .filter((r) => r.reservationStatus !== 'cancelled')
    .filter((r) => dentro(r.pickupDateTime ? toDate(r.pickupDateTime) : null, range))
    .reduce((t, r) => t + (Number(r.totalDays) || 0), 0);
  return Math.min(1, alquilados / disponibles);
}

/** Lo que se saca por cada día que un coche está alquilado. */
export function revenuePerRentalDay(revenue: number, rentalDays: number): number {
  if (!rentalDays) return 0;
  return roundMoney(revenue / rentalDays);
}

export interface RepeatStats {
  /** Clientes con más de un alquiler en el periodo. */
  repeatClients: number;
  totalClients: number;
  /** Qué parte de los ingresos viene de ellos, en tanto por uno. */
  revenueShare: number;
}

/**
 * Cuántos repiten y cuánto pesan.
 *
 * ⚠️ **Repetir es más de un alquiler, no más de un cobro.** Un cliente que paga
 * señal y resto ha pagado dos veces y ha alquilado una: contar cobros
 * convertiría a casi todo el mundo en cliente fiel.
 */
export function repeatClientStats(clients: ClientTotals[]): RepeatStats {
  const total = clients.length;
  const repiten = clients.filter((c) => c.rentals > 1);
  const ingresoTotal = clients.reduce((t, c) => t + c.revenue, 0);
  const ingresoRepiten = repiten.reduce((t, c) => t + c.revenue, 0);
  return {
    repeatClients: repiten.length,
    totalClients: total,
    revenueShare: ingresoTotal > 0 ? ingresoRepiten / ingresoTotal : 0
  };
}
