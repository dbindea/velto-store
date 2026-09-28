/**
 * La solicitud de la web: lo que se valida y cómo se llama.
 *
 * Pieza **pura y sin red**, separada del endpoint por la misma razón que
 * `receipt-core.ts` y `qr.ts`: lo que hay que acertar aquí —qué teléfono vale,
 * qué nombre vale, cuándo caduca el precio— se prueba con datos, no
 * levantando un servidor.
 */

import { randomBytes } from 'crypto';

/**
 * Alfabeto sin `I`, `L`, `O`, `U` ni `0`/`1`.
 *
 * ⚠️ **La referencia se dicta por teléfono**, que es para lo que existe: el
 * operador llama y dice «tu solicitud P-4K7M9X». Las parejas que se confunden
 * al leer no pueden estar dentro. Es el mismo alfabeto que el código de
 * verificación del contrato, y por el mismo motivo — **duplicado a propósito**,
 * porque aquel vive en `contracts/` y esto es de la web pública.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Seis símbolos sobre treinta: 729 millones. Las colisiones no son un tema. */
const REFERENCE_LENGTH = 6;

const REFERENCE_PREFIX = 'P';

/**
 * Una referencia nueva.
 *
 * Muestreo con rechazo, no `byte % 30`: 256 no es múltiplo de 30 y el resto
 * favorecería a los seis primeros símbolos. Cuesta nada hacerlo bien.
 */
export function generateReference(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // 240
  let out = '';
  while (out.length < REFERENCE_LENGTH) {
    for (const byte of randomBytes(REFERENCE_LENGTH)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === REFERENCE_LENGTH) break;
    }
  }
  return `${REFERENCE_PREFIX}-${out}`;
}

/** Lo que el formulario manda. Nada de esto se cree sin mirarlo. */
export interface BookingRequestInput {
  vehicleId?: unknown;
  from?: unknown;
  to?: unknown;
  name?: unknown;
  phone?: unknown;
  note?: unknown;
  /** El campo trampa: si viene relleno, lo ha rellenado un robot. */
  trap?: unknown;
}

export interface BookingRequestFields {
  vehicleId: string;
  name: string;
  phone: string;
  note: string;
}

/**
 * Topes de longitud.
 *
 * ⚠️ **No son cosmética: es un endpoint público que ESCRIBE.** Sin ellos,
 * cualquiera deja un documento de un megabyte en Firestore por cada petición.
 */
export const MAX_NAME = 80;
export const MAX_PHONE = 24;
export const MAX_NOTE = 400;

/**
 * El teléfono, normalizado a lo que `wa.me` necesita: solo dígitos, con prefijo
 * de país y sin el `+`.
 *
 * ⚠️ **Es obligatorio, y esa es la decisión de Dorel**: sin teléfono no hay
 * forma de devolver la llamada ni de seguir por WhatsApp con la referencia
 * delante, que es todo el motivo de la función.
 *
 * ⚠️ **Sin prefijo se asume España.** Un «612 345 678» tecleado por un vecino
 * de Arganda es el caso normal y no puede rechazarse; lo que no vale es
 * inventarse el prefijo cuando el usuario sí puso uno.
 */
export function normalizePhone(raw: string): string | null {
  const limpio = raw.replace(/[\s.\-()]/g, '');
  if (!/^\+?\d{6,20}$/.test(limpio)) return null;

  if (limpio.startsWith('+')) return limpio.slice(1);
  // Nueve dígitos y empieza por 6, 7, 8 o 9: un número español sin prefijo.
  if (/^[6789]\d{8}$/.test(limpio)) return `34${limpio}`;
  return limpio;
}

/**
 * El teléfono como se lee, no como se guarda: lo inverso de `normalizePhone()`,
 * y por eso vive a su lado.
 *
 * ⚠️ **Guardado va sin espacios a propósito** —es lo que `wa.me` y `tel:`
 * necesitan—, y así son doce dígitos seguidos: nadie los lee de un vistazo y
 * quien los copie a mano se equivoca.
 *
 * ⚠️ **Solo se agrupa lo español.** Cada país agrupa a su manera, y un número
 * extranjero partido con la regla de aquí se lee como si estuviera mal. Lo que
 * no se sabe, se deja entero.
 *
 * ⚠️ **Copia FIEL de `src/app/shared/utils/booking-request.util.ts`**, igual
 * que `capitalizeWords`. Si cambia allí, cambia aquí.
 */
export function formatPhone(phone: string): string {
  if (/^34[6789]\d{8}$/.test(phone)) {
    const n = phone.slice(2);
    return `+34 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return `+${phone}`;
}

/** Colapsa espacios y recorta. Lo que el operador va a leer en una tarjeta. */
function limpiarTexto(raw: string, max: number): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Los límites de palabra, las excepciones y la regla del español.
 *
 * ⚠️ **Copia FIEL de `src/app/shared/utils/text-case.util.ts`**, igual que la
 * aritmética del IVA está copiada en `contracts/pdf.ts`: la app y las functions
 * compilan con tsconfigs separados y no pueden compartir módulo. Si cambia
 * allí, cambia aquí — y **fiel** a propósito: una versión «más simple» es
 * exactamente cómo dos comportamientos divergen sin que nadie se entere.
 */
const WORD_BOUNDARY = /([\s\-–—/'’.]+)/;

/** Una palabra con mayúscula Y minúscula dentro: `dCi`, `O'Brien`. Se respeta. */
function isDeliberatelyMixedCase(word: string): boolean {
  return /\p{Lu}/u.test(word.slice(1)) && /\p{Ll}/u.test(word);
}

/** «Arganda **del** Rey», que es la regla del español. `el` se queda fuera. */
const LOWERCASE_WITHIN_NAME = new Set([
  'de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'a', 'al'
]);

/**
 * Un nombre, escrito como se imprime.
 *
 * ⚠️ **Esto NO es cosmética de formulario, y aquí menos que en ningún sitio.**
 * Un visitante teclea «marius ionescu» o «MARIUS IONESCU» desde el móvil, y ese
 * nombre acaba en el saludo del WhatsApp, en la ficha del panel y —al
 * convertir— en un cliente y en el contrato que firma. CLAUDE.md avisa de que
 * el fallo que se repite es justo este: **el campo que nace fuera del
 * formulario** y se queda sin la regla. Este nace en una web pública, que es lo
 * más fuera que hay.
 */
export function capitalizeWords(value: string): string {
  if (!value) return value;
  let primeraPalabraVista = false;
  return value
    .split(WORD_BOUNDARY)
    .map((part) => {
      if (WORD_BOUNDARY.test(part) || !part) return part;

      const esPrimera = !primeraPalabraVista;
      primeraPalabraVista = true;

      if (isDeliberatelyMixedCase(part)) return part;
      if (!esPrimera && LOWERCASE_WITHIN_NAME.has(part.toLowerCase())) {
        return part.toLowerCase();
      }

      // Desde la primera letra CON CAJA, no desde el carácter 0: «2ºA» no puede
      // salir «2ºa». Y `\p{L}` no vale — el ordinal «º» es letra sin caja.
      const primera = part.search(/[\p{Lu}\p{Ll}]/u);
      if (primera < 0) return part;
      return (
        part.slice(0, primera) +
        part.charAt(primera).toUpperCase() +
        part.slice(primera + 1).toLowerCase()
      );
    })
    .join('');
}

export type ValidationError =
  | 'missing-vehicle'
  | 'missing-name'
  | 'missing-phone'
  | 'bad-phone'
  | 'note-too-long';

/**
 * Valida y normaliza lo que llegó.
 *
 * ⚠️ **Lo que NO valida: el precio.** No viaja en la petición a propósito. Si
 * el navegador mandara la cifra, cualquiera pediría un coche por un euro — es
 * la misma regla que el recibo («el importe se lee del pago») y que la creación
 * de reservas, que recalcula en vez de fiarse de lo que enseñó la pantalla.
 */
export function validateBookingRequest(
  input: BookingRequestInput
): { ok: true; fields: BookingRequestFields } | { ok: false; error: ValidationError } {
  const vehicleId = typeof input.vehicleId === 'string' ? input.vehicleId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(vehicleId)) return { ok: false, error: 'missing-vehicle' };

  const name = capitalizeWords(
    limpiarTexto(typeof input.name === 'string' ? input.name : '', MAX_NAME)
  );
  if (name.length < 2) return { ok: false, error: 'missing-name' };

  const phoneRaw = typeof input.phone === 'string' ? input.phone.trim() : '';
  if (!phoneRaw) return { ok: false, error: 'missing-phone' };
  if (phoneRaw.length > MAX_PHONE) return { ok: false, error: 'bad-phone' };
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { ok: false, error: 'bad-phone' };

  const noteRaw = typeof input.note === 'string' ? input.note : '';
  if (noteRaw.length > MAX_NOTE * 2) return { ok: false, error: 'note-too-long' };
  const note = limpiarTexto(noteRaw, MAX_NOTE);

  return { ok: true, fields: { vehicleId, name, phone, note } };
}

/**
 * ¿Lo ha rellenado un robot?
 *
 * El campo trampa está escondido por CSS y ninguna persona lo ve. Un robot que
 * rellena todo lo que encuentra sí. **Y la respuesta es un 200 con una
 * referencia falsa**: contestando un error, el robot aprende a no rellenarlo.
 */
export function looksAutomated(input: BookingRequestInput): boolean {
  return typeof input.trap === 'string' && input.trap.trim().length > 0;
}

/**
 * Hasta cuándo se mantiene el precio.
 *
 * ⚠️ **Se congela en la solicitud, no se lee de Ajustes al mirarla.** Cambiar
 * el plazo en Ajustes no puede mover la caducidad de las que ya existen: es la
 * misma regla que congela el IVA en `pricingSnapshot`, y sin ella un cliente al
 * que se le prometieron 24 horas se encontraría con otra cosa.
 */
export function priceGuaranteedUntil(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}
