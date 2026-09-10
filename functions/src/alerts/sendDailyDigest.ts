/**
 * El correo de la tarde con lo que hay que hacer mañana.
 *
 * ⚠️ **Existe porque el panel solo avisa si alguien entra.** Las tarjetas de
 * «próximos a vencer» y «firma pendiente» ya están, y son correctas — pero un
 * aviso que solo existe cuando abres la aplicación no avisa de nada el día que
 * no la abres, que es justo el día en que hace falta.
 *
 * ⚠️ **Sale a las 9:00 y cuenta lo de MAÑANA**, no lo de hoy. Decisión de Dorel
 * del 10 de septiembre de 2026, corrigiendo una primera versión que lo mandaba a
 * las 20:00: *«20:00 es muy tarde y si hay que hacer cosas antes no me da
 * tiempo»*. Y es el criterio bueno — lo que hace falta no es enterarse pronto,
 * es tener **jornada por delante** para resolverlo: si mañana a las nueve hay
 * una entrega sin contrato firmado, a las 20:00 de hoy ya no se puede llamar al
 * cliente ni pasar por ningún sitio. A las 9:00, queda el día entero.
 */

import * as functions from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { firestore } from '../admin-guard';
import { companyConfig } from '../company-config';
import {
  asuntoDe,
  horaEn,
  mereceEnvio,
  rangoManana,
  type MovimientoReserva,
  type Resumen,
  type VencimientoVehiculo
} from './daily-digest';
import { renderDigestEmail } from './digest-email';

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const RESEND_API_URL = 'https://api.resend.com/emails';

/** A cuántos días vista se avisa de una ITV o un mantenimiento. */
const VENCIMIENTO_DIAS = 30;

/** Fecha de Firestore → `Date`, venga como venga. */
function aFecha(valor: unknown): Date | null {
  if (!valor) return null;
  const v = valor as { toDate?: () => Date; seconds?: number };
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  const d = new Date(valor as string);
  return isNaN(d.getTime()) ? null : d;
}

function etiquetaVehiculo(snap: Record<string, unknown> | undefined): string {
  if (!snap) return '—';
  const partes = [snap['brand'], snap['model']].filter(Boolean).join(' ');
  const matricula = snap['plateNumber'];
  return matricula ? `${partes} · ${matricula}` : partes || '—';
}

/**
 * Reúne lo de mañana.
 *
 * Exportada para poder dispararla a mano desde el callable de prueba: un correo
 * que solo se puede ver esperando a las ocho de la tarde no se puede depurar.
 */
export async function construirResumen(ahora = new Date()): Promise<Resumen> {
  const db = firestore();
  const { desde, hasta, etiqueta } = rangoManana(ahora);

  /**
   * ⚠️ **Se filtran los estados en memoria, no en la consulta.** Firestore no
   * admite una desigualdad sobre `pickupDateTime` junto a un `in` sobre
   * `status` sin un índice compuesto por cada combinación, y el volumen de un
   * día son unas pocas reservas: no compensa un índice por cada lista.
   */
  const [entregasSnap, devolucionesSnap] = await Promise.all([
    db
      .collection('reservations')
      .where('pickupDateTime', '>=', desde)
      .where('pickupDateTime', '<', hasta)
      .get(),
    db
      .collection('reservations')
      .where('returnDateTime', '>=', desde)
      .where('returnDateTime', '<', hasta)
      .get()
  ]);

  const entregas: MovimientoReserva[] = [];
  for (const doc of entregasSnap.docs) {
    const r = doc.data();
    // Una cancelada no se entrega, y una ya entregada tampoco vuelve a serlo.
    if (r['status'] === 'cancelled' || r['status'] === 'delivered') continue;
    if (r['status'] === 'returned' || r['status'] === 'closed') continue;
    const cuando = aFecha(r['pickupDateTime']);
    entregas.push({
      reservationId: doc.id,
      hora: cuando ? horaEn(cuando) : '—',
      cliente: String((r['clientSnapshot'] as Record<string, unknown>)?.['fullName'] ?? '—'),
      telefono: (r['clientSnapshot'] as Record<string, unknown>)?.['phone'] as string | undefined,
      vehiculo: etiquetaVehiculo(r['vehicleSnapshot'] as Record<string, unknown>),
      /**
       * ⚠️ **Va DENTRO de la entrega, no en una lista aparte.** Duplicar la
       * misma reserva en dos bloques hace que se lean los dos por encima; el
       * aviso sirve donde está el dato que hay que mirar.
       */
      contratoSinFirmar: r['contractStatus'] !== 'signed'
    });
  }

  const devoluciones: MovimientoReserva[] = [];
  for (const doc of devolucionesSnap.docs) {
    const r = doc.data();
    if (r['status'] === 'cancelled' || r['status'] === 'closed') continue;
    // Todavía no se ha entregado: su devolución no es cosa de mañana.
    if (r['status'] === 'reserved' || r['status'] === 'confirmed') continue;
    const cuando = aFecha(r['returnDateTime']);
    devoluciones.push({
      reservationId: doc.id,
      hora: cuando ? horaEn(cuando) : '—',
      cliente: String((r['clientSnapshot'] as Record<string, unknown>)?.['fullName'] ?? '—'),
      telefono: (r['clientSnapshot'] as Record<string, unknown>)?.['phone'] as string | undefined,
      vehiculo: etiquetaVehiculo(r['vehicleSnapshot'] as Record<string, unknown>)
    });
  }

  /**
   * Los vencimientos de la flota: ITV, seguro, revisiones.
   *
   * ⚠️ **Se ordenan en memoria.** `nextDueDate` es opcional, y un `orderBy`
   * sobre un campo opcional deja fuera a los documentos que no lo tienen sin
   * avisar — es lo que hizo desaparecer una reparación de la ficha de un coche
   * (M-40).
   */
  const mantenimientoSnap = await db
    .collection('vehicleMaintenance')
    .where('status', 'in', ['pending', 'scheduled', 'overdue'])
    .get();

  const limite = new Date(hasta.getTime() + VENCIMIENTO_DIAS * 86_400_000);
  const vencimientos: VencimientoVehiculo[] = [];
  for (const doc of mantenimientoSnap.docs) {
    const m = doc.data();
    const cuando = aFecha(m['nextDueDate']);
    if (!cuando || cuando > limite) continue;
    vencimientos.push({
      vehiculo: etiquetaVehiculo(m['vehicleSnapshot'] as Record<string, unknown>),
      concepto: String(m['title'] || m['type'] || '—'),
      // ⚠️ Con `2-digit`: el formato por defecto de `es-ES` da «11/9/2026» y la
      // cabecera del correo dice «11/09/2026». Dos formatos de fecha en el
      // mismo correo se leen como un error, aunque digan lo mismo.
      fecha: new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(cuando),
      diasRestantes: Math.round((cuando.getTime() - ahora.getTime()) / 86_400_000)
    });
  }
  vencimientos.sort((a, b) => a.diasRestantes - b.diasRestantes);

  entregas.sort((a, b) => a.hora.localeCompare(b.hora));
  devoluciones.sort((a, b) => a.hora.localeCompare(b.hora));

  return {
    fecha: etiqueta,
    entregas,
    devoluciones,
    vencimientos,
    sinFirmar: entregas.filter((e) => e.contratoSinFirmar).length
  };
}

/** Manda el correo si hay algo que contar. Devuelve qué hizo y por qué. */
export async function enviarResumen(
  apiKey: string | undefined,
  ahora = new Date()
): Promise<{ enviado: boolean; motivo?: string; asunto?: string; resumen: Resumen }> {
  const resumen = await construirResumen(ahora);

  if (!mereceEnvio(resumen)) {
    // No es un fallo: es que mañana no hay nada. Ver `mereceEnvio()`.
    return { enviado: false, motivo: 'sin novedades', resumen };
  }
  if (!apiKey) {
    functions.logger.error('Resumen diario: falta RESEND_API_KEY');
    return { enviado: false, motivo: 'sin RESEND_API_KEY', resumen };
  }

  const company = companyConfig();
  const asunto = asuntoDe(resumen, company.brandName);
  const { html, text } = renderDigestEmail(resumen, company);

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // ⚠️ Resend solo acepta remitentes de un dominio verificado, y el correo
      // de la empresa cambia con el entorno: sale del `.env`, no del código.
      from: company.email,
      to: [company.email],
      subject: asunto,
      html,
      text
    })
  });

  if (!res.ok) {
    const body = await res.text();
    functions.logger.error('Resumen diario: Resend rechazó el envío', { status: res.status, body });
    return { enviado: false, motivo: `resend ${res.status}`, asunto, resumen };
  }

  functions.logger.info('Resumen diario enviado', {
    asunto,
    entregas: resumen.entregas.length,
    devoluciones: resumen.devoluciones.length,
    sinFirmar: resumen.sinFirmar,
    vencimientos: resumen.vencimientos.length
  });
  return { enviado: true, asunto, resumen };
}

/**
 * A las 9:00 de Madrid, todos los días, con lo del día siguiente.
 *
 * ⚠️ **`timeZone` no es decorativo.** Sin ella la programación es UTC y el
 * correo saldría a las 10:00 o a las 11:00 según la época del año, corriéndose
 * solo dos veces al año sin que nadie tocara nada.
 */
export const sendDailyDigest = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Europe/Madrid',
    secrets: [RESEND_API_KEY]
  },
  async () => {
    try {
      await enviarResumen(RESEND_API_KEY.value());
    } catch (err) {
      // Que falle una tarde no puede tumbar la siguiente.
      functions.logger.error('Resumen diario: falló', { err });
    }
  }
);

/**
 * Ver el resumen ahora, sin esperar a las ocho.
 *
 * ⚠️ **Con `enviar: true` manda el correo de verdad.** Sirve para comprobar lo
 * que no se puede leer en un log: cómo se ve en el móvil. Por defecto solo
 * devuelve lo que habría mandado.
 */
export const previewDailyDigest = functions.https.onCall(
  { secrets: [RESEND_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }
    const enviar = (request.data as { enviar?: boolean })?.enviar === true;
    if (!enviar) {
      const resumen = await construirResumen();
      const company = companyConfig();
      return {
        enviado: false,
        motivo: mereceEnvio(resumen) ? 'solo vista previa' : 'sin novedades',
        asunto: mereceEnvio(resumen) ? asuntoDe(resumen, company.brandName) : undefined,
        resumen
      };
    }
    return enviarResumen(RESEND_API_KEY.value());
  }
);
