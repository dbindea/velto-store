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

import { esc, GRIS, TIPO, boton, fila, parrafo, seccion, sobre } from '../alerts/email-shell';

export interface CorreoClienteDatos {
  nombre: string;
  referencia: string;
  coche: string;
  dias: number;
  importe: string;
  recogida: string;
  devolucion: string;
  /**
   * Dónde pidió recogerlo, si lo dijo.
   *
   * ⚠️ **Al cliente se le devuelve lo que él eligió.** Es la única forma que
   * tiene de ver que lo hemos entendido: quien marcó «Aeropuerto» y recibe un
   * correo que no lo menciona no sabe si lo sabemos, y lo que hace es llamar
   * para preguntarlo.
   */
  lugar?: string;
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

  /**
   * ⚠️ **Esto era un `<p>` suelto, y por eso el correo salía descompuesto.**
   * El cuerpo se empalma entre las filas de la tabla del sobre, así que un
   * párrafo que no sea `<tr>` lo expulsa el navegador fuera de la tabla: el
   * saludo, la garantía y la referencia aparecían **encima de la tarjeta** y el
   * botón quedaba dentro pegado al pie. Ahora usa `parrafo()`, de la cáscara
   * común, que es lo que hace que este correo y el que recibe Velto midan
   * igual.
   */
  const p = parrafo;

  const cuerpo =
    p(`Hola ${esc(d.nombre)}, hemos recibido tu pre-reserva.`) +
    seccion(
      'Lo que has pedido',
      fila(esc(d.coche), `${d.dias} ${d.dias === 1 ? 'día' : 'días'} · ${esc(d.importe)}`) +
        fila('Recogida', esc(d.recogida)) +
        fila('Devolución', esc(d.devolucion)) +
        (d.lugar ? fila('Dónde', esc(d.lugar)) : '')
    ) +
    /*
     * ⚠️ **Lo mismo que dice la pantalla, palabra por palabra.** El coche NO
     * queda reservado y lo que se garantiza es el precio: si el correo lo
     * contara distinto, el cliente se quedaría con la versión que más le
     * conviene — y con razón, porque se la hemos dado por escrito.
     *
     * ⚠️ **Y es la redacción del 2 de octubre de 2026, no la de antes.** Dorel
     * reescribió este párrafo en el diálogo por dos motivos que valen igual
     * aquí: que en ese plazo se **confirma la disponibilidad** —el coche no se
     * aparta, así que puede haberse ido— y que «cuando abones la señal» señala
     * al cliente con el dedo. Este correo se quedó con la versión vieja hasta
     * que alguien los puso uno al lado del otro.
     */
    p(
      `Te garantizamos este precio <strong>${esc(d.garantia)}</strong>. En ese plazo ` +
        `te contactaremos por teléfono o WhatsApp para confirmar la disponibilidad ` +
        `y gestionar el pago de la señal.`
    ) +
    p(`El coche quedará reservado <strong>al abonarse la señal</strong>.`) +
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
     * ⚠️ **El filete SE QUEDA, y antes se quitaba por un motivo que ya no es
     * cierto.** La regla de la cáscara es que el filete sobra cuando el cuerpo
     * **termina en un botón**: debajo de una pastilla turquesa una raya a todo
     * lo ancho se lee como una sección vacía. Pero aquí el cuerpo ya no acaba
     * en el botón — detrás va el párrafo de la referencia —, así que sin filete
     * el pie legal se confundía con una frase más del mensaje.
     *
     * Se quedó mal al añadir ese párrafo después: la condición siguió mirando
     * si hay presupuesto, que no es la pregunta.
     */
    pieSinFilete: false,
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
    ...(d.lugar ? [`Dónde: ${d.lugar}`] : []),
    '',
    `Te garantizamos este precio ${d.garantia}. En ese plazo te contactaremos por`,
    'teléfono o WhatsApp para confirmar la disponibilidad y gestionar el pago de la señal.',
    'El coche quedará reservado al abonarse la señal.',
    ...(d.presupuesto ? ['', `Presupuesto: ${d.presupuesto}`] : []),
    '',
    `${d.marca} · ${d.telefonoEmpresa}`,
  ].join('\n');

  return { subject, html, text };
}
