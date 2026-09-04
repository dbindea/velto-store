/**
 * Código Seguro de Verificación del contrato (N-9).
 *
 * ⚠️ **Lo que esto resuelve y lo que no.** Un código de verificación **no valida
 * una firma electrónica** — eso lo hace Adobe Reader o VALIDe abriendo el PDF.
 * Lo que resuelve es el **papel**: quien tiene una copia impresa no puede
 * comprobar nada, y con el código puede confirmar que ese contrato existe, que
 * está firmado y que el fichero que tiene es el mismo que emitimos. Ni los
 * textos del PDF ni los de la página pública deben prometer más que eso.
 *
 * El código es el secreto, igual que lo son el id de `/pay/…` y el de `/d/…`.
 */

import { randomBytes, createHash } from 'crypto';
import { publicBaseUrl } from '../public-url';

/**
 * Alfabeto sin `I`, `L`, `O`, `U` ni `0`/`1`.
 *
 * El código se dicta por teléfono y se teclea desde un papel: las parejas que
 * se confunden al leer no pueden estar dentro. Se quita también la `U` para no
 * formar palabras por accidente.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 12 caracteres sobre 30 símbolos ≈ 59 bits. Adivinarlo no es una vía. */
const CODE_LENGTH = 12;

/** Solo para leerlo; nunca se guarda así. */
const DISPLAY_PREFIX = 'VLT';

/**
 * Un código nuevo.
 *
 * Muestreo con rechazo en vez de `byte % 30`: 256 no es múltiplo de 30, así que
 * el resto favorecería a los seis primeros símbolos del alfabeto. Cuesta nada
 * hacerlo bien y es la clase de sesgo que nadie mira después.
 */
export function generateVerificationCode(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // 240
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/** `VLT-3F7K-9QD2-XR84` — como se imprime en el contrato. */
export function formatVerificationCode(code: string): string {
  const groups = (code.match(/.{1,4}/g) || []).join('-');
  return `${DISPLAY_PREFIX}-${groups}`;
}

/**
 * Devuelve el código canónico, o `null` si lo tecleado no puede serlo.
 *
 * Acepta las dos formas que un humano puede tener delante: la impresa
 * (`VLT-3F7K-9QD2-XR84`) y la de la URL (`3F7K9QD2XR84`), con guiones, espacios
 * o minúsculas. Lo que no acepta es cualquier otra cosa: sin este filtro la
 * function haría una consulta a Firestore por cada cadena que le tiren.
 */
export function normalizeVerificationCode(input: string): string | null {
  if (!input) return null;
  let code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length === CODE_LENGTH + DISPLAY_PREFIX.length && code.startsWith(DISPLAY_PREFIX)) {
    code = code.slice(DISPLAY_PREFIX.length);
  }
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return code;
}

/** La URL que va dentro del QR. Sin guiones: el QR sale más pequeño. */
export function verificationUrl(code: string): string {
  return `${publicBaseUrl()}/v/${code}`;
}

/** Lo mismo, sin esquema, para imprimirlo debajo del QR. */
export function verificationUrlLabel(): string {
  return `${publicBaseUrl().replace(/^https?:\/\//, '')}/v`;
}

/**
 * Huella del PDF, en hexadecimal.
 *
 * ⚠️ **Se calcula sobre los bytes que se guardan, ya sellados.** Calcularla
 * antes de firmar da un valor que no coincide con ningún fichero real: el
 * sellado cambia el documento, que es justo lo que hace. Si la huella de la
 * página no cuadra con la del fichero del cliente, la verificación no sirve
 * para nada — es peor que no tenerla, porque parece que sí.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/** La huella en grupos de ocho, que es como se compara a ojo sin perderse. */
export function formatFingerprint(hex: string): string {
  return (hex.match(/.{1,8}/g) || []).join(' ');
}
