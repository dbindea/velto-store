import { describe, expect, it } from 'vitest';
import { capitalizeWords, toReference, transformInput } from './text-case.util';

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


  it('leaves deliberate mixed case alone: car versions are full of it', () => {
    expect(capitalizeWords('sport tourer business dCi 115')).toBe('Sport Tourer Business dCi 115');
    expect(capitalizeWords('1.5 TCe BlueHDi')).toBe('1.5 TCe BlueHDi');
  });

  it('still tames a word shouted in full caps', () => {
    expect(capitalizeWords('MEGANE')).toBe('Megane');
  });

  it('leaves an empty value alone', () => {
    expect(capitalizeWords('')).toBe('');
  });
});

describe('toReference', () => {
  it('upper-cases and strips spaces', () => {
    expect(toReference(' 1234 abc ')).toBe('1234ABC');
    expect(toReference('vf1 rfa 005')).toBe('VF1RFA005');
  });
});

// ---------------------------------------------------------------------------
// The caret
//
// Every field that rewrites itself as you type did it by assigning
// `input.value`, which parks the caret at the end. Correcting the middle of a
// plate threw you to the end of the field, and the next keystroke landed in the
// wrong place. On a phone that made the field feel broken.
// ---------------------------------------------------------------------------

describe('transformInput', () => {
  /** Minimal stand-in for the parts of an input this helper touches. */
  function fakeInput(value: string, caret = value.length) {
    const input = {
      value,
      selectionStart: caret,
      selectionEnd: caret,
      setSelectionRange(start: number, end: number) {
        this.selectionStart = start;
        this.selectionEnd = end;
      }
    };
    // `transformInput` only moves the caret on the focused element.
    Object.defineProperty(globalThis, 'document', {
      value: { activeElement: input },
      configurable: true
    });
    return input as unknown as HTMLInputElement & { selectionStart: number };
  }

  it('keeps the caret where it was when only the case changes', () => {
    // "12|34abc" — inserting "x" gives "12x|34abc", caret at 3.
    const input = fakeInput('12x34abc', 3);
    expect(transformInput(input, toReference)).toBe('12X34ABC');
    expect(input.selectionStart).toBe(3);
  });

  it('accounts for characters the transform removes', () => {
    // "vf1 rf|a" — the space before the caret disappears, so the caret moves
    // back one with it.
    const input = fakeInput('vf1 rfa', 6);
    expect(transformInput(input, toReference)).toBe('VF1RFA');
    expect(input.selectionStart).toBe(5);
  });

  it('leaves the caret alone when the value does not change', () => {
    const input = fakeInput('1234ABC', 2);
    expect(transformInput(input, toReference)).toBe('1234ABC');
    expect(input.selectionStart).toBe(2);
  });

  it('still returns the transformed value for the model binding', () => {
    const input = fakeInput('renault clio', 12);
    expect(transformInput(input, capitalizeWords)).toBe('Renault Clio');
    expect(input.value).toBe('Renault Clio');
  });
});
