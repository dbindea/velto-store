import { describe, expect, it } from 'vitest';
import {
  addVat,
  blocksAvailability,
  calculateCalendarDays,
  findPricingRuleByDays,
  lowestPricePerDay,
  rangesOverlap,
  tariffNetPrice,
  toDate,
  vehicleIsPublishable,
  widenToFullDays,
} from './core';

// ---------------------------------------------------------------------------
// El núcleo de la web pública.
//
// ⚠️ Esto es una COPIA de utils que viven en `src/app/shared/utils/`, y una
// copia sin tests es una copia que diverge. Pero lo que más se comprueba aquí no
// es que coincida con el original: es que **se aparta de él donde debe**.
//
// Tres funciones cambian de comportamiento a propósito, y las tres siguen la
// misma regla —ante la duda, no publicar—, porque en una pantalla con un
// operador delante equivocarse de más se ve, y en una web ofrecer un coche
// alquilado es una reserva que alguien atenderá.
// ---------------------------------------------------------------------------

describe('toDate — falla CERRADO, al revés que el de la app', () => {
  it('lee las cuatro formas en que llega una fecha', () => {
    const d = new Date('2026-10-01T10:00:00Z');
    expect(toDate(d)?.getTime()).toBe(d.getTime());
    expect(toDate({ toDate: () => d })?.getTime()).toBe(d.getTime());
    // El mapa que escribe `toTimestamp()`, que es lo que de verdad hay guardado.
    expect(toDate({ seconds: 1790000000, nanoseconds: 0 })?.getTime()).toBe(1790000000 * 1000);
    // Y el del admin SDK, que es el que corre en las functions.
    expect(toDate({ _seconds: 1790000000 })?.getTime()).toBe(1790000000 * 1000);
  });

  /**
   * ⚠️ La diferencia que importa. El `toDate()` de la app devuelve `new Date()`
   * ante lo ilegible; aquí eso haría que la reserva no solapara con nada y el
   * coche saliera libre estando alquilado.
   */
  it('devuelve null y NO la fecha de hoy ante lo ilegible', () => {
    expect(toDate(undefined)).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate({})).toBeNull();
    expect(toDate('no es una fecha')).toBeNull();
    expect(toDate(new Date('inválida'))).toBeNull();
    expect(toDate({ seconds: 'ocho' })).toBeNull();
  });
});

describe('blocksAvailability — lista NEGRA, no blanca', () => {
  it('los tres estados terminados no bloquean', () => {
    expect(blocksAvailability('returned')).toBe(false);
    expect(blocksAvailability('closed')).toBe(false);
    expect(blocksAvailability('cancelled')).toBe(false);
  });

  it('los vivos bloquean', () => {
    expect(blocksAvailability('reserved')).toBe(true);
    expect(blocksAvailability('confirmed')).toBe(true);
    expect(blocksAvailability('delivered')).toBe(true);
  });

  /**
   * ⚠️ El caso que justifica invertir la lista: un estado que nadie ha escrito
   * todavía. Con la lista del backoffice —que enumera los que bloquean— una
   * prórroga («el caso más normal del negocio») no estaría entre ellos y la web
   * ofrecería un coche que está fuera.
   */
  it('un estado NUEVO bloquea hasta que alguien decida lo contrario', () => {
    expect(blocksAvailability('extended')).toBe(true);
    expect(blocksAvailability('lo-que-sea')).toBe(true);
    expect(blocksAvailability(undefined)).toBe(true);
    expect(blocksAvailability(42)).toBe(true);
  });
});

describe('vehicleIsPublishable — el estado no es la disponibilidad', () => {
  /**
   * ⚠️ El fallo de producción del 21 de septiembre de 2026: un coche alquilado
   * hasta el 26 salía como «no disponible» al pedirlo para el 1 de octubre. El
   * estado es un hecho de hoy; quien contesta por un rango es el cruce con las
   * reservas.
   */
  it('un coche ALQUILADO se sigue ofreciendo: otras fechas son otra pregunta', () => {
    expect(vehicleIsPublishable('rented')).toBe(true);
    expect(vehicleIsPublishable('available')).toBe(true);
  });

  /**
   * ⚠️ Y aquí al revés que el backoffice: allí un coche en taller se ofrece con
   * un aviso porque hay un operador que puede decidir con el cliente delante.
   * En la web no hay nadie.
   */
  it('en taller o fuera de servicio NO se ofrece', () => {
    expect(vehicleIsPublishable('maintenance')).toBe(false);
    expect(vehicleIsPublishable('out_of_service')).toBe(false);
  });

  it('un estado ilegible tampoco se ofrece', () => {
    expect(vehicleIsPublishable(undefined)).toBe(false);
    expect(vehicleIsPublishable(null)).toBe(false);
  });
});

describe('el precio', () => {
  const TRAMOS = [
    { minDays: 1, maxDays: 1, pricePerDay: 60 },
    { minDays: 2, maxDays: 3, pricePerDay: 55 },
    { minDays: 4, maxDays: null, pricePerDay: 50 },
  ];

  it('aplica el tramo que cubre esos días', () => {
    expect(findPricingRuleByDays(TRAMOS, 1)?.pricePerDay).toBe(60);
    expect(findPricingRuleByDays(TRAMOS, 3)?.pricePerDay).toBe(55);
    expect(findPricingRuleByDays(TRAMOS, 30)?.pricePerDay).toBe(50);
  });

  /**
   * ⚠️ La segunda desviación deliberada. `calculateBasePrice()` de la app
   * contesta `basePrice: 0` cuando ningún tramo aplica, y eso alquilaba el coche
   * GRATIS. Allí ya hay tres capas que lo paran; aquí la única capa es esta, así
   * que un coche sin precio no se ofrece en vez de ofrecerse a cero.
   */
  it('sin tramo que cubra esos días devuelve null, NUNCA 0', () => {
    const conHueco = [
      { minDays: 1, maxDays: 1, pricePerDay: 60 },
      { minDays: 3, maxDays: null, pricePerDay: 50 },
    ];
    expect(tariffNetPrice(conHueco, 2)).toBeNull();

    const conTecho = [{ minDays: 1, maxDays: 30, pricePerDay: 60 }];
    expect(tariffNetPrice(conTecho, 31)).toBeNull();

    expect(tariffNetPrice([], 3)).toBeNull();
    expect(tariffNetPrice(undefined, 3)).toBeNull();
  });

  it('un tramo con precio 0 tampoco se ofrece', () => {
    expect(tariffNetPrice([{ minDays: 1, maxDays: null, pricePerDay: 0 }], 2)).toBeNull();
  });

  it('el «desde» es el tramo más barato', () => {
    expect(lowestPricePerDay(TRAMOS)).toBe(50);
    expect(lowestPricePerDay([])).toBeNull();
  });

  /** ⚠️ La tarifa es NETA y el IVA se SUMA: 30 € son 36,30 €. */
  it('el IVA se suma y se devuelven los dos lados', () => {
    expect(addVat(30, 0.21)).toEqual({ net: 30, gross: 36.3, vatRate: 0.21 });
  });

  /** Un 0 guardado es una reserva pactada sin IVA, no un hueco. */
  it('respeta un tipo del 0 %', () => {
    expect(addVat(100, 0)).toEqual({ net: 100, gross: 100, vatRate: 0 });
  });

  it('un tipo ilegible cae al general en vez de dar NaN', () => {
    expect(addVat(100, NaN as number).gross).toBe(121);
  });
});

describe('los días y el solape', () => {
  const f = (s: string) => new Date(s);

  it('cuenta bloques de 24 h y redondea al alza con una hora de resto', () => {
    expect(calculateCalendarDays(f('2026-10-01T10:00'), f('2026-10-03T10:00'))).toBe(2);
    expect(calculateCalendarDays(f('2026-10-01T10:00'), f('2026-10-03T11:30'))).toBe(3);
    expect(calculateCalendarDays(f('2026-10-03T10:00'), f('2026-10-01T10:00'))).toBe(0);
  });

  it('dos alquileres se pisan si se tocan por dentro', () => {
    expect(rangesOverlap(f('2026-10-01'), f('2026-10-05'), f('2026-10-04'), f('2026-10-08'))).toBe(true);
    // Uno acaba justo cuando empieza el otro: no se pisan.
    expect(rangesOverlap(f('2026-10-01'), f('2026-10-05'), f('2026-10-05'), f('2026-10-08'))).toBe(false);
  });
});

describe('widenToFullDays — lo que impide reconstruir el calendario al minuto', () => {
  it('lleva el principio a medianoche y el final al día siguiente', () => {
    const { from, to } = widenToFullDays(new Date('2026-10-01T14:30'), new Date('2026-10-03T09:15'));
    expect(from.getHours()).toBe(0);
    expect(from.getDate()).toBe(1);
    expect(to.getHours()).toBe(0);
    expect(to.getDate()).toBe(4);
  });

  /**
   * ⚠️ Lo que esto compra: dos consultas distintas dentro del mismo día dan la
   * MISMA ventana, así que estrechándolas no se puede averiguar a qué hora
   * exacta devuelve un cliente.
   */
  it('dos horas distintas del mismo día son indistinguibles', () => {
    const a = widenToFullDays(new Date('2026-10-01T08:00'), new Date('2026-10-02T09:00'));
    const b = widenToFullDays(new Date('2026-10-01T19:45'), new Date('2026-10-02T23:59'));
    expect(a.from.getTime()).toBe(b.from.getTime());
    expect(a.to.getTime()).toBe(b.to.getTime());
  });

  it('una ventana que ya es de días completos no crece', () => {
    const { from, to } = widenToFullDays(new Date('2026-10-01T00:00'), new Date('2026-10-03T00:00'));
    expect(from.getDate()).toBe(1);
    expect(to.getDate()).toBe(3);
  });
});
