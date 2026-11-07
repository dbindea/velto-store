/**
 * El recordatorio de devolución.
 *
 * ⚠️ **Se prueba la COMPOSICIÓN, no el envío**, igual que el aviso de cobro:
 * lo que puede fallar al hablar con Telegram ya está resuelto por no lanzar
 * nunca. Lo que se rompe en silencio es el texto — y aquí el texto se le pega
 * **a un cliente**, así que una frase mal construida no se queda en un log.
 */

import { describe, expect, it } from 'vitest';
import {
  mensajeParaCliente,
  mensajeRecordatorio,
  nombreDePila,
  telefonoParaWhatsapp,
  type DevolucionManana
} from './return-reminder';

const base: DevolucionManana = {
  reservationId: 'aNzwyUgxYs3ghxhx2N7X',
  hora: '10:00',
  dia: '08/11',
  cliente: 'Juan Pérez García',
  telefono: '34600111222',
  telefonoBruto: '600111222',
  coche: 'Renault Mégane',
  matricula: '4466LKK',
  lugar: 'Oficinas Velto - Arganda'
};

describe('nombreDePila', () => {
  it('se queda con el primero, que es con el que se habla a alguien', () => {
    expect(nombreDePila('Juan Pérez García')).toBe('Juan');
    expect(nombreDePila('Maria Lopez de la Torre')).toBe('Maria');
  });

  /**
   * ⚠️ Con un primer trozo de dos letras, el nombre son las DOS palabras: «Mª»
   * y «J.» solos no son un saludo.
   */
  it('con un trozo inicial de dos letras o menos se lleva el siguiente', () => {
    expect(nombreDePila('Mª José Ruiz')).toBe('Mª José');
    expect(nombreDePila('J. Carlos Nieto')).toBe('J. Carlos');
  });

  it('sin nombre legible contesta null en vez de un hueco', () => {
    expect(nombreDePila(undefined)).toBeNull();
    expect(nombreDePila('   ')).toBeNull();
    // Lo que el resumen pinta cuando el snapshot no trae nombre.
    expect(nombreDePila('—')).toBeNull();
  });

  it('colapsa los espacios de sobra', () => {
    expect(nombreDePila('  Juan   Pérez ')).toBe('Juan');
  });
});

describe('telefonoParaWhatsapp', () => {
  /**
   * ⚠️ **Las dos formas están HOY en la base**, porque en la ficha de un cliente
   * el teléfono es texto libre: `+34623766181` y `600111222`.
   */
  it('normaliza lo que el operador teclea de verdad', () => {
    expect(telefonoParaWhatsapp('+34623766181')).toBe('34623766181');
    expect(telefonoParaWhatsapp('600111222')).toBe('34600111222');
    expect(telefonoParaWhatsapp('+34 611 22 33 44')).toBe('34611223344');
    expect(telefonoParaWhatsapp('0034600111222')).toBe('34600111222');
  });

  it('respeta un prefijo internacional que ya venga puesto', () => {
    // Rumanía: 40 + nueve dígitos. No se le puede poner un 34 delante.
    expect(telefonoParaWhatsapp('+40721234567')).toBe('40721234567');
  });

  /**
   * ⚠️ **En la duda, null: el aviso sale sin enlace.** Un número incompleto
   * convertido en enlace abriría el chat de otra persona, y el texto se puede
   * copiar igual sin él.
   */
  it('contesta null con lo que no se puede situar', () => {
    expect(telefonoParaWhatsapp(undefined)).toBeNull();
    expect(telefonoParaWhatsapp('')).toBeNull();
    expect(telefonoParaWhatsapp('sin teléfono')).toBeNull();
    expect(telefonoParaWhatsapp('600 111')).toBeNull();
    // Diez dígitos: ni móvil español ni prefijo reconocible.
    expect(telefonoParaWhatsapp('6001112223')).toBeNull();
  });
});

describe('mensajeParaCliente', () => {
  it('dice la hora, el coche y el lugar, y pide la prórroga', () => {
    const m = mensajeParaCliente(base);
    expect(m).toContain('Buenas tardes Juan,');
    expect(m).toContain('Mañana a las 10:00 finaliza la reserva del Renault Mégane.');
    expect(m).toContain('escríbeme y formalizamos la prórroga');
    expect(m).toContain('te espero a esa hora en Oficinas Velto - Arganda');
  });

  /**
   * ⚠️ **Las dos faltas del ejemplo escrito a mano**, que es lo único que se le
   * ha corregido al texto de Dorel. Esto lo lee un cliente.
   */
  it('escribe «escríbeme» y «prórroga» con sus tildes', () => {
    const m = mensajeParaCliente(base);
    expect(m).not.toContain('escibeme');
    expect(m).not.toContain('proroga');
    expect(m).toContain('escríbeme');
    expect(m).toContain('prórroga');
  });

  /**
   * ⚠️ **No se remite a un dato que no consta**, que es la regla del contrato:
   * «te espero en —» es peor que no decir dónde.
   */
  it('sin lugar pactado no inventa un sitio', () => {
    const m = mensajeParaCliente({ ...base, lugar: undefined });
    expect(m).toContain('nos vemos a esa hora');
    expect(m).not.toContain('undefined');
    expect(m).not.toContain(' en .');
  });

  it('sin hora legible no dice una hora falsa', () => {
    const m = mensajeParaCliente({ ...base, hora: null });
    expect(m).toContain('Mañana finaliza la reserva');
    expect(m).not.toContain('a las null');
    expect(m).toContain('te espero a la hora prevista');
  });

  it('sin nombre saluda igual, sin un hueco detrás', () => {
    const m = mensajeParaCliente({ ...base, cliente: '' });
    expect(m.startsWith('Buenas tardes,')).toBe(true);
  });

  /**
   * ⚠️ **Salió mirando el aviso de verdad, no leyendo el código.** Una reserva
   * sembrada a mano no tiene `vehicleSnapshot`, y con un comodín el cliente
   * leía «finaliza la reserva del vehículo».
   */
  it('sin coche en el snapshot no dice «del vehículo»', () => {
    const m = mensajeParaCliente({ ...base, coche: '' });
    expect(m).toContain('Mañana a las 10:00 finaliza tu reserva.');
    expect(m).not.toContain('del vehículo');
    expect(m).not.toContain('reserva del .');
  });

  /**
   * ⚠️ **Lo que se copia es SOLO el mensaje del cliente.** Un «Mañana termina un
   * alquiler» o una matrícula pegados en su chat delatan que esto lo escribió
   * una máquina — y la matrícula no es asunto suyo.
   */
  it('no se le cuela nada de la cabecera interna', () => {
    const m = mensajeParaCliente(base);
    expect(m).not.toContain('4466LKK');
    expect(m).not.toContain('Mañana termina un alquiler');
    expect(m).not.toContain('<');
  });
});

describe('mensajeRecordatorio', () => {
  const base_url = 'https://store.veltorent.com';

  it('lleva lo que hace falta para decidir sin abrir nada', () => {
    const m = mensajeRecordatorio(base, base_url);
    expect(m).toContain('Renault Mégane');
    expect(m).toContain('<code>4466LKK</code>');
    expect(m).toContain('Juan Pérez García');
    // Formateado para leerlo, no los doce dígitos seguidos.
    expect(m).toContain('+34 600 111 222');
    expect(m).toContain('Devolución mañana 08/11 a las 10:00');
  });

  /**
   * ⚠️ **El bloque es la mitad del valor**: en Telegram un `<pre>` se copia
   * tocándolo, y sin él habría que seleccionar tres párrafos a mano en un móvil.
   */
  it('mete el texto del cliente en un bloque que se copia', () => {
    const m = mensajeRecordatorio(base, base_url);
    expect(m).toContain('<pre>');
    expect(m).toContain('</pre>');
    const dentro = m.slice(m.indexOf('<pre>') + 5, m.indexOf('</pre>'));
    expect(dentro).toBe(mensajeParaCliente(base));
  });

  it('el enlace de WhatsApp lleva el mismo texto que el bloque', () => {
    const m = mensajeRecordatorio(base, base_url);
    expect(m).toContain('https://wa.me/34600111222?text=');
    const codificado = encodeURIComponent(mensajeParaCliente(base));
    expect(m).toContain(codificado);
  });

  it('enlaza la ficha de la reserva en el dominio que toca', () => {
    const m = mensajeRecordatorio(base, base_url);
    expect(m).toContain('https://store.veltorent.com/reservations/aNzwyUgxYs3ghxhx2N7X');
  });

  /**
   * ⚠️ Sin teléfono normalizado **no hay enlace**, y el bruto se enseña para
   * poder marcarlo a mano: un `wa.me` con un número a medias abre el chat de
   * otra persona.
   */
  it('sin teléfono utilizable no pinta el enlace y enseña lo que hay', () => {
    const m = mensajeRecordatorio({ ...base, telefono: null, telefonoBruto: '600 111' }, base_url);
    expect(m).not.toContain('wa.me');
    expect(m).toContain('600 111');
  });

  it('sin teléfono ninguno lo dice en vez de dejar un hueco', () => {
    const m = mensajeRecordatorio(
      { ...base, telefono: null, telefonoBruto: undefined },
      base_url
    );
    expect(m).toContain('sin teléfono');
    expect(m).not.toContain('undefined');
  });

  /**
   * ⚠️ **El separador suelto, que se vio en el aviso real.** Sin nombre de
   * cliente la línea salía como « · sin teléfono»: la misma regla de
   * `mensajeCobro()` —lo que no consta se calla— aplicada a la cabecera.
   */
  it('no deja separadores sueltos cuando falta la mitad de un dato', () => {
    const m = mensajeRecordatorio(
      { ...base, cliente: '', coche: '', matricula: undefined, telefono: null, telefonoBruto: '' },
      base_url
    );
    expect(m.split('\n').some((l) => l.startsWith(' · ') || l.trim() === '·')).toBe(false);
    expect(m).toContain('sin teléfono');
    // Sin coche ni matrícula no hay línea que pintar, pero el aviso sigue
    // diciendo cuándo y enlazando la ficha.
    expect(m).toContain('Devolución mañana 08/11 a las 10:00');
    expect(m).toContain('/reservations/');
  });

  it('sin dominio configurado no pinta un enlace roto', () => {
    const m = mensajeRecordatorio(base, '');
    expect(m).not.toContain('/reservations/');
    expect(m).toContain('wa.me');
  });

  /**
   * ⚠️ **El aviso del parte que falta.** Es lo que evita que este recordatorio
   * deje de salir para quien no completa los partes de entrega.
   */
  it('dice cuándo la reserva sigue sin entregar en la aplicación', () => {
    expect(mensajeRecordatorio(base, base_url)).not.toContain('Sin parte de entrega');
    const m = mensajeRecordatorio({ ...base, sinParteDeEntrega: true }, base_url);
    expect(m).toContain('Sin parte de entrega');
  });

  /**
   * ⚠️ **Este es el test que de verdad importa.** El nombre del cliente y el
   * lugar de entrega los teclea una persona: con `parse_mode: 'HTML'`, un `<`
   * sin escapar hace que Telegram conteste `400 can't parse entities` y el
   * aviso **no llegue** — y lo que se pierde es la última tarde para vender la
   * prórroga.
   */
  it('escapa el HTML de lo que teclea una persona, también dentro del bloque', () => {
    const m = mensajeRecordatorio(
      {
        ...base,
        cliente: 'Juan <b>Pérez</b> & Hijos',
        lugar: 'Nave <industrial> 3',
        matricula: '<script>'
      },
      base_url
    );
    expect(m).not.toContain('<b>Pérez</b>');
    expect(m).not.toContain('<script>');
    expect(m).toContain('&lt;b&gt;Pérez&lt;/b&gt;');
    expect(m).toContain('&amp; Hijos');
    expect(m).toContain('Nave &lt;industrial&gt; 3');
  });

  it('conserva su propio formato', () => {
    const m = mensajeRecordatorio(base, base_url);
    expect(m).toContain('<b>Mañana termina un alquiler</b>');
  });
});
