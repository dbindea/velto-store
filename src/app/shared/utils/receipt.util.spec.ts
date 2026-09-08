import { describe, expect, it } from 'vitest';
import { canIssueReceipt, receiptProblem } from './receipt.util';

/**
 * La misma tabla de casos que `functions/src/invoices/receipt-core.spec.ts`.
 *
 * No es duplicación por descuido: la regla vive en dos sitios porque la
 * aplicación y las functions no pueden compartir módulo, y lo único que impide
 * que las dos copias diverjan en silencio es que las dos se prueben contra los
 * mismos casos. Si se cambia una tabla, se cambian las dos.
 */
describe('qué cobro admite recibo', () => {
  it('una señal cobrada, sí', () => {
    expect(receiptProblem({ direction: 'income', status: 'paid', paidAmount: 200 })).toBeNull();
    expect(canIssueReceipt({ direction: 'income', status: 'paid', paidAmount: 200 })).toBe(true);
  });

  it('un cobro parcial también: el dinero entró, aunque falte el resto', () => {
    expect(receiptProblem({ direction: 'income', status: 'partial', paidAmount: 100 })).toBeNull();
  });

  it('un cargo extra cobrado, sí', () => {
    expect(receiptProblem({ direction: 'charge', status: 'paid', paidAmount: 45 })).toBeNull();
  });

  it('una fila sembrada y sin cobrar, no', () => {
    expect(receiptProblem({ direction: 'income', status: 'pending', paidAmount: 0 })).toBe(
      'payments.receipt.problems.nothingCollected'
    );
  });

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
    expect(receiptProblem({ direction: 'income', status: 'cancelled', paidAmount: 0 })).toBe(
      'payments.receipt.problems.cancelled'
    );
  });

  it('un residuo de coma flotante no cuenta como cobro', () => {
    expect(
      receiptProblem({ direction: 'income', status: 'partial', paidAmount: 0.000000000004 })
    ).toBe('payments.receipt.problems.nothingCollected');
  });

  it('un pago sin datos no revienta: simplemente no admite recibo', () => {
    expect(receiptProblem({})).toBe('payments.receipt.problems.notIncoming');
  });
});
