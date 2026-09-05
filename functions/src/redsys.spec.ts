import { describe, expect, it } from 'vitest';
import { newOrder, resolveOrder, signRedsysParameters, signaturesMatch } from './redsys';

/**
 * Frozen test vector.
 *
 * `params` and `expectedSignature` were produced by the independent
 * `redsys-easy` library against the published Redsys sandbox merchant key,
 * then pinned here. They are the reference for HMAC_SHA256_V1.
 *
 * The signature is NOT a plain HMAC of the merchant key. The key is first
 * diversified by 3DES-encrypting the order, and the HMAC then covers only
 * `Ds_MerchantParameters`. An implementation that skips either step produces
 * a signature the gateway rejects, which is exactly the bug this pins down.
 */
const SANDBOX_KEY = 'sq7HjrUOBfKmC576ILgskD5srU870gJ7';
const ORDER = '1234ABCD5678';
const PARAMS =
  'eyJEU19NRVJDSEFOVF9NRVJDSEFOVENPREUiOiI5OTkwMDg4ODEiLCJEU19NRVJDSEFOVF9URVJNSU5BTCI6IjEiLCJE' +
  'U19NRVJDSEFOVF9PUkRFUiI6IjEyMzRBQkNENTY3OCIsIkRTX01FUkNIQU5UX0FNT1VOVCI6IjEwMCIsIkRTX01FUkNI' +
  'QU5UX0NVUlJFTkNZIjoiOTc4IiwiRFNfTUVSQ0hBTlRfVFJBTlNBQ1RJT05UWVBFIjoiMCJ9';
const EXPECTED_SIGNATURE = 'sJqKw/6QowKa3XjAoH7KhoTnhSFSl7JcU+TzSAia1kI=';

describe('signRedsysParameters', () => {
  it('matches the reference HMAC_SHA256_V1 signature', () => {
    expect(signRedsysParameters(PARAMS, ORDER, SANDBOX_KEY)).toBe(EXPECTED_SIGNATURE);
  });

  it('derives a different key per order', () => {
    const other = signRedsysParameters(PARAMS, '9999ZZZZ0000', SANDBOX_KEY);
    expect(other).not.toBe(EXPECTED_SIGNATURE);
  });

  it('changes when the parameters change', () => {
    const tampered = Buffer.from('{"DS_MERCHANT_AMOUNT":"999999"}').toString('base64');
    expect(signRedsysParameters(tampered, ORDER, SANDBOX_KEY)).not.toBe(EXPECTED_SIGNATURE);
  });

  it('rejects a key that does not decode to 16 or 24 bytes', () => {
    expect(() => signRedsysParameters(PARAMS, ORDER, 'dG9vc2hvcnQ=')).toThrow();
  });
});

describe('signaturesMatch', () => {
  it('accepts the URL-safe encoding Redsys uses in notifications', () => {
    const urlSafe = EXPECTED_SIGNATURE.replace(/\+/g, '-').replace(/\//g, '_');
    expect(signaturesMatch(EXPECTED_SIGNATURE, urlSafe)).toBe(true);
  });

  it('ignores base64 padding differences', () => {
    expect(signaturesMatch(EXPECTED_SIGNATURE, EXPECTED_SIGNATURE.replace(/=+$/, ''))).toBe(true);
  });

  it('rejects a signature that differs by one character', () => {
    const tampered = 'x' + EXPECTED_SIGNATURE.slice(1);
    expect(signaturesMatch(EXPECTED_SIGNATURE, tampered)).toBe(false);
  });

  it('rejects signatures of different lengths without throwing', () => {
    expect(signaturesMatch(EXPECTED_SIGNATURE, 'short')).toBe(false);
  });
});

/**
 * El pedido con el que se cobra.
 *
 * Estos tests existen porque el 4 de septiembre de 2026 se perdió un cobro
 * real: cada consulta de la pantalla pública regeneraba el pedido, y el aviso
 * de Redsys llegó con uno que el documento ya no guardaba.
 */
describe('resolveOrder', () => {
  it('reutiliza el pedido mientras nadie haya intentado pagar con él', () => {
    expect(resolveOrder({ order: '93247C7C67BC' })).toBe('93247C7C67BC');
  });

  it('emite uno nuevo si ya llegó un aviso para el anterior', () => {
    // Redsys rechaza un pedido ya procesado con SIS0051.
    const order = resolveOrder({ order: '93247C7C67BC', responseCode: '0190' });
    expect(order).not.toBe('93247C7C67BC');
    expect(order).toMatch(/^\d{4}[0-9A-F]{8}$/);
  });

  it('emite uno nuevo cuando el pago no tiene ninguno', () => {
    expect(resolveOrder(undefined)).toMatch(/^\d{4}[0-9A-F]{8}$/);
    expect(resolveOrder({})).toMatch(/^\d{4}[0-9A-F]{8}$/);
  });
});

describe('newOrder', () => {
  it('cumple el formato de la pasarela: 12 caracteres, los 4 primeros numéricos', () => {
    for (let i = 0; i < 50; i++) {
      const order = newOrder();
      expect(order).toHaveLength(12);
      expect(order).toMatch(/^\d{4}[0-9A-Z]{8}$/);
    }
  });

  it('no repite', () => {
    const orders = new Set(Array.from({ length: 200 }, () => newOrder()));
    expect(orders.size).toBe(200);
  });
});
