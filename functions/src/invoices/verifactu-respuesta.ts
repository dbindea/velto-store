/**
 * La respuesta de la AEAT a un envío, y qué hacer con ella.
 *
 * Pieza **pura y sin red**, separada del cliente a propósito: los caminos que
 * hay que acertar aquí —el rechazo, el duplicado, el envío parcialmente
 * correcto— son justo los que no se pueden provocar a voluntad contra el
 * servicio real, así que tienen que poder probarse con una respuesta guardada.
 *
 * ⚠️ **Que el envío «funcione» no significa que las facturas hayan entrado.**
 * `EstadoEnvio` puede ser `ParcialmenteCorrecto`: la estructura y la cabecera
 * estaban bien y aun así hay registros rechazados. Quien llame tiene que mirar
 * **línea por línea**, y por eso esta función no devuelve un booleano.
 */

import { XMLParser } from 'fast-xml-parser';

export type EstadoEnvio = 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto';
export type EstadoRegistro = 'Correcto' | 'AceptadoConErrores' | 'Incorrecto';

export interface RespuestaLinea {
  numSerieFactura: string;
  fechaExpedicionFactura?: string;
  estadoRegistro: EstadoRegistro;
  codigoError?: number;
  descripcionError?: string;
  /**
   * Solo cuando se rechaza por duplicado: lo que la AEAT ya tenía registrado.
   *
   * ⚠️ **Un duplicado no es un fallo que haya que arreglar**: significa que ese
   * registro ya está en la Agencia. Tratarlo como error llevaría a reintentar
   * en bucle algo que ya se aceptó.
   */
  duplicado?: {
    idPeticion?: string;
    estadoRegistroDuplicado?: string;
    codigoError?: number;
    descripcionError?: string;
  };
}

export interface RespuestaEnvio {
  /** Lo genera la AEAT y solo si el envío no se rechaza entero. */
  csv?: string;
  estadoEnvio: EstadoEnvio;
  /** Segundos que hay que esperar antes del siguiente envío. */
  tiempoEsperaEnvio?: number;
  lineas: RespuestaLinea[];
}

/** Un `soap:Fault`: la petición ni siquiera llegó a procesarse. */
export class SoapFaultError extends Error {
  constructor(
    readonly faultCode: string,
    readonly faultString: string
  ) {
    super(`SOAP Fault ${faultCode}: ${faultString}`);
    this.name = 'SoapFaultError';
  }
}

/**
 * Códigos de **error técnico** de la AEAT.
 *
 * ⚠️ **Son los únicos que tiene sentido reintentar.** Un error de validación
 * —un NIF mal, una fecha imposible— dará exactamente el mismo resultado por
 * mucho que se reenvíe el mismo XML: reintentarlo es gastar cuota y esconder el
 * problema. Estos doce, en cambio, dicen que algo falló **del lado de allí**.
 *
 * Salen de `docs/aeat/errores.properties.txt`, filtrando los que la propia AEAT
 * describe como «error técnico».
 */
export const ERRORES_TECNICOS = new Set([
  1129, 1241, 1243, 1256, 1288, 3500, 3501, 4108, 4110, 4111, 4118, 4128
]);

/** `3000` — registro de facturación duplicado. */
export const ERROR_DUPLICADO = 3000;

export type Desenlace = 'aceptado' | 'duplicado' | 'reintentable' | 'rechazado';

/**
 * Qué hacer con una línea de la respuesta.
 *
 * ⚠️ **`AceptadoConErrores` cuenta como aceptado.** El registro ha entrado y
 * reenviarlo daría un duplicado; los errores que trae son avisos que hay que
 * mirar, no un motivo para repetir el envío.
 */
export function desenlaceDe(linea: RespuestaLinea): Desenlace {
  if (linea.estadoRegistro === 'Correcto' || linea.estadoRegistro === 'AceptadoConErrores') {
    return 'aceptado';
  }
  if (linea.codigoError === ERROR_DUPLICADO || linea.duplicado) return 'duplicado';
  if (linea.codigoError !== undefined && ERRORES_TECNICOS.has(linea.codigoError)) {
    return 'reintentable';
  }
  return 'rechazado';
}

/**
 * ¿Se puede reintentar el envío entero?
 *
 * Un rechazo de cabecera —NIF no identificado, certificado no válido— tumba el
 * envío completo sin llegar a los registros. Solo se reintenta si la causa es
 * técnica; si es de datos, reintentar no arregla nada.
 */
export function envioReintentable(respuesta: RespuestaEnvio): boolean {
  if (respuesta.estadoEnvio !== 'Incorrecto') return false;
  if (!respuesta.lineas.length) return false;
  return respuesta.lineas.every((l) => desenlaceDe(l) === 'reintentable');
}

/** Quita el prefijo de espacio de nombres: `sfR:CSV` → `CSV`. */
function sinPrefijo(nombre: string): string {
  const i = nombre.indexOf(':');
  return i >= 0 ? nombre.slice(i + 1) : nombre;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  // Los prefijos varían según quién genere el XML; el nombre local no.
  transformTagName: sinPrefijo,
  // ⚠️ Sin esto, un `NumSerieFactura` como «2026/0001» se quedaría en texto pero
  // uno como «12345» se convertiría en número, y el mismo campo tendría dos
  // tipos según la factura.
  parseTagValue: false
});

function comoArray<T>(valor: T | T[] | undefined): T[] {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function comoNumero(valor: unknown): number | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const n = Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parsea la respuesta SOAP.
 *
 * Lanza `SoapFaultError` si la AEAT devolvió un fault, y `Error` si el cuerpo no
 * es una respuesta reconocible — que es distinto de una respuesta que dice
 * «incorrecto»: lo primero significa que **no sabemos** qué ha pasado con las
 * facturas, y eso nunca puede confundirse con un rechazo.
 */
export function parseRespuesta(xml: string): RespuestaEnvio {
  const raiz = parser.parse(xml) as Record<string, any>;
  const envelope = raiz['Envelope'] ?? raiz;
  const body = envelope?.['Body'] ?? envelope;

  const fault = body?.['Fault'];
  if (fault) {
    throw new SoapFaultError(
      String(fault['faultcode'] ?? fault['Code'] ?? 'desconocido'),
      String(fault['faultstring'] ?? fault['Reason'] ?? '')
    );
  }

  const respuesta = body?.['RespuestaRegFactuSistemaFacturacion'];
  if (!respuesta) {
    throw new Error('verifactu: la respuesta no contiene RespuestaRegFactuSistemaFacturacion');
  }

  const estadoEnvio = respuesta['EstadoEnvio'] as EstadoEnvio;
  if (!estadoEnvio) {
    throw new Error('verifactu: la respuesta no trae EstadoEnvio');
  }

  const lineas: RespuestaLinea[] = comoArray(respuesta['RespuestaLinea']).map((l: any) => {
    const dup = l['RegistroDuplicado'];
    return {
      numSerieFactura: String(l['IDFactura']?.['NumSerieFactura'] ?? ''),
      fechaExpedicionFactura: l['IDFactura']?.['FechaExpedicionFactura']
        ? String(l['IDFactura']['FechaExpedicionFactura'])
        : undefined,
      estadoRegistro: l['EstadoRegistro'] as EstadoRegistro,
      codigoError: comoNumero(l['CodigoErrorRegistro']),
      descripcionError: l['DescripcionErrorRegistro']
        ? String(l['DescripcionErrorRegistro'])
        : undefined,
      duplicado: dup
        ? {
            idPeticion: dup['IdPeticionRegistroDuplicado']
              ? String(dup['IdPeticionRegistroDuplicado'])
              : undefined,
            estadoRegistroDuplicado: dup['EstadoRegistroDuplicado']
              ? String(dup['EstadoRegistroDuplicado'])
              : undefined,
            codigoError: comoNumero(dup['CodigoErrorRegistro']),
            descripcionError: dup['DescripcionErrorRegistro']
              ? String(dup['DescripcionErrorRegistro'])
              : undefined
          }
        : undefined
    };
  });

  return {
    csv: respuesta['CSV'] ? String(respuesta['CSV']) : undefined,
    estadoEnvio,
    tiempoEsperaEnvio: comoNumero(respuesta['TiempoEsperaEnvio']),
    lineas
  };
}
