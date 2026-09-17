import { describe, it, expect } from 'vitest';
import {
  appliedPaidAmount,
  chargeAccepted,
  isRefundNotification,
  outstandingAmount
} from './redsys-charge-core';

describe('outstandingAmount — lo que queda, no el total', () => {
  it('sin nada cobrado, lo pendiente es el total', () => {
    expect(outstandingAmount({ amount: 50, paidAmount: 0, pendingAmount: 50 })).toBe(50);
  });

  it('con 20 ya cobrados de 50, el enlace tiene que ir por 30', () => {
    // Es el fallo: iba por 50 y el cliente pagaba 70 € por un concepto de 50.
    expect(outstandingAmount({ amount: 50, paidAmount: 20, pendingAmount: 30 })).toBe(30);
  });

  it('respalda restando si la fila no lleva pendingAmount', () => {
    expect(outstandingAmount({ amount: 50, paidAmount: 20 })).toBe(30);
  });

  it('nunca es negativo, aunque se haya cobrado de más', () => {
    expect(outstandingAmount({ amount: 50, paidAmount: 70, pendingAmount: -20 })).toBe(0);
  });

  it('un pago entero ya cobrado no deja nada pendiente', () => {
    expect(outstandingAmount({ amount: 50, paidAmount: 50, pendingAmount: 0 })).toBe(0);
  });

  it('redondea al céntimo', () => {
    expect(outstandingAmount({ amount: 108.9, paidAmount: 50 })).toBe(58.9);
  });
});

describe('chargeAccepted — 0000 a 0099, y solo eso', () => {
  it('acepta el rango del cobro', () => {
    for (const c of ['0000', '0001', '0050', '0099']) {
      expect(chargeAccepted(c), c).toBe(true);
    }
  });

  it('RECHAZA el rango de la devolución', () => {
    // `/^0[0-9][0-9][0-9]$/` los daba por buenos, y un aviso de devolución
    // aceptada dejaba el pago en `paid` con 0 pendiente: la devolución se
    // deshacía sola en los libros con el dinero ya fuera del banco.
    for (const c of ['0900', '0950', '0999']) {
      expect(chargeAccepted(c), c).toBe(false);
    }
  });

  it('rechaza una denegación', () => {
    expect(chargeAccepted('0180')).toBe(false);
    expect(chargeAccepted('9998')).toBe(false);
  });

  it('rechaza el hueco y la basura', () => {
    expect(chargeAccepted('')).toBe(false);
    expect(chargeAccepted(undefined)).toBe(false);
    expect(chargeAccepted(null)).toBe(false);
    expect(chargeAccepted('SIS0051')).toBe(false);
  });
});

describe('isRefundNotification', () => {
  it('reconoce el tipo 3', () => {
    expect(isRefundNotification({ Ds_TransactionType: '3' })).toBe(true);
    expect(isRefundNotification({ Ds_TransactionType: '03' })).toBe(true);
  });

  it('una autorización no lo es', () => {
    expect(isRefundNotification({ Ds_TransactionType: '0' })).toBe(false);
  });

  it('sin el campo, no se supone que sea devolución', () => {
    expect(isRefundNotification({})).toBe(false);
  });
});

describe('appliedPaidAmount — suma lo cobrado, no pisa con el total', () => {
  it('un cobro entero deja el pago cuadrado', () => {
    expect(appliedPaidAmount({ amount: 50, paidAmount: 0, pendingAmount: 50 }, '5000')).toBe(50);
  });

  it('el segundo tramo se SUMA al primero', () => {
    // 20 en efectivo + 30 en tarjeta = 50. Poniendo `paidAmount = amount`
    // salía 50 igual, pero por casualidad: con cualquier otro reparto se
    // perdía la diferencia.
    expect(appliedPaidAmount({ amount: 50, paidAmount: 20, pendingAmount: 30 }, '3000')).toBe(50);
  });

  it('el importe lo manda el banco, no la fila', () => {
    // Si el cliente pagó 10 de los 30 pendientes, se apuntan 10.
    expect(appliedPaidAmount({ amount: 50, paidAmount: 20, pendingAmount: 30 }, '1000')).toBe(30);
  });

  it('sin importe utilizable cae a lo PENDIENTE, nunca al total', () => {
    expect(appliedPaidAmount({ amount: 50, paidAmount: 20, pendingAmount: 30 }, '')).toBe(50);
    expect(appliedPaidAmount({ amount: 50, paidAmount: 20, pendingAmount: 30 }, undefined)).toBe(50);
  });

  it('redondea al céntimo', () => {
    expect(appliedPaidAmount({ amount: 108.9, paidAmount: 50 }, '5890')).toBe(108.9);
  });
});
