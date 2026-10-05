/**
 * Cómo se ve el aviso de una solicitud de la web.
 *
 * ⚠️ **La maquetación es la MISMA que la del resumen diario** (`email-shell`).
 * Son dos correos del mismo negocio y llegan al mismo buzón: con cada uno
 * maquetado por su cuenta, la cuenta parece de dos empresas. Este estaba escrito
 * aparte, con otros grises, otra tipografía y una tabla de dos columnas que en
 * pantalla estrecha se rompe.
 *
 * ⚠️ **Y está separado del envío a propósito**, igual que `digest-email.ts`. Un
 * correo cuya maquetación solo existe dentro de la función que lo manda no se
 * puede mirar sin mandarlo — y aquí el patrón de fallo que más se repite es el
 * código que se escribe y nunca se ejecuta.
 */

import { TURQUESA, boton, esc, fila, seccion, sobre } from '../alerts/email-shell';
import { formatPhone } from './booking-request-core';

/** Lo que el correo necesita de una solicitud ya guardada. */
export interface BookingRequestEmailData {
  reference: string;
  name: string;
  phone: string;
  note?: string;
  /** Dónde quiere recogerlo, si lo dijo. Ver la nota de abajo. */
  pickupPlace?: string;
  vehicleSnapshot: { brand: string; model: string };
  quoteSnapshot: { totalDays: number; gross: number };
  pickupDate: Date;
  returnDate: Date;
  priceGuaranteedUntil: Date;
}

const dia = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

const diaHora = (d: Date) =>
  `${dia(d)} a las ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const euros = (n: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);

export function renderBookingRequestEmail(
  s: BookingRequestEmailData,
  opciones: { brandName: string; enlace: string }
): { subject: string; html: string; text: string } {
  const coche = `${s.vehicleSnapshot.brand} ${s.vehicleSnapshot.model}`.trim();
  const fechas = `${dia(s.pickupDate)} al ${dia(s.returnDate)}`;
  const dias = s.quoteSnapshot.totalDays;
  const plural = dias === 1 ? '' : 's';
  const precio = euros(s.quoteSnapshot.gross);
  const garantia = diaHora(s.priceGuaranteedUntil);

  /**
   * ⚠️ **Lo primero es el teléfono, y no es una preferencia de maquetación.** La
   * única acción de este correo es llamar; el coche y el precio están para
   * decidir si se llama ya o en un rato, pero lo que hay que tener a un toque es
   * el número. En un móvil, `tel:` marca sin copiar nada.
   */
  const html = sobre({
    titulo: `${s.name} quiere ${coche}`,
    entradilla: `Solicitud ${s.reference} · ${opciones.brandName}`,
    cuerpo:
      seccion(
        'Llámale',
        fila(
          `<a href="tel:+${esc(s.phone)}" style="color:${TURQUESA};text-decoration:none">` +
            `${esc(formatPhone(s.phone))}</a>`,
          esc(s.name)
        ) + (s.note ? fila(`«${esc(s.note)}»`, 'Lo que ha escrito') : '')
      ) +
      seccion(
        'Lo que ha pedido',
        fila(esc(coche), `${esc(fechas)} · ${dias} día${plural}`) +
          /*
           * ⚠️ **El lugar va junto al coche y las fechas, no en la letra
           * pequeña.** Decide si hay que mover una furgoneta y si el alquiler
           * lleva suplemento: es parte de lo que hay que saber antes de
           * llamar, no un detalle que se mira después.
           *
           * ⚠️ **Y solo si se dijo.** Una fila «Recogida: —» en el aviso de
           * cada solicitud enseña a saltársela, y entonces no se lee el día
           * que sí pone «Aeropuerto».
           */
          (s.pickupPlace ? fila(esc(s.pickupPlace), 'Lo recoge en') : '') +
          fila(`${esc(precio)}, IVA incluido`, `Precio garantizado hasta el ${esc(garantia)}`)
      ) +
      (opciones.enlace ? boton('Abrir la solicitud', opciones.enlace) : ''),
    pie:
      'El coche NO está reservado: solo se le ha garantizado el precio. ' +
      'Este aviso sale al instante, en cuanto alguien pide que le llamen desde la web.',
    /** Debajo del botón, el filete se lee como una sección vacía. */
    pieSinFilete: true
  });

  /**
   * ⚠️ **El texto plano no es un adorno**, por la misma razón que en el resumen
   * diario: hay clientes de correo que solo enseñan esa versión, y un correo con
   * el texto vacío puntúa como spam. Este iba sin ella — y es justo el que no se
   * puede perder.
   */
  const text = [
    `${s.name} quiere ${coche}`,
    `Solicitud ${s.reference} — ${opciones.brandName}`,
    '',
    `Teléfono    ${formatPhone(s.phone)}`,
    ...(s.note ? [`Dice        «${s.note}»`] : []),
    '',
    `Coche       ${coche}`,
    `Fechas      ${fechas} (${dias} día${plural})`,
    ...(s.pickupPlace ? [`Recoge en   ${s.pickupPlace}`] : []),
    `Precio      ${precio}, IVA incluido`,
    `Garantizado hasta el ${garantia}`,
    ...(opciones.enlace ? ['', opciones.enlace] : []),
    '',
    'El coche NO está reservado: solo se le ha garantizado el precio.'
  ].join('\n');

  return { subject: `Solicitud ${s.reference} · ${coche} · ${fechas}`, html, text };
}
