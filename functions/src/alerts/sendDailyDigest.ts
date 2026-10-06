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

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { CONSULTA_HORAS_POR_DEFECTO } from '../public/contact-core';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { firestore } from '../admin-guard';
// ⚠️ El `toDate()` de la web pública, que devuelve null ante una fecha ilegible
// en vez de la de hoy. Aquí eso es lo correcto: una solicitud con la fecha rota
// no se borra sola, se queda para que alguien la mire.
import { toDate } from '../public/core';
import { companyConfig } from '../company-config';
import {
  asuntoDe,
  entraEnElResumen,
  horaEn,
  mereceEnvio,
  rangoManana,
  type MovimientoReserva,
  type Resumen,
  type SolicitudSinContestar,
  type VencimientoVehiculo
} from './daily-digest';
import { renderDigestEmail } from './digest-email';
import { avisosDelSistema, type AvisoSistema } from './system-alerts';
// ⚠️ `verifactu-client` se carga al mirar el certificado, no al arrancar: trae
// `node-forge` (34 ms, 42 módulos). Ver la nota de `sendVerifactuRecords.ts`.
import { verifactuEnabled, verifactuEndpoint } from '../invoices/verifactu';
import type { Remision } from '../invoices/verifactu-submission';
import { asuntoDeCorreo } from '../entorno';

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
/**
 * El certificado de la FNMT, aquí solo para mirarle la fecha de caducidad.
 *
 * ⚠️ **Un secret hay que DECLARARLO en la function que lo usa**, no basta con
 * que exista en Secret Manager: si no aparece aquí, `process.env` sale
 * `undefined` y el código se va por la rama del «no está configurado», en
 * silencio y con el despliegue en verde.
 */
const VELTO_SIGNING_CERT = defineSecret('VELTO_SIGNING_CERT');
const VELTO_SIGNING_CERT_PASSWORD = defineSecret('VELTO_SIGNING_CERT_PASSWORD');
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
 * Lo que no sale de ninguna reserva: el certificado y la remisión a la AEAT.
 *
 * ⚠️ **Solo tiene sentido donde se remite.** En un entorno con
 * `VELTO_VERIFACTU_ENABLED=false` no hay nada que remitir y el certificado no se
 * usa para nada, así que avisar de su caducidad sería mandar a resolver un
 * problema que no existe. Hoy eso es producción, hasta el 1 de enero.
 *
 * ⚠️ **Y nunca tumba el correo.** Si la comprobación del certificado falla —la
 * red, un secret sin poner, un `.p12` que no abre— se registra y se sigue: el
 * resumen de mañana tiene que salir igual. Perder el aviso del certificado es un
 * problema; perder las entregas del día siguiente, uno peor.
 */
export async function construirAvisos(
  p12Base64?: string,
  passphrase?: string
): Promise<AvisoSistema[]> {
  if (!verifactuEnabled()) return [];

  const db = firestore();
  let remisiones: Remision[] = [];
  try {
    const snap = await db.collection('verifactuSubmissions').get();
    remisiones = snap.docs.map((d) => d.data() as Remision);
  } catch (e) {
    logger.error('Resumen diario: no se pudo leer verifactuSubmissions', e);
  }

  let dias: number | undefined;
  try {
    const { certificadoDesdeSecreto, probarConexion } = await import(
      '../invoices/verifactu-client'
    );
    const certificado = certificadoDesdeSecreto(p12Base64, passphrase);
    const prueba = await probarConexion(verifactuEndpoint(), certificado);
    dias = prueba.diasParaCaducar;
  } catch (e) {
    logger.error('Resumen diario: no se pudo leer el certificado', e);
  }

  return avisosDelSistema(dias, remisiones);
}

/**
 * Reúne lo de mañana.
 *
 * Exportada para poder dispararla a mano desde el callable de prueba: un correo
 * que solo se puede ver esperando a las ocho de la tarde no se puede depurar.
 */
export async function construirResumen(
  ahora = new Date(),
  avisos: AvisoSistema[] = []
): Promise<Resumen> {
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
    /*
     * ⚠️ **Y no basta con estar dentro de la ventana: hay que tocar HOY.** Sin
     * esto, un vencimiento a 30 días salía en treinta correos seguidos, y la
     * sección se convertía en ruido que se salta — justo el día que urge
     * incluido. Ver `entraEnElResumen()`.
     */
    const dias = Math.round((cuando.getTime() - ahora.getTime()) / 86_400_000);
    if (!entraEnElResumen(dias, VENCIMIENTO_DIAS)) continue;
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
      diasRestantes: Math.round((cuando.getTime() - ahora.getTime()) / 86_400_000),
      /**
       * ⚠️ **Copia FIEL de `BLOCKING_MAINTENANCE_TYPES`** (la app,
       * `vehicle-availability.util.ts`), que es quien de verdad impide alquilar.
       * Si allí se añade un concepto, aquí también — o el correo volverá a
       * decir lo contrario que la aplicación.
       */
      bloquea: m['type'] === 'itv' || m['type'] === 'insurance'
    });
  }
  vencimientos.sort((a, b) => a.diasRestantes - b.diasRestantes);

  /**
   * Las solicitudes que nadie ha contestado.
   *
   * ⚠️ **Entran en el resumen porque ahora se BORRAN**, y un borrado sin aviso
   * convierte una posible venta en una pérdida silenciosa. Con 72 horas de
   * plazo, una solicitud sale en tres resúmenes antes de desaparecer: eso es lo
   * que hace que borrarlas sea razonable.
   *
   * ⚠️ **Y se ordenan por lo que les QUEDA, no por cuándo llegaron.** Lo que
   * hay que llamar hoy es lo que se va mañana, no lo más reciente.
   */
  const solicitudesSnap = await db
    .collection('bookingRequests')
    .where('status', '==', 'new')
    .get();

  const sinContestar: SolicitudSinContestar[] = [];
  for (const doc of solicitudesSnap.docs) {
    const s = doc.data();
    const creada = aFecha(s['createdAt']);
    if (!creada) continue;
    const horasRestantes = Math.round(
      HORAS_SIN_CONTESTAR - (ahora.getTime() - creada.getTime()) / 3_600_000
    );
    const v = (s['vehicleSnapshot'] ?? {}) as Record<string, unknown>;
    sinContestar.push({
      referencia: String(s['reference'] || '—'),
      cliente: String(s['name'] || '—'),
      telefono: String(s['phone'] || '—'),
      coche: `${v['brand'] ?? ''} ${v['model'] ?? ''}`.trim() || '—',
      horasRestantes
    });
  }
  sinContestar.sort((a, b) => a.horasRestantes - b.horasRestantes);

  entregas.sort((a, b) => a.hora.localeCompare(b.hora));
  devoluciones.sort((a, b) => a.hora.localeCompare(b.hora));

  return {
    fecha: etiqueta,
    entregas,
    devoluciones,
    vencimientos,
    sinContestar,
    sinFirmar: entregas.filter((e) => e.contratoSinFirmar).length,
    avisos
  };
}

/** Manda el correo si hay algo que contar. Devuelve qué hizo y por qué. */
export async function enviarResumen(
  apiKey: string | undefined,
  ahora = new Date(),
  cert?: { p12Base64?: string; passphrase?: string }
): Promise<{ enviado: boolean; motivo?: string; asunto?: string; resumen: Resumen }> {
  const avisos = await construirAvisos(cert?.p12Base64, cert?.passphrase);
  const resumen = await construirResumen(ahora, avisos);

  if (!mereceEnvio(resumen)) {
    // No es un fallo: es que mañana no hay nada. Ver `mereceEnvio()`.
    return { enviado: false, motivo: 'sin novedades', resumen };
  }
  if (!apiKey) {
    logger.error('Resumen diario: falta RESEND_API_KEY');
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
      subject: asuntoDeCorreo(asunto),
      html,
      text
    })
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error('Resumen diario: Resend rechazó el envío', { status: res.status, body });
    return { enviado: false, motivo: `resend ${res.status}`, asunto, resumen };
  }

  logger.info('Resumen diario enviado', {
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
    secrets: [RESEND_API_KEY, VELTO_SIGNING_CERT, VELTO_SIGNING_CERT_PASSWORD]
  },
  async () => {
    try {
      await enviarResumen(RESEND_API_KEY.value(), new Date(), {
        // ⚠️ Se leen DENTRO del handler. En el módulo se evaluarían antes de que
        // el runtime resuelva los secrets, y saldrían vacíos (F-12).
        p12Base64: VELTO_SIGNING_CERT.value(),
        passphrase: VELTO_SIGNING_CERT_PASSWORD.value()
      });
    } catch (err) {
      // Que falle una tarde no puede tumbar la siguiente.
      logger.error('Resumen diario: falló', { err });
    }

    /**
     * ⚠️ **La limpieza va AQUÍ y no en una function programada propia**, y es
     * una decisión de coste: estrenar un `onSchedule` nuevo en producción
     * activaría Cloud Scheduler allí —hoy no está: las cinco de la AEAT, que
     * son las que lo usan, no están desplegadas— y sería un servicio más en la
     * factura de Google. Esta ya corre a las nueve en los dos proyectos.
     *
     * Va **fuera del `try` del resumen**: que falle el correo no puede dejar
     * datos personales sin borrar, ni al revés.
     *
     * ⚠️ **Y va DESPUÉS, que desde el 5 de octubre de 2026 no es indiferente.**
     * El resumen nombra las solicitudes sin contestar con lo que les queda, y
     * con 72 horas de plazo y un correo al día eso son **tres** avisos antes de
     * que el barrido se las lleve. Barriendo primero, la última —la que sale
     * como «ÚLTIMO DÍA»— desaparecería antes de que el correo la nombrara, y el
     * aviso que justifica el borrado se perdería justo en la vuelta que
     * importa. Los dos bloques parecen independientes y no lo son del todo.
     */
    try {
      const borradas = await limpiarSolicitudesCaducadas(new Date());
      if (borradas) logger.info('Solicitudes caducadas borradas', { borradas });
    } catch (err) {
      logger.error('No se pudieron limpiar las solicitudes', { err });
    }

    /*
     * ⚠️ **En su propio `try`, no dentro del de arriba.** Si el barrido de las
     * solicitudes fallara, el de las consultas tiene que correr igualmente: lo
     * contrario dejaría datos personales sin borrar **y** con un plazo
     * publicado en `/privacidad` diciendo que se borran. Es la misma razón por
     * la que la limpieza entera va fuera del `try` del resumen.
     */
    try {
      const borradas = await limpiarConsultasCaducadas(new Date());
      if (borradas) logger.info('Consultas de contacto borradas', { borradas });
    } catch (err) {
      logger.error('No se pudieron limpiar las consultas', { err });
    }
  }
);

/**
 * Los cuatro estados que el barrido puede borrar — o sea, todos.
 *
 * ⚠️ **`new` entró el 5 de octubre de 2026, y hasta ese día la regla era la
 * contraria.** Aquí ponía que lo que sigue en `new` no se borra nunca: una
 * solicitud sin atender es trabajo pendiente, y la que entra un viernes a las
 * 23:40 no puede desaparecer el sábado sin que se distinga «no escribió nadie»
 * de «se me pasaron tres». Decisión de Dorel ese día: se borran igual a las 72
 * h. Lo que hace que el argumento viejo ya no aplique son **dos** cosas, y las
 * dos tienen que seguir siendo ciertas: el plazo es más largo que el de las
 * atendidas (72 h frente a 24) y el resumen de las 9:00 las **nombra** cada
 * mañana con lo que les queda. Quitando cualquiera de las dos, esto vuelve a
 * ser un borrado silencioso de trabajo pendiente.
 *
 * ⚠️ **La lista se queda aunque hoy estén los cuatro estados.** Es lo que hace
 * que un estado nuevo —uno que signifique «en negociación», por ejemplo— no
 * empiece a borrarse solo por existir: entrar aquí hay que escribirlo.
 *
 * ⚠️ **El plazo de las atendidas se lee de la PROPIA solicitud** (`keepHours`),
 * congelado al crearla, no de Ajustes. Cambiar el ajuste no puede mover la
 * caducidad de las que ya existen: es la misma regla que congela el IVA en
 * `pricingSnapshot`. El de las sin contestar es una constante — ver
 * `HORAS_SIN_CONTESTAR`.
 */
export const ESTADOS_BORRABLES = ['new', 'contacted', 'discarded', 'converted'] as const;

/**
 * Lo que se espera a una solicitud que **nadie ha contestado**, antes de
 * borrarla.
 *
 * ⚠️ **Hasta el 5 de octubre de 2026 no se borraban NUNCA.** El argumento era
 * bueno —una solicitud sin atender es trabajo pendiente, y perderla es perder
 * un alquiler— y se quedaba corto por el otro lado: lo que no se contesta nunca
 * acaba siendo un nombre y un teléfono de alguien guardados para siempre, y la
 * política de privacidad no lo cubría. Decisión de Dorel ese día: 72 horas.
 *
 * ⚠️ **Y 72 h son TRES avisos antes de borrar**, no uno. El resumen de las 9:00
 * las lista cada mañana, así que una solicitud sin contestar sale en tres
 * correos antes de desaparecer. Eso es lo que hace que borrarlas sea razonable
 * y no una pérdida silenciosa: con 24 h habría casos de llegar un viernes por
 * la noche y no verse nunca.
 *
 * ⚠️ **Es una constante y no un ajuste, a propósito.** Un plazo de borrado de
 * datos personales editable desde una pantalla es un número que se puede bajar
 * a 1 por error y llevarse el trabajo de la semana; cambiarlo aquí pide un
 * despliegue, que es exactamente la fricción que conviene. El de las atendidas
 * sí es ajuste porque va **congelado en cada solicitud** al crearla, así que
 * tocarlo no afecta a las que ya existen; esto se lee al barrer y sí las
 * afectaría a todas.
 */
export const HORAS_SIN_CONTESTAR = 72;

/**
 * ¿Se puede borrar ya esta solicitud?
 *
 * ⚠️ **Pura y aparte, como `blockingMaintenance()`.** Esto decide un borrado
 * definitivo de datos personales, corre una vez al día sin nadie delante y no
 * tenía **ni un test**: lo único que impedía que se llevara trabajo pendiente
 * era un `where` que nadie comprobaba. Con la regla fuera de la consulta se
 * puede probar sin Firestore, que es la única forma de cubrir los casos raros.
 *
 * ⚠️ **En la duda NO se borra.** Sin fecha desde la que contar, o con un
 * `keepHours` ilegible, se conserva: un dato de más se puede borrar mañana, y
 * uno borrado no vuelve.
 *
 * ⚠️ **Y mientras el precio siga PROMETIDO, tampoco.** Este es el fallo que
 * encontró la revisión del 29 de septiembre de 2026 y que costaría un alquiler:
 * el botón «Ampliar 24 h» alarga lo que se le dice al cliente —«te mantengo el
 * precio hasta el jueves»— y **no alargaba el registro que sostiene esa
 * promesa**. Con los plazos por defecto, una solicitud contactada el lunes y
 * ampliada hasta el jueves se borraba el miércoles: el cliente llamaba dentro
 * de su plazo citando la referencia y aquí no había nada. Los dos plazos son
 * ajustes independientes —`bookingRequestPriceHours` llega a 720 h y
 * `bookingRequestKeepHours` baja a 1—, así que no basta con que «suelan»
 * cuadrar: la aplicación no puede borrar aquello a lo que ella misma sigue
 * comprometida.
 */
export function solicitudCaducada(d: Record<string, unknown>, ahora: Date): boolean {
  /**
   * ⚠️ **Las sin contestar cuentan desde que LLEGARON, no desde que se
   * atendieron**, que es lo obvio en cuanto se dice: no las ha atendido nadie.
   * Y con su propio plazo, que es más largo — ver `HORAS_SIN_CONTESTAR`.
   */
  const sinContestar = d['status'] === 'new';

  const desde = sinContestar
    ? toDate(d['createdAt'])
    : toDate(d['handledAt']) || toDate(d['createdAt']);
  if (!desde) return false;

  const horas = sinContestar ? HORAS_SIN_CONTESTAR : Number(d['keepHours']);
  if (!isFinite(horas) || horas <= 0) return false;
  if (ahora.getTime() - desde.getTime() < horas * 60 * 60 * 1000) return false;

  const garantia = toDate(d['priceGuaranteedUntil']);
  if (garantia && garantia.getTime() > ahora.getTime()) return false;

  return true;
}

/**
 * Borra las solicitudes de la web que ya cumplieron su plazo.
 *
 * ⚠️ **Se llamaba `limpiarSolicitudesAtendidas` y el nombre pasó a mentir** el
 * día que `new` entró en `ESTADOS_BORRABLES`: desde entonces también se lleva
 * las que no ha atendido nadie, que son justo las que más duele perder. Un
 * nombre que dice menos de lo que la función hace es el que deja a alguien
 * tranquilo al leer la llamada.
 */
export async function limpiarSolicitudesCaducadas(ahora: Date): Promise<number> {
  const db = firestore();
  const snap = await db
    .collection('bookingRequests')
    .where('status', 'in', [...ESTADOS_BORRABLES])
    .get();

  let borradas = 0;
  let lote = db.batch();
  let enLote = 0;

  for (const doc of snap.docs) {
    if (!solicitudCaducada(doc.data(), ahora)) continue;

    lote.delete(doc.ref);
    borradas++;
    // Un `writeBatch` admite 500 operaciones.
    if (++enLote === 400) {
      await lote.commit();
      lote = db.batch();
      enLote = 0;
    }
  }
  if (enLote) await lote.commit();
  return borradas;
}

/**
 * ¿Se puede borrar ya este mensaje de contacto?
 *
 * ⚠️ **Al revés que una solicitud de reserva, aquí SÍ se borra por antigüedad
 * a secas**, sin mirar el estado. Y es deliberado: una solicitud sin atender es
 * trabajo pendiente y perderla es perder un alquiler, pero de un mensaje de
 * contacto **ya salió un correo** en el instante en que se envió — Dorel lo
 * tiene en su bandeja, y él mismo dijo que si hace falta más tiempo se queda
 * con el correo. Lo que se borra aquí es la copia, no el original.
 *
 * ⚠️ **El plazo se lee del PROPIO mensaje** (`keepHours`), congelado al
 * crearlo, no de una constante leída al barrer. Es lo que permite ampliarlo
 * para uno concreto sin mover los demás, y la misma regla que congela el IVA en
 * `pricingSnapshot`: cambiar el ajuste no puede mover lo que ya existe.
 *
 * ⚠️ **Y en la duda NO se borra.** Sin fecha desde la que contar, o con un
 * `keepHours` ilegible, se conserva: un dato de más se puede borrar mañana, y
 * uno borrado no vuelve.
 */
export function consultaCaducada(d: Record<string, unknown>, ahora: Date): boolean {
  const creada = toDate(d['createdAt']);
  if (!creada) return false;

  const horas = Number(d['keepHours'] ?? CONSULTA_HORAS_POR_DEFECTO);
  if (!isFinite(horas) || horas <= 0) return false;

  return ahora.getTime() - creada.getTime() >= horas * 60 * 60 * 1000;
}

/**
 * Borra los mensajes de contacto que ya han cumplido su plazo.
 *
 * ⚠️ **Sin esto, la política de privacidad sería falsa desde el primer día.**
 * El barrido de arriba mira SOLO `bookingRequests`; una colección nueva no la
 * limpia nadie, y eso no falla en ninguna parte — simplemente los datos se
 * quedan ahí para siempre.
 *
 * ⚠️ **Corre una vez al día, a las nueve**, así que entre que se cumplen las 24
 * horas y el mensaje desaparece pueden pasar unas horas más. La página de
 * privacidad lo dice con esas palabras: publicar «24 horas» a secas sería
 * publicar algo que no se cumple exactamente.
 */
export async function limpiarConsultasCaducadas(ahora: Date): Promise<number> {
  const db = firestore();
  // Sin `where`: son pocos documentos por definición —se borran a diario— y
  // filtrar por fecha en la consulta exigiría un índice que ataría el barrido a
  // que esté construido. Es la misma decisión que el límite por teléfono.
  const snap = await db.collection('contactRequests').get();

  let borradas = 0;
  let lote = db.batch();
  let enLote = 0;

  for (const doc of snap.docs) {
    if (!consultaCaducada(doc.data(), ahora)) continue;

    lote.delete(doc.ref);
    borradas++;
    if (++enLote === 400) {
      await lote.commit();
      lote = db.batch();
      enLote = 0;
    }
  }
  if (enLote) await lote.commit();
  return borradas;
}

/**
 * Ver el resumen ahora, sin esperar a las ocho.
 *
 * ⚠️ **Con `enviar: true` manda el correo de verdad.** Sirve para comprobar lo
 * que no se puede leer en un log: cómo se ve en el móvil. Por defecto solo
 * devuelve lo que habría mandado.
 */
export const previewDailyDigest = onCall(
  { secrets: [RESEND_API_KEY, VELTO_SIGNING_CERT, VELTO_SIGNING_CERT_PASSWORD] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }
    // ⚠️ La vista previa monta los mismos secrets que el envío de verdad. Si no,
    // enseñaría un correo sin el aviso del certificado y el primero con aviso
    // sería el que sale solo a las nueve, que es el que no se puede ensayar.
    const cert = {
      p12Base64: VELTO_SIGNING_CERT.value(),
      passphrase: VELTO_SIGNING_CERT_PASSWORD.value()
    };
    const enviar = (request.data as { enviar?: boolean })?.enviar === true;
    if (!enviar) {
      const avisos = await construirAvisos(cert.p12Base64, cert.passphrase);
      const resumen = await construirResumen(new Date(), avisos);
      const company = companyConfig();
      return {
        enviado: false,
        motivo: mereceEnvio(resumen) ? 'solo vista previa' : 'sin novedades',
        asunto: mereceEnvio(resumen) ? asuntoDe(resumen, company.brandName) : undefined,
        resumen
      };
    }
    return enviarResumen(RESEND_API_KEY.value(), new Date(), cert);
  }
);
