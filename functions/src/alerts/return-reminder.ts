/**
 * El recordatorio de la tarde: mañana vuelve un coche.
 *
 * ⚠️ **No es el resumen diario con otra hora.** El de las 9:00 (`daily-digest`)
 * cuenta lo que hay que **preparar**: entregas, devoluciones, vencimientos. Este
 * trae lo que hay que **escribirle a una persona**, redactado y listo para
 * pegarlo en su WhatsApp. Lo pidió Dorel el 7 de noviembre de 2026, con el
 * ejemplo escrito a mano: un alquiler que termina mañana es la última tarde en
 * la que se puede vender una prórroga, y a las 9:00 del día siguiente ya es
 * tarde para proponerla.
 *
 * ⚠️ **El texto es de Dorel y está casi literal**, como el de las solicitudes
 * (`whatsappMessage()` en la app). Lo único que se le ha cambiado son dos faltas
 * —«escibeme» y «proroga»— y el lugar de devolución, que él no puso y es el dato
 * que ahorra la siguiente pregunta del cliente. Quien sabe cómo se le habla a
 * sus clientes es él; lo que aporta esto son los datos que cambian.
 *
 * ⚠️ **En español, siempre.** No hay ningún campo en `Client` que diga en qué
 * idioma habla, así que elegirlo sería inventárselo. Es la misma frontera que
 * los nombres de fichero: lo que escribe el sistema va en el idioma del negocio,
 * y lo que un cliente lee —los PDF— sigue el de la plataforma porque allí sí
 * consta. Si algún día el cliente guarda su idioma, este es el sitio.
 *
 * ⚠️ **Y la composición va SEPARADA del envío**, como `email-shell.ts` y como
 * `mensajeCobro()`. El patrón de fallo que más se repite aquí es el código que
 * se escribe y nunca se ejecuta, y un mensaje que solo se puede ver mandándolo
 * es un mensaje que nadie mira hasta que sale mal delante de un cliente.
 */

import { esc } from './telegram';
import { formatPhone } from '../public/booking-request-core';

/** Una devolución de mañana, ya con todo lo que hace falta para redactar. */
export interface DevolucionManana {
  /** Para el enlace a la ficha. */
  reservationId: string;
  /** `HH:mm` en la zona del negocio. `null` si la fecha no se pudo leer. */
  hora: string | null;
  /** `dd/MM`, para que el aviso siga siendo cierto si se lee al día siguiente. */
  dia: string;
  /** El nombre completo, tal y como está en el snapshot de la reserva. */
  cliente: string;
  /**
   * El teléfono **normalizado** para `wa.me`: solo dígitos y con prefijo.
   * `null` si no se pudo, y entonces no se pinta el enlace.
   */
  telefono: string | null;
  /** El teléfono tal y como lo tecleó el operador, para enseñarlo. */
  telefonoBruto?: string;
  /**
   * Lo que se le dice al cliente: «Citroën Berlingo».
   *
   * ⚠️ **Puede venir vacío y entonces la frase cambia**, no se rellena con un
   * comodín. Una reserva sembrada a mano puede no tener `vehicleSnapshot`, y
   * «finaliza la reserva del vehículo» —que es lo que salía— se lee como un
   * hueco mal tapado. Sin coche, lo que termina es «tu reserva».
   */
  coche: string;
  /** La matrícula, que es con lo que el operador identifica el coche. */
  matricula?: string;
  /** Dónde se devuelve, si consta. */
  lugar?: string;
  /**
   * El coche está fuera **sin parte de entrega**: la reserva sigue en
   * `reserved` o `confirmed` y la recogida ya pasó.
   *
   * ⚠️ **Entra en el aviso a propósito, y es la defensa contra el fallo
   * silencioso.** Pidiendo solo `delivered` —que es lo correcto en teoría— el
   * recordatorio no saldría NUNCA para quien no complete los partes de
   * entrega, y un aviso que no sale no se echa de menos. Se avisa igual y se
   * dice que el parte falta, que además es trabajo pendiente de verdad.
   */
  sinParteDeEntrega?: boolean;
}

/**
 * El nombre con el que se le habla a alguien.
 *
 * ⚠️ **Solo el primero, y es lo único que hace falta.** El snapshot guarda el
 * nombre completo —«Maria Lopez de la Torre»— y un WhatsApp que empieza por
 * «Buenas tardes Maria Lopez de la Torre» se lee como una carta de un banco.
 *
 * ⚠️ **Un primer trozo de dos letras o menos se queda con el siguiente**
 * («Mª José», «J. Carlos»): ahí el nombre no es la primera palabra, es las dos.
 *
 * Sin nombre legible devuelve `null`, y el saludo sale sin él. Lo que no puede
 * salir es «Buenas tardes —».
 */
export function nombreDePila(nombre: string | undefined): string | null {
  const limpio = (nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!limpio || limpio === '—') return null;

  const trozos = limpio.split(' ');
  const primero = trozos[0];
  if (primero.length <= 2 && trozos.length > 1) return `${primero} ${trozos[1]}`;
  return primero;
}

/**
 * El teléfono como lo necesita `wa.me`: dígitos, con prefijo y sin `+`.
 *
 * ⚠️ **Aquí el campo es TEXTO LIBRE**, al revés que en las solicitudes de la
 * web —donde `booking-request-core.ts` ya lo normaliza al entrar—. En la ficha
 * de un cliente lo teclea el operador, así que conviven `+34623766181`,
 * `600111222` y lo que haga falta: las dos formas están hoy en la base de
 * desarrollo.
 *
 * ⚠️ **Nueve dígitos se dan por españoles**, y hay que decirlo porque es una
 * suposición: un móvil extranjero tecleado sin prefijo acabaría apuntando a un
 * número de aquí. Es seguro **porque el enlace solo ABRE el chat** —con el
 * nombre del contacto delante, antes de enviar nada— y porque el mensaje se
 * puede copiar igual sin él. Lo que no vale es inventarse un prefijo en algo
 * que se mande solo.
 *
 * En la duda devuelve `null`: el aviso sale sin enlace, con el teléfono a la
 * vista para marcarlo a mano.
 */
export function telefonoParaWhatsapp(bruto: string | undefined): string | null {
  const digitos = (bruto ?? '').replace(/\D/g, '');
  if (!digitos) return null;

  // `0034…` y `+34…` acaban en lo mismo: el prefijo ya está puesto.
  const sinCeros = digitos.replace(/^00/, '');

  if (/^34[6789]\d{8}$/.test(sinCeros)) return sinCeros;
  if (/^[6789]\d{8}$/.test(sinCeros)) return `34${sinCeros}`;
  // Cualquier otro prefijo internacional se respeta tal cual.
  if (/^\d{11,15}$/.test(sinCeros)) return sinCeros;
  return null;
}

/**
 * El mensaje que se le pega al cliente.
 *
 * Tres párrafos cortos, que es como se lee un WhatsApp: el saludo, la prórroga
 * —que es para lo que se escribe— y la devolución.
 *
 * ⚠️ **La última frase cambia con lo que consta, no se rellena con un hueco.**
 * Sin lugar pactado no se puede decir dónde, y «te espero en —» es peor que no
 * decirlo. Es la misma regla que el contrato: no se remite a un dato que no se
 * imprime.
 */
export function mensajeParaCliente(d: DevolucionManana): string {
  const nombre = nombreDePila(d.cliente);
  const saludo = nombre ? `Buenas tardes ${nombre},` : 'Buenas tardes,';

  const cuando = d.hora ? `Mañana a las ${d.hora}` : 'Mañana';
  const queTermina = d.coche.trim() ? `la reserva del ${d.coche.trim()}` : 'tu reserva';
  /**
   * ⚠️ **«prolongarla», no «prolongar la estancia».** Corrección de Dorel del 7
   * de noviembre de 2026, y el motivo es de negocio: *«es un coche, no un
   * hotel»*. Era un añadido mío sobre su texto, no suyo.
   */
  const cuerpo =
    `${cuando} finaliza ${queTermina}. ` +
    `Si deseas prolongarla, escríbeme y formalizamos la prórroga.`;

  /**
   * ⚠️ **«quedamos», no «te espero».** La otra corrección del mismo día, y
   * resuelve de paso el artículo que no se podía deducir: «te espero a esa hora
   * en Aeropuerto T1» pedía un «el» que depende del sitio —«en Oficinas Velto»
   * no lo lleva—, y «quedamos a esa hora en Aeropuerto T1» funciona con los dos
   * porque el lugar queda como nombre propio. Un artículo adivinado a partir de
   * un texto que teclea el operador se equivoca el día que escriba «la nave».
   */
  const esaHora = d.hora ? 'a esa hora' : 'a la hora prevista';
  const cierre = d.lugar
    ? `En caso contrario, quedamos ${esaHora} en ${d.lugar}. ¡Gracias!`
    : `En caso contrario, nos vemos ${esaHora}. ¡Gracias!`;

  return `${saludo}\n\n${cuerpo}\n\n${cierre}`;
}

/**
 * El aviso de Telegram: la cabecera para Dorel y el texto para el cliente.
 *
 * ⚠️ **El texto del cliente va en `<pre>`, y eso es la mitad del valor.** En
 * Telegram un bloque de código **se copia tocándolo**: suelto habría que
 * seleccionar tres párrafos a mano en un móvil, que es justo el trabajo que
 * esto viene a quitar. Por lo mismo la matrícula va en `<code>`.
 *
 * ⚠️ **Y la cabecera queda FUERA del bloque**, a propósito: lo que se copia
 * tiene que ser exactamente lo que se le manda al cliente. Un «Mañana termina
 * un alquiler» pegado en el chat de un cliente delata que esto lo escribió una
 * máquina.
 *
 * ⚠️ **El enlace de WhatsApp es un extra, no el plan.** `wa.me` solo abre la
 * aplicación de verdad en el móvil; en el ordenador se escribe desde WhatsApp
 * Web y hay que pegar. Es la misma razón por la que la ficha de una solicitud
 * tiene las dos vías.
 */
export function mensajeRecordatorio(d: DevolucionManana, baseUrl?: string): string {
  const texto = mensajeParaCliente(d);

  /**
   * ⚠️ **Lo que no consta se calla; no se escribe un hueco.** Es la misma regla
   * que `mensajeCobro()`, y aquí se vio en la pantalla: una reserva sin nombre
   * de cliente dejaba la línea en « · sin teléfono», con el separador suelto
   * delante. Por eso se une con `filter`, no concatenando.
   */
  const coche = [
    d.coche.trim() ? `<b>${esc(d.coche.trim())}</b>` : '',
    d.matricula ? `<code>${esc(d.matricula)}</code>` : ''
  ]
    .filter(Boolean)
    .join(' · ');

  // «sin teléfono» SÍ se escribe: dice que no hay a quién escribirle, que es
  // justo lo que hay que saber antes de abrir la ficha.
  const telefono = d.telefono
    ? formatPhone(d.telefono)
    : (d.telefonoBruto ?? '').trim() || 'sin teléfono';

  const lineas: string[] = [
    '🔁 <b>Mañana termina un alquiler</b>',
    '',
    ...(coche ? [coche] : []),
    [esc(d.cliente.trim()), esc(telefono)].filter(Boolean).join(' · '),
    `Devolución mañana ${esc(d.dia)}${d.hora ? ` a las ${esc(d.hora)}` : ''}`
  ];

  if (d.sinParteDeEntrega) {
    lineas.push('', '⚠️ Sin parte de entrega: la reserva sigue sin entregar en la aplicación.');
  }

  lineas.push('', 'Para el cliente (tócalo para copiarlo):', `<pre>${esc(texto)}</pre>`);

  const enlaces: string[] = [];
  if (d.telefono) {
    enlaces.push(`<a href="https://wa.me/${d.telefono}?text=${encodeURIComponent(texto)}">`
      + 'Abrir WhatsApp</a>');
  }
  if (baseUrl) {
    enlaces.push(`<a href="${baseUrl}/reservations/${d.reservationId}">Ver la reserva</a>`);
  }
  if (enlaces.length) lineas.push('', enlaces.join(' · '));

  return lineas.join('\n');
}
