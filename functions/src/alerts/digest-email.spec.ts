import { describe, expect, it } from 'vitest';
import { renderDigestEmail } from './digest-email';
import type { Resumen } from './daily-digest';

const EMPRESA = { brandName: 'VELTO MOBILITY' };

const base: Resumen = {
  fecha: '11/09/2026',
  entregas: [],
  devoluciones: [],
  vencimientos: [],
  sinFirmar: 0
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
