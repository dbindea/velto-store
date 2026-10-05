/**
 * La señal de visita de la web pública.
 *
 * ⚠️ **Pública y sin autenticar, como el resto de `/api/…` de la web.** Lo que
 * la protege de que alguien infle los números no es una llave, es que **casi
 * nada de lo que llega se cree**: la ruta pasa por lista blanca, el hito
 * también, y la identidad del visitante se calcula **en el servidor** con su IP
 * y su agente. El cliente no puede decir quién es ni cuántos son.
 *
 * ⚠️ **No guarda nada en el dispositivo** —ni cookie, ni `localStorage`—, que
 * es lo que permite no pedir consentimiento. Ver `analitica-core.ts`.
 *
 * ⚠️ **Y escribe AGREGADOS, no eventos.** Un documento por día con contadores,
 * más un documento por visitante y día que solo existe para no contarlo dos
 * veces. Guardar cada página vista como su propio documento daría recorridos
 * completos y costaría una escritura por página; con cuatro visitas al día no
 * se nota, pero esto es un escaparate y el día que funcione sí.
 */

import { onRequest, Request } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
// ⚠️ El subpath, nunca `firebase-functions/v2`: ese barrel carga los
// proveedores de todos los tipos de trigger —407 módulos y 340 ms— en cada
// arranque en frío, también cuando la petición era contar una visita.
// `arranque.spec.ts` lo caza, y lo cazó.
import * as logger from 'firebase-functions/logger';
import { firestore } from '../admin-guard';
import {
  pareceBot,
  diaDeMadrid,
  huellaVisitante,
  ipDelVisitante,
  normalizaRuta,
  normalizaHito
} from './analitica-core';

/**
 * El secreto con el que se sala la huella.
 *
 * ⚠️ **Sin él, el hash se deshace probando.** Hay unos pocos miles de millones
 * de IPv4: con la lista de hashes de un día y sin secreto, cualquiera las
 * recorre y sabe quién entró. Con secreto, hay que conocerlo.
 *
 * ⚠️ **Y si no está configurado, NO se mide.** Antes que escribir huellas
 * reversibles, no se escribe nada: el contador vale menos que el dato de una
 * persona.
 */
const ANALYTICS_SALT = defineSecret('VELTO_ANALYTICS_SALT');

export const COLECCION = 'webAnalytics';

export const trackWebVisit = onRequest(
  { cors: false, secrets: [ANALYTICS_SALT] },
  async (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    // Nunca cacheado: cada visita es una visita.
    res.set('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method-not-allowed' });
      return;
    }

    /**
     * ⚠️ **Siempre 204, pase lo que pase.** Esto lo llama un `sendBeacon` desde
     * la página del cliente: un error aquí no tiene a nadie a quien contárselo,
     * y devolver un 4xx solo serviría para que alguien afinara el ataque
     * probando qué cuela. Lo que no se puede contar, se descarta en silencio y
     * se registra en el log.
     */
    const fin = () => res.status(204).send('');

    try {
      const secreto = ANALYTICS_SALT.value();
      if (!secreto) {
        logger.warn('trackWebVisit sin VELTO_ANALYTICS_SALT: no se mide nada');
        fin();
        return;
      }

      const ua = String(req.get('user-agent') || '');
      const dia = diaDeMadrid(new Date());
      const docDia = firestore().collection(COLECCION).doc(dia);

      // El bot se cuenta aparte, y no como visitante: saber cuántos hay es lo
      // que permite creerse el resto de la cifra.
      if (pareceBot(ua)) {
        await docDia.set(
          { date: dia, bots: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        fin();
        return;
      }

      const cuerpo = (req.body ?? {}) as Record<string, unknown>;
      const ruta = normalizaRuta(cuerpo['ruta']);
      const hito = normalizaHito(cuerpo['hito']);
      if (!ruta && !hito) {
        fin();
        return;
      }

      const ip = ipDelVisitante(req.get('x-forwarded-for'), req.ip);
      const huella = huellaVisitante(ip, ua, dia, secreto);

      /**
       * ⚠️ **El visitante se cuenta con un `create()`, no leyendo antes.**
       * `create()` falla si el documento ya existe, y esa es toda la lógica:
       * quien entra por primera vez hoy lo crea, y el resto de sus páginas
       * fallan al crearlo. Un «lee y si no está escribe» tendría una carrera
       * entre dos pestañas abiertas a la vez y contaría dos.
       */
      let nuevo = false;
      try {
        await docDia
          .collection('visitors')
          .doc(huella)
          .create({ at: FieldValue.serverTimestamp() });
        nuevo = true;
      } catch {
        // Ya estaba: es la misma persona viendo otra página.
      }

      /**
       * ⚠️ **Los contadores anidados van como OBJETO, no con la clave punteada.**
       * En un `set()` una clave `'routes.flota'` crea un campo que se llama
       * literalmente «routes.flota»; solo `update()` interpreta el punto como
       * ruta. Y `update()` no vale aquí porque el documento del día no existe
       * hasta la primera visita. Con el objeto anidado y `merge: true`,
       * Firestore mezcla bien y los `increment` se aplican dentro.
       *
       * ⚠️ Y la barra de la portada se guarda como `home`: una clave de mapa no
       * puede llevar `/` sin escaparla, y escaparla es pedir que el día de
       * mañana alguien lea el mapa y no entienda qué es cada cosa.
       */
      const cambios: Record<string, unknown> = {
        date: dia,
        updatedAt: FieldValue.serverTimestamp()
      };
      if (nuevo) cambios['visitors'] = FieldValue.increment(1);
      if (ruta) {
        cambios['pageViews'] = FieldValue.increment(1);
        cambios['routes'] = { [ruta === '/' ? 'home' : ruta.slice(1)]: FieldValue.increment(1) };
      }
      if (hito) cambios['funnel'] = { [hito]: FieldValue.increment(1) };

      await docDia.set(cambios, { merge: true });
      fin();
    } catch (err) {
      logger.error('trackWebVisit', err);
      fin();
    }
  }
);
