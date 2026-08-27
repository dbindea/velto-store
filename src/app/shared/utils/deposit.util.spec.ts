import { describe, expect, it } from 'vitest';
import { buildDeposit, isDepositWaived, needsWaivedReason } from './deposit.util';

describe('isDepositWaived', () => {
  it('treats zero, absent and negative as waived', () => {
    expect(isDepositWaived(0)).toBe(true);
    expect(isDepositWaived(null)).toBe(true);
    expect(isDepositWaived(undefined)).toBe(true);
    expect(isDepositWaived(-50)).toBe(true);
    expect(isDepositWaived(Number.NaN)).toBe(true);
  });

  it('treats any real amount as a deposit', () => {
    expect(isDepositWaived(150)).toBe(false);
    expect(isDepositWaived(0.01)).toBe(false);
  });
});

describe('needsWaivedReason', () => {
  it('asks for a reason only when the deposit is waived', () => {
    expect(needsWaivedReason(150, '')).toBe(false);
    expect(needsWaivedReason(0, '')).toBe(true);
  });

  it('rejects a reason that says nothing', () => {
    expect(needsWaivedReason(0, '  ')).toBe(true);
    expect(needsWaivedReason(0, 'ok')).toBe(true);
  });

  it('accepts a real reason', () => {
    expect(needsWaivedReason(0, 'Cliente habitual')).toBe(false);
  });
});

describe('buildDeposit', () => {
  it('creates a pending deposit when there is an amount', () => {
    const deposit = buildDeposit(150);
    expect(deposit.requiredAmount).toBe(150);
    expect(deposit.status).toBe('pending');
    expect(deposit.waivedReason).toBeUndefined();
  });

  it('rounds the amount to the cent', () => {
    expect(buildDeposit(150.005).requiredAmount).toBe(150.01);
  });

  it('creates a waived deposit, not a pending one, when it is zero', () => {
    // The difference matters: `pending` means "we are waiting for this money".
    // Nobody is going to pay it, so the workflow would wait forever.
    const deposit = buildDeposit(0, 'Cliente habitual');
    expect(deposit.requiredAmount).toBe(0);
    expect(deposit.status).toBe('waived');
    expect(deposit.waivedReason).toBe('Cliente habitual');
  });

  it('trims the reason', () => {
    expect(buildDeposit(0, '  Cliente habitual  ').waivedReason).toBe('Cliente habitual');
  });

  it('refuses to waive a deposit without a reason', () => {
    // `isDepositSettled()` in the workflow util only treats a zero deposit as
    // settled when a reason was recorded, so a reservation created this way
    // could never be closed.
    expect(() => buildDeposit(0)).toThrow(/reason/i);
    expect(() => buildDeposit(0, '  ')).toThrow(/reason/i);
    expect(() => buildDeposit(0, 'no')).toThrow(/reason/i);
  });
});
