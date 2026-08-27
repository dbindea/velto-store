import { describe, expect, it } from 'vitest';
import { buildReservationNote } from './reservation-note.util';

describe('buildReservationNote', () => {
  it('never emits undefined fields', () => {
    // This is the whole point: the note travels inside an arrayUnion sentinel,
    // which cannot be cleaned on the way out. An operator whose authorised-user
    // record had no displayName broke every note with
    // "Unsupported field value: undefined".
    const note = buildReservationNote('Cliente avisa que llega tarde');

    for (const value of Object.values(note)) {
      expect(value).not.toBeUndefined();
    }
    expect('createdBy' in note).toBe(false);
    expect('createdByEmail' in note).toBe(false);
  });

  it('records the author when there is one', () => {
    const note = buildReservationNote('Nota', {
      displayName: 'Dorel Bindea',
      email: 'dbindea@gmail.com'
    });
    expect(note.createdBy).toBe('Dorel Bindea');
    expect(note.createdByEmail).toBe('dbindea@gmail.com');
  });

  it('treats blank and null author fields as absent', () => {
    const note = buildReservationNote('Nota', { displayName: '   ', email: null });
    expect('createdBy' in note).toBe(false);
    expect('createdByEmail' in note).toBe(false);
  });

  it('records only the half of the author it has', () => {
    const note = buildReservationNote('Nota', { email: 'ops@velto.es' });
    expect('createdBy' in note).toBe(false);
    expect(note.createdByEmail).toBe('ops@velto.es');
  });

  it('trims the text', () => {
    expect(buildReservationNote('  con espacios  ').text).toBe('con espacios');
  });

  it('refuses an empty note', () => {
    expect(() => buildReservationNote('')).toThrow(/required/i);
    expect(() => buildReservationNote('   ')).toThrow(/required/i);
  });

  it('gives every note its own id and a timestamp', () => {
    const a = buildReservationNote('a');
    const b = buildReservationNote('b');
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt.seconds).toBeGreaterThan(0);
  });
});
