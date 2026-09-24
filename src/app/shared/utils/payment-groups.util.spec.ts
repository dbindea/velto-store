import { describe, expect, it } from 'vitest';
import { PAYMENT_TYPE_LABELS, Payment, PaymentType } from '@shared/models/payment.model';
import {
  PAYMENT_GROUP_ORDER,
  groupKeyOf,
  groupPaymentsForReservation
} from './payment-groups.util';

const fila = (
  type: PaymentType,
  amount: number,
  paidAmount = 0,
  status: Payment['status'] = 'pending'
): Payment =>
  ({
    type,
    amount,
    paidAmount,
    status,
    direction: 'in'
  }) as unknown as Payment;

describe('groupKeyOf', () => {
  /**
   * ⚠️ **El test que hace que esto no sea una lista blanca.** `collectedTotalsOf()`
   * enumera lo que **sí** es ingreso, así que un `PaymentType` nuevo que nadie
   * añada deja de contar **en silencio** — el propio fichero lo avisa. Aquí no
   * puede pasar: se recorre el tipo entero (`PAYMENT_TYPE_LABELS` es un
   * `Record<PaymentType, string>`, y el compilador obliga a que esté completo) y
   * se comprueba que cada valor aterriza en un bloque conocido.
   *
   * Si mañana aparece un tipo sin clasificar, cae en «otros» y **se ve en la
   * pantalla**, que es lo contrario de desaparecer.
   */
  it('clasifica TODOS los tipos de cobro que existen', () => {
    const tipos = Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[];
    expect(tipos.length).toBeGreaterThan(10);
    for (const t of tipos) {
      expect(PAYMENT_GROUP_ORDER).toContain(groupKeyOf(t));
    }
  });

  it('separa las tres cosas que se pagan por separado', () => {
    expect(groupKeyOf('initial_payment')).toBe('rental');
    expect(groupKeyOf('remaining_payment')).toBe('rental');
    // Un servicio pactado al reservar no es un cargo extra: no se cubre con la
    // fianza y no ensucia la ficha con «daños» de un alquiler sin un rasguño.
    expect(groupKeyOf('delivery_fee')).toBe('services');
    expect(groupKeyOf('collection_fee')).toBe('services');
    expect(groupKeyOf('extra_damage')).toBe('extras');
    expect(groupKeyOf('deposit')).toBe('deposit');
    expect(groupKeyOf('free_payment')).toBe('other');
  });
});

describe('groupPaymentsForReservation', () => {
  it('devuelve los bloques en el orden en que se leen', () => {
    const grupos = groupPaymentsForReservation([
      fila('deposit', 150),
      fila('extra_damage', 60),
      fila('initial_payment', 30),
      fila('delivery_fee', 18.15)
    ]);
    expect(grupos.map((g) => g.key)).toEqual(['rental', 'services', 'extras', 'deposit']);
  });

  it('no inventa bloques vacíos', () => {
    const grupos = groupPaymentsForReservation([fila('initial_payment', 30)]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].key).toBe('rental');
  });

  it('suma devengado, cobrado y pendiente de cada bloque', () => {
    const [alquiler] = groupPaymentsForReservation([
      fila('initial_payment', 30, 30, 'paid'),
      fila('remaining_payment', 30, 20, 'partial')
    ]);
    expect(alquiler.required).toBe(60);
    expect(alquiler.paid).toBe(50);
    expect(alquiler.pending).toBe(10);
  });

  /**
   * ⚠️ Una fila cancelada sigue a la vista —se pidió y se dejó de pedir, y
   * esconderla hace que el operador busque dónde fue— pero **no cuenta**, que
   * es la misma regla de `calculateReservationPaymentSummary()`. Si las dos no
   * coincidieran, el subtotal del bloque no cuadraría con la cabecera.
   */
  it('enseña lo cancelado sin sumarlo', () => {
    const [alquiler] = groupPaymentsForReservation([
      fila('initial_payment', 30, 30, 'paid'),
      fila('remaining_payment', 999, 0, 'cancelled')
    ]);
    expect(alquiler.payments).toHaveLength(2);
    expect(alquiler.required).toBe(30);
    expect(alquiler.pending).toBe(0);
  });

  /**
   * ⚠️ **El caso que convierte 150 € en 300 €.** Una devolución y una retención
   * llevan importe y van en dirección contraria: sumadas al bloque, una fianza
   * cobrada y devuelta diría que se pidieron 300 €. Es el mismo fallo que
   * Informes ya tuvo que corregir contando una fianza dos veces.
   */
  it('las devoluciones y retenciones se ven en el bloque, pero no suman', () => {
    const [fianza] = groupPaymentsForReservation([
      fila('deposit', 150, 150, 'paid'),
      fila('deposit_retention', 60, 60, 'paid'),
      fila('deposit_refund', 90, 90, 'paid')
    ]);
    expect(fianza.payments).toHaveLength(3);
    expect(fianza.required).toBe(150);
    expect(fianza.paid).toBe(150);
    expect(fianza.pending).toBe(0);
  });
});
