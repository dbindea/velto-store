import { describe, expect, it } from 'vitest';
import { renderDigestEmail } from './digest-email';
import type { Resumen } from './daily-digest';

const EMPRESA = { brandName: 'VELTO MOBILITY' };

const base: Resumen = {
  fecha: '11/09/2026',
  entregas: [],
  devoluciones: [],
  vencimientos: [],
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
   * caducada el coche **no se puede alquilar**, así que no puede leerse como un
   * recordatorio más.
   */
  it('distingue lo vencido de lo que falta por vencer', () => {
    const vencido = renderDigestEmail(
      {
        ...base,
        vencimientos: [
          { vehiculo: '0951LTL', concepto: 'ITV', fecha: '01/09/2026', diasRestantes: -9 }
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
          { vehiculo: '0951LTL', concepto: 'ITV', fecha: '17/09/2026', diasRestantes: 7 }
        ]
      },
      EMPRESA
    );
    expect(porVencer.html).not.toContain('VENCIDO');
    expect(porVencer.html).toContain('en 7 días');
  });

  it('«en 1 día», no «en 1 días»', () => {
    const { html } = renderDigestEmail(
      {
        ...base,
        vencimientos: [{ vehiculo: '0951LTL', concepto: 'ITV', fecha: '11/09/2026', diasRestantes: 1 }]
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
