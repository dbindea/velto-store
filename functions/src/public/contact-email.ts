/**
 * Cómo se ve el correo de una consulta del formulario de contacto.
 *
 * ⚠️ **La maquetación es la MISMA que la del resumen diario y la del aviso de
 * una solicitud** (`email-shell`). Son tres correos del mismo negocio y llegan
 * al mismo buzón: con cada uno maquetado por su cuenta, la cuenta parece de
 * tres empresas. Es la misma razón por la que la marca de los PDF vive en un
 * solo `brand.ts`.
 *
 * ⚠️ **Y está separado del envío a propósito.** Un correo cuya maquetación solo
 * existe dentro de la función que lo manda no se puede mirar sin mandarlo — y
 * aquí el patrón de fallo que más se repite es el código que se escribe y nunca
 * se ejecuta. Se mira volcándolo a un `.html` y abriéndolo a 390 px.
 */

import { TURQUESA, esc, fila, seccion, sobre } from '../alerts/email-shell';
import { formatPhone } from './booking-request-core';
import {
  DURACION_ROTULO,
  MOTIVO_ROTULO,
  type ContactFields,
} from './contact-core';

export interface ContactEmailData extends ContactFields {
  reference: string;
}

/**
 * Las filas propias de cada rama.
 *
 * ⚠️ **Solo se pinta lo que tiene valor.** Una fila vacía en un correo se lee
 * como un dato que falta, no como un dato que no se pidió — y eso hace dudar de
 * todo lo demás. `validateContact()` ya descarta los campos de la rama que no
 * se eligió, así que aquí basta con no pintar lo vacío.
 */
function detalle(c: ContactFields): string {
  const filas: string[] = [];

  if (c.motivo === 'alquilar') {
    if (c.duracion) filas.push(fila(esc(DURACION_ROTULO[c.duracion]), 'Cuánto tiempo'));
    if (c.queCoche) filas.push(fila(esc(c.queCoche), 'Qué coche busca'));
    if (c.domicilio) {
      filas.push(fila(c.lugar ? esc(c.lugar) : 'Sí, sin decir dónde', 'Lo quiere a domicilio'));
    }
  }

  if (c.motivo === 'poner-en-alquiler') {
    if (c.coche) filas.push(fila(esc(c.coche), c.anio ? `Del ${esc(c.anio)}` : 'Su coche'));
    if (c.poblacion) filas.push(fila(esc(c.poblacion), 'Dónde está'));
    if (c.parado) filas.push(fila(esc(c.parado), 'Cuánto tiempo lleva parado'));
  }

  return filas.join('');
}

export function renderContactEmail(
  c: ContactEmailData,
  opciones: { brandName: string }
): { subject: string; html: string; text: string } {
  const rotulo = MOTIVO_ROTULO[c.motivo];
  const detalles = detalle(c);

  /**
   * ⚠️ **Lo primero es el teléfono**, igual que en el aviso de una solicitud y
   * por lo mismo: la única acción de este correo es contestar. En un móvil,
   * `tel:` marca sin copiar nada, y `mailto:` abre el correo ya dirigido.
   */
  const contacto =
    fila(
      `<a href="tel:+${esc(c.phone)}" style="color:${TURQUESA};text-decoration:none">` +
        `${esc(formatPhone(c.phone))}</a>`,
      esc(c.name)
    ) +
    (c.email
      ? fila(
          `<a href="mailto:${esc(c.email)}" style="color:${TURQUESA};text-decoration:none">` +
            `${esc(c.email)}</a>`,
          'Su correo'
        )
      : '');

  const html = sobre({
    titulo: `${c.name}: ${rotulo.toLowerCase()}`,
    entradilla: `Consulta ${c.reference} · ${opciones.brandName}`,
    cuerpo:
      seccion('Contesta', contacto) +
      (detalles ? seccion('Lo que ha contado', detalles) : '') +
      /*
       * ⚠️ **El mensaje va ENTERO y al final.** Es lo que la persona escribió
       * con sus palabras, y es lo que decide la conversación: recortarlo en el
       * correo obligaría a abrir otra cosa para leerlo, y no hay otra cosa —
       * esto no tiene pantalla en el backoffice. El tope de 1200 caracteres ya
       * lo puso la validación.
       */
      (c.mensaje ? seccion('Su mensaje', fila(`«${esc(c.mensaje)}»`, '')) : ''),
    pie:
      'Este aviso sale al instante, en cuanto alguien envía el formulario de ' +
      'contacto de la web. No crea ninguna reserva ni ninguna ficha de cliente.',
  });

  /**
   * ⚠️ **El texto plano no es un adorno**: hay clientes de correo que solo
   * enseñan esa versión, y un correo con el texto vacío puntúa como spam.
   */
  const lineas = [
    `${c.name}: ${rotulo.toLowerCase()}`,
    `Consulta ${c.reference} — ${opciones.brandName}`,
    '',
    `Teléfono    ${formatPhone(c.phone)}`,
    ...(c.email ? [`Correo      ${c.email}`] : []),
  ];

  if (c.motivo === 'alquilar') {
    if (c.duracion) lineas.push(`Cuánto      ${DURACION_ROTULO[c.duracion]}`);
    if (c.queCoche) lineas.push(`Qué coche   ${c.queCoche}`);
    if (c.domicilio) lineas.push(`A domicilio ${c.lugar || 'sí, sin decir dónde'}`);
  }
  if (c.motivo === 'poner-en-alquiler') {
    if (c.coche) lineas.push(`Su coche    ${c.coche}${c.anio ? ` (${c.anio})` : ''}`);
    if (c.poblacion) lineas.push(`Dónde       ${c.poblacion}`);
    if (c.parado) lineas.push(`Parado      ${c.parado}`);
  }
  if (c.mensaje) lineas.push('', 'Su mensaje:', c.mensaje);

  return {
    subject: `Consulta ${c.reference} · ${rotulo}`,
    html,
    text: lineas.join('\n'),
  };
}
