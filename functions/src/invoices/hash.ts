/**
 * La huella encadenada de VeriFactu.
 *
 * ⚠️ **Esto se calcula desde la PRIMERA factura, aunque no se envíe nada a la
 * AEAT hasta 2027.** El encadenamiento es obligatorio en las **dos** modalidades
 * del RD 1007/2023, no solo en la que transmite; y si la cadena arrancase en
 * enero de 2027, arrancaría sobre un histórico que nadie puede acreditar.
 *
 * Cada registro incorpora la huella del anterior, de modo que alterar uno rompe
 * todos los siguientes. Es lo que convierte una lista de facturas en una
 * cadena.
 *
 * Especificación: «Veri-Factu — Especificaciones de la huella o hash de los
 * registros de facturación y de evento» (AEAT, área de Desarrolladores).
 * https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf
 *
 * ⚠️ **Antes de la fase 3, contrastar contra la última versión de ese PDF.** El
 * orden de los campos, el formato de las fechas y el de los importes son
 * exactos: un espacio de más y la huella deja de coincidir con la que calcule
 * la AEAT, y entonces no vale de nada haberla guardado.
 */

import { createHash } from 'crypto';

/**
 * Tipo de factura según la AEAT. Solo los que este negocio emite.
 *
 * `F1` es la factura completa —la única de la fase 1—. Las `R*` son
 * rectificativas y llegan en la fase 2, cada una según el motivo del art. 80
 * LIVA que la justifique.
 */
export type TipoFacturaAeat = 'F1' | 'F2' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export interface RegistroAltaHashInput {
  /** NIF del emisor, sin espacios. */
  idEmisorFactura: string;
  /** Serie y número juntos, tal como se imprime: `2026/0001`. */
  numSerieFactura: string;
  /** Fecha de expedición. */
  fechaExpedicion: Date;
  tipoFactura: TipoFacturaAeat;
  /** Suma de cuotas de IVA. */
  cuotaTotal: number;
  /** Base + cuotas. */
  importeTotal: number;
  /** Huella del registro inmediatamente anterior. Cadena vacía en el primero. */
  huellaAnterior: string;
  /** Momento en que se genera el registro. */
  fechaHoraGenRegistro: Date;
  /** Huso con el que se sella la marca de tiempo. */
  timeZone?: string;
}

/** La zona en la que opera el negocio, igual que en los contratos. */
export const INVOICE_TIME_ZONE = process.env.VELTO_TIME_ZONE || 'Europe/Madrid';

/**
 * `dd-mm-aaaa`, que es el formato que pide la especificación para
 * `FechaExpedicionFactura`.
 *
 * Se compone en la zona del negocio y no en la del runtime: las Cloud Functions
 * arrancan en UTC, y una factura expedida a las 00:30 del día 9 en Madrid es
 * todavía día 8 en UTC. Ya pasó con los contratos, que salían dos horas antes.
 */
export function formatFechaExpedicion(date: Date, timeZone = INVOICE_TIME_ZONE): string {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')}`;
}

/**
 * ISO 8601 **con huso**, que es lo que pide `FechaHoraHusoGenRegistro`:
 * `2026-09-08T19:20:30+02:00`.
 *
 * `toISOString()` no sirve: da siempre UTC con `Z` y perdería el huso en el que
 * realmente se emitió la factura.
 */
export function formatFechaHoraHuso(date: Date, timeZone = INVOICE_TIME_ZONE): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset'
  });
  const partes = fmt.formatToParts(date);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '';

  // `longOffset` da «GMT+02:00» y la norma quiere «+02:00». En UTC devuelve
  // «GMT+00:00», que se queda en «+00:00»: es ISO 8601 válido y equivalente a
  // «Z», así que no hay ningún caso que traducir a mano.
  const offset = get('timeZoneName').replace('GMT', '').trim();

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

/**
 * Importes con punto decimal y **dos decimales exactos**.
 *
 * `String(199.65)` daría «199.65», pero `String(199.6)` daría «199.6» y la
 * huella dejaría de coincidir. El formato no se negocia.
 */
export function formatImporte(value: number): string {
  return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
}

/**
 * La cadena exacta sobre la que se calcula la huella de un registro de alta.
 *
 * ⚠️ **El orden es el de la especificación y no se toca.** Es el mismo en que
 * los campos aparecen en el diseño de registro del anexo de la orden, y
 * reordenarlos produce una huella distinta que parece igual de válida.
 */
export function buildRegistroAltaString(input: RegistroAltaHashInput): string {
  const tz = input.timeZone || INVOICE_TIME_ZONE;
  return [
    `IDEmisorFactura=${input.idEmisorFactura.trim()}`,
    `NumSerieFactura=${input.numSerieFactura.trim()}`,
    `FechaExpedicionFactura=${formatFechaExpedicion(input.fechaExpedicion, tz)}`,
    `TipoFactura=${input.tipoFactura}`,
    `CuotaTotal=${formatImporte(input.cuotaTotal)}`,
    `ImporteTotal=${formatImporte(input.importeTotal)}`,
    `Huella=${input.huellaAnterior || ''}`,
    `FechaHoraHusoGenRegistro=${formatFechaHoraHuso(input.fechaHoraGenRegistro, tz)}`
  ].join('&');
}

/**
 * SHA-256 en hexadecimal **mayúsculas**, 64 caracteres.
 *
 * Las mayúsculas no son estilo: la especificación las fija, y una huella en
 * minúsculas no coincide con la que calcula la AEAT sobre los mismos datos.
 */
export function computeRegistroAltaHash(input: RegistroAltaHashInput): string {
  return createHash('sha256')
    .update(buildRegistroAltaString(input), 'utf8')
    .digest('hex')
    .toUpperCase();
}
