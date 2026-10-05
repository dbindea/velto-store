import { describe, expect, it } from 'vitest';
import { renderDigestEmail } from './digest-email';
import type { Resumen } from './daily-digest';

const EMPRESA = { brandName: 'VELTO MOBILITY' };

const base: Resumen = {
  fecha: '11/09/2026',
  entregas: [],
  devoluciones: [],
  vencimientos: [],
  sinContestar: [],
  sinFirmar: 0,
  avisos: []
};

const entrega = (extra: Partial<Resumen['entregas'][0]> = {}) => ({
  reservationId: 'r1',
  hora: '09:00',
  cliente: 'Cliente Pruebas',
  vehiculo: 'Kia Ceed · 7777ATM',
  ...extra
});

describe('el correo del resumen', () => {
  /**
   * ⚠️ **El aviso de la firma tiene que estar en las DOS versiones.** Hay
   * clientes de correo que solo muestran el texto plano, y ahí es donde más
   * fácil se pierde: sin marcarlo, queda como una línea más entre las entregas.
   */
  it('el contrato sin firmar se ve en el HTML y en el texto', () => {
    const { html, text } = renderDigestEmail(
      { ...base, entregas: [entrega({ contratoSinFirmar: true })], sinFirmar: 1 },
      EMPRESA
    );
    expect(html).toContain('SIN CONTRATO FIRMADO');
    expect(text).toContain('SIN CONTRATO FIRMADO');
  });

  it('una entrega normal no lo lleva', () => {
    const { html, text } = renderDigestEmail({ ...base, entregas: [entrega()] }, EMPRESA);
    expect(html).not.toContain('SIN CONTRATO FIRMADO');
    expect(text).not.toContain('SIN CONTRATO FIRMADO');
  });

  /**
   * ⚠️ **Un correo con el texto plano vacío acaba en spam**, y además hay quien
   * lo lee así. No es un adorno del HTML.
   */
  it('la versión de texto nunca sale vacía si hay algo que contar', () => {
    const { text } = renderDigestEmail({ ...base, entregas: [entrega()] }, EMPRESA);
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain('Cliente Pruebas');
    expect(text).toContain('09:00');
  });

  /** Un cliente llamado «Pérez & Hijos <S.L.>» basta para romper el HTML. */
  it('escapa lo que rompería el HTML', () => {
    const { html } = renderDigestEmail(
      { ...base, entregas: [entrega({ cliente: 'Pérez & Hijos <S.L.>' })] },
      EMPRESA
    );
    expect(html).toContain('Pérez &amp; Hijos &lt;S.L.&gt;');
    expect(html).not.toContain('<S.L.>');
  });

  /**
   * ⚠️ Un vencimiento pasado y uno futuro no son la misma noticia: con la ITV
   * caducada el coche no puede circular, así que no puede leerse como un
   * recordatorio más.
   *
   * ⚠️ **La frase iba en imperativo porque el sistema no bloqueaba.** Desde el
   * 21 de septiembre de 2026 la ITV y el seguro **sí bloquean**, así que el
   * correo puede decir lo que de verdad pasa: el coche no se alquila. Lo que no
   * puede es decirlo de todo — ver el test de abajo.
   */
  it('distingue lo vencido de lo que falta por vencer', () => {
    const vencido = renderDigestEmail(
      {
        ...base,
        vencimientos: [
          {
            vehiculo: '0951LTL',
            concepto: 'ITV',
            fecha: '01/09/2026',
            diasRestantes: -9,
            bloquea: true
          }
        ]
      },
      EMPRESA
    );
    expect(vencido.html).toContain('VENCIDO');
    expect(vencido.html).toContain('no se puede alquilar');

    const porVencer = renderDigestEmail(
      {
        ...base,
        vencimientos: [
          {
            vehiculo: '0951LTL',
            concepto: 'ITV',
            fecha: '17/09/2026',
            diasRestantes: 7,
            bloquea: true
          }
        ]
      },
      EMPRESA
    );
    expect(porVencer.html).not.toContain('VENCIDO');
    expect(porVencer.html).toContain('en 7 días');
  });

  /**
   * ⚠️ **Lo que este test protege es que el correo no prometa lo que la
   * aplicación no hace.** Decía «no alquiles este coche hasta pasarla» de
   * **cualquier** vencimiento, y solo la ITV y el seguro impiden circular
   * (`BLOCKING_MAINTENANCE_TYPES`): un cambio de aceite vencido salía con esa
   * frase mientras el asistente ofrecía el coche sin rechistar.
   *
   * Un aviso que el sistema no respalda se deja de creer, y arrastra consigo a
   * los que sí. Y **se comprueba el control**: si el que bloquea dejara de
   * decirlo, el test de arriba cae.
   */
  it('NO dice «no se puede alquilar» de lo que no bloquea', () => {
    const { html } = renderDigestEmail(
      {
        ...base,
        vencimientos: [
          {
            vehiculo: '0951LTL',
            concepto: 'Cambio de aceite',
            fecha: '01/09/2026',
            diasRestantes: -9,
            bloquea: false
          }
        ]
      },
      EMPRESA
    );
    expect(html).toContain('VENCIDO');
    expect(html).not.toContain('no se puede alquilar');
    expect(html).toContain('el coche sigue alquilándose');
  });

  it('«en 1 día», no «en 1 días»', () => {
    const { html } = renderDigestEmail(
      {
        ...base,
        vencimientos: [
          {
            vehiculo: '0951LTL',
            concepto: 'ITV',
            fecha: '11/09/2026',
            diasRestantes: 1,
            bloquea: true
          }
        ]
      },
      EMPRESA
    );
    expect(html).toContain('en 1 día');
    expect(html).not.toContain('en 1 días');
  });

  /** Una sección sin nada no se pinta: un titular vacío es ruido. */
  it('no pinta las secciones que están vacías', () => {
    const { html } = renderDigestEmail({ ...base, entregas: [entrega()] }, EMPRESA);
    expect(html).toContain('Entregas');
    expect(html).not.toContain('Devoluciones');
    expect(html).not.toContain('Vence en la flota');
  });
});

/**
 * ⚠️ **Los avisos del sistema se prueban porque el fallo típico de este proyecto
 * es una etiqueta escrita, traducida y nunca pintada.** Pasó con el «Recibido
 * de» del recibo. Aquí sería peor: el aviso existiría en el objeto, el correo
 * saldría, y el certificado caducaría igual.
 */
describe('los avisos del sistema', () => {
  const urgente = { clase: 'remision' as const, texto: 'Cadena PARADA', urgente: true };
  const tranquilo = { clase: 'certificado' as const, texto: 'Caduca en 30 días', urgente: false };

  it('se pintan en el HTML y en el texto plano', () => {
    const { html, text } = renderDigestEmail({ ...base, avisos: [tranquilo] }, EMPRESA);
    expect(html).toContain('Caduca en 30 días');
    expect(text).toContain('Caduca en 30 días');
  });

  /**
   * Lo de abajo se hace hoy; esto no se hace nunca si no se ve. Detrás de tres
   * entregas, un aviso de caducidad no se lee.
   */
  it('van ARRIBA, antes que las entregas', () => {
    const { html } = renderDigestEmail(
      { ...base, avisos: [urgente], entregas: [entrega()] },
      EMPRESA
    );
    expect(html.indexOf('Cadena PARADA')).toBeLessThan(html.indexOf('Entregas'));
  });

  it('lo urgente se distingue de lo que solo hay que ir mirando', () => {
    const rojo = renderDigestEmail({ ...base, avisos: [urgente] }, EMPRESA).html;
    const ambar = renderDigestEmail({ ...base, avisos: [tranquilo] }, EMPRESA).html;
    // El fondo, no el color de la tinta: es lo que se ve de un vistazo y lo que
    // distingue «esto está parado» de «esto hay que mirarlo en un mes».
    expect(rojo).toContain('background:#fdeceb');
    expect(ambar).toContain('background:#fbf3e2');
    expect(rojo).not.toContain('background:#fbf3e2');
  });

  /**
   * En el texto plano no hay color, así que la distinción tiene que estar en las
   * palabras. Hay clientes de correo que solo enseñan esa versión.
   */
  it('y en el texto plano, que no tiene color, lo urgente va marcado', () => {
    const rojo = renderDigestEmail({ ...base, avisos: [urgente] }, EMPRESA).text;
    const ambar = renderDigestEmail({ ...base, avisos: [tranquilo] }, EMPRESA).text;
    expect(rojo).toContain('*** Cadena PARADA ***');
    expect(ambar).not.toContain('***');
  });

  it('sin avisos no deja ningún hueco en el correo', () => {
    const { html, text } = renderDigestEmail({ ...base, entregas: [entrega()] }, EMPRESA);
    expect(html).not.toContain('border-left:4px solid');
    expect(text.split('\n')[1]).toBe('');
  });
});

/**
 * ⚠️ **Estos tests son la contrapartida del borrado a las 72 h.** Desde el 5 de
 * octubre de 2026 una solicitud que nadie contesta se borra sola, y lo único
 * que lo hace defendible es que antes se avise — en un correo que llega sin
 * abrir la aplicación, que es justo el caso del que no ha contestado.
 *
 * Y el patrón de fallo de esta casa es el código escrito y nunca ejecutado: la
 * sección existiría en el objeto, el correo saldría, y la solicitud se borraría
 * igual. Por eso se comprueba lo PINTADO, en las dos versiones.
 */
describe('las solicitudes sin contestar', () => {
  const pendiente = (horasRestantes: number) => ({
    referencia: 'SOL-2026-0007',
    cliente: 'Cliente Pruebas',
    telefono: '600 11 22 33',
    coche: 'Kia Ceed',
    horasRestantes
  });

  it('se pintan en el HTML y en el texto plano', () => {
    const { html, text } = renderDigestEmail({ ...base, sinContestar: [pendiente(48)] }, EMPRESA);
    expect(html).toContain('Sin contestar');
    expect(html).toContain('SOL-2026-0007');
    expect(html).toContain('600 11 22 33');
    expect(text).toContain('SIN CONTESTAR');
    expect(text).toContain('SOL-2026-0007');
  });

  /**
   * ⚠️ **Se dice lo que LE QUEDA, no cuándo llegó.** «Llegó hace dos días» hay
   * que restarlo mentalmente; «se borra en 12 h» se entiende de un vistazo, que
   * es lo que hace que alguien coja el teléfono hoy.
   */
  it('la última vuelta avisa del borrado, en las dos versiones', () => {
    const { html, text } = renderDigestEmail({ ...base, sinContestar: [pendiente(12)] }, EMPRESA);
    expect(html).toContain('Se borra en 12 h si nadie contesta');
    expect(text).toContain('se borra en 12 h si nadie contesta');
  });

  /** Ya pasada de plazo: el próximo barrido se la lleva, y hoy es el último día. */
  it('y la que ya cumplió el plazo lo dice sin inventarse un número', () => {
    const { html, text } = renderDigestEmail({ ...base, sinContestar: [pendiente(0)] }, EMPRESA);
    expect(html).toContain('en el próximo barrido');
    expect(text).toContain('en el próximo barrido');
    expect(html).not.toContain('en 0 h');
  });

  /**
   * Lo contrario también importa: con tres días por delante no hay nada que
   * gritar. Un aviso que suena igual el primer día que el último se deja de
   * leer, y arrastra consigo al que sí urgía.
   */
  it('la que tiene margen NO avisa de ningún borrado', () => {
    const { html, text } = renderDigestEmail({ ...base, sinContestar: [pendiente(60)] }, EMPRESA);
    expect(html).not.toContain('si nadie contesta');
    expect(text).not.toContain('***');
    expect(text).toContain('(quedan 60 h)');
  });

  it('sin ninguna, la sección no se pinta', () => {
    const { html, text } = renderDigestEmail({ ...base, entregas: [entrega()] }, EMPRESA);
    expect(html).not.toContain('Sin contestar');
    expect(text).not.toContain('SIN CONTESTAR');
  });
});
