import { describe, expect, it } from 'vitest';
import { capitalizeWords } from './text-case.util';

describe('capitalizeWords', () => {
  it('capitalises after a hyphen, which is what M-9 was about', () => {
    expect(capitalizeWords('madrid-barajas')).toBe('Madrid-Barajas');
  });

  it('handles the address that reached a customer PDF', () => {
    expect(capitalizeWords('aeropuerto adolfo suárez madrid-barajas, terminal 4')).toBe(
      'Aeropuerto Adolfo Suárez Madrid-Barajas, Terminal 4'
    );
  });

  it('capitalises after an apostrophe, straight or curly', () => {
    expect(capitalizeWords("o'brien")).toBe("O'Brien");
    expect(capitalizeWords('o’brien')).toBe('O’Brien');
  });

  it('capitalises after a slash and after a dash', () => {
    expect(capitalizeWords('arganda/rivas')).toBe('Arganda/Rivas');
    expect(capitalizeWords('madrid – barcelona')).toBe('Madrid – Barcelona');
  });

  it('tames shouted input without losing the separators', () => {
    expect(capitalizeWords('VEREDA DEL MELERO, 3')).toBe('Vereda Del Melero, 3');
  });

  it('preserves the spacing it was given', () => {
    expect(capitalizeWords('arganda  del rey')).toBe('Arganda  Del Rey');
    expect(capitalizeWords(' arganda')).toBe(' Arganda');
  });

  it('leaves an empty value alone', () => {
    expect(capitalizeWords('')).toBe('');
  });
});
