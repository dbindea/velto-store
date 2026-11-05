import { describe, expect, it } from 'vitest';
import { PAYMENT_TYPE_LABELS, Payment, PaymentType } from '@shared/models/payment.model';
import { isPaymentTypeSentinel, paymentConceptKey } from './payment-concept.util';

const fila = (type: PaymentType, concept: string): Payment =>
  ({ type, concept }) as Payment;

describe('isPaymentTypeSentinel', () => {
  it('reconoce TODOS los valores del enumerado', () => {
    // Recorrer el mapa y no una lista a mano: el compilador obliga a que
    // `PAYMENT_TYPE_LABELS` esté completo, así que un tipo nuevo entra solo.
    for (const tipo of Object.keys(PAYMENT_TYPE_LABELS)) {
      expect(isPaymentTypeSentinel(tipo)).toBe(true);
    }
  });

  it('no confunde el texto del operador con un enumerado', () => {
    expect(isPaymentTypeSentinel('Rueda pinchada')).toBe(false);
    expect(isPaymentTypeSentinel('Señal reserva')).toBe(false);
    expect(isPaymentTypeSentinel('Resto alquiler')).toBe(false);
    // Una clave i18n tampoco lo es: esa sí se traduce al leer.
    expect(isPaymentTypeSentinel('payments.types.remainingPayment')).toBe(false);
  });

  it('el vacío no es centinela: es ausencia', () => {
    expect(isPaymentTypeSentinel('')).toBe(false);
    expect(isPaymentTypeSentinel('   ')).toBe(false);
    expect(isPaymentTypeSentinel(undefined)).toBe(false);
    expect(isPaymentTypeSentinel(null)).toBe(false);
  });

  it('no se cuela nada del prototipo', () => {
    // `PAYMENT_TYPE_LABELS['constructor']` es truthy indexando a pelo, y un
    // concepto así desaparecería de la pantalla.
    expect(isPaymentTypeSentinel('constructor')).toBe(false);
    expect(isPaymentTypeSentinel('toString')).toBe(false);
    expect(isPaymentTypeSentinel('hasOwnProperty')).toBe(false);
  });
});

describe('paymentConceptKey', () => {
  it('deja intacto el texto libre del operador', () => {
    expect(paymentConceptKey(fila('extra_damage', 'Rueda pinchada'))).toBe('Rueda pinchada');
  });

  it('deja pasar una clave i18n guardada, que `translate()` ya resuelve', () => {
    expect(paymentConceptKey(fila('remaining_payment', 'payments.types.remainingPayment'))).toBe(
      'payments.types.remainingPayment'
    );
  });

  it('sin concepto contesta el rótulo del tipo', () => {
    expect(paymentConceptKey(fila('initial_payment', ''))).toBe('payments.types.initialPayment');
    expect(paymentConceptKey({ type: 'deposit' } as Payment)).toBe('payments.types.deposit');
  });

  it('un concepto que repite su propio tipo contesta el rótulo, no el enumerado', () => {
    // Es el caso que `buildInitialPaymentRows()` siembra a propósito para la
    // entrega y la recogida a domicilio.
    expect(paymentConceptKey(fila('delivery_fee', 'delivery_fee'))).toBe(
      'payments.types.deliveryFee'
    );
    expect(paymentConceptKey(fila('collection_fee', 'collection_fee'))).toBe(
      'payments.types.collectionFee'
    );
  });

  it('EL CASO DE PRODUCCIÓN: un concepto con OTRO tipo dentro se resuelve por la fila', () => {
    // Las 6 filas que dejó el «pago completo» en producción: la señal y el
    // resto quedaron con `concept: 'rental_payment'` encima. Lo que vale es su
    // propio tipo — esa fila son 50 € de señal, no el alquiler entero.
    expect(paymentConceptKey(fila('initial_payment', 'rental_payment'))).toBe(
      'payments.types.initialPayment'
    );
    expect(paymentConceptKey(fila('remaining_payment', 'rental_payment'))).toBe(
      'payments.types.remainingPayment'
    );
  });

  it('el enumerado se reconoce con espacios alrededor', () => {
    expect(paymentConceptKey(fila('initial_payment', '  rental_payment  '))).toBe(
      'payments.types.initialPayment'
    );
  });

  it('sin pago no revienta', () => {
    expect(paymentConceptKey(null)).toBe('');
    expect(paymentConceptKey(undefined)).toBe('');
  });

  it('un tipo desconocido cae a sí mismo en vez de desaparecer', () => {
    // Defensa para un documento viejo con un tipo que el enumerado ya no tiene:
    // más vale un rótulo feo que una fila de dinero sin título.
    expect(paymentConceptKey({ type: 'tipo_retirado', concept: '' } as unknown as Payment)).toBe(
      'tipo_retirado'
    );
  });
});
