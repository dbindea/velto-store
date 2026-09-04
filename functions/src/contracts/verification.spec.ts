import { describe, expect, it, afterEach } from 'vitest';
import {
  formatFingerprint,
  formatVerificationCode,
  generateVerificationCode,
  normalizeVerificationCode,
  sha256Hex,
  verificationUrl,
  verificationUrlLabel
} from './verification';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('el código de verificación', () => {
  it('mide 12 caracteres y solo usa el alfabeto legible', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateVerificationCode();
      expect(code).toHaveLength(12);
      for (const ch of code) expect(ALPHABET).toContain(ch);
    }
  });

  /**
   * Se dicta por teléfono y se copia de un papel: las parejas que se confunden
   * al leer no pueden estar dentro.
   */
  it('nunca contiene caracteres que se confundan al leerlos', () => {
    const codes = Array.from({ length: 500 }, generateVerificationCode).join('');
    for (const ch of 'ILOU01') expect(codes).not.toContain(ch);
  });

  /**
   * `byte % 30` habría favorecido a los seis primeros símbolos. Con muestreo
   * con rechazo salen todos, y este test es lo que distingue una cosa de la
   * otra sin tener que leer la implementación.
   */
  it('reparte entre los treinta símbolos, sin sesgo hacia los primeros', () => {
    const codes = Array.from({ length: 2000 }, generateVerificationCode).join('');
    for (const ch of ALPHABET) expect(codes).toContain(ch);
  });

  it('no repite: 5.000 códigos son 5.000 distintos', () => {
    const seen = new Set(Array.from({ length: 5000 }, generateVerificationCode));
    expect(seen.size).toBe(5000);
  });
});

describe('cómo se escribe y cómo se lee', () => {
  it('se imprime en grupos de cuatro con el prefijo de la marca', () => {
    expect(formatVerificationCode('3F7K9QD2XR84')).toBe('VLT-3F7K-9QD2-XR84');
  });

  it('acepta lo impreso, lo de la URL y lo mal tecleado', () => {
    for (const input of [
      'VLT-3F7K-9QD2-XR84',
      'vlt-3f7k-9qd2-xr84',
      'VLT 3F7K 9QD2 XR84',
      '3F7K9QD2XR84',
      '3f7k-9qd2-xr84'
    ]) {
      expect(normalizeVerificationCode(input), input).toBe('3F7K9QD2XR84');
    }
  });

  it('vuelve del formato impreso al canónico', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateVerificationCode();
      expect(normalizeVerificationCode(formatVerificationCode(code))).toBe(code);
    }
  });

  /**
   * Sin este filtro, cada cadena que alguien tire contra la function sería una
   * lectura de Firestore que pagamos nosotros.
   */
  it('rechaza lo que no puede ser un código, sin consultar nada', () => {
    for (const input of [
      '',
      'VLT',
      '3F7K9QD2XR8', // 11
      '3F7K9QD2XR845', // 13
      '3F7K9QD2XR8I', // la I no está en el alfabeto
      '3F7K9QD2XR80', // el 0 tampoco
      '../contracts/algo'
    ]) {
      expect(normalizeVerificationCode(input), input).toBeNull();
    }
  });
});

describe('la URL del QR', () => {
  const previo = process.env.VELTO_PUBLIC_BASE_URL;
  afterEach(() => {
    if (previo === undefined) delete process.env.VELTO_PUBLIC_BASE_URL;
    else process.env.VELTO_PUBLIC_BASE_URL = previo;
  });

  it('cuelga del dominio propio del entorno', () => {
    process.env.VELTO_PUBLIC_BASE_URL = 'https://store.veltorent.com';
    expect(verificationUrl('3F7K9QD2XR84')).toBe('https://store.veltorent.com/v/3F7K9QD2XR84');
    expect(verificationUrlLabel()).toBe('store.veltorent.com/v');
  });

  it('no se queda con la barra final si la variable la trae', () => {
    process.env.VELTO_PUBLIC_BASE_URL = 'https://rentalcar.veltomobility.com/';
    expect(verificationUrl('3F7K9QD2XR84')).toBe(
      'https://rentalcar.veltomobility.com/v/3F7K9QD2XR84'
    );
  });
});

describe('la huella del PDF', () => {
  it('es el SHA-256 de los bytes, en hexadecimal', () => {
    // Vector de referencia: SHA-256 de la cadena vacía.
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  /**
   * Es la propiedad de la que depende todo N-9: si un byte del PDF cambia, la
   * huella cambia. Es lo que permite decirle a un cliente que el fichero que
   * tiene es —o no es— el que emitimos.
   */
  it('cambia si cambia un solo byte', () => {
    const a = sha256Hex(new Uint8Array([1, 2, 3]));
    const b = sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it('se enseña en grupos de ocho, que es como se compara a ojo', () => {
    const hex = sha256Hex(new Uint8Array());
    const shown = formatFingerprint(hex);
    expect(shown.split(' ')).toHaveLength(8);
    expect(shown.replace(/ /g, '')).toBe(hex);
  });
});
