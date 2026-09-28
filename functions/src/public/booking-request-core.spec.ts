/**
 * Lo que entra por el único endpoint público que ESCRIBE.
 *
 * ⚠️ **Aquí no hay operador que vea nada.** En una pantalla del backoffice un
 * dato raro se ve y se corrige; esto lo rellena cualquiera del mundo y se guarda
 * solo. Por eso lo que se prueba no es el camino feliz, sino lo que hay que
 * rechazar y lo que hay que dejar pasar aunque parezca raro — un teléfono
 * escrito con espacios lo escribe todo el mundo.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_NAME,
  MAX_NOTE,
  generateReference,
  looksAutomated,
  normalizePhone,
  priceGuaranteedUntil,
  validateBookingRequest
} from './booking-request-core';

const BASE = { vehicleId: 'abc123', name: 'Marius Ionescu', phone: '612345678' };

describe('normalizePhone', () => {
  it.each([
    ['612345678', '34612345678'],
    ['612 345 678', '34612345678'],
    ['612-345-678', '34612345678'],
    ['+34 612 345 678', '34612345678'],
    ['+40 721 234 567', '40721234567'],
    ['(612) 345.678', '34612345678']
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizePhone(entrada)).toBe(esperado);
  });

  it('un móvil español sin prefijo se asume de España', () => {
    // Es el caso normal: un vecino de Arganda no escribe el +34.
    expect(normalizePhone('699123456')).toBe('34699123456');
  });

  it('pero NO se le inventa el prefijo a quien sí lo puso', () => {
    expect(normalizePhone('+1 2025550123')).toBe('12025550123');
  });

  it.each(['', 'no tengo', '12345', 'seis uno dos', '++34612345678', '612345678a'])(
    'rechaza %s',
    (entrada) => {
      expect(normalizePhone(entrada)).toBeNull();
    }
  );
});

describe('validateBookingRequest', () => {
  it('acepta lo normal y normaliza el teléfono', () => {
    const r = validateBookingRequest({ ...BASE, note: '  lo necesito   por la tarde ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.phone).toBe('34612345678');
    // Los espacios de más se colapsan: el operador lee esto en una tarjeta.
    expect(r.fields.note).toBe('lo necesito por la tarde');
  });

  it('EL TELÉFONO ES OBLIGATORIO', () => {
    // Decisión de Dorel: sin teléfono no hay forma de devolver la llamada ni de
    // seguir por WhatsApp con la referencia, que es todo el motivo de esto.
    const r = validateBookingRequest({ ...BASE, phone: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('missing-phone');
  });

  it.each([
    [{ vehicleId: '' }, 'missing-vehicle'],
    [{ vehicleId: '../../otra/cosa' }, 'missing-vehicle'],
    [{ name: '' }, 'missing-name'],
    [{ name: 'A' }, 'missing-name'],
    [{ phone: 'llámame' }, 'bad-phone']
  ] as const)('rechaza %j con %s', (parche, error) => {
    const r = validateBookingRequest({ ...BASE, ...parche });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe(error);
  });

  it('recorta lo largo en vez de rechazarlo', () => {
    // Un nombre de 200 caracteres es raro, no es un ataque; lo que no puede
    // pasar es que se guarde entero. El tope es la defensa, no el rechazo.
    const r = validateBookingRequest({ ...BASE, name: 'x'.repeat(200) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.name.length).toBe(MAX_NAME);
  });

  it('pero una nota absurdamente larga sí se rechaza', () => {
    // Un endpoint público que escribe: sin tope, cada petición deja un
    // documento de un megabyte en Firestore.
    const r = validateBookingRequest({ ...BASE, note: 'x'.repeat(MAX_NOTE * 2 + 1) });
    expect(r.ok).toBe(false);
  });

  it('lo que no es cadena no se cuela', () => {
    const r = validateBookingRequest({ ...BASE, name: { toString: () => 'listillo' } });
    expect(r.ok).toBe(false);
  });

  it('EL PRECIO no se lee de la petición', () => {
    // Si viajara, cualquiera pediría el coche por un euro. Lo calcula el
    // servidor, como el importe del recibo se lee del pago.
    const r = validateBookingRequest({ ...BASE, price: 1, total: 1 } as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.fields).sort()).toEqual(['name', 'note', 'phone', 'vehicleId']);
  });
});

describe('el campo trampa', () => {
  it('relleno = robot', () => {
    expect(looksAutomated({ trap: 'http://spam' })).toBe(true);
  });

  it.each([undefined, '', '   '])('vacío (%j) = persona', (v) => {
    expect(looksAutomated({ trap: v })).toBe(false);
  });
});

describe('generateReference', () => {
  it('lleva prefijo y seis símbolos', () => {
    expect(generateReference()).toMatch(/^P-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it('NO usa los símbolos que se confunden al dictarla', () => {
    // Se lee por teléfono: I/1, O/0, L y U fuera.
    const muchas = Array.from({ length: 300 }, () => generateReference()).join('');
    expect(muchas).not.toMatch(/[ILOU01]/);
  });

  it('no se repite en trescientas', () => {
    const vistas = new Set(Array.from({ length: 300 }, () => generateReference()));
    expect(vistas.size).toBe(300);
  });
});

describe('priceGuaranteedUntil', () => {
  it('suma las horas pactadas', () => {
    const ahora = new Date('2026-09-28T18:40:00');
    expect(priceGuaranteedUntil(ahora, 24).toISOString()).toBe(
      new Date('2026-09-29T18:40:00').toISOString()
    );
  });

  it('se calcula al crear, no al mirar', () => {
    // La fecha se congela en la solicitud: cambiar el plazo en Ajustes no puede
    // mover la caducidad de las que ya existen. Misma regla que el IVA del
    // `pricingSnapshot`.
    const ahora = new Date('2026-09-28T18:40:00');
    const con24 = priceGuaranteedUntil(ahora, 24);
    const con48 = priceGuaranteedUntil(ahora, 48);
    expect(con48.getTime() - con24.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

/**
 * El nombre, escrito como se imprime.
 *
 * ⚠️ Es el fallo que CLAUDE.md dice que se repite —el campo que nace fuera del
 * formulario y se queda sin la regla— y este nace en una web pública, que es lo
 * más fuera que hay. El nombre acaba en el saludo del WhatsApp y, al convertir,
 * en el contrato que el cliente firma.
 */
describe('el nombre se capitaliza', () => {
  const nombreDe = (v: string) => {
    const r = validateBookingRequest({ ...BASE, name: v });
    return r.ok ? r.fields.name : null;
  };

  it.each([
    ['marius ionescu', 'Marius Ionescu'],
    ['MARIUS IONESCU', 'Marius Ionescu'],
    ['  prueba   CLAUDE ', 'Prueba Claude'],
    ['maría josé', 'María José']
  ])('%s → %s', (entrada, esperado) => {
    expect(nombreDe(entrada)).toBe(esperado);
  });

  it('respeta las preposiciones internas, que es la regla del español', () => {
    expect(nombreDe('juan de la cruz')).toBe('Juan de la Cruz');
  });

  it('pero no al empezar la cadena', () => {
    expect(nombreDe('de la fuente')).toBe('De la Fuente');
  });

  it('el apóstrofo es límite de palabra, como en la app', () => {
    // Comprobado contra la copia de la app: las dos dan lo mismo en los doce
    // casos que se probaron, este incluido.
    expect(nombreDe("sean o'brien")).toBe("Sean O'Brien");
  });
});
