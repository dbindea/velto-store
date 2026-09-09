/**
 * Qué se envía, en qué orden, y qué se hace con lo que conteste la AEAT.
 *
 * Pieza **pura y sin red ni Firestore**, separada del envío por lo mismo que el
 * parseo de la respuesta: aquí viven las decisiones que no se pueden provocar a
 * voluntad contra el servicio real —un lote a medio contestar, un rechazo en
 * mitad de la cadena— y que si no se prueban aquí se prueban en producción con
 * facturas reales detrás.
 *
 * ⚠️ **El estado del envío NO vive en la factura.** Una factura emitida es
 * inmutable: `firestore.rules` deniega el `update` a todo el mundo, y lo poco
 * que el backend le escribe encima —`pdfUrl`, `status: 'rectified'`— es
 * justamente lo que no es contenido fiscal. El envío, en cambio, cambia muchas
 * veces: pendiente, intentado, rechazado, reintentado, aceptado. Meterlo dentro
 * del documento fiscal sería estar reescribiendo una factura cada vez que la
 * Agencia contesta. Por eso hay una colección aparte, `verifactuSubmissions`,
 * con un documento por factura y el mismo id.
 */

import type { RespuestaEnvio, RespuestaLinea } from './verifactu-respuesta';
import { desenlaceDe } from './verifactu-respuesta';
import type { CabeceraEnvio } from './verifactu-xml';
import { formatFechaExpedicion } from './hash';

export type EstadoRemision =
  /** Emitida y todavía no aceptada por la AEAT. */
  | 'pendiente'
  /** La AEAT la tiene. Es el único estado final bueno. */
  | 'aceptado'
  /** Rechazada por un motivo que no se arregla reenviando lo mismo. */
  | 'rechazado'
  /** Falló el transporte o la AEAT tuvo un problema técnico: se reintenta. */
  | 'error';

export interface Remision {
  invoiceId: string;
  fullNumber: string;
  /**
   * La posición en la cadena de huellas.
   *
   * ⚠️ **No se ordena por fecha de emisión.** La cadena la construye una
   * transacción, y dos facturas emitidas en el mismo segundo pueden llevar una
   * fecha que no respete el orden en que realmente se encadenaron. Enviarlas al
   * revés hace que la segunda referencie una huella que la AEAT todavía no
   * tiene, y se rechaza con un error de encadenamiento que parece un fallo del
   * cálculo. Este índice lo escribe la misma transacción que la huella, así que
   * no pueden discrepar.
   */
  chainIndex: number;
  estado: EstadoRemision;
  intentos: number;
}

/** Cuántos registros van en un envío. El esquema admite hasta 1000. */
export const REGISTROS_POR_ENVIO = 100;

/**
 * Lo que toca enviar ahora, **en orden de cadena**.
 *
 * ⚠️ **Se corta en el primer registro que no está pendiente de envío.** Si el
 * anterior fue rechazado, todo lo que venga detrás encadena con su huella y la
 * AEAT lo rechazará igual: seguir adelante convierte un problema en un montón
 * de problemas idénticos y gasta el límite de envíos. Un rechazo definitivo es
 * un incidente que mira una persona, no algo que se salte solo.
 */
export function siguientesAEnviar(remisiones: Remision[], max = REGISTROS_POR_ENVIO): Remision[] {
  const ordenadas = [...remisiones].sort((a, b) => a.chainIndex - b.chainIndex);
  const lote: Remision[] = [];
  for (const r of ordenadas) {
    if (r.estado === 'aceptado') continue;
    // Rechazado: la cadena se para aquí hasta que alguien lo resuelva.
    if (r.estado === 'rechazado') break;
    lote.push(r);
    if (lote.length >= max) break;
  }
  return lote;
}

/**
 * ¿Hay algo atascado que necesite a una persona?
 *
 * Un rechazo no se puede arreglar reenviando: la factura es inmutable y el
 * registro va sellado con su huella. Bloquea la cadena, así que **tiene que
 * verse**, no quedarse en un log.
 */
export function remisionBloqueada(remisiones: Remision[]): Remision | undefined {
  return [...remisiones]
    .sort((a, b) => a.chainIndex - b.chainIndex)
    .find((r) => r.estado === 'rechazado');
}

export interface ResultadoLinea {
  invoiceId: string;
  fullNumber: string;
  estado: EstadoRemision;
  csv?: string;
  codigoError?: number;
  descripcionError?: string;
}

/**
 * Qué le pasó a cada registro del lote.
 *
 * ⚠️ **Un registro del que la AEAT no dice nada se queda pendiente.** Es el caso
 * que hay que acertar: se mandan cinco, contesta por cuatro, y dar por buena la
 * quinta porque «el envío fue correcto» deja una factura sin remitir y al
 * sistema convencido de lo contrario. Se cruzan por número de factura, no por
 * posición: nada garantiza que la respuesta venga en el mismo orden.
 *
 * ⚠️ **Y un duplicado cuenta como aceptado.** Significa que ese registro ya está
 * en la Agencia —normalmente porque un envío anterior llegó y se perdió la
 * respuesta—, así que reintentarlo en bucle es perseguir algo que ya ocurrió.
 */
export function resultadosDelLote(
  lote: Remision[],
  respuesta: RespuestaEnvio
): ResultadoLinea[] {
  const porNumero = new Map<string, RespuestaLinea>();
  for (const l of respuesta.lineas) {
    if (l.numSerieFactura) porNumero.set(l.numSerieFactura.trim(), l);
  }

  return lote.map((r) => {
    const linea = porNumero.get(r.fullNumber.trim());
    if (!linea) {
      // Sin respuesta no sabemos nada: sigue pendiente, y se reintenta.
      return { invoiceId: r.invoiceId, fullNumber: r.fullNumber, estado: 'pendiente' as const };
    }
    const desenlace = desenlaceDe(linea);
    const estado: EstadoRemision =
      desenlace === 'aceptado' || desenlace === 'duplicado'
        ? 'aceptado'
        : desenlace === 'reintentable'
          ? 'error'
          : 'rechazado';
    return {
      invoiceId: r.invoiceId,
      fullNumber: r.fullNumber,
      estado,
      csv: estado === 'aceptado' ? respuesta.csv : undefined,
      codigoError: linea.codigoError,
      descripcionError: linea.descripcionError
    };
  });
}

/**
 * La cabecera del envío, con la remisión voluntaria si toca.
 *
 * ⚠️ **`RemisionVoluntaria` solo mientras NO se esté obligado.** VELTO lo está a
 * partir del 1 de enero de 2027; remitir antes es una adhesión voluntaria y hay
 * que declararla, con la fecha hasta la que se asume el compromiso. Después de
 * esa fecha el bloque sobra: mandarlo cuando ya es obligatorio no describe nada.
 *
 * ⚠️ **`FechaFinVeriFactu` tiene que ser el 31 de diciembre del año en curso o
 * del anterior** (error `4120`). Por eso se calcula del año de la fecha y no se
 * escribe a mano: un literal se queda viejo el 1 de enero, y el rechazo llega
 * cuando ya hay una factura emitida detrás.
 *
 * ⚠️ **Y el año es el de Madrid, no el del reloj del servidor.** Las Cloud
 * Functions arrancan en UTC: a las 00:30 del 1 de enero en España todavía es 31
 * de diciembre en UTC, y la cabecera declararía el año anterior al de la factura
 * que va dentro. Se saca de `formatFechaExpedicion()`, la misma función que
 * estampa la fecha en el registro, para que no puedan discrepar.
 */
export const VERIFACTU_OBLIGATORIO_DESDE_ANIO = 2027;

/** El año natural en la zona del negocio: `09-09-2026` → `2026`. */
function anioDe(fecha: Date): number {
  return Number(formatFechaExpedicion(fecha).slice(-4));
}

export function cabeceraPara(
  obligadoNombreRazon: string,
  obligadoNif: string,
  ahora: Date
): CabeceraEnvio {
  const anio = anioDe(ahora);
  if (anio >= VERIFACTU_OBLIGATORIO_DESDE_ANIO) {
    return { obligadoNombreRazon, obligadoNif };
  }
  return {
    obligadoNombreRazon,
    obligadoNif,
    remisionVoluntaria: { fechaFinVerifactu: `31-12-${anio}` }
  };
}

/**
 * Cuánto esperar antes del siguiente envío.
 *
 * ⚠️ **Lo dice la AEAT en cada respuesta y hay que hacerle caso.** Enviar antes
 * de tiempo se rechaza (`4102`), y el rechazo tumba el envío entero — así que
 * ignorarlo no adelanta nada, retrasa. Si no viene, un minuto, que es el valor
 * habitual del servicio.
 */
export const ESPERA_POR_DEFECTO_S = 60;

export function esperaHasta(respuesta: RespuestaEnvio, ahora: Date): Date {
  const s = respuesta.tiempoEsperaEnvio ?? ESPERA_POR_DEFECTO_S;
  return new Date(ahora.getTime() + s * 1000);
}
