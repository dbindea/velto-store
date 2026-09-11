/**
 * Qué hay que hacer mañana, y si merece la pena mandar un correo.
 *
 * Pieza **pura y sin red ni Firestore**, separada del envío por lo mismo que el
 * resto: aquí viven las decisiones —qué entra, qué no, y cuándo callarse— y
 * probarlas no puede depender de que sea de noche ni de que haya reservas.
 *
 * ⚠️ **El aviso existe porque el panel solo avisa si alguien entra.** Ese es el
 * problema que resuelve esto y conviene no perderlo de vista: todo lo que aquí
 * se decida tiene que seguir teniendo sentido para alguien que **no** ha abierto
 * la aplicación.
 */

import type { AvisoSistema } from './system-alerts';

/** La zona en la que opera el negocio, igual que en las facturas. */
export const DIGEST_TIME_ZONE = process.env.VELTO_TIME_ZONE || 'Europe/Madrid';

/**
 * El desfase de una zona respecto a UTC, en minutos, **en un instante dado**.
 *
 * Hace falta el instante porque el desfase cambia: Madrid es `+01:00` en
 * invierno y `+02:00` en verano.
 */
function offsetMinutos(instante: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'longOffset'
  }).formatToParts(instante);
  const nombre = partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nombre);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** El año, mes y día que son en esa zona en ese instante. */
function civil(instante: Date, timeZone: string): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instante);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day') };
}

/**
 * El instante UTC en que empieza un día civil de esa zona.
 *
 * ⚠️ **Se calcula dos veces a propósito.** El desfase depende del instante, y el
 * instante es lo que estamos buscando: se parte de la medianoche en UTC, se mira
 * qué desfase había ahí y se corrige. En los dos domingos del año en que cambia
 * la hora, la primera respuesta cae al otro lado del cambio, así que se vuelve a
 * preguntar con el resultado. Sin esa segunda vuelta, el día empieza una hora
 * antes o después dos veces al año.
 */
function inicioDelDia(y: number, m: number, d: number, timeZone: string): Date {
  const utcMedianoche = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const primera = new Date(utcMedianoche - offsetMinutos(new Date(utcMedianoche), timeZone) * 60000);
  return new Date(utcMedianoche - offsetMinutos(primera, timeZone) * 60000);
}

export interface RangoDia {
  /** Inclusivo. */
  desde: Date;
  /** Exclusivo: es el inicio del día siguiente. */
  hasta: Date;
  /** `dd/MM/yyyy`, para el asunto y la cabecera del correo. */
  etiqueta: string;
}

/**
 * Mañana, en la zona del negocio.
 *
 * ⚠️ **No vale calcularlo en UTC.** Las Cloud Functions arrancan en UTC, y una
 * entrega a las 00:30 del día 11 en Madrid son las 22:30 del día 10 en UTC: con
 * un rango en UTC, esa entrega no saldría en el correo de nadie. Es la misma
 * trampa que ya hizo que los contratos salieran con dos horas menos.
 */
export function rangoManana(ahora: Date, timeZone = DIGEST_TIME_ZONE): RangoDia {
  const hoy = civil(ahora, timeZone);
  // +1 día sobre la fecha civil: `Date.UTC` normaliza el fin de mes y el año.
  const manana = new Date(Date.UTC(hoy.y, hoy.m - 1, hoy.d + 1));
  const y = manana.getUTCFullYear();
  const m = manana.getUTCMonth() + 1;
  const d = manana.getUTCDate();

  const desde = inicioDelDia(y, m, d, timeZone);
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1));
  const hasta = inicioDelDia(
    siguiente.getUTCFullYear(),
    siguiente.getUTCMonth() + 1,
    siguiente.getUTCDate(),
    timeZone
  );

  return {
    desde,
    hasta,
    etiqueta: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
  };
}

/** La hora `HH:mm` de un instante, en la zona del negocio. */
export function horaEn(instante: Date, timeZone = DIGEST_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(instante);
}

export interface MovimientoReserva {
  reservationId: string;
  hora: string;
  cliente: string;
  telefono?: string;
  vehiculo: string;
  /** Solo en las entregas: si el contrato no está firmado, qué le falta. */
  contratoSinFirmar?: boolean;
}

export interface VencimientoVehiculo {
  vehiculo: string;
  concepto: string;
  /** `dd/MM/yyyy`. */
  fecha: string;
  /** Negativo si ya venció. */
  diasRestantes: number;
}

export interface Resumen {
  fecha: string;
  entregas: MovimientoReserva[];
  devoluciones: MovimientoReserva[];
  vencimientos: VencimientoVehiculo[];
  /** Cuántas entregas van sin contrato firmado. Es lo que más urge. */
  sinFirmar: number;
  /**
   * Lo que no sale de ninguna reserva: el certificado que caduca y la remisión
   * a la AEAT atascada. Ver `system-alerts.ts`.
   */
  avisos: AvisoSistema[];
}

/**
 * ¿Hay algo que contar?
 *
 * ⚠️ **Un correo diario que casi siempre dice «nada» se acaba filtrando, y con
 * él se filtra el que sí importaba.** Por eso no se manda cuando no hay nada:
 * el silencio es la señal de que no hay nada, y no cuesta un correo. Es la misma
 * razón por la que un aviso no repite lo que ya se ve en la pantalla donde se
 * trabaja.
 *
 * ⚠️ **Un aviso de sistema SÍ obliga a mandarlo**, aunque no haya ni un coche
 * que entregar. El certificado que caduca y la remisión atascada tienen en común
 * que no se notan: no rompen nada visible hasta que ya es tarde. Si se callaran
 * los días tranquilos, el día que hicieran falta tampoco habría correo.
 */
export function mereceEnvio(r: Resumen): boolean {
  return (
    r.entregas.length > 0 ||
    r.devoluciones.length > 0 ||
    r.vencimientos.length > 0 ||
    r.avisos.length > 0
  );
}

/**
 * El asunto, que es lo único que se lee sin abrir.
 *
 * ⚠️ **Lo que urge va delante.** «3 entregas» y «3 entregas · 1 SIN FIRMAR» son
 * el mismo día y no la misma tarde: sin contrato firmado no se puede entregar el
 * coche, y enterarse por la mañana deja sin margen para llamar al cliente.
 */
export function asuntoDe(r: Resumen, marca: string): string {
  /**
   * ⚠️ El plural no es añadir una `s`: «devolución» hace «devoluciones» y pierde
   * la tilde. Concatenar el sufijo daba «2 devoluciónes» en el asunto, que es lo
   * único que se lee sin abrir el correo.
   */
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  const partes: string[] = [];
  /**
   * ⚠️ **Lo urgente del sistema va antes que nada**, incluso que un contrato sin
   * firmar. Un contrato sin firmar se resuelve esa mañana con una llamada; la
   * cadena de facturación parada o el certificado caducado no se resuelven con
   * una llamada, y cada día que pasa hay facturas emitidas que no se remiten.
   */
  if (r.avisos.some((a) => a.urgente)) partes.push('⚠️ REVISAR');
  if (r.sinFirmar) partes.push(`${r.sinFirmar} SIN FIRMAR`);
  if (r.entregas.length) partes.push(plural(r.entregas.length, 'entrega', 'entregas'));
  if (r.devoluciones.length) {
    partes.push(plural(r.devoluciones.length, 'devolución', 'devoluciones'));
  }
  const vencidos = r.vencimientos.filter((v) => v.diasRestantes < 0).length;
  if (vencidos) partes.push(plural(vencidos, 'vencido', 'vencidos'));
  else if (r.vencimientos.length) partes.push(`${r.vencimientos.length} por vencer`);

  /**
   * ⚠️ Un aviso que no es urgente y un día sin nada más dejaban el asunto
   * terminado en dos puntos: «Mañana 12/09/2026: ». El correo llegaba —hay algo
   * que contar— pero el asunto no decía qué, que es justo lo único que se lee
   * sin abrirlo.
   */
  if (!partes.length && r.avisos.length) {
    partes.push(plural(r.avisos.length, 'aviso', 'avisos'));
  }

  return `${marca} · Mañana ${r.fecha}: ${partes.join(' · ')}`;
}
