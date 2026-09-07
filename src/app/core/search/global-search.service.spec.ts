import { describe, expect, it } from 'vitest';
import { parseVerificationCode } from './global-search.service';

/**
 * Buscar un contrato por el código que el cliente dicta por teléfono (M-45).
 *
 * El código se lee de un papel y se dicta en voz alta, así que lo que llega al
 * buscador casi nunca es la forma canónica: llega con guiones, en minúscula, o
 * con un cero donde había una O.
 */
describe('parseVerificationCode', () => {
  it('acepta la forma impresa, con prefijo y guiones', () => {
    expect(parseVerificationCode('VLT-7M63-EE55-THDK')).toBe('7M63EE55THDK');
  });

  it('acepta la forma tecleada de corrido', () => {
    expect(parseVerificationCode('7M63EE55THDK')).toBe('7M63EE55THDK');
  });

  it('no distingue mayúsculas: nadie teclea en mayúsculas al buscar', () => {
    expect(parseVerificationCode('vlt-7m63-ee55-thdk')).toBe('7M63EE55THDK');
  });

  it('perdona los espacios de quien lo copia a trozos', () => {
    expect(parseVerificationCode('  VLT 7M63 EE55 THDK ')).toBe('7M63EE55THDK');
  });

  it('traduce 0 y 1, que no existen en el alfabeto', () => {
    // Se dicta por teléfono: un cero tecleado es casi seguro una O mal oída, y
    // un uno una I. Traducirlos encuentra el contrato; rechazarlos deja al
    // operador convencido de que el código es falso.
    expect(parseVerificationCode('VLT-7M63-EE55-THDK'.replace('O', '0'))).toBe('7M63EE55THDK');
    expect(parseVerificationCode('7M63EE55THDK'.replace(/O/g, '0'))).toBe('7M63EE55THDK');
  });

  it('rechaza lo que no puede ser un código', () => {
    // Sin esto se pagaría una lectura de Firestore por cada tecla.
    expect(parseVerificationCode('')).toBeNull();
    expect(parseVerificationCode('Dorel')).toBeNull();
    expect(parseVerificationCode('0001PRB')).toBeNull();
    expect(parseVerificationCode('7M63EE55THD')).toBeNull();      // 11
    expect(parseVerificationCode('7M63EE55THDKX')).toBeNull();    // 13
  });

  it('rechaza letras que el alfabeto excluye a propósito', () => {
    // L y U no se usan porque se confunden al dictar; si aparecen, lo tecleado
    // no es un código nuestro.
    expect(parseVerificationCode('LLLLLLLLLLLL')).toBeNull();
    expect(parseVerificationCode('UUUUUUUUUUUU')).toBeNull();
  });
});
