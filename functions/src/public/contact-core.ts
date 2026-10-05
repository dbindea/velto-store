/**
 * El formulario de contacto de la web: qué se acepta y cómo se limpia.
 *
 * Pieza **pura y sin red**, separada del endpoint por la misma razón que
 * `booking-request-core.ts`: lo que hay que acertar aquí —qué motivo vale, qué
 * campos exige cada rama, qué se recorta— se prueba con datos y no levantando
 * un servidor.
 *
 * ⚠️ **Reutiliza lo del formulario de reserva, no lo copia.** El teléfono, el
 * nombre capitalizado y la referencia salen de `booking-request-core.ts`:
 * duplicarlos habría dado dos reglas para el mismo dato, y la primera vez que
 * divergieran nadie sabría cuál manda. Lo único propio de aquí es el motivo y
 * los campos de cada rama.
 */

import {
  capitalizeWords,
  generateReference,
  normalizePhone,
} from './booking-request-core';

/**
 * Por qué escribe.
 *
 * ⚠️ **Es el primer campo del formulario y el que decide todo lo demás**, así
 * que es lo único de verdad obligatorio además del contacto: sin él, el correo
 * que le llega a Dorel no dice si tiene delante a un cliente o a alguien que
 * quiere ceder un coche, que son dos conversaciones distintas.
 */
export const MOTIVOS = ['alquilar', 'poner-en-alquiler', 'otra'] as const;
export type Motivo = (typeof MOTIVOS)[number];

/** Cómo se lee cada motivo en el correo y en la ficha. */
export const MOTIVO_ROTULO: Record<Motivo, string> = {
  alquilar: 'Quiere alquilar un coche',
  'poner-en-alquiler': 'Quiere poner su coche en alquiler',
  otra: 'Otra consulta',
};

/**
 * Cuánto tiempo lo necesita.
 *
 * ⚠️ **Tramos y no una fecha**, a propósito. Quien escribe por el formulario
 * de contacto —y no por el buscador— muchas veces **todavía no tiene fechas**:
 * exigírselas es perderlo. Para quien las tiene está el buscador, que además
 * le da el precio.
 */
export const DURACIONES = ['1-3', '4-7', '8-15', 'mas-15', 'no-lo-se'] as const;
export type Duracion = (typeof DURACIONES)[number];

export const DURACION_ROTULO: Record<Duracion, string> = {
  '1-3': 'De 1 a 3 días',
  '4-7': 'De 4 a 7 días',
  '8-15': 'De 8 a 15 días',
  'mas-15': 'Más de 15 días',
  'no-lo-se': 'Todavía no lo sé',
};

/** Lo que el formulario manda. Nada de esto se cree sin mirarlo. */
export interface ContactInput {
  motivo?: unknown;
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  mensaje?: unknown;
  /* Rama «alquilar» */
  duracion?: unknown;
  queCoche?: unknown;
  domicilio?: unknown;
  lugar?: unknown;
  /* Rama «poner en alquiler» */
  coche?: unknown;
  anio?: unknown;
  poblacion?: unknown;
  parado?: unknown;
  /** El campo trampa: si viene relleno, lo ha rellenado un robot. */
  trap?: unknown;
}

export interface ContactFields {
  motivo: Motivo;
  name: string;
  phone: string;
  email: string;
  mensaje: string;
  duracion: Duracion | '';
  queCoche: string;
  domicilio: boolean;
  lugar: string;
  coche: string;
  anio: string;
  poblacion: string;
  parado: string;
}

/**
 * Topes de longitud.
 *
 * ⚠️ **No son cosmética: es un endpoint público que ESCRIBE.** Sin ellos
 * cualquiera deja un documento de un megabyte en Firestore por cada petición.
 * El mensaje admite más que la nota de una solicitud porque aquí es el campo
 * principal — es donde la persona cuenta lo suyo.
 */
export const MAX_NAME = 80;
export const MAX_EMAIL = 120;
export const MAX_MENSAJE = 1200;
export const MAX_CORTO = 120;

/** Colapsa espacios y recorta. */
function limpiar(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * El correo, si lo dan.
 *
 * ⚠️ **Es OPCIONAL y el teléfono no.** Dorel contesta por teléfono y por
 * WhatsApp, así que exigir un correo sería pedir un dato que no usa para
 * dejar fuera a quien no quiere darlo. Lo que se valida es que, si viene,
 * tenga forma de correo: guardar «no tengo» en un campo de correo es peor que
 * no tener el campo.
 *
 * ⚠️ **La comprobación es a propósito FLOJA.** Una expresión regular estricta
 * rechaza direcciones válidas raras —y las hay—, y aquí el coste de un falso
 * rechazo es perder un cliente mientras el de un correo mal escrito es que
 * Dorel llame por teléfono, que es lo que iba a hacer de todos modos.
 */
export function normalizeEmail(raw: unknown): string | null {
  const limpio = limpiar(raw, MAX_EMAIL).toLowerCase();
  if (!limpio) return '';
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(limpio) ? limpio : null;
}

export type ContactValidation =
  | { ok: true; fields: ContactFields }
  | { ok: false; error: string };

/**
 * ⚠️ **Lo obligatorio es lo MÍNIMO: motivo, nombre y teléfono.** Todo lo demás
 * ayuda y no bloquea. Un formulario de contacto que exige ocho campos es un
 * formulario que la gente abandona, y aquí el único objetivo es que Dorel pueda
 * devolver la llamada sabiendo de qué va.
 *
 * ⚠️ **Y los campos de una rama que no se eligió se DESCARTAN**, no se guardan
 * vacíos ni se guardan a medias. El navegador manda en el `FormData` todo lo
 * que haya en el formulario, incluidos los campos de las ramas escondidas: sin
 * este filtro, una consulta de «poner en alquiler» llegaría con una duración de
 * alquiler dentro y el correo diría dos cosas a la vez.
 */
export function validateContact(input: ContactInput): ContactValidation {
  const motivo = typeof input.motivo === 'string' ? input.motivo : '';
  if (!(MOTIVOS as readonly string[]).includes(motivo)) {
    return { ok: false, error: 'bad-motivo' };
  }

  const name = capitalizeWords(limpiar(input.name, MAX_NAME));
  if (name.length < 2) return { ok: false, error: 'bad-name' };

  const telefono = typeof input.phone === 'string' ? normalizePhone(input.phone) : null;
  if (!telefono) return { ok: false, error: 'bad-phone' };

  const email = normalizeEmail(input.email);
  if (email === null) return { ok: false, error: 'bad-email' };

  const esAlquilar = motivo === 'alquilar';
  const esPoner = motivo === 'poner-en-alquiler';

  const duracionCruda = typeof input.duracion === 'string' ? input.duracion : '';
  const duracion =
    esAlquilar && (DURACIONES as readonly string[]).includes(duracionCruda)
      ? (duracionCruda as Duracion)
      : '';

  return {
    ok: true,
    fields: {
      motivo: motivo as Motivo,
      name,
      phone: telefono,
      email,
      mensaje: limpiar(input.mensaje, MAX_MENSAJE),
      duracion,
      queCoche: esAlquilar ? limpiar(input.queCoche, MAX_CORTO) : '',
      // El `<select>` manda la cadena; lo que decide es que valga «si».
      domicilio: esAlquilar && input.domicilio === 'si',
      lugar: esAlquilar ? limpiar(input.lugar, MAX_CORTO) : '',
      coche: esPoner ? limpiar(input.coche, MAX_CORTO) : '',
      anio: esPoner ? limpiar(input.anio, 8) : '',
      poblacion: esPoner ? capitalizeWords(limpiar(input.poblacion, MAX_CORTO)) : '',
      parado: esPoner ? limpiar(input.parado, MAX_CORTO) : '',
    },
  };
}

/**
 * ⚠️ **Al robot se le contesta que SÍ.** Devolviendo un error aprende a no
 * rellenar el campo escondido y la trampa deja de servir para siempre. La
 * referencia que se lleva no existe en ninguna parte.
 *
 * Y con `create: if false` en las reglas de Firestore, esta trampa es la única
 * defensa contra el relleno automático de este endpoint.
 */
export function looksAutomated(input: ContactInput): boolean {
  return typeof input.trap === 'string' && input.trap.trim().length > 0;
}

/** La referencia de una consulta: `C-` para distinguirla de la `P-` de reserva. */
export function generateContactReference(): string {
  return generateReference('C');
}

/**
 * Cuánto se guarda un mensaje del formulario de contacto.
 *
 * Decisión de Dorel del 30 de septiembre de 2026: «el borrado de los mensajes
 * es a las 24 h con posibilidad de ampliar; ya me quedo con el email si hace
 * falta más tiempo».
 *
 * ⚠️ **Este número está PUBLICADO en `/privacidad`**, y eso lo cambia todo: un
 * plazo escrito en una política de privacidad es una afirmación que cualquiera
 * puede contrastar contra lo que de verdad haya en Firestore. Si la política
 * dice 24 horas y ahí hay mensajes de hace tres días, la propia política es la
 * prueba del incumplimiento. Si se toca este valor, se toca esa página el mismo
 * día.
 *
 * ⚠️ **Y vive AQUÍ y no en `sendDailyDigest.ts`, que es quien barre.** Lo usan
 * los dos —el endpoint público al crear y el barrido al borrar—, y este módulo
 * es puro: importarlo desde el resumen diario no arrastra nada. Al revés sí:
 * `api.ts` tirando de `sendDailyDigest` metería el resumen entero en la cadena
 * de arranque del API público, que es justo lo que `arranque.spec.ts` impide.
 */
export const CONSULTA_HORAS_POR_DEFECTO = 24;
