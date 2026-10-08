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
  canExtendGuarantee,
  canMarkContacted,
  extendedGuaranteeUntil,
  formatPhone,
  newCount,
  promisedPriceCeiling,
  requestPickupAt,
  requestReturnAt,
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

describe('el mensaje de WhatsApp', () => {
  const msg = whatsappMessage(solicitud(), 'Velto Mobility');

  /**
   * ⚠️ **El texto es de Dorel y se comprueba ENTERO, no por trozos.** Es lo que
   * va a leer un cliente: si alguien lo reescribe «mejorándolo», este test lo
   * para y obliga a que la decisión la tome él, que es de quien es la voz.
   */
  it('es exactamente el texto que Dorel escribió', () => {
    /**
     * ⚠️ **El espacio que va antes del € no es un capricho del test.** Es el espacio
     * DURO que `Intl.NumberFormat('es-ES')` mete entre el importe y el símbolo,
     * y es correcto: impide que «188,76» y «€» acaben en líneas distintas. Con
     * un espacio normal aquí, el test falla enseñando dos cadenas que **se ven
     * idénticas** — que es exactamente lo que pasó al escribirlo.
     *
     * ⚠️ **Y va como escape, no como el carácter.** Escrito tal cual es un
     * espacio invisible dentro del código: el lint lo marca con razón
     * (`no-irregular-whitespace`), porque quien lo lea después no tiene forma de
     * saber que ahí hay algo distinto de un espacio normal.
     */
    expect(msg).toBe(
      'Hola Marius Ionescu, te contacto de Velto Mobility en relación a tu solicitud ' +
        'del alquiler del coche Renault Clio · 3 días · 188,76\u00a0€ (IVA incluido). ' +
        '¿Deseas finalizar la reserva?'
    );
  });

  it('lleva el coche, los días y el precio que vio', () => {
    expect(msg).toContain('Renault Clio');
    expect(msg).toContain('3 días');
    expect(msg).toContain('188,76');
  });

  /**
   * ⚠️ **La referencia NO va dentro, y es deliberado.** Un código no le dice
   * nada a quien recibe el mensaje; el coche, los días y el precio sí, y son lo
   * que vio en la web. La referencia vive en la ficha, para el operador.
   */
  it('no lleva la referencia, que no significa nada para el cliente', () => {
    expect(msg).not.toContain('P-4K7M9X');
  });

  it('NO promete el coche', () => {
    // La web dijo que no queda reservado. «¿Deseas finalizar la reserva?» dice
    // lo mismo: que todavía no la hay. Contradecirlo por WhatsApp es peor que
    // no escribir, porque el cliente se queda con lo último que leyó.
    expect(msg).not.toMatch(/te lo guardo|reservado para ti|apartado para ti|te lo reservo/i);
  });

  it('y el enlace lo lleva codificado', () => {
    const enlace = whatsappLink(solicitud(), msg);
    expect(enlace.startsWith('https://wa.me/34612345678?text=')).toBe(true);
    expect(decodeURIComponent(enlace.split('text=')[1])).toBe(msg);
  });

  /**
   * ⚠️ **Lo que se manda es lo EDITADO, no el borrador.** Es toda la razón de
   * que `whatsappLink()` reciba el texto en vez de componerlo: componiéndolo,
   * el operador reescribiría el mensaje y saldría el de siempre — y no se
   * enteraría hasta verlo en el chat del cliente.
   */
  it('el enlace manda lo que el operador escribió, no el borrador', () => {
    const suyo = 'Hola María, soy Dorel de VELTO. ¿Te viene bien que te llame ahora?';
    const enlace = whatsappLink(solicitud(), suyo);
    expect(decodeURIComponent(enlace.split('text=')[1])).toBe(suyo);
    expect(enlace).not.toContain('P-4K7M9X');
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

describe('qué se puede hacer con cada solicitud', () => {
  /**
   * ⚠️ **UNA CONVERTIDA NO SE CONVIERTE DOS VECES.** Sin esto, dos clics
   * seguidos —o dos pestañas abiertas— crearían dos reservas del mismo coche
   * para las mismas fechas, y la segunda bloquearía un coche que nadie pidió.
   */
  it('convertir: todo menos lo ya convertido o descartado', () => {
    expect(canConvert(solicitud({ status: 'new' }))).toBe(true);
    expect(canConvert(solicitud({ status: 'contacted' }))).toBe(true);
    expect(canConvert(solicitud({ status: 'converted' }))).toBe(false);
    expect(canConvert(solicitud({ status: 'discarded' }))).toBe(false);
  });

  /**
   * ⚠️ **Volver a descartar una descartada APLAZA el borrado**, y por eso no se
   * puede. `marcar()` reescribe `handledAt`, que es el sello desde el que
   * cuenta `keepHours`: cada pulsación regala otras 24 h de conservación al
   * nombre y al teléfono de alguien a quien ya se decidió no atender.
   */
  it('descartar: ni lo convertido ni lo YA descartado', () => {
    expect(canDiscard(solicitud({ status: 'new' }))).toBe(true);
    expect(canDiscard(solicitud({ status: 'contacted' }))).toBe(true);
    expect(canDiscard(solicitud({ status: 'converted' }))).toBe(false);
    expect(canDiscard(solicitud({ status: 'discarded' }))).toBe(false);
  });

  /** Por lo mismo: marcar dos veces contactada movería el reloj otra vez. */
  it('marcar contactada: solo lo que está sin contestar', () => {
    expect(canMarkContacted(solicitud({ status: 'new' }))).toBe(true);
    expect(canMarkContacted(solicitud({ status: 'contacted' }))).toBe(false);
    expect(canMarkContacted(solicitud({ status: 'converted' }))).toBe(false);
    expect(canMarkContacted(solicitud({ status: 'discarded' }))).toBe(false);
  });
});

describe('la hora que nadie dijo', () => {
  /**
   * ⚠️ **Este es el test que importa.** Lo guardado es la ventana de
   * disponibilidad —00:00 y 23:59:59.999—, y llevarla tal cual al asistente
   * daba una recogida a medianoche y una devolución a las 23:59. Ninguna de las
   * dos es una hora a la que se entregue un coche.
   */
  it('convierte la ventana de días completos en dos mediodías', () => {
    const r = solicitud({
      pickupDate: new Date(2026, 10, 2, 0, 0, 0, 0),
      returnDate: new Date(2026, 10, 9, 23, 59, 59, 999)
    });
    const recogida = requestPickupAt(r)!;
    const devolucion = requestReturnAt(r)!;

    expect(recogida.getDate()).toBe(2);
    expect(recogida.getHours()).toBe(12);
    expect(devolucion.getDate()).toBe(9);
    expect(devolucion.getHours()).toBe(12);
  });

  /**
   * ⚠️ **El test que faltaba, y el que de verdad importa.** El de arriba usa
   * las 23:59:59.999, que es lo que decía el comentario del util — pero NO es
   * lo que escribe el backend. `widenToFullDays()` corre en una Cloud Function
   * (UTC), suma un día y lo deja a medianoche, así que lo que hay en Firestore
   * es el **inicio del día siguiente**: una solicitud del 4 al 7 se guarda con
   * `returnDate = 2026-10-08T00:00:00Z`.
   *
   * Leerlo como inclusivo abría el asistente con cuatro días en vez de tres,
   * contradiciendo el «3 días · 187,95 €» de la misma ficha. Comprobado contra
   * las 18 solicitudes reales de desarrollo: las 18 tenían esta forma.
   */
  it('el fin de la ventana es EXCLUSIVO: medianoche UTC del día siguiente es el día anterior', () => {
    const r = solicitud({
      pickupDate: new Date('2026-10-04T00:00:00Z'),
      returnDate: new Date('2026-10-08T00:00:00Z')
    });

    const recogida = requestPickupAt(r)!;
    const devolucion = requestReturnAt(r)!;

    expect(recogida.getDate()).toBe(4);
    expect(recogida.getHours()).toBe(12);
    // El 7, no el 8: el cliente pidió del 4 al 7.
    expect(devolucion.getDate()).toBe(7);
    expect(devolucion.getHours()).toBe(12);
    expect(devolucion.getMinutes()).toBe(0);
  });

  it('y así la duración propuesta es la que se le cobró', () => {
    const r = solicitud({
      pickupDate: new Date('2026-10-04T00:00:00Z'),
      returnDate: new Date('2026-10-08T00:00:00Z')
    });
    const dias = Math.round(
      (requestReturnAt(r)!.getTime() - requestPickupAt(r)!.getTime()) / 86400000
    );
    expect(dias).toBe(3);
  });

  it('y NO arrastra los milisegundos del final del día', () => {
    // 23:59:59.999 con `setHours(12)` deja el `.999` dentro, y eso viaja al
    // campo del asistente.
    const r = solicitud({ returnDate: new Date(2026, 10, 9, 23, 59, 59, 999) });
    const d = requestReturnAt(r)!;
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('el día no se mueve, que es lo que una conversión a UTC sí haría', () => {
    const r = solicitud({ pickupDate: new Date(2026, 0, 1, 0, 0, 0, 0) });
    const d = requestPickupAt(r)!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it('sin fecha guardada contesta null, no la de hoy', () => {
    expect(requestPickupAt(solicitud({ pickupDate: undefined }))).toBeNull();
    expect(requestReturnAt(solicitud({ returnDate: undefined }))).toBeNull();
  });

  /**
   * ⚠️ **Lo que estos tres protegen es el descuadre del 5 de octubre de 2026.**
   * Un cliente pidió las 10:00 en la web; el correo le dijo 00:00, el
   * presupuesto 12:00 y el backoffice proponía 12:00 también — porque la hora
   * se usaba para cotizar y se tiraba al escribir la solicitud. Desde que la
   * function la guarda, **manda ella**; el mediodía se queda solo para las
   * solicitudes anteriores, que no la traen.
   */
  it('si la solicitud trae la hora pedida, manda ella y no el mediodía', () => {
    const r = solicitud({
      pickupDate: new Date(2026, 9, 24, 0, 0, 0, 0),
      returnDate: new Date(2026, 9, 26, 0, 0, 0, 0),
      pickupDateTime: new Date(2026, 9, 24, 10, 0, 0, 0),
      returnDateTime: new Date(2026, 9, 25, 10, 0, 0, 0)
    });
    expect(requestPickupAt(r)!.getHours()).toBe(10);
    expect(requestReturnAt(r)!.getHours()).toBe(10);
    // Y el día de devolución es el 25, no el 26 exclusivo de la ventana.
    expect(requestReturnAt(r)!.getDate()).toBe(25);
  });

  /**
   * ⚠️ **El final de la ventana es medianoche UTC, no local.** Lo escribe
   * `widenToFullDays()` y es lo que `alMediodia(…, true)` reconoce para restar
   * el día de más. Con un `new Date(2026, 9, 26)` —medianoche **local**— el
   * test pasaba a mano y describía una forma que Firestore no guarda nunca; es
   * el mismo despiste que ya tuvo la primera versión de estas pruebas.
   */
  it('sin la hora pedida sigue valiendo el mediodía, que es el caso antiguo', () => {
    const r = solicitud({
      pickupDate: new Date(Date.UTC(2026, 9, 24)),
      returnDate: new Date(Date.UTC(2026, 9, 26))
    });
    expect(requestPickupAt(r)!.getHours()).toBe(12);
    expect(requestReturnAt(r)!.getHours()).toBe(12);
    expect(requestReturnAt(r)!.getDate()).toBe(25);
  });

  /**
   * ⚠️ **Una hora ilegible NO tumba la ficha: cae al respaldo.** Es la regla de
   * la casa con los datos guardados —en la duda, lo que no se puede interpretar
   * no manda— y aquí evita que un documento raro deje la pantalla sin fechas.
   */
  it('una hora guardada ilegible cae al mediodía en vez de romper', () => {
    const r = solicitud({
      pickupDate: new Date(Date.UTC(2026, 9, 24)),
      pickupDateTime: 'cuando sea'
    });
    const d = requestPickupAt(r)!;
    expect(d.getHours()).toBe(12);
    // Y el DÍA es el que pidió el cliente, no el de hoy.
    expect(d.getDate()).toBe(24);
  });

  /**
   * ⚠️ **El caso que `toDate()` convertiría en «hoy».** Ese util cae a la fecha
   * actual ante cualquier cosa que no sepa leer —a propósito, para que un
   * documento corrupto no tumbe una vista con el pipe `date`—, y aquí eso
   * sería peor que el fallo: la solicitud propondría hoy como día de recogida y
   * el operador lo llevaría al asistente sin que nada chirriara.
   */
  it('un mapa vacío tampoco se cuela como la fecha de hoy', () => {
    const r = solicitud({
      pickupDate: new Date(Date.UTC(2026, 9, 24)),
      pickupDateTime: {}
    });
    expect(requestPickupAt(r)!.getDate()).toBe(24);
  });

  /** Y la forma que sí guarda Firestore se lee tal cual. */
  it('lee el Timestamp de Firestore, que es lo que de verdad llega', () => {
    const instante = new Date(2026, 9, 24, 10, 0, 0, 0);
    const r = solicitud({
      pickupDate: new Date(Date.UTC(2026, 9, 24)),
      pickupDateTime: { seconds: Math.floor(instante.getTime() / 1000), nanoseconds: 0 }
    });
    expect(requestPickupAt(r)!.getHours()).toBe(10);
  });
});

describe('ampliar el precio garantizado', () => {
  const ahora = new Date('2026-09-29T10:00:00');

  it('lo que sigue en pie se amplía desde la fecha PROMETIDA', () => {
    // Al cliente se le dijo una fecha: ampliar no puede recortarla.
    const vigente = new Date('2026-09-30T18:00:00');
    expect(extendedGuaranteeUntil(vigente, 24, ahora).toISOString()).toBe(
      new Date('2026-10-01T18:00:00').toISOString()
    );
  });

  it('LO CADUCADO SE AMPLÍA DESDE AHORA, o el botón no haría nada', () => {
    // Sumando sobre lo vencido, 24 h dejarían la promesa todavía en el pasado:
    // el operador pulsa, el aviso sigue diciendo «caducado» y parece roto.
    const vencido = new Date('2026-09-25T10:00:00');
    const resultado = extendedGuaranteeUntil(vencido, 24, ahora);
    expect(resultado.getTime()).toBeGreaterThan(ahora.getTime());
    expect(resultado.toISOString()).toBe(new Date('2026-09-30T10:00:00').toISOString());
  });

  it('sin fecha ninguna, también desde ahora', () => {
    expect(extendedGuaranteeUntil(null, 24, ahora).toISOString()).toBe(
      new Date('2026-09-30T10:00:00').toISOString()
    );
  });

  it('dos ampliaciones seguidas suman, que es cómo se llega a los dos días', () => {
    const una = extendedGuaranteeUntil(new Date('2026-09-30T10:00:00'), 24, ahora);
    const dos = extendedGuaranteeUntil(una, 24, ahora);
    expect(dos.toISOString()).toBe(new Date('2026-10-02T10:00:00').toISOString());
  });

  it('solo se amplía lo que espera respuesta', () => {
    expect(canExtendGuarantee(solicitud({ status: 'new' }))).toBe(true);
    expect(canExtendGuarantee(solicitud({ status: 'contacted' }))).toBe(true);
    // Una convertida ya tiene su precio congelado en la reserva, y una
    // descartada no espera nada: prometerles algo es prometer al vacío.
    expect(canExtendGuarantee(solicitud({ status: 'converted' }))).toBe(false);
    expect(canExtendGuarantee(solicitud({ status: 'discarded' }))).toBe(false);
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

/**
 * El precio prometido por la web, que es un techo y no una tarifa.
 *
 * ⚠️ **Lo que se prueba es que convertir no cobre MÁS de lo prometido**, que es
 * lo que pasaba: la web redondea el total a la baja hasta `,95` y el asistente
 * recalculaba desde la curva al céntimo. Y la otra mitad, que es la que se
 * olvida: que un cliente con descuento de fidelidad **no pague el techo** si su
 * tarifa sale por debajo.
 */
describe('el techo del precio prometido', () => {
  it('acuerda lo prometido cuando la tarifa pide más', () => {
    // El caso real del Kadjar a 31 días: la web prometió 1.030,95 € con IVA,
    // o sea 852,02 € de neto, y la curva pide 852,50 €.
    expect(promisedPriceCeiling(852.02, 852.5)).toBe(852.02);
  });

  it('no toca nada cuando la tarifa ya cumple la promesa', () => {
    expect(promisedPriceCeiling(852.02, 852.02)).toBeNull();
    expect(promisedPriceCeiling(852.02, 800)).toBeNull();
  });

  it('respeta el descuento de fidelidad cuando deja la tarifa por debajo', () => {
    // 852,50 € con un 5 % son 809,88: al cliente fiel no se le sube al techo.
    expect(promisedPriceCeiling(852.02, 809.88)).toBeNull();
  });

  it('no acuerda nada sin promesa', () => {
    expect(promisedPriceCeiling(undefined, 852.5)).toBeNull();
    expect(promisedPriceCeiling(null, 852.5)).toBeNull();
    expect(promisedPriceCeiling(0, 852.5)).toBeNull();
    expect(promisedPriceCeiling(-10, 852.5)).toBeNull();
    expect(promisedPriceCeiling(NaN, 852.5)).toBeNull();
  });

  it('no acuerda nada sin tarifa con la que comparar', () => {
    // Un coche sin tramo para esos días devuelve 0, y entonces el precio
    // prometido no se puede dar por cumplible: eso lo para el buscador.
    expect(promisedPriceCeiling(852.02, 0)).toBeNull();
    expect(promisedPriceCeiling(852.02, NaN)).toBeNull();
  });

  it('redondea a céntimos lo que acuerda', () => {
    expect(promisedPriceCeiling(852.019, 900)).toBe(852.02);
  });

  /**
   * ⚠️ **La propiedad que de verdad importa**, porque es la que un abogado
   * mediría: con la promesa puesta como techo, lo que se acaba cobrando nunca
   * queda por encima de lo que la web dijo.
   */
  it('lo acordado nunca queda por encima de lo prometido', () => {
    const prometido = 852.02;
    for (let tarifa = 1; tarifa <= 2000; tarifa += 0.37) {
      const neto = Math.round(tarifa * 100) / 100;
      const techo = promisedPriceCeiling(prometido, neto);
      const seCobra = techo ?? neto;
      expect(
        seCobra <= prometido + 1e-9,
        `con una tarifa de ${neto} € se cobrarían ${seCobra} € y se prometieron ${prometido}`
      ).toBe(true);
    }
  });
});
