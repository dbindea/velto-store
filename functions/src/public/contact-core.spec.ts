import { describe, expect, it } from 'vitest';
import {
  generateContactReference,
  looksAutomated,
  normalizeEmail,
  validateContact,
} from './contact-core';

/**
 * ⚠️ **Lo que se prueba aquí es lo que decide si un mensaje LLEGA**, que es la
 * única función de este formulario. Un rechazo injusto es un cliente perdido
 * sin que nadie se entere: no deja rastro en ninguna parte, porque el mensaje
 * nunca existió.
 */

const minimo = { motivo: 'otra', name: 'marius ionescu', phone: '612345678' };

describe('lo minimo para que un mensaje entre', () => {
  it('acepta motivo, nombre y telefono, y nada mas', () => {
    const r = validateContact(minimo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.motivo).toBe('otra');
    expect(r.fields.phone).toBe('34612345678');
  });

  it('capitaliza el nombre, porque acaba en un correo y en una ficha', () => {
    const r = validateContact({ ...minimo, name: 'MARIUS DE la fuente' });
    expect(r.ok && r.fields.name).toBe('Marius de la Fuente');
  });

  it('rechaza un motivo que no existe, en vez de guardarlo', () => {
    expect(validateContact({ ...minimo, motivo: 'comprar' })).toEqual({
      ok: false,
      error: 'bad-motivo',
    });
    expect(validateContact({ ...minimo, motivo: '' }).ok).toBe(false);
    expect(validateContact({ ...minimo, motivo: undefined }).ok).toBe(false);
  });

  it('rechaza un nombre que no es un nombre', () => {
    expect(validateContact({ ...minimo, name: 'a' }).ok).toBe(false);
    expect(validateContact({ ...minimo, name: '   ' }).ok).toBe(false);
    expect(validateContact({ ...minimo, name: 123 }).ok).toBe(false);
  });

  it('rechaza sin telefono: sin el no hay forma de devolver la llamada', () => {
    expect(validateContact({ ...minimo, phone: '' }).ok).toBe(false);
    expect(validateContact({ ...minimo, phone: 'llamame' }).ok).toBe(false);
  });
});

describe('el correo es opcional, pero si viene tiene que serlo', () => {
  it('sin correo pasa', () => {
    expect(validateContact(minimo).ok).toBe(true);
    expect(validateContact({ ...minimo, email: '' }).ok).toBe(true);
  });

  it('un correo valido se guarda en minusculas', () => {
    const r = validateContact({ ...minimo, email: '  Marius@Ejemplo.COM ' });
    expect(r.ok && r.fields.email).toBe('marius@ejemplo.com');
  });

  it('lo que no es un correo se rechaza, en vez de guardar basura', () => {
    expect(normalizeEmail('no tengo')).toBeNull();
    expect(normalizeEmail('marius@')).toBeNull();
    expect(normalizeEmail('@ejemplo.com')).toBeNull();
    expect(validateContact({ ...minimo, email: 'pregunta por mi' }).ok).toBe(false);
  });
});

/**
 * El filtro por rama es lo que impide que el correo diga dos cosas a la vez: el
 * navegador manda TODO lo que hay en el formulario, incluidas las ramas
 * escondidas.
 */
describe('los campos de una rama que no se eligio se descartan', () => {
  const todo = {
    ...minimo,
    duracion: '4-7',
    queCoche: 'un familiar',
    domicilio: 'si',
    lugar: 'Rivas',
    coche: 'Seat Ibiza',
    anio: '2019',
    poblacion: 'arganda del rey',
    parado: 'tres meses',
  };

  it('«alquilar» se queda con lo suyo y tira lo del otro lado', () => {
    const r = validateContact({ ...todo, motivo: 'alquilar' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.duracion).toBe('4-7');
    expect(r.fields.queCoche).toBe('un familiar');
    expect(r.fields.domicilio).toBe(true);
    expect(r.fields.lugar).toBe('Rivas');
    // Y nada de la otra rama.
    expect(r.fields.coche).toBe('');
    expect(r.fields.anio).toBe('');
    expect(r.fields.poblacion).toBe('');
    expect(r.fields.parado).toBe('');
  });

  it('«poner en alquiler» al reves', () => {
    const r = validateContact({ ...todo, motivo: 'poner-en-alquiler' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.coche).toBe('Seat Ibiza');
    expect(r.fields.poblacion).toBe('Arganda del Rey');
    expect(r.fields.duracion).toBe('');
    expect(r.fields.queCoche).toBe('');
    expect(r.fields.domicilio).toBe(false);
    expect(r.fields.lugar).toBe('');
  });

  it('«otra» no se queda con nada de las dos ramas', () => {
    const r = validateContact({ ...todo, motivo: 'otra' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.duracion).toBe('');
    expect(r.fields.coche).toBe('');
  });

  it('una duracion que no esta en la lista se descarta, no se guarda', () => {
    const r = validateContact({ ...minimo, motivo: 'alquilar', duracion: 'un rato' });
    expect(r.ok && r.fields.duracion).toBe('');
  });
});

describe('los topes de longitud, que es un endpoint publico que escribe', () => {
  it('recorta el mensaje en vez de rechazarlo', () => {
    const r = validateContact({ ...minimo, mensaje: 'x'.repeat(5000) });
    expect(r.ok && r.fields.mensaje.length).toBe(1200);
  });

  it('colapsa los espacios', () => {
    const r = validateContact({ ...minimo, mensaje: 'hola\n\n   que    tal' });
    expect(r.ok && r.fields.mensaje).toBe('hola que tal');
  });
});

describe('la trampa', () => {
  it('un campo escondido relleno delata al robot', () => {
    expect(looksAutomated({ trap: 'http://spam' })).toBe(true);
  });

  it('vacio o ausente es una persona', () => {
    expect(looksAutomated({ trap: '' })).toBe(false);
    expect(looksAutomated({ trap: '   ' })).toBe(false);
    expect(looksAutomated({})).toBe(false);
  });
});

describe('la referencia', () => {
  it('lleva el prefijo C, que la distingue de la P de una reserva', () => {
    expect(generateContactReference()).toMatch(/^C-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it('no trae ninguna letra que se confunda al dictarla por telefono', () => {
    const muchas = Array.from({ length: 200 }, () => generateContactReference()).join('');
    expect(muchas).not.toMatch(/[ILOU01]/);
  });
});
