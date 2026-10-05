import { describe, expect, it } from 'vitest';
import { renderContactEmail, type ContactEmailData } from './contact-email';

/**
 * ⚠️ **Lo que se comprueba es que el correo diga TODO lo que la persona
 * escribió.** Es el único sitio donde ese mensaje existe: no hay pantalla en el
 * backoffice que lo enseñe, así que un campo que no se pinte aquí es un campo
 * que Dorel no va a leer nunca — y no falla nada, porque el correo llega igual.
 */

const base: ContactEmailData = {
  reference: 'C-4K7M9X',
  motivo: 'otra',
  name: 'Marius Ionescu',
  phone: '34612345678',
  email: '',
  mensaje: '',
  duracion: '',
  queCoche: '',
  domicilio: false,
  lugar: '',
  coche: '',
  anio: '',
  poblacion: '',
  parado: '',
};

const opciones = { brandName: 'VELTO MOBILITY' };

describe('lo que siempre tiene que estar', () => {
  it('el nombre, el telefono legible y la referencia', () => {
    const { html, text, subject } = renderContactEmail(base, opciones);
    for (const salida of [html, text]) {
      expect(salida).toContain('Marius Ionescu');
      expect(salida).toContain('+34 612 345 678');
      expect(salida).toContain('C-4K7M9X');
    }
    expect(subject).toContain('C-4K7M9X');
  });

  it('el telefono se puede marcar de un toque', () => {
    const { html } = renderContactEmail(base, opciones);
    expect(html).toContain('href="tel:+34612345678"');
  });

  it('el asunto dice de que va sin abrirlo', () => {
    expect(renderContactEmail({ ...base, motivo: 'alquilar' }, opciones).subject).toContain(
      'Quiere alquilar un coche'
    );
    expect(
      renderContactEmail({ ...base, motivo: 'poner-en-alquiler' }, opciones).subject
    ).toContain('Quiere poner su coche en alquiler');
  });
});

describe('el mensaje de la persona va ENTERO', () => {
  it('en el HTML y en el texto plano', () => {
    const largo = 'Necesito un coche para llevar a mi madre al médico tres días.';
    const { html, text } = renderContactEmail({ ...base, mensaje: largo }, opciones);
    expect(html).toContain(largo);
    expect(text).toContain(largo);
  });

  it('sin mensaje no se pinta una seccion vacia', () => {
    const { html } = renderContactEmail(base, opciones);
    expect(html).not.toContain('Su mensaje');
  });
});

describe('cada rama pinta lo suyo y nada de la otra', () => {
  it('alquilar', () => {
    const { html, text } = renderContactEmail(
      { ...base, motivo: 'alquilar', duracion: '4-7', queCoche: 'un familiar', domicilio: true, lugar: 'Rivas' },
      opciones
    );
    for (const salida of [html, text]) {
      expect(salida).toContain('De 4 a 7 días');
      expect(salida).toContain('un familiar');
      expect(salida).toContain('Rivas');
    }
  });

  it('poner en alquiler', () => {
    const { html, text } = renderContactEmail(
      { ...base, motivo: 'poner-en-alquiler', coche: 'Seat Ibiza', anio: '2019', poblacion: 'Arganda del Rey', parado: 'tres meses' },
      opciones
    );
    for (const salida of [html, text]) {
      expect(salida).toContain('Seat Ibiza');
      expect(salida).toContain('2019');
      expect(salida).toContain('Arganda del Rey');
      expect(salida).toContain('tres meses');
    }
  });

  it('a domicilio sin decir donde se dice asi, no se calla', () => {
    const { html } = renderContactEmail({ ...base, motivo: 'alquilar', domicilio: true }, opciones);
    expect(html).toContain('Sí, sin decir dónde');
  });
});

describe('el correo es opcional y se nota', () => {
  it('con correo, se puede contestar de un toque', () => {
    const { html } = renderContactEmail({ ...base, email: 'marius@ejemplo.com' }, opciones);
    expect(html).toContain('href="mailto:marius@ejemplo.com"');
  });

  it('sin correo no se pinta una fila vacia', () => {
    expect(renderContactEmail(base, opciones).html).not.toContain('Su correo');
    expect(renderContactEmail(base, opciones).text).not.toContain('Correo');
  });
});

/**
 * ⚠️ Todo lo que entra aquí lo ha escrito un desconocido en una web pública.
 */
describe('lo que escribe un desconocido va escapado', () => {
  it('no se cuela HTML en el correo', () => {
    const { html } = renderContactEmail(
      { ...base, name: '<script>alert(1)</script>', mensaje: 'a & b < c' },
      opciones
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b &lt; c');
  });
});

describe('la version de texto plano existe de verdad', () => {
  it('no viene vacia, que puntuaria como spam', () => {
    const { text } = renderContactEmail({ ...base, mensaje: 'hola' }, opciones);
    expect(text.trim().length).toBeGreaterThan(60);
    expect(text).not.toContain('<');
  });
});
