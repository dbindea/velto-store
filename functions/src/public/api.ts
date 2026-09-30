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
import * as logger from 'firebase-functions/logger';
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
import type { PublicAvailableVehicle } from './types';
import { defineSecret } from 'firebase-functions/params';
import { companyConfig } from '../company-config';
import { publicBaseUrl } from '../public-url';
/**
 * ⚠️ **Estático y no perezoso a propósito.** La regla del arranque en frío es
 * apartar lo que pesa, y esto son cinco funciones que devuelven cadenas, sin una
 * sola dependencia: un módulo de 432, frente a los cientos que costaría un
 * `pdf-lib`. Cargarlo perezosamente solo complicaría el único sitio que lo usa.
 */
import { renderBookingRequestEmail, type BookingRequestEmailData } from './booking-request-email';
import { renderContactEmail } from './contact-email';
import {
  generateContactReference,
  looksAutomated as contactoAutomatizado,
  validateContact,
  type ContactInput
} from './contact-core';
import {
  generateReference,
  looksAutomated,
  priceGuaranteedUntil,
  validateBookingRequest,
  type BookingRequestInput
} from './booking-request-core';

/**
 * ⚠️ **Declarado aquí y leído DENTRO del handler.** Un secret que existe en
 * Secret Manager pero no aparece en el `secrets: [...]` de su function no se
 * monta en el runtime: `process.env` sale `undefined` y el código se va por la
 * rama del «no está configurado», en silencio y con el despliegue en verde.
 */
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const RESEND_API_URL = 'https://api.resend.com/emails';

/** La colección de las solicitudes de la web. */
const SOLICITUDES = 'bookingRequests';

/** Cuántas solicitudes admite un mismo teléfono seguidas, y en cuánto rato. */
const LIMITE_SOLICITUDES = 3;
const LIMITE_SOLICITUDES_MINUTOS = 30;

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
function cors(res: Response, metodos = 'GET, OPTIONS'): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', metodos);
  /**
   * ⚠️ **`Content-Type` hace falta para el POST de la solicitud.** Un `fetch`
   * con cuerpo JSON dispara una comprobación previa, y sin esta cabecera el
   * navegador la rechaza **antes** de llamar — así que la function nunca se
   * entera y lo que se ve es un fallo de red sin explicación.
   */
  res.set('Access-Control-Allow-Headers', 'Content-Type');
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

/**
 * Una solicitud de la web: «que me llamen».
 *
 * ⚠️ **Es el ÚNICO endpoint público que escribe**, y por eso lleva encima todo
 * lo que los otros tres no necesitan: topes de longitud, campo trampa y un
 * límite por teléfono. Los demás solo leen; aquí cualquiera del mundo deja un
 * documento en Firestore.
 *
 * ⚠️ **No crea una reserva ni un cliente, y esa es la regla que lo sostiene.**
 * Una reserva bloquearía el coche, saldría en el calendario y contaría en
 * informes — o sea, apartar la flota gratis. Un cliente llenaría el fichero de
 * gente que nunca alquiló, con su nombre y su teléfono dentro. Los dos nacen
 * cuando el operador convierte, no antes. Es la misma regla que ya sostiene el
 * presupuesto: los documentos informativos no tocan el estado del alquiler.
 *
 * ⚠️ **Lo que se garantiza es el PRECIO, no el coche**, y el texto que ve el
 * cliente lo dice. Apartar un vehículo sin pago ni identidad deja la flota
 * bloqueable por cualquiera; mantener una cifra no quita inventario.
 */
export const createBookingRequest = onRequest(
  { cors: false, secrets: [RESEND_API_KEY] },
  async (req: Request, res: Response) => {
    cors(res, 'POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { fallo(res, 405, 'method-not-allowed'); return; }

    const cuerpo = (req.body ?? {}) as BookingRequestInput;

    /**
     * ⚠️ **Al robot se le contesta que sí.** Devolviendo un error aprende a no
     * rellenar el campo escondido y la trampa deja de servir para siempre. La
     * referencia que se lleva no existe en ninguna parte.
     */
    if (looksAutomated(cuerpo)) {
      logger.info('Solicitud descartada por el campo trampa');
      res.json({ reference: generateReference(), priceGuaranteedUntil: null });
      return;
    }

    const validado = validateBookingRequest(cuerpo);
    if (!validado.ok) { fallo(res, 400, validado.error); return; }
    const { vehicleId, name, phone, note } = validado.fields;

    const desde = parseFecha(cuerpo.from);
    const hasta = parseFecha(cuerpo.to);
    if (!desde || !hasta) { fallo(res, 400, 'bad-dates'); return; }

    const ventana = widenToFullDays(desde, hasta);
    const dias = calculateCalendarDays(ventana.from, ventana.to);
    if (dias < 1) { fallo(res, 400, 'bad-range'); return; }
    if (dias > MAX_DIAS) { fallo(res, 400, 'range-too-long'); return; }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (ventana.from < hoy) { fallo(res, 400, 'past-date'); return; }

    try {
      /**
       * ⚠️ **El límite va por TELÉFONO y no por IP.** Detrás de un móvil hay
       * una IP compartida por media provincia, así que limitar por ahí deja
       * fuera a clientes de verdad; y el teléfono es obligatorio, que es lo que
       * lo hace posible. No pretende parar a un atacante decidido —cambiar de
       * número es fácil—: pretende que un formulario reenviado veinte veces no
       * llene la bandeja.
       */
      /**
       * ⚠️ **Un solo `where` y el resto en memoria, a propósito.** Cruzar
       * `phone` con un rango de `createdAt` exige un índice compuesto, y eso
       * ataría el único endpoint público que escribe a que un índice esté
       * construido: mientras se crea, la function devuelve 500 y el visitante
       * ve «no hemos podido enviarlo». Lo comprobé desplegándolo así.
       *
       * Para un teléfono dado hay siempre un puñado de documentos —el límite de
       * abajo y la limpieza diaria lo garantizan—, así que traerlos y filtrar
       * aquí cuesta lo mismo y no depende de nada.
       */
      const desdeVentana = Date.now() - LIMITE_SOLICITUDES_MINUTOS * 60 * 1000;
      const mismoTelefono = await firestore()
        .collection(SOLICITUDES)
        .where('phone', '==', phone)
        .limit(50)
        .get();
      const recientes = mismoTelefono.docs.filter((d) => {
        const cuando = toDate(d.data()['createdAt']);
        return cuando !== null && cuando.getTime() >= desdeVentana;
      });
      if (recientes.length >= LIMITE_SOLICITUDES) {
        fallo(res, 429, 'too-many-requests', { phone });
        return;
      }

      const ajustes = await operationSettings();

      /**
       * ⚠️ **El coche se comprueba AQUÍ otra vez**, aunque la web solo ofrezca
       * los libres: entre que se pintó la lista y se envió el formulario cabe
       * una reserva. Y se recalcula el precio, que no viaja en la petición.
       */
      const doc = await firestore().collection('vehicles').doc(vehicleId).get();
      const raw = doc.data() as Record<string, unknown> | undefined;
      if (!doc.exists || !raw || raw['publicEnabled'] !== true || !vehicleIsPublishable(raw['status'])) {
        fallo(res, 409, 'vehicle-unavailable');
        return;
      }

      const neto = tariffNetPrice(raw['pricingRules'] as never, dias);
      // Sin tarifa para esos días no se cotiza: la regla de toda la web pública.
      if (neto === null) { fallo(res, 409, 'vehicle-unavailable'); return; }

      const reservas = await firestore()
        .collection('reservations')
        .where('vehicleId', '==', vehicleId)
        .get();
      for (const r of reservas.docs) {
        const data = r.data();
        if (!blocksAvailability(data['reservationStatus'])) continue;
        const inicio = toDate(data['pickupDateTime']);
        const fin = toDate(data['returnDateTime']);
        // Una fecha ilegible cuenta como ocupado, como en la disponibilidad.
        if (!inicio || !fin || rangesOverlap(ventana.from, ventana.to, inicio, fin)) {
          fallo(res, 409, 'vehicle-unavailable');
          return;
        }
      }

      const precio = addVat(neto, ajustes.vatRate);
      const ahora = new Date();
      const garantia = priceGuaranteedUntil(ahora, ajustes.bookingRequestPriceHours);
      const reference = generateReference();

      const solicitud = {
        reference,
        status: 'new',
        createdAt: ahora,
        name,
        phone,
        note,
        vehicleId,
        /**
         * Lo que el cliente VIO, congelado. No es comodidad: el operador va a
         * llamar citando esa cifra, y el coche puede cambiar de tarifa mañana.
         * Misma razón que `pricingSnapshot`.
         */
        vehicleSnapshot: {
          brand: String(raw['brand'] ?? ''),
          model: String(raw['model'] ?? ''),
          category: String(raw['category'] ?? '')
        },
        quoteSnapshot: {
          totalDays: dias,
          net: precio.net,
          gross: precio.gross,
          vatRate: precio.vatRate,
          currency: 'EUR'
        },
        pickupDate: ventana.from,
        returnDate: ventana.to,
        priceGuaranteedUntil: garantia,
        /** El plazo de borrado, congelado: ver `bookingRequestKeepHours`. */
        keepHours: ajustes.bookingRequestKeepHours
      };

      const ref = await firestore().collection(SOLICITUDES).add(solicitud);

      /**
       * ⚠️ **El aviso NUNCA tumba la solicitud.** Se escribe primero y se avisa
       * después: perder el correo es un problema, perder la solicitud que el
       * cliente acaba de mandar es uno mucho mayor. Misma regla que el sellado
       * del contrato, que se guarda sin sellar antes que perder la firma.
       */
      try {
        await avisarSolicitud(ref.id, solicitud);
      } catch (error) {
        logger.error('No se pudo avisar de la solicitud', { id: ref.id, error });
      }

      res.json({ reference, priceGuaranteedUntil: garantia.toISOString() });
    } catch (error) {
      logger.error('Fallo creando la solicitud', error);
      fallo(res, 500, 'internal');
    }
  }
);

/**
 * El correo que avisa de una solicitud nueva.
 *
 * ⚠️ **Lleva dentro todo lo que hace falta para decidir sin abrir nada**: coche,
 * fechas, días, precio y teléfono. Un aviso que obliga a entrar en la
 * aplicación para saber si merece la pena es un aviso que se mira más tarde, y
 * más tarde el cliente ya ha llamado a otro.
 *
 * ⚠️ **Aquí solo se manda; cómo se ve está en `booking-request-email.ts`.**
 *
 * ⚠️ **Y NO es un WhatsApp, aunque sería lo natural.** Mandarlo exigiría la
 * WhatsApp Business Cloud API: un número dedicado que no puede ser el del móvil
 * de la agencia, verificación de empresa con Meta, plantilla aprobada y pago por
 * mensaje —sería una plantilla de utilidad fuera de ventana de servicio—. Lo
 * gratuito es al revés: contestar dentro de las 24 h a quien te escribe. Por eso
 * el WhatsApp va en el otro sentido, desde la ficha del panel con un enlace
 * `wa.me`, que no cuesta nada y sale del número de siempre.
 */
async function avisarSolicitud(id: string, s: BookingRequestEmailData): Promise<void> {
  const apiKey = RESEND_API_KEY.value();
  if (!apiKey) {
    logger.warn('Solicitud sin avisar: RESEND_API_KEY no está configurada', { id });
    return;
  }

  const empresa = companyConfig();
  const base = publicBaseUrl();
  const { subject, html, text } = renderBookingRequestEmail(s, {
    brandName: empresa.brandName,
    enlace: base ? `${base}/booking-requests/${id}` : ''
  });

  const r = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${empresa.brandName} <${empresa.email}>`,
      to: [empresa.email],
      subject,
      html,
      text
    })
  });
  if (!r.ok) {
    throw new Error(`Resend respondió ${r.status}: ${await r.text()}`);
  }
}

/* ===========================================================================
 * EL FORMULARIO DE CONTACTO
 * ======================================================================== */

/** Las consultas del formulario, separadas de las solicitudes de reserva. */
const CONSULTAS = 'contactRequests';

/**
 * ⚠️ **Más holgado que el de las solicitudes (3 en 30 minutos), y a propósito.**
 * Una solicitud es siempre la misma acción —pedir precio de un coche—, pero por
 * aquí alguien puede escribir, darse cuenta de que se dejó un dato y volver a
 * enviar. Dos de más no llenan una bandeja; cinco seguidos sí son un robot que
 * ha pasado la trampa.
 */
const LIMITE_CONSULTAS = 5;
const LIMITE_CONSULTAS_MINUTOS = 30;

/**
 * «Escríbenos»: el formulario guiado de `/contacto`.
 *
 * ⚠️ **Es el SEGUNDO endpoint público que escribe**, y por eso lleva lo mismo
 * que el primero: topes de longitud, campo trampa y límite por teléfono. Los de
 * lectura no necesitan nada de esto; aquí cualquiera del mundo deja un
 * documento en Firestore.
 *
 * ⚠️ **No crea cliente, ni reserva, ni solicitud de reserva.** Es una consulta:
 * queda un documento y sale un correo. Quien decide si eso se convierte en algo
 * es Dorel, llamando — igual que con las solicitudes de la web, y por la misma
 * razón: un fichero lleno de gente que nunca alquiló es un fichero que hay que
 * justificar ante la AEPD.
 *
 * ⚠️ **Y no se guarda nada que no se haya pedido.** Ni la IP, ni el navegador,
 * ni de qué página venía. Lo que no se guarda no hay que protegerlo, ni
 * declararlo en la política de privacidad, ni borrarlo cuando alguien lo pida.
 */
export const createContactRequest = onRequest(
  { cors: false, secrets: [RESEND_API_KEY] },
  async (req: Request, res: Response) => {
    cors(res, 'POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { fallo(res, 405, 'method-not-allowed'); return; }

    const cuerpo = (req.body ?? {}) as ContactInput;

    /**
     * ⚠️ **Al robot se le contesta que sí.** Devolviendo un error aprende a no
     * rellenar el campo escondido y la trampa deja de servir para siempre. La
     * referencia que se lleva no existe en ninguna parte.
     */
    if (contactoAutomatizado(cuerpo)) {
      logger.info('Consulta descartada por el campo trampa');
      res.json({ reference: generateContactReference() });
      return;
    }

    const validado = validateContact(cuerpo);
    if (!validado.ok) { fallo(res, 400, validado.error); return; }
    const campos = validado.fields;

    try {
      /**
       * ⚠️ **Un solo `where` y el resto en memoria**, igual que en las
       * solicitudes y por el mismo motivo: cruzar `phone` con un rango de
       * `createdAt` exige un índice compuesto, y eso ataría un endpoint público
       * a que un índice esté construido. Mientras se crea, la function devuelve
       * 500 y el visitante ve «no hemos podido enviarlo».
       */
      const desdeVentana = Date.now() - LIMITE_CONSULTAS_MINUTOS * 60 * 1000;
      const mismoTelefono = await firestore()
        .collection(CONSULTAS)
        .where('phone', '==', campos.phone)
        .limit(50)
        .get();
      const recientes = mismoTelefono.docs.filter((d) => {
        const cuando = toDate(d.data()['createdAt']);
        return cuando !== null && cuando.getTime() >= desdeVentana;
      });
      if (recientes.length >= LIMITE_CONSULTAS) {
        fallo(res, 429, 'too-many-requests', { phone: campos.phone });
        return;
      }

      const reference = generateContactReference();
      const consulta = { reference, status: 'new', createdAt: new Date(), ...campos };

      const ref = await firestore().collection(CONSULTAS).add(consulta);

      /**
       * ⚠️ **El aviso NUNCA tumba la consulta.** Se escribe primero y se avisa
       * después: perder el correo es un problema, perder lo que la persona
       * acaba de escribir es uno mucho mayor. Misma regla que el sellado del
       * contrato, que se guarda sin sellar antes que perder la firma.
       */
      try {
        const empresa = companyConfig();
        const { subject, html, text } = renderContactEmail(
          { reference, ...campos },
          { brandName: empresa.brandName }
        );
        await enviarCorreo(subject, html, text);
      } catch (error) {
        logger.error('No se pudo avisar de la consulta', { id: ref.id, error });
      }

      res.json({ reference });
    } catch (error) {
      logger.error('Fallo creando la consulta', error);
      fallo(res, 500, 'internal');
    }
  }
);

/**
 * Manda un correo a la propia empresa.
 *
 * ⚠️ **El remitente y el destinatario son el mismo**, que es lo que hace que
 * Resend lo acepte: solo admite remitentes de un dominio verificado. Si el
 * dominio de `companyConfig().email` no lo está, esto falla con un 403 que
 * **no dice «dominio sin verificar»** — dice «Error al enviar el email (403)».
 */
async function enviarCorreo(subject: string, html: string, text: string): Promise<void> {
  const apiKey = RESEND_API_KEY.value();
  if (!apiKey) {
    logger.warn('Consulta sin avisar: RESEND_API_KEY no está configurada');
    return;
  }
  const empresa = companyConfig();
  const r = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${empresa.brandName} <${empresa.email}>`,
      to: [empresa.email],
      subject,
      html,
      text
    })
  });
  if (!r.ok) {
    throw new Error(`Resend respondió ${r.status}: ${await r.text()}`);
  }
}
