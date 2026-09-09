/**
 * Remitir a la AEAT los registros que todavía no ha aceptado.
 *
 * ⚠️ **Emitir una factura y remitirla son dos cosas distintas, y a propósito.**
 * `issueInvoice` no llama a la Agencia: si lo hiciera, un servicio caído o lento
 * dejaría al operador esperando delante de una factura que ya tiene número
 * consumido, o —peor— tumbaría la emisión por un problema de red. La factura se
 * emite siempre; el envío es un proceso aparte que reintenta hasta conseguirlo.
 * Es la misma regla que el sellado del contrato: perder el sello es un problema,
 * perder la firma del cliente es uno mucho mayor.
 *
 * Hay dos entradas sobre la misma lógica:
 *
 * - `sendVerifactuRecords`, callable, para mandar ahora y para reintentar a mano.
 * - `sweepVerifactuRecords`, programada, que es la que garantiza que una factura
 *   emitida acaba remitida aunque nadie vuelva a abrir la aplicación.
 *
 * ⚠️ **Sin la programada esto no cumple.** Un envío que solo ocurre cuando
 * alguien pulsa un botón depende de que alguien se acuerde, y VERI\*FACTU pide
 * remisión inmediata. La callable es la comodidad; el barrido es la obligación.
 */

import * as functions from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../admin-guard';
import { companyConfig } from '../company-config';
import { verifactuEnabled, verifactuEndpoint, type RegistroAlta } from './verifactu';
import { buildEnvioSoap } from './verifactu-xml';
import { certificadoDesdeSecreto, enviarRegistros } from './verifactu-client';
import { SoapFaultError } from './verifactu-respuesta';
import {
  cabeceraPara,
  esperaHasta,
  remisionBloqueada,
  resultadosDelLote,
  siguientesAEnviar,
  type Remision
} from './verifactu-submission';

/**
 * El certificado de representante, el mismo con el que se sellan los contratos.
 *
 * ⚠️ **Declarado aquí y leído dentro del handler.** Un secret que existe en
 * Secret Manager pero no aparece en el `secrets: [...]` de su function **no se
 * monta en el runtime**: `process.env` sale `undefined` y el código se va por la
 * rama del «no está configurado», en silencio y con el despliegue en verde
 * (F-12).
 */
const VELTO_SIGNING_CERT = defineSecret('VELTO_SIGNING_CERT');
const VELTO_SIGNING_CERT_PASSWORD = defineSecret('VELTO_SIGNING_CERT_PASSWORD');

const SUBMISSIONS = 'verifactuSubmissions';
const INVOICES = 'invoices';
/** El control de ritmo. Empieza por `_` para no colisionar con ningún id de factura. */
const CONTROL_DOC = '_control';

export interface ResumenEnvio {
  /** `disabled`, `waiting`, `blocked`, `empty`, `sent`. */
  resultado: 'disabled' | 'waiting' | 'blocked' | 'empty' | 'sent';
  enviados: number;
  aceptados: number;
  rechazados: number;
  errores: number;
  pendientes: number;
  csv?: string;
  /** La primera factura atascada, si la hay. */
  bloqueadaPor?: string;
  detalle?: string;
}

const VACIO = (resultado: ResumenEnvio['resultado'], detalle?: string): ResumenEnvio => ({
  resultado,
  enviados: 0,
  aceptados: 0,
  rechazados: 0,
  errores: 0,
  pendientes: 0,
  detalle
});

/**
 * Manda lo que toque y anota el resultado.
 *
 * Devuelve un resumen en vez de lanzar cuando no hay nada que hacer: «no había
 * nada pendiente» y «falló el envío» son cosas distintas y quien llama tiene que
 * poder distinguirlas.
 */
export async function procesarPendientes(ahora = new Date()): Promise<ResumenEnvio> {
  if (!verifactuEnabled()) {
    // Ni siquiera se lee la cola: con el envío apagado, mirarla no aporta nada
    // y la factura no imprime el QR, así que nadie está esperando este acuse.
    return VACIO('disabled', 'VELTO_VERIFACTU_ENABLED no está activo');
  }

  const db = firestore();
  const controlRef = db.collection(SUBMISSIONS).doc(CONTROL_DOC);

  /**
   * ⚠️ **El ritmo lo marca la AEAT y hay que respetarlo.** Enviar antes del
   * plazo que dijo en la respuesta anterior se rechaza con el `4102`, y el
   * rechazo tumba el envío entero: adelantarse no adelanta, retrasa. La marca
   * vive en un documento y no en memoria porque cada invocación de una Cloud
   * Function puede caer en una instancia distinta.
   */
  const control = await controlRef.get();
  const noAntesDe = control.data()?.noEnviarAntesDe?.toDate?.() as Date | undefined;
  if (noAntesDe && ahora < noAntesDe) {
    return VACIO('waiting', `siguiente envío a partir de ${noAntesDe.toISOString()}`);
  }

  const snap = await db
    .collection(SUBMISSIONS)
    .where('pendienteEnvio', '==', true)
    .orderBy('chainIndex', 'asc')
    .get();

  const remisiones: Remision[] = snap.docs.map((d) => ({
    invoiceId: d.id,
    fullNumber: String(d.data().fullNumber || ''),
    chainIndex: Number(d.data().chainIndex ?? 0),
    estado: d.data().estado,
    intentos: Number(d.data().intentos ?? 0)
  }));

  const lote = siguientesAEnviar(remisiones);
  if (!lote.length) {
    const bloqueada = remisionBloqueada(remisiones);
    if (bloqueada) {
      /**
       * ⚠️ **Un rechazo para la cadena entera y no se arregla solo.** Todo lo
       * que venga detrás encadena con su huella, así que la AEAT lo rechazaría
       * igual. Hace falta una persona: por eso sale como resultado propio y no
       * como «no había nada que enviar», que es lo que parecería desde fuera.
       */
      functions.logger.error('VeriFactu: la cadena está bloqueada', {
        invoiceId: bloqueada.invoiceId,
        fullNumber: bloqueada.fullNumber
      });
      return { ...VACIO('blocked'), bloqueadaPor: bloqueada.fullNumber };
    }
    return VACIO('empty');
  }

  // Los registros salen de la factura tal y como se sellaron al emitirla. No se
  // reconstruyen: un registro recalculado se parecería al original sin ser el
  // mismo, y la huella no coincidiría.
  const registros: RegistroAlta[] = [];
  for (const r of lote) {
    const doc = await db.collection(INVOICES).doc(r.invoiceId).get();
    const registro = doc.data()?.verifactu as RegistroAlta | undefined;
    if (!registro?.IDVersion || !registro?.Huella) {
      /**
       * ⚠️ **Antes parar que mandar algo incompleto.** Una factura sin registro
       * guardado no se puede reconstruir —es inmutable— y enviarla a medias
       * gastaría un rechazo y dejaría la cadena parada igual. Es un incidente,
       * no un caso a sortear.
       */
      throw new functions.https.HttpsError(
        'failed-precondition',
        'invoices.errors.verifactuRecordMissing'
      );
    }
    registros.push(registro);
  }

  const company = companyConfig();
  const soap = buildEnvioSoap(
    cabeceraPara(company.legalName, company.taxId, ahora),
    registros
  );

  const certificado = certificadoDesdeSecreto(
    VELTO_SIGNING_CERT.value(),
    VELTO_SIGNING_CERT_PASSWORD.value()
  );

  let respuesta;
  try {
    ({ respuesta } = await enviarRegistros(soap, {
      endpoint: verifactuEndpoint(),
      certificado
    }));
  } catch (err) {
    /**
     * ⚠️ **Un fallo de transporte NO marca las facturas como rechazadas.** Si la
     * conexión se corta no sabemos si la AEAT llegó a registrar el envío: puede
     * haberlo procesado y habernos perdido la respuesta. Se anota el intento y
     * se reintenta; si había entrado, el reintento vuelve como duplicado, que
     * ya se sabe leer como aceptado.
     */
    const motivo = err instanceof SoapFaultError ? err.faultString : String(err);
    functions.logger.error('VeriFactu: el envío no llegó a completarse', {
      motivo,
      facturas: lote.map((r) => r.fullNumber)
    });
    const batch = db.batch();
    for (const r of lote) {
      batch.set(
        db.collection(SUBMISSIONS).doc(r.invoiceId),
        {
          estado: 'error',
          intentos: FieldValue.increment(1),
          ultimoIntentoAt: FieldValue.serverTimestamp(),
          ultimoError: motivo.slice(0, 500)
        },
        { merge: true }
      );
    }
    // Se espera igual: puede que el corte fuera por ir demasiado deprisa.
    batch.set(
      controlRef,
      { noEnviarAntesDe: esperaHasta({ estadoEnvio: 'Incorrecto', lineas: [] }, ahora) },
      { merge: true }
    );
    await batch.commit();
    throw new functions.https.HttpsError('unavailable', 'invoices.errors.verifactuUnreachable');
  }

  const resultados = resultadosDelLote(lote, respuesta);

  const batch = db.batch();
  for (const res of resultados) {
    const aceptado = res.estado === 'aceptado';
    batch.set(
      db.collection(SUBMISSIONS).doc(res.invoiceId),
      {
        estado: res.estado,
        /**
         * ⚠️ **Solo la aceptada sale de la cola.** Una rechazada sigue
         * `pendienteEnvio` a propósito: bloquea la cadena y tiene que seguir
         * saliendo en la lista hasta que alguien la resuelva. Sacarla la
         * escondería, que es justo lo contrario de lo que hace falta.
         */
        pendienteEnvio: !aceptado,
        intentos: FieldValue.increment(1),
        ultimoIntentoAt: FieldValue.serverTimestamp(),
        aceptadoAt: aceptado ? FieldValue.serverTimestamp() : null,
        csv: res.csv ?? null,
        codigoError: res.codigoError ?? null,
        descripcionError: res.descripcionError ?? null,
        // El historial no se pisa: es el rastro de qué se intentó y cuándo.
        historial: FieldValue.arrayUnion({
          at: new Date(),
          estado: res.estado,
          csv: res.csv ?? null,
          codigoError: res.codigoError ?? null,
          descripcionError: res.descripcionError ?? null
        })
      },
      { merge: true }
    );
  }
  batch.set(controlRef, { noEnviarAntesDe: esperaHasta(respuesta, ahora) }, { merge: true });
  await batch.commit();

  const cuenta = (e: string) => resultados.filter((r) => r.estado === e).length;
  const resumen: ResumenEnvio = {
    resultado: 'sent',
    enviados: lote.length,
    aceptados: cuenta('aceptado'),
    rechazados: cuenta('rechazado'),
    errores: cuenta('error'),
    pendientes: cuenta('pendiente'),
    csv: respuesta.csv
  };

  // Un rechazo se registra como error, no como información: para la cadena.
  if (resumen.rechazados) {
    functions.logger.error('VeriFactu: registros rechazados', {
      resumen,
      rechazadas: resultados.filter((r) => r.estado === 'rechazado')
    });
  } else {
    functions.logger.info('VeriFactu: envío completado', resumen);
  }

  return resumen;
}

export interface EstadoVerifactu {
  /** ¿Se está remitiendo de verdad? Lo decide el entorno, no la pantalla. */
  enabled: boolean;
  /** `test` = preproducción. Un registro aceptado ahí **no está presentado**. */
  entorno: 'test' | 'live';
  endpoint: string;
  pendientes: { invoiceId: string; fullNumber: string; estado: string; intentos: number;
    codigoError?: number; descripcionError?: string }[];
  aceptadas: number;
  /** La primera factura atascada. Bloquea todo lo que venga detrás. */
  bloqueadaPor?: string;
  /** Hasta cuándo hay que esperar antes del siguiente envío. */
  siguienteEnvio?: string;
}

/**
 * Qué está remitido y qué no.
 *
 * ⚠️ **`entorno` viaja siempre y la pantalla lo enseña.** Un registro aceptado
 * en preproducción no está presentado ante nadie: enseñar «aceptado» a secas
 * haría creer que la obligación está cumplida cuando lo que hay es un ensayo.
 */
export const getVerifactuStatus = functions.https.onCall(
  async (request): Promise<EstadoVerifactu> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }
    const db = firestore();

    const pendientesSnap = await db
      .collection(SUBMISSIONS)
      .where('pendienteEnvio', '==', true)
      .orderBy('chainIndex', 'asc')
      .get();

    const remisiones: Remision[] = pendientesSnap.docs.map((d) => ({
      invoiceId: d.id,
      fullNumber: String(d.data().fullNumber || ''),
      chainIndex: Number(d.data().chainIndex ?? 0),
      estado: d.data().estado,
      intentos: Number(d.data().intentos ?? 0)
    }));

    const aceptadas = await db
      .collection(SUBMISSIONS)
      .where('pendienteEnvio', '==', false)
      .count()
      .get();

    const control = await db.collection(SUBMISSIONS).doc(CONTROL_DOC).get();
    const noAntesDe = control.data()?.noEnviarAntesDe?.toDate?.() as Date | undefined;

    return {
      enabled: verifactuEnabled(),
      entorno: process.env.VELTO_VERIFACTU_ENV === 'live' ? 'live' : 'test',
      endpoint: verifactuEndpoint(),
      pendientes: pendientesSnap.docs.map((d) => ({
        invoiceId: d.id,
        fullNumber: String(d.data().fullNumber || ''),
        estado: String(d.data().estado || 'pendiente'),
        intentos: Number(d.data().intentos ?? 0),
        codigoError: d.data().codigoError ?? undefined,
        descripcionError: d.data().descripcionError ?? undefined
      })),
      aceptadas: aceptadas.data().count,
      bloqueadaPor: remisionBloqueada(remisiones)?.fullNumber,
      siguienteEnvio: noAntesDe && noAntesDe > new Date() ? noAntesDe.toISOString() : undefined
    };
  }
);

/** Mandar ahora. La usa el botón de Facturas y el reintento manual. */
export const sendVerifactuRecords = functions.https.onCall(
  { secrets: [VELTO_SIGNING_CERT, VELTO_SIGNING_CERT_PASSWORD] },
  async (request): Promise<ResumenEnvio> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }
    return procesarPendientes();
  }
);

/**
 * El barrido, que es lo que hace que esto cumpla.
 *
 * ⚠️ **Cada cinco minutos, no cada hora.** VERI\*FACTU pide remisión inmediata:
 * el margen es para agrupar y respetar el ritmo que marca la Agencia, no para
 * acumular el día. Y no se pone más agresivo porque la propia AEAT dice en cada
 * respuesta cuánto hay que esperar, y saltárselo se rechaza.
 */
export const sweepVerifactuRecords = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Europe/Madrid',
    secrets: [VELTO_SIGNING_CERT, VELTO_SIGNING_CERT_PASSWORD]
  },
  async () => {
    try {
      await procesarPendientes();
    } catch (err) {
      // Un barrido que falla no puede tumbar el siguiente: se anota y se
      // reintenta dentro de cinco minutos.
      functions.logger.error('VeriFactu: el barrido falló', { err });
    }
  }
);
