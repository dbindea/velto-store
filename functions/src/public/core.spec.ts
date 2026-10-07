import { describe, expect, it } from 'vitest';
import {
  addVat,
  blocksAvailability,
  calculateCalendarDays,
  findPricingRuleByDays,
  aTerminacion,
  longestRule,
  publicPrice,
  lowestPricePerDay,
  rangesOverlap,
  tariffNetPrice,
  toDate,
  vehicleIsPublishable,
  widenToFullDays,
  disponibleDesde,
  ventanaOcupada,
  diasOcupados,
  diaIso,
  ventanaDeMantenimiento,
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

  /**
   * ⚠️ **El «desde» sale de la CURVA, no del número tecleado en el tramo.**
   * Este test decía `toBe(50)` —el `pricePerDay` del último tramo— hasta el 8 de
   * octubre de 2026, y eso es justo lo que hacía que la tarjeta prometiera un
   * precio que el presupuesto no respetaba: con la tarifa base de 60 €, un
   * alquiler de 4 días cuesta `curveTotal(60, 4)` y su media es 48,25, no 50.
   *
   * Medido en producción ese día, antes de corregirlo: el Duster anunciaba
   * 29,95 €/día y cobraba 37,68 por los mismos 16 días.
   */
  it('el «desde» es lo que de verdad cuesta el día en el tramo más largo', () => {
    /*
     * La curva al día 4 con tarifa base 60, escrita entera para que el número no
     * sea mágico: el multiplicador interpola entre (3; 2,7) y (7; 5,6), o sea
     * 2,7 + ¼ × 2,9 = 3,425. Total 60 × 3,425 = 205,50 y por día 51,375 → 51,38.
     * La tabla decía 50, que es lo que se publicaba y lo que no se cobraba.
     */
    expect(lowestPricePerDay(TRAMOS)).toBe(51.38);
    expect(lowestPricePerDay([])).toBeNull();
    expect(lowestPricePerDay(undefined)).toBeNull();
  });

  /**
   * ⚠️ **El escaparate necesita el tramo ENTERO, no solo su precio.** Sin decir
   * desde cuántos días rige, «desde 48,25 €» es un precio que casi nadie va a
   * pagar y el visitante lo descubre al elegir fechas.
   */
  it('el tramo del alquiler más largo viene con sus días', () => {
    expect(longestRule(TRAMOS)).toEqual({ minDays: 4, maxDays: null, pricePerDay: 50 });
  });

  /**
   * ⚠️ **Se elige por los DÍAS y no por el precio tecleado**, y esto es una
   * reversión: antes era `cheapestRule()` y cogía el `pricePerDay` menor. Eso
   * solo coincide si la tabla es coherente, y desde que el total lo calcula la
   * curva esos números son informativos — en producción dos de los cinco coches
   * publicados tenían como «más barato» un tramo intermedio. La curva es
   * monótona: el suelo está donde empieza el último tramo, teclee lo que teclee
   * nadie.
   */
  it('aunque la tabla tenga el tramo largo más caro, el «desde» es el suyo', () => {
    const raras = [
      { minDays: 1, maxDays: 6, pricePerDay: 40 },
      { minDays: 7, maxDays: null, pricePerDay: 45 },
    ];
    expect(longestRule(raras)?.minDays).toBe(7);
  });

  it('descarta los tramos sin precio, que no se pueden anunciar', () => {
    const conHuecos = [
      { minDays: 1, maxDays: 3, pricePerDay: 0 },
      { minDays: 4, maxDays: null, pricePerDay: 48 },
    ];
    expect(longestRule(conHuecos)?.minDays).toBe(4);
    expect(longestRule([{ minDays: 1, maxDays: null, pricePerDay: 0 }])).toBeNull();
    expect(longestRule([])).toBeNull();
    expect(longestRule(undefined)).toBeNull();
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

describe('el precio de escaparate: terminado en ,95 y siempre HACIA ABAJO', () => {
  it('baja al ,95 del entero anterior cuando los céntimos no llegan', () => {
    expect(aTerminacion(26.43)).toBe(25.95);
    expect(aTerminacion(50.2)).toBe(49.95);
    expect(aTerminacion(25)).toBe(24.95);
    expect(aTerminacion(30.01)).toBe(29.95);
  });

  it('con los céntimos ya por encima, se queda en el ,95 de ese entero', () => {
    expect(aTerminacion(24.99)).toBe(24.95);
    expect(aTerminacion(24.95)).toBe(24.95);
    expect(aTerminacion(24.96)).toBe(24.95);
  });

  /**
   * ⚠️ Lo que NUNCA puede pasar: que el precio suba. Anunciar menos de lo que
   * se cobra es lo que prohíbe la ley de consumo, y es el único sentido en el
   * que este redondeo sería peligroso.
   */
  it('NUNCA sube, para ninguna entrada', () => {
    for (let c = 100; c <= 30000; c += 7) {
      const bruto = c / 100;
      expect(aTerminacion(bruto)).toBeLessThanOrEqual(bruto);
    }
  });

  it('y nunca regala más de 0,99 €', () => {
    for (let c = 100; c <= 30000; c += 7) {
      const bruto = c / 100;
      expect(bruto - aTerminacion(bruto)).toBeLessThan(1);
    }
  });

  it('un importe por debajo de 1 € se deja en paz, no sale negativo', () => {
    expect(aTerminacion(0.5)).toBe(0.5);
    expect(aTerminacion(0)).toBe(0);
    expect(aTerminacion(NaN)).toBeNaN();
  });

  it('siempre acaba en ,95 de verdad', () => {
    for (let c = 100; c <= 30000; c += 13) {
      expect(Math.round(aTerminacion(c / 100) * 100) % 100).toBe(95);
    }
  });
});

describe('publicPrice — los dos lados del impuesto cuadran contra lo que se ENSEÑA', () => {
  it('el bruto es el terminado en ,95', () => {
    // 25 netos al 21 % son 30,25; de escaparate, 29,95.
    expect(publicPrice(25, 0.21).gross).toBe(29.95);
  });

  it('el neto se recalcula desde el bruto: neto + IVA da el bruto anunciado', () => {
    for (const neto of [12, 25, 33.5, 47.9, 120]) {
      const p = publicPrice(neto, 0.21);
      const iva = Math.round((p.gross - p.net) * 100) / 100;
      expect(Math.round((p.net + iva) * 100) / 100).toBe(p.gross);
    }
  });

  it('el neto publicado es MENOR que el de la tarifa: la rebaja sale de la empresa', () => {
    const p = publicPrice(25, 0.21);
    expect(p.net).toBeLessThan(25);
  });

  /** Una reserva pactada sin IVA: el 0 se respeta y no cae al general. */
  it('con IVA al 0 el bruto es el neto, y también termina en ,95', () => {
    const p = publicPrice(25, 0);
    expect(p.vatRate).toBe(0);
    expect(p.gross).toBe(24.95);
    expect(p.net).toBe(24.95);
  });
});

// ---------------------------------------------------------------------------
// El día de preparación, y el calendario que sale de él.
//
// ⚠️ Regla de negocio de Dorel del 30 de septiembre de 2026: «si una persona
// entrega el coche hoy a las 12:00 o 14:00 no se puede alquilar hasta el día
// siguiente a las 12:00, para revisar, limpiar y rellenar combustible».
// ---------------------------------------------------------------------------

const d = (iso: string) => new Date(iso);

describe('disponibleDesde — el coche no sale el mismo día que vuelve', () => {
  it('devuelto a las 12:00, libre al día siguiente a las 12:00', () => {
    expect(disponibleDesde(d('2026-10-10T12:00:00')).toISOString()).toBe(
      d('2026-10-11T12:00:00').toISOString()
    );
  });

  it('devuelto a las 14:00, libre al día siguiente a las 12:00 igualmente', () => {
    // Los dos ejemplos que dio Dorel dan el mismo instante: lo que manda es el
    // día siguiente, no las 24 horas exactas.
    expect(disponibleDesde(d('2026-10-10T14:00:00')).toISOString()).toBe(
      d('2026-10-11T12:00:00').toISOString()
    );
  });

  it('devuelto de madrugada, TAMPOCO sale ese día', () => {
    // Un coche que vuelve a las 8:00 podría limpiarse por la mañana, pero eso
    // lo decide el mostrador. La web no ofrece lo que no sabe.
    expect(disponibleDesde(d('2026-10-10T08:00:00')).toISOString()).toBe(
      d('2026-10-11T12:00:00').toISOString()
    );
  });

  it('cruza el fin de mes sin inventarse un día 32', () => {
    expect(diaIso(disponibleDesde(d('2026-10-31T18:00:00')))).toBe('2026-11-01');
  });

  it('no toca la fecha que recibe', () => {
    const fin = d('2026-10-10T12:00:00');
    disponibleDesde(fin);
    expect(fin.toISOString()).toBe(d('2026-10-10T12:00:00').toISOString());
  });
});

describe('ventanaOcupada', () => {
  it('estira la reserva hasta que el coche está listo', () => {
    const v = ventanaOcupada(d('2026-10-05T10:00:00'), d('2026-10-08T10:00:00'))!;
    expect(diaIso(v.inicio)).toBe('2026-10-05');
    expect(v.fin.toISOString()).toBe(d('2026-10-09T12:00:00').toISOString());
  });

  it('con una fecha ilegible devuelve null, y quien llama lo trata como ocupado', () => {
    expect(ventanaOcupada(null, d('2026-10-08T10:00:00'))).toBeNull();
    expect(ventanaOcupada(d('2026-10-05T10:00:00'), 'lo que sea')).toBeNull();
  });

  it('lee las cuatro formas de fecha de Firestore', () => {
    const v = ventanaOcupada(
      { seconds: Math.floor(d('2026-10-05T10:00:00').getTime() / 1000) },
      { _seconds: Math.floor(d('2026-10-08T10:00:00').getTime() / 1000) }
    );
    expect(v).not.toBeNull();
    expect(diaIso(v!.inicio)).toBe('2026-10-05');
  });
});

describe('diasOcupados — lo que pinta el calendario de la ficha', () => {
  const desde = d('2026-10-01T09:30:00');

  it('marca los días del alquiler MÁS el de preparación', () => {
    const v = ventanaOcupada(d('2026-10-05T10:00:00'), d('2026-10-07T10:00:00'))!;
    // Sale el 5, vuelve el 7 y está listo el 8 a las 12: el 8 no se puede coger.
    expect(diasOcupados([v], desde, 12)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    ]);
  });

  it('un alquiler de un solo día ocupa dos: el suyo y el de después', () => {
    const v = ventanaOcupada(d('2026-10-05T10:00:00'), d('2026-10-05T20:00:00'))!;
    expect(diasOcupados([v], desde, 12)).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('cuenta la MISMA ventana que el buscador, o el calendario mentiría', () => {
    /*
     * Es la comprobación que de verdad importa: el buscador ensancha a días
     * completos y cruza con `rangesOverlap`. Si un día sale libre aquí y
     * ocupado allí, el visitante lo elige, pulsa y la web le dice que no hay
     * coches — que es peor que no tener calendario.
     */
    const v = ventanaOcupada(d('2026-10-05T10:00:00'), d('2026-10-07T10:00:00'))!;
    const ocupados = diasOcupados([v], desde, 12);

    for (let dia = 1; dia <= 12; dia++) {
      const iso = `2026-10-${String(dia).padStart(2, '0')}`;
      const ventana = widenToFullDays(d(`${iso}T10:00:00`), d(`${iso}T18:00:00`));
      const buscadorDiceOcupado = rangesOverlap(ventana.from, ventana.to, v.inicio, v.fin);
      expect(ocupados.includes(iso)).toBe(buscadorDiceOcupado);
    }
  });

  it('varias reservas se acumulan sin repetir días', () => {
    const a = ventanaOcupada(d('2026-10-02T10:00:00'), d('2026-10-03T10:00:00'))!;
    const b = ventanaOcupada(d('2026-10-04T10:00:00'), d('2026-10-05T10:00:00'))!;
    const dias = diasOcupados([a, b], desde, 10);
    expect(dias).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
    expect(new Set(dias).size).toBe(dias.length);
  });

  it('sin reservas no hay ningún día ocupado', () => {
    expect(diasOcupados([], desde, 30)).toEqual([]);
  });

  it('no mira más allá del horizonte que se le pide', () => {
    const v = ventanaOcupada(d('2026-11-20T10:00:00'), d('2026-11-22T10:00:00'))!;
    expect(diasOcupados([v], desde, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// El taller: qué cita deja el coche sin alquilar y cuánto tiempo.
//
// ⚠️ Decisión de Dorel del 1 de octubre de 2026: «que el coche no esté
// disponible solo para aquel día en concreto y cuando la prioridad sea alta,
// porque si hay un cambio de aceite esto puede esperar».
// ---------------------------------------------------------------------------

describe('ventanaDeMantenimiento', () => {
  const cita = (extra: Record<string, unknown> = {}) => ({
    priority: 'high',
    status: 'scheduled',
    type: 'itv',
    nextDueDate: d('2026-10-20T00:00:00'),
    ...extra,
  });

  it('una ITV de prioridad alta ocupa SU día, y solo ese', () => {
    const v = ventanaDeMantenimiento(cita())!;
    expect(diaIso(v.inicio)).toBe('2026-10-20');
    expect(diasOcupados([v], d('2026-10-18T09:00:00'), 6)).toEqual(['2026-10-20']);
  });

  it('⚠️ el día siguiente NO se ocupa: la preparación es de las devoluciones', () => {
    // Un coche que vuelve del taller está listo; uno que vuelve de un alquiler
    // hay que revisarlo, limpiarlo y repostarlo.
    const v = ventanaDeMantenimiento(cita())!;
    expect(diasOcupados([v], d('2026-10-18T09:00:00'), 6)).not.toContain('2026-10-21');
  });

  it('un cambio de aceite NO ocupa nada: puede esperar', () => {
    expect(ventanaDeMantenimiento(cita({ priority: 'medium', type: 'oil_change' }))).toBeNull();
    expect(ventanaDeMantenimiento(cita({ priority: 'low' }))).toBeNull();
  });

  it('«crítica» ocupa igual que «alta»', () => {
    expect(ventanaDeMantenimiento(cita({ priority: 'critical' }))).not.toBeNull();
  });

  it('lo ya hecho o cancelado no ocupa', () => {
    expect(ventanaDeMantenimiento(cita({ status: 'completed' }))).toBeNull();
    expect(ventanaDeMantenimiento(cita({ status: 'cancelled' }))).toBeNull();
  });

  it('lo vencido sí ocupa: `overdue` es que no se ha hecho', () => {
    expect(ventanaDeMantenimiento(cita({ status: 'overdue' }))).not.toBeNull();
  });

  it('⚠️ sin fecha no ocupa NADA, y aquí es lo correcto', () => {
    // Al revés que una reserva con la fecha ilegible, que bloquea. Un
    // mantenimiento sin día es un recordatorio: bloquear «por si acaso»
    // dejaría el coche inalquilable para siempre por una nota sin fecha.
    expect(ventanaDeMantenimiento(cita({ nextDueDate: null }))).toBeNull();
    expect(ventanaDeMantenimiento(cita({ nextDueDate: 'lo que sea' }))).toBeNull();
  });

  it('sin prioridad no ocupa: no se da por alta lo que no lo dice', () => {
    expect(ventanaDeMantenimiento(cita({ priority: undefined }))).toBeNull();
  });

  it('lee la fecha en las formas de Firestore', () => {
    const v = ventanaDeMantenimiento(
      cita({ nextDueDate: { seconds: Math.floor(d('2026-10-20T11:00:00').getTime() / 1000) } })
    );
    expect(v && diaIso(v.inicio)).toBe('2026-10-20');
  });
});
