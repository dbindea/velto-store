/**
 * The rule that matters here is the one that is easy to get backwards:
 * a Firestore sentinel must come out the other side STILL A SENTINEL.
 *
 * Rebuilding one has broken this project twice — contract timestamps written
 * as `{}` (F-4), and internal notes failing with "Unsupported field value:
 * undefined" because the clean walked into `arrayUnion()._elements`.
 */

import { describe, expect, it } from 'vitest';
import { arrayUnion, serverTimestamp, increment, FieldValue } from '@angular/fire/firestore';
import { cleanForFirestore } from './firestore-clean.util';

describe('sentinels survive untouched', () => {
  it('keeps arrayUnion a sentinel, not a map', () => {
    const sentinel = arrayUnion({ id: 'n1', text: 'hola' });
    const cleaned = cleanForFirestore({ internalNotes: sentinel });

    // Identity, not just shape: anything else is no longer an append.
    expect(cleaned.internalNotes).toBe(sentinel);
    expect(cleaned.internalNotes).toBeInstanceOf(FieldValue);
  });

  it('keeps serverTimestamp a sentinel', () => {
    const sentinel = serverTimestamp();
    const cleaned = cleanForFirestore({ createdAt: sentinel, updatedAt: sentinel });

    expect(cleaned.createdAt).toBe(sentinel);
    expect(cleaned.updatedAt).toBeInstanceOf(FieldValue);
  });

  it('keeps increment a sentinel', () => {
    const sentinel = increment(1);
    expect(cleanForFirestore({ count: sentinel }).count).toBe(sentinel);
  });

  it('does not turn a sentinel into a plain object', () => {
    // What the old implementation did: rebuild it with Object.entries(), which
    // produced a plain `{ _methodName, _elements }` map. Firestore then wrote
    // that map instead of appending — and reported the undefined inside it.
    const cleaned: any = cleanForFirestore({ notes: arrayUnion({ a: 1 }) });
    expect(Object.getPrototypeOf(cleaned.notes)).not.toBe(Object.prototype);
  });
});

describe('undefined removal', () => {
  it('drops undefined keys and keeps the rest', () => {
    const cleaned = cleanForFirestore({ a: 1, b: undefined, c: 'x' });
    expect(cleaned).toEqual({ a: 1, c: 'x' });
    expect('b' in cleaned).toBe(false);
  });

  it('recurses into nested plain objects', () => {
    const cleaned = cleanForFirestore({ deposit: { amount: 0, reason: undefined } });
    expect(cleaned).toEqual({ deposit: { amount: 0 } });
  });

  it('strips undefined from inside arrays', () => {
    // The reservation service's old cleaner returned arrays untouched, so an
    // undefined inside one reached Firestore and threw.
    const cleaned = cleanForFirestore({
      notes: [{ id: 'n1', createdBy: undefined }, undefined, { id: 'n2' }]
    });
    expect(cleaned.notes).toEqual([{ id: 'n1' }, { id: 'n2' }]);
  });

  it('keeps null by default', () => {
    expect(cleanForFirestore({ a: null })).toEqual({ a: null });
  });

  it('drops null when asked', () => {
    expect(cleanForFirestore({ a: null, b: 1 }, { stripNulls: true })).toEqual({ b: 1 });
  });
});

describe('non-plain values are passed through', () => {
  it('leaves Date alone', () => {
    const date = new Date('2026-08-27T10:00:00Z');
    expect(cleanForFirestore({ at: date }).at).toBe(date);
  });

  it('leaves anything with a toDate() alone', () => {
    // Stands in for a Firestore Timestamp.
    const stamp = { seconds: 1, nanoseconds: 0, toDate: () => new Date() };
    Object.setPrototypeOf(stamp, { constructor: function Timestamp() {} });
    expect(cleanForFirestore({ at: stamp }).at).toBe(stamp);
  });

  it('passes primitives through', () => {
    expect(cleanForFirestore(5)).toBe(5);
    expect(cleanForFirestore('x')).toBe('x');
    expect(cleanForFirestore(null)).toBe(null);
    expect(cleanForFirestore(false)).toBe(false);
  });

  it('keeps zero and empty string, which are real values', () => {
    expect(cleanForFirestore({ deposit: 0, note: '' })).toEqual({ deposit: 0, note: '' });
  });
});
