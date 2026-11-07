/**
 * El aviso de las 17:00: mañana termina un alquiler, escríbele al cliente.
 *
 * Lo pidió Dorel el 7 de noviembre de 2026, con el texto escrito a mano: *«Para
 * las reservas que caducan por ejemplo mañana me gustaría recibir hoy como a
 * las 17:00h, el día anterior, de la finalización de la reserva, un mensaje en
 * telegram para copiar y pegar al cliente en whatsapp»*.
 *
 * ⚠️ **No es el resumen diario a otra hora.** El de las 9:00 cuenta lo que hay
 * que **preparar** y lo lee quien abre el correo; este trae **el mensaje ya
 * redactado** y la hora es parte de la petición: la tarde de antes es la última
 * en la que se puede vender una prórroga. A las 9:00 del día de la devolución
 * el cliente ya está de camino.
 *
 * ⚠️ **Por Telegram y no por correo**, por lo mismo que el aviso de cobro: el
 * correo no suena. *«Hasta que no vea el email o entre no me entero»* — y aquí
 * el aviso caduca en unas horas, así que uno que se lee al día siguiente no
 * sirve de nada.
 *
 * ⚠️ **No manda nada al cliente, y es deliberado.** Lo que llega es un borrador
 * para copiar o un enlace que **abre** WhatsApp con el texto puesto; quien
 * pulsa enviar es Dorel. Mandarlo solo pediría la API de WhatsApp Business —un
 * número aparte, verificación con Meta, plantilla aprobada y pago por mensaje—
 * y, sobre todo, quitaría la última revisión humana de algo que lee un cliente.
 */

import * as logger from 'firebase-functions/logger';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { firestore } from '../admin-guard';
// El lector estricto: una fecha ilegible es `null`, no la de hoy.
import { toDate } from '../public/core';
import {
  caeEnElRango,
  diaDeReferencia,
  ESTADOS_CON_MOVIMIENTO,
  horaEn,
  rangoManana
} from './daily-digest';
import { avisarPorTelegram } from './telegram';
import {
  mensajeRecordatorio,
  telefonoParaWhatsapp,
  type DevolucionManana
} from './return-reminder';
import { publicBaseUrl } from '../public-url';

const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');

/**
 * Marca y modelo, que es como se le nombra el coche a un cliente.
 *
 * ⚠️ **Vacío si no consta, nunca un comodín.** Devolvía `'vehículo'` y el
 * mensaje salía «finaliza la reserva del vehículo» en las reservas sin
 * `vehicleSnapshot` —las sembradas a mano—. `mensajeParaCliente()` sabe
 * decirlo de otra forma; aquí lo que toca es no inventarse el dato.
 */
function cocheDe(snap: Record<string, unknown> | undefined): string {
  return [snap?.['brand'], snap?.['model']].filter(Boolean).join(' ').trim();
}

/**
 * Las devoluciones de mañana, con todo lo que hace falta para redactar.
 *
 * ⚠️ **El rango se filtra en memoria y el estado en la consulta**, no al revés.
 * `returnDateTime` está guardado como un mapa `{ seconds, nanoseconds }` y
 * Firestore **no lo compara con un timestamp**: una consulta de rango sobre él
 * no devuelve ni un documento, sin error ninguno. Ver `caeEnElRango()`, que es
 * donde está escrito el caso completo — y que es justo el fallo que llevaba dos
 * meses vaciando el resumen diario.
 */
export async function devolucionesDeManana(ahora = new Date()): Promise<DevolucionManana[]> {
  const db = firestore();
  const rango = rangoManana(ahora);

  const snap = await db
    .collection('reservations')
    .where('reservationStatus', 'in', [...ESTADOS_CON_MOVIMIENTO])
    .get();

  const fuera: DevolucionManana[] = [];

  for (const doc of snap.docs) {
    const r = doc.data();
    if (!caeEnElRango(r['returnDateTime'], rango)) continue;

    const estado = r['reservationStatus'];

    /**
     * ⚠️ **Lo ya devuelto NO se avisa.** Con el parte de devolución hecho el
     * coche está en la nave: escribirle al cliente para ofrecerle una prórroga
     * de un alquiler que ya terminó es el aviso que hace que se dejen de leer
     * los demás.
     */
    if (estado === 'returned') continue;

    /**
     * ⚠️ **Sin parte de entrega se avisa IGUAL, y eso es deliberado.** Pedir
     * solo `delivered` es lo correcto en teoría —es el estado que significa
     * «el coche está fuera»— y tiene un modo de fallo que no se nota: quien no
     * complete los partes de entrega no recibiría este aviso **nunca**, y un
     * aviso que no llega no se echa de menos. Así que si la recogida ya pasó,
     * el coche se da por fuera y el aviso lo dice.
     */
    const sinParte = estado !== 'delivered';
    if (sinParte) {
      const recogida = toDate(r['pickupDateTime']);
      // La recogida todavía no ha llegado: no hay coche fuera del que hablar.
      if (!recogida || recogida.getTime() > ahora.getTime()) continue;
    }

    const cliente = r['clientSnapshot'] as Record<string, unknown> | undefined;
    const vehiculo = r['vehicleSnapshot'] as Record<string, unknown> | undefined;
    const devolucion = toDate(r['returnDateTime']);
    const telefonoBruto = cliente?.['phone'] as string | undefined;
    const matricula = vehiculo?.['plateNumber'] as string | undefined;
    const lugar = r['returnLocation'] as string | undefined;

    fuera.push({
      reservationId: doc.id,
      hora: devolucion ? horaEn(devolucion) : null,
      // `etiqueta` es `dd/MM/yyyy` por construcción; el año sobra para mañana.
      dia: rango.etiqueta.slice(0, 5),
      cliente: String(cliente?.['fullName'] ?? '').trim(),
      telefono: telefonoParaWhatsapp(telefonoBruto),
      ...(telefonoBruto ? { telefonoBruto } : {}),
      coche: cocheDe(vehiculo),
      ...(matricula ? { matricula } : {}),
      ...(lugar?.trim() ? { lugar: lugar.trim() } : {}),
      ...(sinParte ? { sinParteDeEntrega: true } : {})
    });
  }

  // Lo que vuelve antes, primero: es el orden en que hay que escribir.
  fuera.sort((a, b) => (a.hora ?? '99:99').localeCompare(b.hora ?? '99:99'));
  return fuera;
}

/**
 * Manda un aviso por devolución. Devuelve qué hizo.
 *
 * ⚠️ **Uno por reserva, no un mensaje con la lista.** El valor entero está en
 * que el texto del cliente se copia **tocándolo**, y en un mensaje con tres
 * clientes dentro no hay nada que tocar: habría que seleccionar a mano el trozo
 * que toca, que es el trabajo que esto viene a quitar. Y cada uno lleva su
 * enlace de WhatsApp, que es de un cliente concreto.
 *
 * ⚠️ **Y si no hay ninguna, no se manda nada.** Misma regla que `mereceEnvio()`
 * en el resumen: un aviso diario que casi siempre dice «nada» se acaba
 * silenciando, y con él el que sí importaba.
 */
export async function enviarRecordatorios(
  token: string | undefined,
  ahora = new Date()
): Promise<{ enviados: number; devoluciones: DevolucionManana[]; mensajes: string[] }> {
  const devoluciones = await devolucionesDeManana(ahora);
  const base = publicBaseUrl();
  const mensajes = devoluciones.map((d) => mensajeRecordatorio(d, base));

  let enviados = 0;
  for (const texto of mensajes) {
    // `avisarPorTelegram` no lanza nunca: un fallo con un cliente no puede
    // dejar sin aviso a los demás.
    if (await avisarPorTelegram(texto, token, process.env.TELEGRAM_CHAT_ID)) enviados++;
  }

  if (devoluciones.length) {
    logger.info('Recordatorios de devolución', { total: devoluciones.length, enviados });
  }
  return { enviados, devoluciones, mensajes };
}

/**
 * A las 17:00 de Madrid, todos los días.
 *
 * ⚠️ **`timeZone` no es decorativo.** Sin ella la programación es UTC y el
 * aviso saldría a las 18:00 en invierno y a las 19:00 en verano, corriéndose
 * solo dos veces al año sin que nadie tocara nada.
 *
 * ⚠️ **Es el segundo `onSchedule` del proyecto**, así que estrena un trabajo más
 * en Cloud Scheduler. Son dos por proyecto y el plan gratuito trae tres por
 * cuenta de facturación, así que no cuesta nada hoy — pero conviene saber que
 * esto ya no es gratis por construcción, como avisa la nota de la limpieza de
 * solicitudes en `sendDailyDigest`.
 */
export const sendReturnReminders = onSchedule(
  {
    schedule: '0 17 * * *',
    timeZone: 'Europe/Madrid',
    secrets: [TELEGRAM_BOT_TOKEN]
  },
  async () => {
    try {
      // ⚠️ Se lee DENTRO del handler: en el módulo se evaluaría antes de que el
      // runtime resuelva los secrets, y saldría vacío (F-12).
      await enviarRecordatorios(TELEGRAM_BOT_TOKEN.value(), new Date());
    } catch (err) {
      // Que falle una tarde no puede tumbar la siguiente.
      logger.error('Recordatorios de devolución: falló', { err });
    }
  }
);

/**
 * Verlo ahora, sin esperar a las cinco.
 *
 * ⚠️ **Con `enviar: true` manda los avisos de verdad**, que es la única forma de
 * comprobar lo que no se lee en un log: si el bloque se copia de un toque, si el
 * enlace abre WhatsApp con el texto puesto y cómo queda en un móvil. Por defecto
 * solo devuelve lo que habría mandado.
 *
 * ⚠️ **Y `fecha` permite ensayar sin mover ninguna reserva.** Un aviso que solo
 * se puede ver el día antes de una devolución real es un aviso que no se puede
 * depurar — y la alternativa, cambiarle la fecha a una reserva para provocarlo,
 * es tocar datos para probar. Es `YYYY-MM-DD` y significa «haz como si hoy fuera
 * este día».
 */
export const previewReturnReminders = onCall(
  { secrets: [TELEGRAM_BOT_TOKEN] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }

    const datos = (request.data ?? {}) as { enviar?: boolean; fecha?: string };

    let ahora = new Date();
    if (datos.fecha) {
      const referencia = diaDeReferencia(datos.fecha);
      if (!referencia) {
        throw new HttpsError('invalid-argument', 'La fecha tiene que ser un YYYY-MM-DD real.');
      }
      ahora = referencia;
    }

    if (datos.enviar === true) return enviarRecordatorios(TELEGRAM_BOT_TOKEN.value(), ahora);

    const devoluciones = await devolucionesDeManana(ahora);
    const base = publicBaseUrl();
    return {
      enviados: 0,
      devoluciones,
      mensajes: devoluciones.map((d) => mensajeRecordatorio(d, base))
    };
  }
);
