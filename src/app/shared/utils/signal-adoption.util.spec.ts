/**
 * Adoptar la señal ya cobrada al convertir una solicitud.
 *
 * ⚠️ **Lo que se prueba aquí es dinero que ya está en el banco.** Si la
 * adopción falla, la reserva vuelve a pedir una señal que el cliente ya pagó
 * —el fallo que esto viene a arreglar— y si acierta de más, se adopta un cobro
 * que no es de esta reserva. Las dos direcciones tienen su caso.
 */

import { describe, expect, it } from 'vitest';
import {
  adoptedSignalFields,
  adoptedSignalIsPaid,
  canAdoptSignalPayment,
  netPaidOf,
  type AdoptableSignal
} from './signal-adoption.util';
import { buildInitialPayment } from './payment-summary.util';

const SOLICITUD = 'req-abc';

function cobro(extra: Partial<AdoptableSignal> = {}): AdoptableSignal {
  return {
    id: 'pay-1',
    type: 'free_payment',
    amount: 50,
    paidAmount: 50,
    status: 'paid',
    bookingRequestId: SOLICITUD,
    ...extra
  } as AdoptableSignal;
}

describe('canAdoptSignalPayment', () => {
  it('adopta el cobro de la solicitud que se está convirtiendo', () => {
    expect(canAdoptSignalPayment(cobro(), SOLICITUD).ok).toBe(true);
  });

  it('adopta también el que todavía NO se ha pagado', () => {
    // Es el caso que evita la fila duplicada mientras el cliente se lo piensa.
    const pendiente = cobro({ status: 'pending', paidAmount: 0 });
    expect(canAdoptSignalPayment(pendiente, SOLICITUD).ok).toBe(true);
  });

  it('se niega si no hay cobro', () => {
    const d = canAdoptSignalPayment(null, SOLICITUD);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toContain('notFound');
  });

  /**
   * ⚠️ El caso que de verdad protege: adoptarlo no lo duplicaría, lo MOVERÍA,
   * dejando a la reserva anterior con su señal cobrada y sin la fila que la
   * acredita.
   */
  it('se niega si ya pertenece a otra reserva', () => {
    const d = canAdoptSignalPayment(cobro({ reservationId: 'otra' }), SOLICITUD);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toContain('alreadyAttached');
  });

  it('se niega si está cancelado, que no es dinero', () => {
    const d = canAdoptSignalPayment(cobro({ status: 'cancelled' }), SOLICITUD);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toContain('cancelled');
  });

  /**
   * ⚠️ El id viaja por la URL. Sin comparar la solicitud, una URL tecleada a
   * mano ataría el cobro de otra persona a esta reserva.
   */
  it('se niega si el cobro es de OTRA solicitud', () => {
    const d = canAdoptSignalPayment(cobro({ bookingRequestId: 'req-xyz' }), SOLICITUD);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toContain('otherRequest');
  });

  it('se niega si el cobro no es de ninguna solicitud', () => {
    const d = canAdoptSignalPayment(cobro({ bookingRequestId: undefined }), SOLICITUD);
    expect(d.ok).toBe(false);
  });
});

describe('netPaidOf', () => {
  it('es lo cobrado cuando no se ha devuelto nada', () => {
    expect(netPaidOf(cobro())).toBe(50);
  });

  /**
   * ⚠️ Un pago parcialmente devuelto sigue en `paid` por el resto. Mirando solo
   * `paidAmount` se daría por cobrada una señal que volvió a la tarjeta.
   */
  it('descuenta lo devuelto, como sumPaid()', () => {
    expect(netPaidOf(cobro({ paidAmount: 50, refundedAmount: 20 }))).toBe(30);
  });

  it('no baja de cero aunque lo devuelto supere lo cobrado', () => {
    expect(netPaidOf(cobro({ paidAmount: 50, refundedAmount: 80 }))).toBe(0);
  });
});

/**
 * El bloque de la reserva lo arma `buildInitialPayment()`, que ya es su única
 * autoridad. Lo que se comprueba aquí es que **la pareja funciona**: el importe
 * neto que calcula este fichero, metido en aquella, da el estado correcto. Es
 * la costura por la que esto puede romperse en silencio.
 */
describe('la señal adoptada, armada con buildInitialPayment', () => {
  const bloque = (p: AdoptableSignal) =>
    buildInitialPayment(Number(p.amount) || 0, { paidAmount: netPaidOf(p) });

  it('un cobro pagado deja la señal pagada', () => {
    const b = bloque(cobro({ amount: 25, paidAmount: 25 }));
    expect(b.requiredAmount).toBe(25);
    expect(b.paidAmount).toBe(25);
    expect(b.status).toBe('paid');
  });

  it('un cobro pendiente deja la señal pendiente', () => {
    const b = bloque(cobro({ status: 'pending', paidAmount: 0 }));
    expect(b.paidAmount).toBe(0);
    expect(b.status).toBe('pending');
  });

  it('un cobro parcial no da la señal por pagada', () => {
    const b = bloque(cobro({ amount: 50, paidAmount: 20, status: 'partial' }));
    expect(b.status).toBe('pending');
    expect(b.paidAmount).toBe(20);
  });

  /**
   * ⚠️ El caso que `netPaidOf` existe para acertar: el pago sigue en `paid`
   * por el resto, así que mirando `paidAmount` la señal parecería cobrada.
   */
  it('una señal devuelta entera vuelve a estar pendiente', () => {
    const b = bloque(cobro({ amount: 50, paidAmount: 50, refundedAmount: 50 }));
    expect(b.paidAmount).toBe(0);
    expect(b.status).toBe('pending');
  });
});

describe('adoptedSignalFields', () => {
  const reserva = {
    clientId: 'cli-1',
    clientSnapshot: { fullName: 'Marius Ionescu' },
    vehicleSnapshot: { plateNumber: '4466LKK' },
    pickupDateTime: { seconds: 10 },
    returnDateTime: { seconds: 20 },
    totalDays: 3,
    pricingSnapshot: { finalPrice: 302.5 }
  };

  it('ata el cobro a la reserva y lo convierte en señal', () => {
    const f = adoptedSignalFields('res-9', reserva);
    expect(f['reservationId']).toBe('res-9');
    expect(f['type']).toBe('initial_payment');
  });

  /**
   * ⚠️ El concepto se guarda como el TIPO, no como una frase: el cobro nació
   * con el texto que nombraba la referencia de la solicitud, y esa deja de ser
   * el sujeto en cuanto hay reserva. Con el tipo dentro, el pipe lo traduce.
   */
  it('guarda el concepto como la clave del tipo, no como texto', () => {
    expect(adoptedSignalFields('res-9', reserva)['concept']).toBe('initial_payment');
  });

  it('lleva el bloque de la reserva, como las filas sembradas', () => {
    const snap = adoptedSignalFields('res-9', reserva)['reservationSnapshot'] as any;
    expect(snap.totalDays).toBe(3);
    expect(snap.finalPrice).toBe(302.5);
  });

  /**
   * ⚠️ **El centinela NO puede viajar aquí.** `deleteField()` es un objeto con
   * propiedades propias: dentro de este mapa, un limpiador que lo recorriera lo
   * dejaría en `{}` y Firestore escribiría un mapa vacío en vez de borrar el
   * campo. Lo añade quien escribe, después de limpiar.
   */
  it('NO incluye isFreePayment: el centinela lo pone quien escribe', () => {
    expect(adoptedSignalFields('res-9', reserva)).not.toHaveProperty('isFreePayment');
  });

  /**
   * ⚠️ **Devuelve lo que le dan SIN limpiar, y quien escribe tiene que
   * limpiarlo.** No es un descuido: este fichero es puro y no conoce
   * `cleanForFirestore()`. Pero el contrato hay que dejarlo escrito, porque
   * olvidarlo costó el primer intento contra desarrollo — el `clientSnapshot`
   * de un cliente de alta rápida lleva `email: undefined`, Firestore rechaza
   * el `update()` entero y, al ir en el mismo `writeBatch`, no se creaba ni la
   * reserva. El typecheck, los tests y la build pasaban los tres.
   */
  it('deja pasar los undefined del snapshot: limpiar es de quien escribe', () => {
    const f = adoptedSignalFields('res-9', {
      ...reserva,
      clientSnapshot: { fullName: 'Sin Correo', email: undefined }
    });
    expect((f['clientSnapshot'] as any).email).toBeUndefined();
    expect('email' in (f['clientSnapshot'] as any)).toBe(true);
  });
});

describe('adoptedSignalIsPaid', () => {
  it('distingue cobrada de pendiente', () => {
    expect(adoptedSignalIsPaid(cobro())).toBe(true);
    expect(adoptedSignalIsPaid(cobro({ paidAmount: 20 }))).toBe(false);
  });

  it('un cobro de importe 0 no cuenta como señal cobrada', () => {
    expect(adoptedSignalIsPaid(cobro({ amount: 0, paidAmount: 0 }))).toBe(false);
  });
});
