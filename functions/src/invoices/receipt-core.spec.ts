import { describe, expect, it } from 'vitest';
import { canIssueReceipt, receiptProblem } from './receipt-core';

/**
 * La regla del recibo, que es una regla sobre dinero: **solo se justifica lo
 * que ha entrado**. Los cuatro casos que no admiten recibo no son hipótesis —
 * son filas que existen en cualquier reserva cerrada de la aplicación.
 */
describe('qué cobro admite recibo', () => {
  it('una señal cobrada, sí', () => {
    expect(
      receiptProblem({ direction: 'income', status: 'paid', paidAmount: 200 })
    ).toBeNull();
    expect(canIssueReceipt({ direction: 'income', status: 'paid', paidAmount: 200 })).toBe(true);
  });

  it('un cobro parcial también: el dinero entró, aunque falte el resto', () => {
    expect(
      receiptProblem({ direction: 'income', status: 'partial', paidAmount: 100 })
    ).toBeNull();
  });

  it('un cargo extra cobrado, sí', () => {
    expect(
      receiptProblem({ direction: 'charge', status: 'paid', paidAmount: 45 })
    ).toBeNull();
  });

  it('una fila sembrada y sin cobrar, no: no hay nada que justificar', () => {
    expect(receiptProblem({ direction: 'income', status: 'pending', paidAmount: 0 })).toBe(
      'payments.receipt.problems.nothingCollected'
    );
  });

  /**
   * ⚠️ El caso que hace falta acertar. Una devolución de fianza mueve dinero en
   * la dirección contraria, así que un papel que dijera «recibido de …» sería
   * lo contrario de lo que pasó — y lleva `paidAmount` mayor que cero, así que
   * la comprobación del importe no lo caza.
   */
  it('una devolución de fianza, no, aunque tenga importe', () => {
    expect(receiptProblem({ direction: 'refund', status: 'paid', paidAmount: 300 })).toBe(
      'payments.receipt.problems.notIncoming'
    );
  });

  it('una retención de fianza tampoco', () => {
    expect(receiptProblem({ direction: 'retention', status: 'paid', paidAmount: 45 })).toBe(
      'payments.receipt.problems.notIncoming'
    );
  });

  it('un cobro cancelado, no', () => {
    expect(receiptProblem({ direction: 'income', status: 'cancelled', paidAmount: 200 })).toBe(
      'payments.receipt.problems.cancelled'
    );
  });

  it('un cobro fallido, no', () => {
    expect(receiptProblem({ direction: 'income', status: 'failed', paidAmount: 0 })).toBe(
      'payments.receipt.problems.cancelled'
    );
  });

  it('el estado manda sobre el importe cuando fallan los dos', () => {
    // «Este cobro está cancelado» explica más que «no se ha cobrado nada».
    expect(receiptProblem({ direction: 'income', status: 'cancelled', paidAmount: 0 })).toBe(
      'payments.receipt.problems.cancelled'
    );
  });

  /**
   * Un céntimo de residuo de coma flotante no es dinero cobrado. `108.9 - 50`
   * da `58.900000000000006` en este proyecto, y de ahí salen importes que
   * parecen ceros y no lo son.
   */
  it('un residuo de coma flotante no cuenta como cobro', () => {
    expect(
      receiptProblem({ direction: 'income', status: 'partial', paidAmount: 0.000000000004 })
    ).toBe('payments.receipt.problems.nothingCollected');
  });

  it('un pago sin datos no revienta: simplemente no admite recibo', () => {
    expect(receiptProblem({})).toBe('payments.receipt.problems.notIncoming');
  });
});
