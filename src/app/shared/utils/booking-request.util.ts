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

/** Una descartada se puede recuperar; una convertida ya no. */
export function canDiscard(r: BookingRequest): boolean {
  return r.status !== 'converted';
}

/**
 * El mensaje de WhatsApp, ya redactado.
 *
 * ⚠️ **Lleva la referencia dentro, y ese es su motivo de ser.** El operador
 * escribe desde su número de siempre y el cliente tiene que poder reconocer de
 * qué va: «tu solicitud P-4K7M9X» ata la conversación a lo que pidió.
 *
 * ⚠️ **Y no promete el coche.** Dice lo mismo que vio al enviar el formulario:
 * que el precio se mantiene y que el coche no está apartado. Un WhatsApp que
 * diga «te lo guardo» convierte en falso lo que la web dejó claro.
 */
export function whatsappMessage(r: BookingRequest, brandName: string): string {
  const coche = `${r.vehicleSnapshot?.brand ?? ''} ${r.vehicleSnapshot?.model ?? ''}`.trim();
  const dias = r.quoteSnapshot?.totalDays ?? 0;
  const precio = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: r.quoteSnapshot?.currency || 'EUR'
  }).format(r.quoteSnapshot?.gross ?? 0);

  return [
    `Hola ${r.name}, soy de ${brandName}.`,
    '',
    `Tu solicitud ${r.reference}:`,
    `${coche} · ${dias} ${dias === 1 ? 'día' : 'días'} · ${precio}, IVA incluido.`,
    '',
    'Te llamo para confirmar. El coche no está apartado, pero te mantenemos el precio.'
  ].join('\n');
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
export function whatsappLink(r: BookingRequest, brandName: string): string {
  return `https://wa.me/${r.phone}?text=${encodeURIComponent(whatsappMessage(r, brandName))}`;
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
