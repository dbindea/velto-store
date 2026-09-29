/**
 * Qué se puede hacer con una solicitud, y qué se le dice al cliente.
 *
 * Pieza pura: la pantalla apaga o explica cada botón preguntándole, y el
 * servicio le pregunta lo mismo antes de escribir. Es el mismo reparto que
 * `reservation-edit.util.ts` — dos autoridades acabarían discrepando, y
 * entonces la pantalla deja hacer algo que el servicio rechaza.
 */

import type { BookingRequest, BookingRequestStatus } from '@shared/models/booking-request.model';
import { toDate } from './reservation-date.util';

/**
 * ¿Sigue en pie el precio que se le prometió?
 *
 * ⚠️ **Caducar el precio NO caduca la solicitud.** El teléfono sigue sirviendo
 * y la llamada sigue mereciendo la pena: lo único que ha dejado de sostenerse
 * es la cifra. Confundirlos haría desaparecer clientes por una fecha.
 */
export function priceStillGuaranteed(r: BookingRequest, now: Date = new Date()): boolean {
  const hasta = r.priceGuaranteedUntil ? toDate(r.priceGuaranteedUntil) : null;
  if (!hasta || isNaN(hasta.getTime())) return false;
  return hasta.getTime() > now.getTime();
}

/**
 * La hora que se supone cuando el cliente no dijo ninguna.
 *
 * ⚠️ **El formulario de la web pide FECHAS, no horas**, y lo que se guarda es
 * la **ventana de disponibilidad**: `widenToFullDays()` la ensancha a días
 * completos, así que `pickupDate` son las 00:00 y `returnDate` las 23:59:59.
 * Eso es correcto para cruzarla con las reservas y **mentira** como hora de
 * entrega: la ficha decía «02/11/2026 – 09/11/2026» sin más, y al convertir
 * llevaba al asistente una recogida a las 00:00 y una devolución a las 23:59.
 *
 * Mediodía es la respuesta honesta a «no se dijo»: cae dentro del horario de la
 * oficina, no da la madrugada por buena y es lo que el operador va a pactar por
 * teléfono de todos modos. Decisión de Dorel del 29 de septiembre de 2026.
 */
export const DEFAULT_REQUEST_HOUR = 12;

function alMediodia(valor: unknown): Date | null {
  if (!valor) return null;
  const d = toDate(valor);
  if (isNaN(d.getTime())) return null;
  /**
   * ⚠️ Se reconstruye el día en hora local, no se mueve la hora sobre el mismo
   * objeto. `returnDate` son las 23:59:59.999: poniéndole las 12:00 con
   * `setHours()` el día no cambia, pero los milisegundos sí quedarían dentro —
   * y una fecha con `.999` viaja al asistente y se ve en el campo.
   */
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), DEFAULT_REQUEST_HOUR, 0, 0, 0);
}

/** Cuándo recogería, si no se pacta otra cosa. */
export function requestPickupAt(r: BookingRequest): Date | null {
  return alMediodia(r.pickupDate);
}

/** Cuándo devolvería, si no se pacta otra cosa. */
export function requestReturnAt(r: BookingRequest): Date | null {
  return alMediodia(r.returnDate);
}

/**
 * Hasta cuándo quedaría el precio garantizado al ampliarlo.
 *
 * ⚠️ **Se cuenta desde AHORA cuando ya caducó**, no desde la fecha vieja. El
 * caso normal es justo ese —«se le pasó el plazo y lo amplío mientras se lo
 * piensa»—, y sumando sobre lo vencido una ampliación de 24 h podría dejar la
 * promesa **todavía en el pasado**: el operador pulsaría, el aviso seguiría
 * diciendo «caducado» y parecería que el botón no hace nada.
 *
 * ⚠️ **Y si aún está en pie se suma a lo prometido**, no a hoy: al cliente se
 * le dijo una fecha y ampliar no puede recortarla.
 */
export function extendedGuaranteeUntil(
  current: Date | null,
  hours: number,
  now: Date = new Date()
): Date {
  const desde = current && current.getTime() > now.getTime() ? current : now;
  return new Date(desde.getTime() + hours * 3_600_000);
}

/**
 * ¿Tiene sentido ampliarle el plazo?
 *
 * Una convertida ya es una reserva con su precio congelado, y una descartada no
 * espera respuesta: prometerle nada a ninguna de las dos es prometer al vacío.
 */
export function canExtendGuarantee(r: BookingRequest): boolean {
  return r.status === 'new' || r.status === 'contacted';
}

/**
 * ¿Se puede convertir en reserva?
 *
 * ⚠️ **Una ya convertida no se convierte dos veces.** Sin esto, dos clics
 * seguidos —o dos pestañas abiertas— crearían dos reservas del mismo coche para
 * las mismas fechas, y la segunda bloquearía un coche que nadie pidió. Es la
 * misma lección que la reserva que no se asigna dos veces a un colaborador.
 */
export function canConvert(r: BookingRequest): boolean {
  return r.status !== 'converted' && r.status !== 'discarded';
}

/**
 * ⚠️ **Una convertida no se descarta; una descartada tampoco se re-descarta.**
 * Lo segundo parece inofensivo y no lo es: `marcar()` reescribe `handledAt`, y
 * ese sello es el que arranca el plazo de borrado — volver a pulsar «Descartar»
 * **aplaza 24 horas más** el borrado del nombre y el teléfono de alguien a quien
 * ya se decidió no atender.
 */
export function canDiscard(r: BookingRequest): boolean {
  return r.status !== 'converted' && r.status !== 'discarded';
}

/**
 * ¿Se puede marcar como contactada?
 *
 * Solo lo que está **sin contestar**: una ya contactada no se vuelve a
 * contactar —volvería a mover `handledAt` y con él el plazo de borrado— y una
 * convertida o descartada ya salió de la lista de trabajo.
 */
export function canMarkContacted(r: BookingRequest): boolean {
  return r.status === 'new';
}

/**
 * El mensaje de WhatsApp, ya redactado.
 *
 * ⚠️ **El texto es de Dorel** (29 de septiembre de 2026). Lo escribió él y se
 * pone tal cual: quien conoce a sus clientes y sabe cómo se les habla es el que
 * llama, no esto. Lo único que aporta el código son los cuatro datos que cambian
 * —nombre, coche, días y precio— y la marca.
 *
 * La única corrección sobre su redacción es «del alquiler **del** coche», que
 * él mismo aprobó: sin el artículo la frase no concuerda, y esto lo lee un
 * cliente. Cualquier otro retoque es suyo — y ahora, además, el campo se edita
 * antes de enviar.
 *
 * ⚠️ **Identifica el alquiler por el COCHE, los días y el precio, no por la
 * referencia.** Aquí llevó `P-4K7M9X` dentro con el argumento de que ataba la
 * conversación a lo que el cliente pidió, y es al revés: un código no le dice
 * nada a quien recibe el mensaje —«Citroën Berlingo · 7 días · 440,44 €» sí, y
 * es exactamente lo que vio en la web—. La referencia sigue en la ficha, que es
 * donde sirve: para que el operador la cite si hace falta.
 *
 * ⚠️ **Y no promete el coche.** «¿Deseas finalizar la reserva?» dice justo lo
 * que la web dejó claro: que todavía no hay reserva. Un WhatsApp que diga «te lo
 * guardo» convierte en falso lo que el cliente leyó, y hay test de eso.
 *
 * ⚠️ **Es un BORRADOR, no el mensaje final.** Lo que se manda es lo que haya en
 * el campo de la ficha, que el operador puede reescribir entero antes de
 * enviarlo: fue la decisión de Dorel —«redactado y editable antes de enviar»— y
 * tiene su motivo, porque quien llama conoce al cliente y esto no. Por eso
 * `whatsappLink()` recibe el texto y no lo compone: si lo compusiera, lo
 * editado no saldría nunca por el enlace.
 */
export function whatsappMessage(r: BookingRequest, brandName: string): string {
  const coche = `${r.vehicleSnapshot?.brand ?? ''} ${r.vehicleSnapshot?.model ?? ''}`.trim();
  const dias = r.quoteSnapshot?.totalDays ?? 0;
  const precio = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: r.quoteSnapshot?.currency || 'EUR'
  }).format(r.quoteSnapshot?.gross ?? 0);

  return (
    `Hola ${r.name}, te contacto de ${brandName} en relación a tu solicitud ` +
    `del alquiler del coche ${coche} · ${dias} ${dias === 1 ? 'día' : 'días'} · ` +
    `${precio} (IVA incluido). ¿Deseas finalizar la reserva?`
  );
}

/**
 * El enlace que abre WhatsApp con el mensaje puesto.
 *
 * ⚠️ **Es `wa.me`, no la API de WhatsApp Business**, y es una decisión de
 * coste: mandar un mensaje desde el servidor exigiría un número dedicado
 * distinto del de la agencia, verificación de empresa con Meta, plantilla
 * aprobada y pago por mensaje. Esto es un enlace, cuesta cero y sale del número
 * de siempre.
 */
export function whatsappLink(r: BookingRequest, mensaje: string): string {
  return `https://wa.me/${r.phone}?text=${encodeURIComponent(mensaje)}`;
}

/** Para el `tel:` del botón de llamar. */
export function telLink(r: BookingRequest): string {
  return `tel:+${r.phone}`;
}

/**
 * El teléfono como se lee, no como se guarda.
 *
 * ⚠️ **Guardado va sin espacios a propósito** —es lo que `wa.me` y `tel:`
 * necesitan—, y así son doce dígitos seguidos: nadie los lee de un vistazo y
 * quien los copie a mano se equivoca. Por eso la pantalla y el correo lo
 * separan, y el enlace sigue llevando el número crudo.
 *
 * ⚠️ **Solo se agrupa lo español.** Cada país agrupa a su manera, y un número
 * extranjero partido con la regla de aquí se lee como si estuviera mal. Lo que
 * no se sabe, se deja entero.
 *
 * ⚠️ **Copia FIEL de `functions/src/public/booking-request-core.ts`**, como
 * `capitalizeWords`: la app y las functions no pueden compartir módulo. Si
 * cambia allí, cambia aquí.
 */
export function formatPhone(phone: string): string {
  if (/^34[6789]\d{8}$/.test(phone)) {
    const n = phone.slice(2);
    return `+34 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return `+${phone}`;
}

/**
 * Cuántas están sin atender.
 *
 * Es el número del contador del menú y el de la tarjeta del panel: lo que hace
 * que una entrada de menú más no sea un problema, porque se ve sin abrirla.
 */
export function newCount(requests: BookingRequest[]): number {
  return requests.filter((r) => r.status === 'new').length;
}

/**
 * El orden de la lista.
 *
 * ⚠️ **Lo sin atender primero, y dentro de eso lo más reciente.** Una lista de
 * solicitudes ordenada solo por fecha entierra la que lleva dos días sin
 * contestar debajo de las convertidas de hoy — que ya no son trabajo.
 */
const PESO: Record<BookingRequestStatus, number> = {
  new: 0,
  contacted: 1,
  converted: 2,
  discarded: 3
};

export function sortRequests(requests: BookingRequest[]): BookingRequest[] {
  return [...requests].sort((a, b) => {
    const p = PESO[a.status] - PESO[b.status];
    if (p !== 0) return p;
    const fa = a.createdAt ? toDate(a.createdAt).getTime() : 0;
    const fb = b.createdAt ? toDate(b.createdAt).getTime() : 0;
    return fb - fa;
  });
}
