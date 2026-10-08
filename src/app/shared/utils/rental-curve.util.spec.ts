import {
  DEFAULT_CURVE_POINTS,
  curveAveragePerDay,
  curveMultiplier,
  curvePointsProblem,
  curveTotal,
  roundToRateStep,
  type CurvePoint
} from './rental-curve.util';

/**
 * ⚠️ **Los números de este bloque son la propuesta comercial de Dorel del 6 de
 * octubre de 2026, copiada literal.** No se recalculan: si un cambio en la
 * curva los mueve, lo que hay que mover es la decisión de negocio, no el test.
 */
describe('la curva de duración, contra la tabla que pidió Dorel', () => {
  const esperado: Array<[dias: number, b50: number, b60: number, b90: number]> = [
    [1, 50, 60, 90],
    [3, 135, 162, 243],
    [7, 280, 336, 504],
    [14, 455, 546, 819],
    [21, 609, 730.8, 1096.2],
    [30, 750, 900, 1350]
  ];

  for (const [dias, b50, b60, b90] of esperado) {
    it(`${dias} día(s): 50 € → ${b50}, 60 € → ${b60}, 90 € → ${b90}`, () => {
      expect(curveTotal(50, dias)).toBe(b50);
      expect(curveTotal(60, dias)).toBe(b60);
      expect(curveTotal(90, dias)).toBe(b90);
    });
  }

  /** Los ejemplos sueltos que dio, que son los que caen ENTRE puntos. */
  it('interpola entre puntos: 2, 8 y 13 días', () => {
    expect(curveTotal(50, 2)).toBe(92.5);
    expect(curveTotal(50, 8)).toBe(305);
    expect(curveTotal(50, 13)).toBe(430);
  });

  it('a partir de 31 días es lineal, al 50 % de la tarifa base', () => {
    expect(curveTotal(50, 31)).toBe(775);
    expect(curveTotal(50, 40)).toBe(1000);
    expect(curveTotal(90, 40)).toBe(1800);
  });

  /**
   * ⚠️ **El enlace entre la curva y la larga estancia es el borde peligroso.**
   * El día 30 vale 15 × B y el 31 vale 15,5 × B: si alguien moviera el último
   * punto sin mover el factor del 50 %, el alquiler más largo saldría más
   * barato. Por eso el día 31 se comprueba contra el 30 y no solo contra su
   * propia fórmula.
   */
  it('el día 31 cuesta MÁS que el 30, que es donde se juntan las dos reglas', () => {
    expect(curveTotal(50, 31)).toBeGreaterThan(curveTotal(50, 30));
  });
});

/**
 * ⚠️ **Estas dos propiedades son el motivo de existir de la curva**, así que se
 * comprueban sobre TODO el rango y no sobre los puntos: lo que falla en un
 * modelo por tramos son justo los días de en medio.
 */
describe('las dos invariantes, día a día', () => {
  for (const base of [50, 60, 90]) {
    it(`con base ${base} €, el total siempre sube y la media nunca`, () => {
      let totalPrevio = 0;
      let mediaPrevia = Number.POSITIVE_INFINITY;
      for (let d = 1; d <= 120; d++) {
        const total = curveTotal(base, d);
        const media = total / d;
        expect(total).toBeGreaterThan(totalPrevio);
        expect(media).toBeLessThanOrEqual(mediaPrevia + 1e-9);
        totalPrevio = total;
        mediaPrevia = media;
      }
    });
  }
});

describe('la media diaria', () => {
  it('se redondea para enseñarla', () => {
    expect(curveAveragePerDay(curveTotal(50, 8), 8)).toBe(38.13);
  });

  /**
   * ⚠️ **Y por eso no se puede usar para recalcular el total.** 38,13 × 8 son
   * 305,04 y el alquiler vale 305: el total manda y la media solo explica.
   */
  it('multiplicarla por los días NO devuelve el total', () => {
    const total = curveTotal(50, 8);
    expect(curveAveragePerDay(total, 8) * 8).not.toBe(total);
  });
});

describe('qué NO es una duración válida', () => {
  it('cero días o negativos no cuestan nada, no dan NaN', () => {
    expect(curveTotal(50, 0)).toBe(0);
    expect(curveTotal(50, -3)).toBe(0);
  });

  /** ⚠️ Sin tarifa base no hay precio: un 0 aquí sería alquilar gratis. */
  it('sin tarifa base devuelve 0 y no un total a medias', () => {
    expect(curveTotal(0, 7)).toBe(0);
    expect(curveTotal(-10, 7)).toBe(0);
  });
});

/**
 * ⚠️ **Los puntos se validan ANTES de guardarlos**, porque después no hay dónde:
 * un cliente al que se le ha enseñado un precio de 8 días más barato que el de 7
 * tiene razón, y la cifra ya está en su pantalla.
 */
describe('validar unos puntos editados', () => {
  it('los de la casa valen', () => {
    expect(curvePointsProblem(DEFAULT_CURVE_POINTS)).toBeNull();
  });

  it('con menos de dos puntos no hay curva', () => {
    expect(curvePointsProblem([{ dias: 1, multiplicador: 1 }])).toBe('pricing.curve.errors.toofew');
  });

  it('los días tienen que ir en orden y sin repetirse', () => {
    const malos: CurvePoint[] = [
      { dias: 1, multiplicador: 1 },
      { dias: 7, multiplicador: 5.6 },
      { dias: 3, multiplicador: 2.7 }
    ];
    expect(curvePointsProblem(malos)).toBe('pricing.curve.errors.order');
  });

  /** El caso que de verdad importa: una curva que abarata el alquiler largo. */
  it('rechaza una curva donde la media diaria SUBE', () => {
    const malos: CurvePoint[] = [
      { dias: 1, multiplicador: 1 },
      { dias: 3, multiplicador: 3.6 }
    ];
    expect(curvePointsProblem(malos)).toBe('pricing.curve.errors.averageIncreasing');
  });

  it('y una donde el total no crece', () => {
    const malos: CurvePoint[] = [
      { dias: 1, multiplicador: 5 },
      { dias: 3, multiplicador: 2 }
    ];
    expect(curvePointsProblem(malos)).not.toBeNull();
  });

  it('un multiplicador de cero o negativo no vale', () => {
    expect(
      curvePointsProblem([
        { dias: 1, multiplicador: 1 },
        { dias: 3, multiplicador: 0 }
      ])
    ).toBe('pricing.curve.errors.multiplier');
  });
});

describe('el multiplicador suelto', () => {
  it('a un día es exactamente 1, que es lo que hace de B la tarifa de un día', () => {
    expect(curveMultiplier(1)).toBe(1);
  });
});

/**
 * ⚠️ **Esto redondea lo que se PROPONE, no lo que se cobra.** Lo pidió Dorel el
 * 8 de octubre de 2026 —«que no me recomiende 32,5 tampoco 44; mejor 30 y 45»—
 * porque una tarifa es un número que se dice por teléfono. El total del alquiler
 * lo sigue calculando `curveTotal()` al céntimo.
 */
describe('el redondeo a múltiplos de 5', () => {
  it('es exactamente lo que pidió: 32,50 baja a 30 y 44 sube a 45', () => {
    expect(roundToRateStep(32.5)).toBe(30);
    expect(roundToRateStep(44)).toBe(45);
  });

  /**
   * ⚠️ **El empate baja, y `Math.round()` NO lo hace.** En JavaScript los
   * empates van hacia arriba —`Math.round(6.5)` es 7—, así que 32,50 habría
   * salido 35 y 37,50 habría salido 40. Es justo el caso del ejemplo de Dorel,
   * y la dirección segura: subir el precio propuesto es subírselo a un cliente
   * sin que nadie lo haya decidido.
   */
  it('en un empate baja, nunca sube', () => {
    expect(roundToRateStep(37.5)).toBe(35);
    expect(roundToRateStep(42.5)).toBe(40);
    expect(roundToRateStep(2.5)).toBe(0);
  });

  it('al múltiplo más cercano cuando no hay empate', () => {
    expect(roundToRateStep(43.91)).toBe(45);
    expect(roundToRateStep(34.3)).toBe(35);
    expect(roundToRateStep(27.49)).toBe(25);
    expect(roundToRateStep(28)).toBe(30);
  });

  it('un importe que ya es múltiplo de 5 no se mueve', () => {
    expect(roundToRateStep(30)).toBe(30);
    expect(roundToRateStep(55)).toBe(55);
  });

  it('lo que no es un importe sale 0, no NaN', () => {
    expect(roundToRateStep(0)).toBe(0);
    expect(roundToRateStep(-10)).toBe(0);
    expect(roundToRateStep(NaN)).toBe(0);
  });

  /**
   * ⚠️ **Nunca devuelve algo que no sea múltiplo del paso.** Es la única
   * propiedad que de verdad importa: si saliera un 32,500000000000004 por la
   * coma flotante, el operador vería otra vez un número que no se puede decir
   * por teléfono.
   */
  it('todo lo que sale es múltiplo de 5, sin restos de coma flotante', () => {
    for (let v = 0.5; v <= 200; v += 0.37) {
      const r = roundToRateStep(v);
      expect(r % 5).toBe(0);
      expect(Math.abs(r - v)).toBeLessThanOrEqual(2.5);
    }
  });
});
