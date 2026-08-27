/**
 * The short-link mapping.
 *
 * There is no lookup table behind these URLs: the id IS the address. So the
 * mapping has to be exactly right in both directions — a mistake here is a
 * customer opening a link from WhatsApp and getting a 404, or worse, reaching
 * a path they should not.
 */

import { describe, expect, it } from 'vitest';
import { resolveDocumentPath, shortIdFor } from './documentLink';

describe('shortIdFor', () => {
  it('prefixes quotes with q and reservations with r', () => {
    expect(shortIdFor('quote', 'A1b2C3d4')).toBe('qA1b2C3d4');
    expect(shortIdFor('booking', 'p2RjP0LG1zp7KHqyNtB0')).toBe('rp2RjP0LG1zp7KHqyNtB0');
  });

  it('round-trips: what we mint is what resolves', () => {
    const quoteId = 'A1b2C3d4E5f6G7h8';
    expect(resolveDocumentPath(shortIdFor('quote', quoteId))).toBe(`quotes/${quoteId}/quote.pdf`);

    const reservationId = 'p2RjP0LG1zp7KHqyNtB0';
    expect(resolveDocumentPath(shortIdFor('booking', reservationId))).toBe(
      `reservations/${reservationId}/booking-confirmation.pdf`
    );
  });
});

describe('resolveDocumentPath', () => {
  it('refuses anything that is not a known prefix', () => {
    expect(resolveDocumentPath('xABC123')).toBeNull();
    expect(resolveDocumentPath('ABC123')).toBeNull();
  });

  it('refuses empty and truncated ids', () => {
    expect(resolveDocumentPath('')).toBeNull();
    expect(resolveDocumentPath('q')).toBeNull();
    expect(resolveDocumentPath('r')).toBeNull();
    expect(resolveDocumentPath('qab')).toBeNull(); // shorter than the minimum
  });

  it('refuses ids that could climb out of their folder', () => {
    // The id lands straight in a Storage path, so traversal is the thing to
    // keep out. Anything with a slash or a dot is rejected outright.
    expect(resolveDocumentPath('q../../contracts/secret')).toBeNull();
    expect(resolveDocumentPath('q..%2F..%2Fcontracts')).toBeNull();
    expect(resolveDocumentPath('qfoo/bar')).toBeNull();
    expect(resolveDocumentPath('qfoo.bar')).toBeNull();
    expect(resolveDocumentPath('q' + 'a'.repeat(200))).toBeNull();
  });

  it('never resolves to the contracts folder', () => {
    // Contracts are reached through the signing token, which is single-use and
    // expires. They must not become permanently readable through a short link.
    for (const id of ['cABC123456', 'contractsABC', 'qcontracts', 'rcontracts']) {
      const path = resolveDocumentPath(id);
      expect(path === null || !path.startsWith('contracts/')).toBe(true);
    }
  });

  it('accepts the url-safe alphabet Firestore and our ids use', () => {
    expect(resolveDocumentPath('qA1b2-C3d_4E5f')).toBe('quotes/A1b2-C3d_4E5f/quote.pdf');
  });
});
