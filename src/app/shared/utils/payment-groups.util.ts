/**
 * Las filas de cobro de una reserva, ordenadas en los bloques con los que se
 * habla de ellas en el mostrador.
 *
 * ⚠️ **Esto NO es una autoridad nueva sobre el dinero.** No decide importes ni
 * estados: reparte en bloques las filas que ya existen y suma lo que ya suma
 * `calculateReservationPaymentSummary()`, con sus mismas reglas. Existe porque
 * la ficha de la reserva enseñaba el dinero en **tres tarjetas** —«Pendiente»,
 * «Precio total» y «Resumen»— que contaban lo mismo de tres formas y ninguna
 * contestaba la pregunta del mostrador: cuánto tiene que darme el cliente. Las
 * tres se funden en una, y esto es lo que la ordena.
 *
 * ⚠️ **Todo tipo de cobro cae en algún bloque, y eso está probado.** Es la
 * diferencia con una lista blanca: aquí un `PaymentType` nuevo que nadie
 * clasifique aterriza en «otros» y **se ve**, en vez de desaparecer de la
 * pantalla sin que nada avise. Es el mismo fallo que `collectedTotalsOf()`
 * documenta al revés —allí un tipo sin añadir deja de contar como ingreso en
 * silencio—, y aquí no se puede repetir porque el test enumera el tipo entero.
 */

import { Payment, PaymentType } from '@shared/models/payment.model';
import {
  EXTRA_TYPES,
  RENTAL_TYPES,
  SERVICE_TYPES,
  calculatePendingAmount,
  roundMoney
} from '@shared/utils/payment-summary.util';

/**
 * La fianza y sus movimientos.
 *
 * ⚠️ **Los tres van juntos en el bloque y solo el primero suma.** Una
 * devolución y una retención llevan importe y van en dirección contraria: si
 * entraran en el subtotal, una fianza de 150 € cobrada y devuelta diría 300 €.
 * Es exactamente lo que `analytics.util.ts` tuvo que corregir en Informes.
 */
export const DEPOSIT_TYPES: PaymentType[] = ['deposit', 'deposit_refund', 'deposit_retention'];

/** Movimientos que salen o que ya estaban dentro: no suman al subtotal. */
const MOVIMIENTOS: PaymentType[] = ['deposit_refund', 'deposit_retention'];

export type PaymentGroupKey = 'rental' | 'services' | 'extras' | 'deposit' | 'other';

/** El orden en que se leen, que es el del alquiler: lo pactado, lo pedido después. */
export const PAYMENT_GROUP_ORDER: PaymentGroupKey[] = [
  'rental',
  'services',
  'extras',
  'deposit',
  'other'
];

export interface PaymentGroup {
  key: PaymentGroupKey;
  /** Todas las filas del bloque, canceladas incluidas: el rastro también se lee. */
  payments: Payment[];
  /** Lo devengado: lo que el cliente debe por este concepto, se haya cobrado o no. */
  required: number;
  /** Lo que de ese concepto ya entró. */
  paid: number;
  /** Lo que falta. */
  pending: number;
}

export function groupKeyOf(type: PaymentType): PaymentGroupKey {
  if (RENTAL_TYPES.includes(type)) return 'rental';
  if (SERVICE_TYPES.includes(type)) return 'services';
  if (EXTRA_TYPES.includes(type)) return 'extras';
  if (DEPOSIT_TYPES.includes(type)) return 'deposit';
  return 'other';
}

/**
 * Reparte las filas en bloques y suma cada uno.
 *
 * ⚠️ **Lo cancelado se ENSEÑA pero no se suma.** Una fila cancelada documenta
 * algo que se pidió y se dejó de pedir; esconderla haría que el operador se
 * preguntara dónde fue. Que no cuente es la misma regla que aplica
 * `calculateReservationPaymentSummary()`, y las dos tienen que decir lo mismo o
 * el subtotal del bloque no cuadraría con la cabecera.
 *
 * Los bloques vacíos no se devuelven: una línea a «0,00 €» en todas las
 * reservas se lee como un concepto que existe y no se ha cobrado.
 */
export function groupPaymentsForReservation(payments: Payment[]): PaymentGroup[] {
  const porBloque = new Map<PaymentGroupKey, Payment[]>();
  for (const p of payments) {
    const clave = groupKeyOf(p.type);
    const lista = porBloque.get(clave);
    if (lista) lista.push(p);
    else porBloque.set(clave, [p]);
  }

  const grupos: PaymentGroup[] = [];
  for (const key of PAYMENT_GROUP_ORDER) {
    const filas = porBloque.get(key);
    if (!filas?.length) continue;

    const cuentan = filas.filter(
      (p) => p.status !== 'cancelled' && !MOVIMIENTOS.includes(p.type)
    );
    grupos.push({
      key,
      payments: filas,
      required: roundMoney(cuentan.reduce((t, p) => t + (p.amount || 0), 0)),
      paid: roundMoney(cuentan.reduce((t, p) => t + (p.paidAmount || 0), 0)),
      pending: roundMoney(
        cuentan.reduce((t, p) => t + calculatePendingAmount(p.amount || 0, p.paidAmount || 0), 0)
      )
    });
  }
  return grupos;
}
