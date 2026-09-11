import { describe, expect, it } from 'vitest';
import { isOpenPayment, visiblePayments } from './payment-scope.util';
import type { Payment, PaymentStatus } from '@shared/models/payment.model';

const pago = (status: PaymentStatus, paidAmount = 0): Payment =>
  ({
    id: status,
    status,
    type: 'deposit_payment',
    method: 'cash',
    amount: 100,
    paidAmount,
    pendingAmount: 100 - paidAmount,
    currency: 'EUR'
  }) as unknown as Payment;

describe('qué cobros quedan abiertos', () => {
  it('lo pendiente y lo parcial están abiertos: es lo que falta por cobrar', () => {
    expect(isOpenPayment(pago('pending'))).toBe(true);
    expect(isOpenPayment(pago('partial', 50))).toBe(true);
  });

  it('un cobro fallido también: hay que perseguirlo y no dice qué ingresó la empresa', () => {
    expect(isOpenPayment(pago('failed'))).toBe(true);
  });

  it('lo cobrado NO está abierto — es la fila que suma la facturación', () => {
    expect(isOpenPayment(pago('paid', 100))).toBe(false);
  });

  it('una devolución tampoco: lleva importe y revela un cobro anterior', () => {
    expect(isOpenPayment(pago('refunded', 100))).toBe(false);
  });

  it('lo cancelado tampoco: ya no hay nada que hacer con ello', () => {
    expect(isOpenPayment(pago('cancelled'))).toBe(false);
  });
});

describe('la lista que ve cada uno', () => {
  const todos = [
    pago('pending'),
    pago('partial', 50),
    pago('paid', 100),
    pago('failed'),
    pago('cancelled'),
    pago('refunded', 100)
  ];

  it('un administrador ve el libro entero, sin tocar nada', () => {
    expect(visiblePayments(todos, true)).toEqual(todos);
  });

  it('sin el permiso solo quedan los abiertos', () => {
    expect(visiblePayments(todos, false).map((p) => p.status)).toEqual([
      'pending',
      'partial',
      'failed'
    ]);
  });

  it('⚠️ ningún cobrado se cuela: es lo único que no puede fallar aquí', () => {
    const visibles = visiblePayments(todos, false);
    expect(visibles.some((p) => p.status === 'paid' || p.status === 'refunded')).toBe(false);
    expect(visibles.reduce((t, p) => t + p.paidAmount, 0)).toBe(50);
  });

  it('no muta la lista que le dan', () => {
    const original = [...todos];
    visiblePayments(todos, false);
    expect(todos).toEqual(original);
  });
});
