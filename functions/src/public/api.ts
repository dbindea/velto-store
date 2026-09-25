/**
 * La API que consume la web pública. Tres endpoints, sin autenticación.
 *
 * ⚠️ **`onRequest` y no `onCall`, a propósito.** Los callables son del SDK de
 * Firebase y la web pública es Astro: meter el SDK entero en un escaparate para
 * pedir una lista de coches es cargar medio megabyte y un cliente de Firestore
 * en la página que tiene que ser rápida. Con HTTP plano, Astro hace `fetch` y
 * además puede renderizar en servidor.
 *
 * Se llaman a través del rewrite `/api/*` de Hosting, para que la dirección viva
 * en el dominio propio. La URL de `cloudfunctions.net` sigue existiendo y no se
 * puede esconder: **nada de lo que hay aquí depende de por dónde se entre.**
 *
 * ⚠️ **Lo que estos endpoints NO pueden hacer, y por qué:**
 *
 * - **No escriben.** Ni una reserva, ni un contador, ni un log en Firestore. Un
 *   endpoint público que escribe es un endpoint que alguien llena.
 * - **No distinguen «no existe» de «no publicado».** Las dos cosas son un 404
 *   idéntico: contestar distinto confirma qué ids existen.
 * - **No devuelven el motivo de que un coche no esté libre.** Solo se enumeran
 *   los disponibles. Que falte uno ya dice bastante, pero decir *por qué* falta
 *   —«alquilado hasta el 12»— es contarle a cualquiera el calendario del
 *   negocio.
 * - **No devuelven errores con detalle.** Nada de stack traces ni de mensajes
 *   que describan la consulta. Un código y una clave, y el detalle al log.
 */

import { onRequest, Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { Response } from 'express';
import { firestore, storageBucket } from '../admin-guard';
import { operationSettings } from '../settings';
import { toDetail, toSummary } from './mapper';
import {
  addVat,
  blocksAvailability,
  calculateCalendarDays,
  rangesOverlap,
  tariffNetPrice,
  toDate,
  vehicleIsPublishable,
  widenToFullDays,
} from './core';
import { PublicAvailableVehicle } from './types';

/**
 * Cuántos coches se devuelven como mucho.
 *
 * La flota son 2–10 coches, así que esto no recorta nada hoy; está para que el
 * día que sean 200 una llamada no se lleve la colección entera. ⚠️ **Y si
 * recorta, se registra**: un tope silencioso se lee como «esto es todo lo que
 * hay».
 */
const MAX_VEHICULOS = 60;

/** El alquiler más largo que la web cotiza. Más que eso, se habla por teléfono. */
const MAX_DIAS = 90;

/**
 * Se acepta cualquier origen porque esto **es** público: la web de Velto, un
 * buscador o un agregador leen lo mismo. Restringirlo daría sensación de
 * control sin darlo — un `Origin` lo pone quien quiera con `curl`.
 */
function cors(res: Response): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Max-Age', '3600');
}

/**
 * Caché en el borde.
 *
 * ⚠️ **Es la mitigación de coste que de verdad funciona**, y por eso está aquí y
 * no en un contador de peticiones: cada respuesta servida por la CDN de Hosting
 * es una invocación que no ocurre y una lectura de Firestore que no se paga. Un
 * bucle contra `/api/fleet` se come la caché, no la base de datos.
 *
 * La disponibilidad se cachea menos: una reserva nueva tiene que notarse pronto,
 * o la web ofrece lo que ya se ha llevado otro.
 */
function cache(res: Response, segundos: number): void {
  res.set('Cache-Control', `public, max-age=60, s-maxage=${segundos}`);
}

function fallo(res: Response, code: number, key: string, detalle?: unknown): void {
  if (detalle) logger.warn('API pública: petición rechazada', { key, detalle });
  res.status(code).json({ error: key });
}

/** Una fecha `YYYY-MM-DD` o `YYYY-MM-DDTHH:mm`, en hora local. */
function parseFecha(valor: unknown): Date | null {
  if (typeof valor !== 'string' || valor.length > 16) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(valor);
  if (!m) return null;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, 0, 0
  );
  return isNaN(d.getTime()) ? null : d;
}

/** Los coches publicables: `publicEnabled` y un estado que se pueda ofrecer. */
async function cochesPublicados(): Promise<Array<{ id: string; raw: Record<string, unknown> }>> {
  const snap = await firestore()
    .collection('vehicles')
    .where('publicEnabled', '==', true)
    .limit(MAX_VEHICULOS + 1)
    .get();

  if (snap.size > MAX_VEHICULOS) {
    logger.warn('La flota publicada supera el tope y se recorta', {
      tope: MAX_VEHICULOS,
      encontrados: snap.size,
    });
  }

  return snap.docs
    .slice(0, MAX_VEHICULOS)
    .map(d => ({ id: d.id, raw: d.data() as Record<string, unknown> }))
    .filter(v => vehicleIsPublishable(v.raw['status']));
}

/** GET /api/fleet — la flota publicada. */
export const publicVehicles = onRequest({ cors: false }, async (req: Request, res: Response) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { fallo(res, 405, 'method-not-allowed'); return; }

  try {
    const [ajustes, coches] = await Promise.all([operationSettings(), cochesPublicados()]);
    const bucket = storageBucket().bucket().name;
    cache(res, 600);
    res.json({ vehicles: coches.map(v => toSummary(v.id, v.raw, bucket, ajustes.vatRate)) });
  } catch (error) {
    logger.error('Fallo listando la flota pública', error);
    fallo(res, 500, 'internal');
  }
});

/** GET /api/vehicle?id=… — la ficha. */
export const publicVehicleDetail = onRequest({ cors: false }, async (req: Request, res: Response) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { fallo(res, 405, 'method-not-allowed'); return; }

  const id = req.query['id'];
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    fallo(res, 400, 'bad-request');
    return;
  }

  try {
    const snap = await firestore().collection('vehicles').doc(id).get();
    const raw = snap.data() as Record<string, unknown> | undefined;
    /**
     * ⚠️ **Un coche que no existe y uno que no está publicado dan el MISMO
     * 404.** Distinguirlos —un 403 para el segundo— le confirmaría a quien
     * prueba ids cuáles corresponden a coches reales.
     */
    if (!snap.exists || !raw || raw['publicEnabled'] !== true || !vehicleIsPublishable(raw['status'])) {
      fallo(res, 404, 'not-found');
      return;
    }
    const ajustes = await operationSettings();
    cache(res, 600);
    res.json({ vehicle: toDetail(id, raw, storageBucket().bucket().name, ajustes.vatRate) });
  } catch (error) {
    logger.error('Fallo sirviendo la ficha pública', error);
    fallo(res, 500, 'internal');
  }
});

/**
 * GET /api/availability?from=…&to=…[&vehicleId=…] — qué hay libre y a cuánto.
 *
 * ⚠️ **La ventana se ensancha a días completos antes de cruzar nada.** Sin eso,
 * estrechando la consulta hora a hora se puede averiguar el instante exacto en
 * que un coche se libera, o sea a qué hora devuelve un cliente concreto. Ver
 * `widenToFullDays()`.
 *
 * ⚠️ **Las reservas se traen por vehículo y se filtran EN MEMORIA.** No se puede
 * acotar la consulta por fecha: `toTimestamp()` guarda un mapa
 * `{ seconds, nanoseconds }` y no un `Timestamp`, así que un
 * `where('returnDateTime', '>=', …)` **no filtra nada** — es el mismo hecho que
 * dejó el calendario vacío en producción. Con 2–10 coches leer sus reservas es
 * barato; el día que no lo sea, la salida es un campo plano indexable, no un
 * filtro que parece funcionar.
 */
export const checkPublicAvailability = onRequest({ cors: false }, async (req: Request, res: Response) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { fallo(res, 405, 'method-not-allowed'); return; }

  const desde = parseFecha(req.query['from']);
  const hasta = parseFecha(req.query['to']);
  if (!desde || !hasta) { fallo(res, 400, 'bad-dates'); return; }

  const ventana = widenToFullDays(desde, hasta);
  const dias = calculateCalendarDays(ventana.from, ventana.to);
  if (dias < 1) { fallo(res, 400, 'bad-range'); return; }
  if (dias > MAX_DIAS) { fallo(res, 400, 'range-too-long'); return; }

  // Una recogida en el pasado no se cotiza: el precio saldría bien y la reserva
  // sería imposible.
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (ventana.from < hoy) { fallo(res, 400, 'past-date'); return; }

  const soloEste = req.query['vehicleId'];
  if (soloEste !== undefined && (typeof soloEste !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(soloEste))) {
    fallo(res, 400, 'bad-request');
    return;
  }

  try {
    const ajustes = await operationSettings();
    const bucket = storageBucket().bucket().name;
    let coches = await cochesPublicados();
    if (typeof soloEste === 'string') coches = coches.filter(v => v.id === soloEste);

    const libres: PublicAvailableVehicle[] = [];
    for (const coche of coches) {
      const neto = tariffNetPrice(coche.raw['pricingRules'] as never, dias);
      /**
       * ⚠️ **Sin tarifa para esos días, el coche NO se ofrece.** La versión de
       * la app contestaba `0` y eso alquilaba el coche gratis; aquí no hay
       * operador que lo vea, así que un coche sin precio simplemente no está.
       */
      if (neto === null) {
        logger.warn('Coche publicado sin tarifa para el rango pedido', { id: coche.id, dias });
        continue;
      }

      const reservas = await firestore()
        .collection('reservations')
        .where('vehicleId', '==', coche.id)
        .get();

      let ocupado = false;
      for (const r of reservas.docs) {
        const data = r.data();
        if (!blocksAvailability(data['reservationStatus'])) continue;
        const inicio = toDate(data['pickupDateTime']);
        const fin = toDate(data['returnDateTime']);
        /**
         * ⚠️ **Una fecha ilegible cuenta como OCUPADO.** `toDate()` de la app
         * devolvería hoy y la reserva dejaría de solapar: el coche saldría
         * libre estando alquilado. Ante la duda, no se publica.
         */
        if (!inicio || !fin) { ocupado = true; break; }
        if (rangesOverlap(ventana.from, ventana.to, inicio, fin)) { ocupado = true; break; }
      }
      if (ocupado) continue;

      libres.push({
        ...toSummary(coche.id, coche.raw, bucket, ajustes.vatRate),
        totalDays: dias,
        price: { ...addVat(neto, ajustes.vatRate), currency: 'EUR' },
      });
    }

    // Menos caché que el catálogo: una reserva nueva tiene que notarse.
    cache(res, 120);
    res.json({
      from: ventana.from.toISOString(),
      to: ventana.to.toISOString(),
      totalDays: dias,
      vehicles: libres,
    });
  } catch (error) {
    logger.error('Fallo calculando disponibilidad pública', error);
    fallo(res, 500, 'internal');
  }
});
