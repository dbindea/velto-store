import { describe, expect, it } from 'vitest';
import type { CocheResumen } from './api';
import {
  MAX_DESCRIPCION,
  MAX_TITULO,
  descripcionDeCoche,
  recortaPorPalabras,
  rellena,
  tituloDeCoche,
} from './seo';

// ---------------------------------------------------------------------------
// El título y la descripción de una ficha
//
// ⚠️ **Lo que se comprueba es el TOPE y que no se parta una palabra.** Un
// título de 85 caracteres no da error en ninguna parte: simplemente Google lo
// corta, y lo que se pierde es «de alquiler en Arganda del Rey», que es la
// búsqueda por la que esta empresa puede competir.
// ---------------------------------------------------------------------------

const COCHE = (extra: Partial<CocheResumen> = {}): CocheResumen =>
  ({
    id: 'x',
    brand: 'Dacia',
    model: 'Duster',
    version: 'Comfort 10 Tce 100',
    year: 2022,
    category: 'intermediate',
    bodyType: '4_5_doors',
    fuelType: 'petrol',
    transmission: 'manual',
    seats: 5,
    luggageCapacity: 3,
    ...extra,
  }) as CocheResumen;

describe('el título de una ficha', () => {
  it('nunca pasa del tope, pruebe el coche que pruebe', () => {
    const nombres: Array<[string, string, string]> = [
      ['Dacia', 'Duster', 'Comfort 10 Tce 100'],
      ['Volkswagen', 'Tiguan Allspace', 'Advance 2.0 Tdi Dsg'],
      ['Mercedes-Benz', 'Sprinter Tourer Pro Larga', '319 Cdi 9G-Tronic'],
      ['Kia', 'Ceed', ''],
    ];
    for (const [brand, model, version] of nombres) {
      const t = tituloDeCoche(COCHE({ brand, model, version }));
      expect(t.length, t).toBeLessThanOrEqual(MAX_TITULO);
      expect(t, t).toContain(brand);
    }
  });

  /**
   * ⚠️ **Lleva la frase por la que se busca, entera.** Es lo que propuso Dorel:
   * «alquiler de coches en Arganda» es lo que se teclea, y «Dacia Duster de
   * alquiler en Arganda» —lo de antes— la parte en dos y pierde la coincidencia.
   */
  it('lleva la frase que se busca, no una variante partida', () => {
    for (const c of [COCHE(), COCHE({ brand: 'Kia', model: 'Ceed', version: '' })]) {
      expect(tituloDeCoche(c)).toContain('alquiler de coches en Arganda');
    }
  });

  /**
   * ⚠️ **Lo primero que se cae es la versión**, que es lo que nadie busca: entre
   * «Tiguan Allspace - alquiler de coches en Arganda» y «Tiguan Allspace Advance
   * 2.0 Tdi Dsg», lo que trae visitas es lo primero.
   */
  it('con un nombre largo se queda sin versión, y después sin marca', () => {
    const t = tituloDeCoche(
      COCHE({ brand: 'Volkswagen', model: 'Tiguan Allspace', version: 'Advance 2.0 Tdi Dsg' })
    );
    expect(t).toBe('Volkswagen Tiguan Allspace - alquiler de coches en Arganda');
    expect(t).not.toContain('Advance');
  });

  /**
   * ⚠️ **Con la frase completa, la versión casi nunca cabe**, y es un cambio de
   * verdad respecto al formato anterior: el reclamo mide 37 caracteres y la
   * marca 8, así que al nombre le quedan 12. «Kia Ceed GT» entra; «Dacia Duster
   * Comfort 10 Tce 100», no. No se pierde nada que importe —la versión sigue en
   * el `<h1>` y en la descripción— y lo que se gana es la frase que se teclea.
   */
  it('con un nombre MUY corto cabe hasta la versión', () => {
    const t = tituloDeCoche(COCHE({ brand: 'Kia', model: 'Ceed', version: 'GT' }));
    expect(t).toBe('Kia Ceed GT - alquiler de coches en Arganda del Rey | Velto');
    expect(t.length).toBeLessThanOrEqual(MAX_TITULO);
  });

  it('con un nombre normal se cae la versión y queda la marca', () => {
    const t = tituloDeCoche(COCHE({ brand: 'Dacia', model: 'Duster' }));
    expect(t).toBe('Dacia Duster - alquiler de coches en Arganda del Rey | Velto');
    expect(t.length).toBe(60);
  });

  /**
   * ⚠️ **Y nunca a media palabra.** «…de alquiler en Argan» no es que quede
   * feo: es que parte en dos la palabra por la que se compite.
   */
  it('jamás corta una palabra por la mitad', () => {
    const t = tituloDeCoche(
      COCHE({ brand: 'Mercedes-Benz', model: 'Sprinter Tourer Pro Larga Extra' })
    );
    expect(t.length).toBeLessThanOrEqual(MAX_TITULO);
    expect(t.endsWith(' ')).toBe(false);
    // Lo que queda son palabras enteras del nombre original.
    for (const p of t.split(' ')) {
      expect('Mercedes-Benz Sprinter Tourer Pro Larga Extra de alquiler').toContain(p);
    }
  });
});

describe('la descripción de una ficha', () => {
  it('nunca pasa del tope', () => {
    for (const seats of [2, 5, 9]) {
      const d = descripcionDeCoche(COCHE({ seats, environmentalLabel: 'C' }));
      expect(d.length, d).toBeLessThanOrEqual(MAX_DESCRIPCION);
    }
  });

  /**
   * ⚠️ **Y aprovecha el hueco.** Era lo pedido: media línea desaprovechada es
   * media línea menos para decir «precio final» en el resultado de búsqueda.
   */
  it('llena lo que puede en vez de quedarse corta', () => {
    const d = descripcionDeCoche(COCHE());
    expect(d.length).toBeGreaterThan(120);
    expect(d).toContain('Precio final');
  });

  it('nunca termina a mitad de frase', () => {
    for (const model of ['Duster', 'Sprinter Tourer Pro Larga Extra Muy Largo']) {
      const d = descripcionDeCoche(COCHE({ model }));
      expect(d.endsWith('.'), d).toBe(true);
    }
  });
});

describe('rellena', () => {
  it('para en la primera frase que no cabe, no se la salta', () => {
    // Si se saltara la larga y metiera la corta, el orden de importancia que
    // decidió quien escribió la lista dejaría de respetarse.
    expect(rellena('Base.', ['x'.repeat(40), 'corta.'], 20)).toBe('Base.');
  });

  it('no añade nada si no cabe nada', () => {
    expect(rellena('Base.', ['algo.'], 5)).toBe('Base.');
  });
});

describe('recortaPorPalabras', () => {
  it('deja el texto como está si ya cabe', () => {
    expect(recortaPorPalabras('corto', 20)).toBe('corto');
  });

  it('corta por el espacio anterior, nunca a media palabra', () => {
    expect(recortaPorPalabras('uno dos tres cuatro', 11)).toBe('uno dos');
  });
});
