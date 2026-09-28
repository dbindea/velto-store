/**
 * Lo que se puede hacer con una solicitud, y lo que se le dice al cliente.
 *
 * ⚠️ Lo que se prueba aquí no es el camino feliz: es que **caducar el precio no
 * caduque al cliente**, que no se pueda convertir dos veces, y que el mensaje
 * de WhatsApp no prometa el coche — porque la web ya dijo que no está apartado
 * y contradecirse por WhatsApp es peor que no escribir.
 */

import { describe, expect, it } from 'vitest';
import type { BookingRequest } from '@shared/models/booking-request.model';
import {
  canConvert,
  canDiscard,
  formatPhone,
  newCount,
  priceStillGuaranteed,
  sortRequests,
  telLink,
  whatsappLink,
  whatsappMessage
} from './booking-request.util';

function solicitud(p: Partial<BookingRequest> = {}): BookingRequest {
  return {
    reference: 'P-4K7M9X',
    status: 'new',
    name: 'Marius Ionescu',
    phone: '34612345678',
    note: '',
    vehicleId: 'v1',
    vehicleSnapshot: { brand: 'Renault', model: 'Clio', category: 'compact' },
    quoteSnapshot: { totalDays: 3, net: 156, gross: 188.76, vatRate: 0.21, currency: 'EUR' },
    keepHours: 24,
    ...p
  } as BookingRequest;
}

describe('priceStillGuaranteed', () => {
  const AHORA = new Date('2026-09-28T18:00:00');

  it('dentro del plazo, sí', () => {
    const r = solicitud({ priceGuaranteedUntil: new Date('2026-09-29T18:00:00') });
    expect(priceStillGuaranteed(r, AHORA)).toBe(true);
  });

  it('pasado el plazo, no', () => {
    const r = solicitud({ priceGuaranteedUntil: new Date('2026-09-28T17:59:00') });
    expect(priceStillGuaranteed(r, AHORA)).toBe(false);
  });

  it('CADUCAR EL PRECIO NO CADUCA LA SOLICITUD', () => {
    // Lo único que deja de sostenerse es la cifra: el teléfono sigue sirviendo
    // y la llamada sigue mereciendo la pena.
    const r = solicitud({ priceGuaranteedUntil: new Date('2020-01-01') });
    expect(priceStillGuaranteed(r, AHORA)).toBe(false);
    expect(canConvert(r)).toBe(true);
    expect(canDiscard(r)).toBe(true);
  });

  it('sin fecha guardada no se afirma que siga en pie', () => {
    expect(priceStillGuaranteed(solicitud(), AHORA)).toBe(false);
  });
});

describe('canConvert', () => {
  it.each(['new', 'contacted'] as const)('desde %s sí', (status) => {
    expect(canConvert(solicitud({ status }))).toBe(true);
  });

  it('UNA CONVERTIDA NO SE CONVIERTE DOS VECES', () => {
    // Sin esto, dos clics seguidos crearían dos reservas del mismo coche para
    // las mismas fechas, y la segunda bloquearía un coche que nadie pidió.
    expect(canConvert(solicitud({ status: 'converted' }))).toBe(false);
  });

  it('una descartada tampoco', () => {
    expect(canConvert(solicitud({ status: 'discarded' }))).toBe(false);
  });
});

describe('canDiscard', () => {
  it('una descartada se puede recuperar y volver a descartar', () => {
    expect(canDiscard(solicitud({ status: 'discarded' }))).toBe(true);
  });

  it('una convertida ya no: hay una reserva detrás', () => {
    expect(canDiscard(solicitud({ status: 'converted' }))).toBe(false);
  });
});

describe('el mensaje de WhatsApp', () => {
  const msg = whatsappMessage(solicitud(), 'VELTO MOBILITY');

  it('lleva la referencia, que es su motivo de ser', () => {
    expect(msg).toContain('P-4K7M9X');
  });

  it('lleva el coche, los días y el precio que vio', () => {
    expect(msg).toContain('Renault Clio');
    expect(msg).toContain('3 días');
    expect(msg).toContain('188,76');
  });

  it('NO promete el coche', () => {
    // La web ya dijo que no está apartado. Contradecirlo por WhatsApp es peor
    // que no escribir: el cliente se queda con lo último que leyó.
    expect(msg).toContain('no está apartado');
    expect(msg).not.toMatch(/te lo guardo|reservado para ti|apartado para ti/i);
  });

  it('y el enlace lo lleva codificado', () => {
    const enlace = whatsappLink(solicitud(), 'VELTO MOBILITY');
    expect(enlace.startsWith('https://wa.me/34612345678?text=')).toBe(true);
    expect(decodeURIComponent(enlace.split('text=')[1])).toBe(msg);
  });

  it('un día no se escribe «1 días»', () => {
    const uno = whatsappMessage(
      solicitud({ quoteSnapshot: { totalDays: 1, net: 52, gross: 62.92, vatRate: 0.21, currency: 'EUR' } }),
      'VELTO MOBILITY'
    );
    expect(uno).toContain('1 día ');
    expect(uno).not.toContain('1 días');
  });
});

describe('telLink', () => {
  it('lleva el + que el teléfono guardado no tiene', () => {
    // Se guarda sin `+` porque es lo que `wa.me` necesita; un `tel:` sin él
    // marca un número nacional equivocado desde el extranjero.
    expect(telLink(solicitud())).toBe('tel:+34612345678');
  });
});

describe('la lista', () => {
  it('cuenta las que están sin atender', () => {
    expect(
      newCount([
        solicitud({ status: 'new' }),
        solicitud({ status: 'new' }),
        solicitud({ status: 'contacted' }),
        solicitud({ status: 'converted' })
      ])
    ).toBe(2);
  });

  it('LO SIN ATENDER VA PRIMERO, aunque sea más viejo', () => {
    // Ordenando solo por fecha, la que lleva dos días sin contestar queda
    // debajo de las convertidas de hoy, que ya no son trabajo.
    const vieja = solicitud({ reference: 'VIEJA', status: 'new', createdAt: new Date('2026-09-26') });
    const nueva = solicitud({ reference: 'HECHA', status: 'converted', createdAt: new Date('2026-09-28') });
    expect(sortRequests([nueva, vieja]).map((r) => r.reference)).toEqual(['VIEJA', 'HECHA']);
  });

  it('y dentro del mismo estado, lo más reciente primero', () => {
    const a = solicitud({ reference: 'A', createdAt: new Date('2026-09-27') });
    const b = solicitud({ reference: 'B', createdAt: new Date('2026-09-28') });
    expect(sortRequests([a, b]).map((r) => r.reference)).toEqual(['B', 'A']);
  });

  it('no muta la lista que recibe', () => {
    const original = [solicitud({ reference: 'A', status: 'converted' }), solicitud({ reference: 'B' })];
    sortRequests(original);
    expect(original.map((r) => r.reference)).toEqual(['A', 'B']);
  });
});

describe('formatPhone', () => {
  it('separa el español en tres grupos, que es como se dicta', () => {
    expect(formatPhone('34600111222')).toBe('+34 600 111 222');
  });

  it('también un fijo, que empieza por 9', () => {
    expect(formatPhone('34911234567')).toBe('+34 911 234 567');
  });

  it('LO EXTRANJERO SE DEJA ENTERO', () => {
    // Partirlo con la regla española haría que un número correcto se leyera
    // como si estuviera mal escrito. Cada país agrupa a su manera.
    expect(formatPhone('40721234567')).toBe('+40721234567');
    expect(formatPhone('447700900123')).toBe('+447700900123');
  });

  it('y el número que guarda la web sigue siendo el que marca el enlace', () => {
    // El formato es para leer; `tel:` y `wa.me` necesitan los dígitos pelados.
    const r = solicitud({ phone: '34600111222' });
    expect(telLink(r)).toBe('tel:+34600111222');
    expect(formatPhone(r.phone)).toBe('+34 600 111 222');
  });
});
