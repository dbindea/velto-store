/**
 * Lo que se prueba aquí es lo único que impide que salga dinero de más.
 *
 * No hay red debajo: una devolución aceptada por el banco ya ha movido el
 * dinero, y deshacerla es una llamada al comercio. Así que cada caso de abajo es
 * un euro que no se va.
 */

import { describe, expect, it } from 'vitest';
import {
  refundAccepted,
  refundProblem,
  refundableAmount,
  toRedsysAmount
} from './redsys-refund-core';

const cobro = (extra: Record<string, unknown> = {}) => ({
  status: 'paid',
  method: 'redsys',
  paidAmount: 100,
  redsys: { order: '000000000001', authorizationCode: '379521' },
  ...extra
});

describe('cuánto queda por devolver', () => {
  it('de un cobro intacto, todo', () => {
    expect(refundableAmount(cobro())).toBe(100);
  });

  /**
   * ⚠️ **La prueba que evita devolver dos veces.** Sin descontar lo ya devuelto,
   * dos parciales de 50 € sobre un cobro de 100 € pasarían las dos y saldrían
   * 100 € cuando se querían devolver 50.
   */
  it('descuenta lo ya devuelto', () => {
    expect(refundableAmount(cobro({ refundedAmount: 40 }))).toBe(60);
    expect(refundableAmount(cobro({ refundedAmount: 100 }))).toBe(0);
  });

  it('nunca es negativo, aunque los datos digan una barbaridad', () => {
    expect(refundableAmount(cobro({ refundedAmount: 500 }))).toBe(0);
  });

  it('sin pago, cero', () => {
    expect(refundableAmount(null)).toBe(0);
  });
});

describe('qué impide devolver', () => {
  it('un cobro normal con tarjeta se puede devolver', () => {
    expect(refundProblem(cobro(), 100)).toBeNull();
    expect(refundProblem(cobro(), 25.5)).toBeNull();
  });

  /**
   * ⚠️ **Lo cobrado en efectivo no se devuelve por el banco.** Ofrecerlo haría
   * creer que Redsys ha movido algo cuando el dinero está en la caja.
   */
  it('lo que no se cobró con tarjeta, no', () => {
    for (const method of ['cash', 'bank_transfer', 'bizum', 'physical_pos', 'manual_card']) {
      expect(refundProblem(cobro({ method }), 10)).toBe('payments.refund.errors.notCard');
    }
  });

  /**
   * ⚠️ **La que evita regalar dinero.** Un pago pendiente o fallido no ha movido
   * nada: «devolverlo» sería mandarle al cliente un importe que nunca pagó.
   */
  it('lo que no se ha cobrado, tampoco', () => {
    for (const status of ['pending', 'failed', 'cancelled', 'refunded']) {
      expect(refundProblem(cobro({ status }), 10)).toBe('payments.refund.errors.notCollected');
    }
  });

  it('un cobro parcial sí, por lo que entró', () => {
    expect(refundProblem(cobro({ status: 'partial', paidAmount: 30 }), 30)).toBeNull();
  });

  /**
   * ⚠️ Redsys no devuelve «a una tarjeta»: devuelve contra la operación que
   * autorizó. Sin su pedido, la llamada la rechaza el banco.
   */
  it('sin el pedido original, no hay nada que devolver', () => {
    expect(refundProblem(cobro({ redsys: {} }), 10)).toBe('payments.refund.errors.noOrder');
    expect(refundProblem(cobro({ redsys: undefined }), 10)).toBe('payments.refund.errors.noOrder');
  });

  it('lo ya devuelto entero no se vuelve a devolver', () => {
    expect(refundProblem(cobro({ refundedAmount: 100 }), 10)).toBe(
      'payments.refund.errors.alreadyRefunded'
    );
  });

  /**
   * ⚠️ **EL CINTURÓN.** No se puede sacar de la empresa más de lo que ese cobro
   * metió, ni sumando devoluciones parciales.
   */
  it('no se puede devolver más de lo cobrado', () => {
    expect(refundProblem(cobro(), 100.01)).toBe('payments.refund.errors.overRefund');
    expect(refundProblem(cobro(), 1000)).toBe('payments.refund.errors.overRefund');
  });

  it('ni más de lo que queda tras una parcial', () => {
    expect(refundProblem(cobro({ refundedAmount: 60 }), 41)).toBe(
      'payments.refund.errors.overRefund'
    );
    expect(refundProblem(cobro({ refundedAmount: 60 }), 40)).toBeNull();
  });

  /**
   * ⚠️ `Number(null)` y `Number('')` son **0**, no `NaN`: sin comprobar la
   * ausencia antes de convertir, un importe vacío llegaría al banco como una
   * devolución de cero.
   */
  it('un importe vacío no es cero', () => {
    for (const v of [null, undefined, '']) {
      expect(refundProblem(cobro(), v)).toBe('payments.refund.errors.amountRequired');
    }
  });

  it('ni cero ni negativo', () => {
    expect(refundProblem(cobro(), 0)).toBe('payments.refund.errors.amountPositive');
    expect(refundProblem(cobro(), -10)).toBe('payments.refund.errors.amountPositive');
  });

  it('sin pago, no hay devolución', () => {
    expect(refundProblem(null, 10)).toBe('payments.refund.errors.notFound');
  });
});

describe('cómo se le habla a Redsys', () => {
  /**
   * ⚠️ **Céntimos, sin decimales ni separadores.** Mandar `1.00` en vez de `100`
   * hace que el banco lea otra cosa, y lo que lea de más sale de verdad.
   */
  it('el importe va en céntimos', () => {
    expect(toRedsysAmount(1)).toBe('100');
    expect(toRedsysAmount(0.01)).toBe('1');
    expect(toRedsysAmount(133.1)).toBe('13310');
    expect(toRedsysAmount(302.5)).toBe('30250');
  });

  /**
   * ⚠️ **El medio céntimo SUBE, igual que en el resto de la aplicación.**
   * `108.9 * 0.25` da `27.224999999999998` en coma flotante, que al céntimo son
   * 27,23 y no 27,22: es el mismo criterio que usan las comisiones y el precio,
   * y tiene que serlo — si aquí redondeara al revés, devolver «todo» dejaría un
   * céntimo sin devolver y el cliente lo vería en su extracto.
   *
   * Que suba no abre ningún hueco: el tope de `refundProblem()` compara con el
   * mismo redondeo, así que un céntimo de más sobre lo cobrado se rechaza.
   */
  it('y el medio céntimo sube, como en todo lo demás', () => {
    expect(toRedsysAmount(27.224999999999998)).toBe('2723');
    expect(toRedsysAmount(0.005)).toBe('1');
  });

  /**
   * ⚠️ **La prueba que evita devolver dos veces por leer mal la respuesta.**
   * Una autorización aceptada responde 0000–0099; una DEVOLUCIÓN aceptada
   * responde 0900–0999. Con la regla del cobro, una devolución correcta se
   * leería como error y la aplicación la reintentaría.
   */
  it('una devolución aceptada está en el rango 0900-0999', () => {
    expect(refundAccepted('0900')).toBe(true);
    expect(refundAccepted(900)).toBe(true);
    expect(refundAccepted('0950')).toBe(true);
    expect(refundAccepted('0999')).toBe(true);
  });

  it('y el 0000 de un cobro NO es una devolución aceptada', () => {
    expect(refundAccepted('0000')).toBe(false);
    expect(refundAccepted('0099')).toBe(false);
  });

  it('un error del banco tampoco', () => {
    expect(refundAccepted('9998')).toBe(false);
    expect(refundAccepted('0190')).toBe(false);
    expect(refundAccepted('')).toBe(false);
    expect(refundAccepted(undefined)).toBe(false);
    expect(refundAccepted('SIS0051')).toBe(false);
  });
});
