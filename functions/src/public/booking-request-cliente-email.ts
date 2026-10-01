/**
 * El correo que recibe **el cliente** cuando hace una pre-reserva.
 *
 * ⚠️ **No confundir con `booking-request-email.ts`, que es el aviso a la
 * agencia.** Aquel le dice a Dorel que hay alguien esperando; este le dice al
 * cliente qué ha pedido, hasta cuándo le vale el precio y qué falta. Son dos
 * destinatarios y dos tonos, y por eso son dos ficheros — lo único que
 * comparten es la cáscara.
 *
 * ⚠️ **La maquetación va SEPARADA del envío**, como el resumen diario: es la
 * única forma de mirarlo sin mandarlo, y el patrón de fallo que más se repite
 * aquí es el código que se escribe y nunca se ejecuta.
 *
 * ⚠️ **Y los estilos van EN LÍNEA**, repitiendo la familia en cada elemento:
 * Gmail borra el `<style>` del `<head>` en la vista móvil y Outlook no hereda
 * `font-family` dentro de una tabla.
 */

import { esc, GRIS, TINTA, TIPO, boton, fila, seccion, sobre } from '../alerts/email-shell';

export interface CorreoClienteDatos {
  nombre: string;
  referencia: string;
  coche: string;
  dias: number;
  importe: string;
  recogida: string;
  devolucion: string;
  /** Hasta cuándo se le garantiza el precio, ya escrito. */
  garantia: string;
  /** El enlace corto al presupuesto. Vacío si no se pudo generar. */
  presupuesto: string;
  marca: string;
  telefonoEmpresa: string;
}

export function renderBookingRequestClienteEmail(d: CorreoClienteDatos): {
  subject: string;
  html: string;
  text: string;
} {
  /*
   * ⚠️ **La referencia va en el ASUNTO.** Es lo que el cliente va a citar si
   * contesta o escribe por WhatsApp, y lo que hace que el correo se encuentre
   * buscándola. Un asunto genérico se pierde entre los demás.
   */
  const subject = `Tu pre-reserva ${d.referencia} · ${d.coche}`;

  const p = (texto: string) =>
    `<p style="margin:0 0 12px;font-family:${TIPO};font-size:14px;line-height:1.5;color:${TINTA}">${texto}</p>`;

  const cuerpo =
    p(`Hola ${esc(d.nombre)}, hemos recibido tu pre-reserva.`) +
    seccion(
      'Lo que has pedido',
      fila(esc(d.coche), `${d.dias} ${d.dias === 1 ? 'día' : 'días'} · ${esc(d.importe)}`) +
        fila('Recogida', esc(d.recogida)) +
        fila('Devolución', esc(d.devolucion))
    ) +
    /*
     * ⚠️ **Lo mismo que dice la pantalla, palabra por palabra.** El coche NO
     * queda reservado y lo que se garantiza es el precio: si el correo lo
     * contara distinto, el cliente se quedaría con la versión que más le
     * conviene — y con razón, porque se la hemos dado por escrito.
     */
    p(
      `Te garantizamos este precio <strong>${esc(d.garantia)}</strong>. Dentro de ese plazo ` +
        `te contactamos por teléfono o WhatsApp para dejarla en firme con el pago de la señal.`
    ) +
    p(
      `Hasta entonces el coche <strong>no queda reservado</strong>: lo que te guardamos es el precio.`
    ) +
    (d.presupuesto ? boton('Ver el presupuesto', d.presupuesto) : '') +
    p(
      `<span style="font-family:${TIPO};font-size:13px;color:${GRIS}">` +
        `Tu referencia es <strong>${esc(d.referencia)}</strong>. Si prefieres adelantarlo, ` +
        `escríbenos o llámanos al ${esc(d.telefonoEmpresa)} con ella delante.</span>`
    );

  const html = sobre({
    titulo: 'Pre-reserva recibida',
    entradilla: `${d.marca} · referencia ${d.referencia}`,
    cuerpo,
    pie:
      `Recibes este correo porque has pedido una pre-reserva en la web de ` +
      `${d.marca}. Si no has sido tú, puedes ignorarlo: no hay nada reservado ` +
      `a tu nombre.`,
    /*
     * ⚠️ **Sin filete en el pie**: el cuerpo termina en un botón, y debajo de
     * una pastilla turquesa una raya a todo lo ancho se lee como una sección
     * vacía. Va como opción explícita y no adivinando si el cuerpo acaba en
     * botón.
     */
    pieSinFilete: !!d.presupuesto,
  });

  /*
   * ⚠️ **La versión de texto no es opcional.** Un correo sin ella puntúa como
   * spam, y hay clientes que solo enseñan esa — justo el que no se puede
   * perder.
   */
  const text = [
    `Hola ${d.nombre}, hemos recibido tu pre-reserva.`,
    '',
    `Referencia: ${d.referencia}`,
    `${d.coche} · ${d.dias} ${d.dias === 1 ? 'día' : 'días'} · ${d.importe}`,
    `Recogida: ${d.recogida}`,
    `Devolución: ${d.devolucion}`,
    '',
    `Te garantizamos este precio ${d.garantia}. Dentro de ese plazo te contactamos`,
    'por teléfono o WhatsApp para dejarla en firme con el pago de la señal.',
    'Hasta entonces el coche no queda reservado: lo que te guardamos es el precio.',
    ...(d.presupuesto ? ['', `Presupuesto: ${d.presupuesto}`] : []),
    '',
    `${d.marca} · ${d.telefonoEmpresa}`,
  ].join('\n');

  return { subject, html, text };
}
