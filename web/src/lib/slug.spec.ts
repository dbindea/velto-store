import { describe, expect, it } from 'vitest';
import { cocheDeSegmento, slugBase, slugify, slugsDeFlota } from './slug';
import type { CocheResumen } from './api';

/** Lo mínimo para que el tipo cuadre: estas funciones solo miran cuatro campos. */
function coche(p: Partial<CocheResumen> & { id: string }): CocheResumen {
  return {
    brand: 'Renault',
    model: 'Megane',
    year: 2022,
    category: 'compact',
    bodyType: 'sedan',
    fuelType: 'diesel',
    transmission: 'manual',
    seats: 5,
    luggageCapacity: 2,
    ...p,
  } as CocheResumen;
}

describe('slugify', () => {
  it('quita acentos en vez de dejarlos escapados', () => {
    expect(slugify('Mégane')).toBe('megane');
    expect(slugify('Citroën C4')).toBe('citroen-c4');
  });

  it('colapsa todo lo que no sea letra o número', () => {
    expect(slugify('Clase A 180 d')).toBe('clase-a-180-d');
    expect(slugify('  C4  //  Picasso  ')).toBe('c4-picasso');
  });

  it('no deja guiones sueltos en los extremos', () => {
    expect(slugify('-Ford-')).toBe('ford');
    expect(slugify('!!!')).toBe('');
  });
});

describe('slugBase', () => {
  it('es marca y modelo, nunca la versión', () => {
    expect(slugBase({ brand: 'Renault', model: 'Mégane' })).toBe('renault-megane');
  });
});

describe('slugsDeFlota', () => {
  it('sin colisiones, cada coche se queda con marca y modelo', () => {
    const flota = [
      coche({ id: 'a1', brand: 'Ford', model: 'Custom' }),
      coche({ id: 'b2', brand: 'Renault', model: 'Megane' }),
      coche({ id: 'c3', brand: 'Dacia', model: 'Duster' }),
    ];
    const s = slugsDeFlota(flota);
    expect(s.get('a1')).toBe('ford-custom');
    expect(s.get('b2')).toBe('renault-megane');
    expect(s.get('c3')).toBe('dacia-duster');
  });

  it('dos del mismo modelo se desempatan por versión', () => {
    const flota = [
      coche({ id: 'a1', version: 'Sport Tourer' }),
      coche({ id: 'b2', version: 'RS Line' }),
    ];
    const s = slugsDeFlota(flota);
    expect(s.get('a1')).toBe('renault-megane-sport-tourer');
    expect(s.get('b2')).toBe('renault-megane-rs-line');
  });

  /**
   * ⚠️ **Y NUNCA con la matrícula**, que era la primera idea. No está en la API
   * pública y publicarla dejaría las placas de la flota indexadas en Google.
   * El desempate de último recurso sale del id, que no dice nada de nadie.
   */
  it('sin versión que los distinga, se desempatan con un código del id', () => {
    const flota = [coche({ id: 'jRfQu3ebHPe1' }), coche({ id: 'WEO7vHPU6ZaR' })];
    const s = slugsDeFlota(flota);
    expect(s.get('jRfQu3ebHPe1')).toBe('renault-megane-jrfq');
    expect(s.get('WEO7vHPU6ZaR')).toBe('renault-megane-weo7');
    expect(s.get('jRfQu3ebHPe1')).not.toBe(s.get('WEO7vHPU6ZaR'));
  });

  it('con la misma versión en los dos, también cae al código del id', () => {
    const flota = [
      coche({ id: 'jRfQu3ebHPe1', version: 'RS Line' }),
      coche({ id: 'WEO7vHPU6ZaR', version: 'RS Line' }),
    ];
    const s = slugsDeFlota(flota);
    expect(s.get('jRfQu3ebHPe1')).toBe('renault-megane-jrfq');
    expect(s.get('WEO7vHPU6ZaR')).toBe('renault-megane-weo7');
  });

  /**
   * ⚠️ **El reparto no puede depender de cómo venga ordenada la flota.** Si
   * dependiera, un despliegue cambiaría la dirección de un coche sin que nadie
   * tocara nada — y con ella su sitio en Google.
   */
  it('da el mismo resultado venga como venga ordenada', () => {
    const a = coche({ id: 'jRfQu3ebHPe1' });
    const b = coche({ id: 'WEO7vHPU6ZaR' });
    // Se compara la CORRESPONDENCIA, no el orden de inserción del Map: lo que
    // tiene que ser estable es qué slug le toca a cada coche.
    expect(Object.fromEntries(slugsDeFlota([a, b]))).toEqual(
      Object.fromEntries(slugsDeFlota([b, a]))
    );
  });

  it('un coche sin marca ni modelo se queda con su id y no con un guion suelto', () => {
    const s = slugsDeFlota([coche({ id: 'abc123', brand: '', model: '' })]);
    expect(s.get('abc123')).toBe('abc123');
  });

  it('todos los slugs de una flota son distintos entre sí', () => {
    const flota = [
      coche({ id: 'a1' }),
      coche({ id: 'b2' }),
      coche({ id: 'c3', version: '2019' }),
      coche({ id: 'd4', brand: 'Renault', model: 'Megane 2019' }),
    ];
    const s = slugsDeFlota(flota);
    const valores = [...s.values()];
    expect(new Set(valores).size).toBe(valores.length);
  });
});

describe('cocheDeSegmento', () => {
  const flota = [
    coche({ id: 'a1', brand: 'Ford', model: 'Custom' }),
    coche({ id: 'b2', brand: 'Renault', model: 'Megane' }),
  ];

  it('encuentra por slug', () => {
    expect(cocheDeSegmento(flota, 'ford-custom')?.id).toBe('a1');
  });

  /**
   * ⚠️ **Las direcciones viejas con el id tienen que seguir resolviendo.** Están
   * en el índice de Google y en cualquier WhatsApp que se mandara; dejar de
   * atenderlas convierte cada una en una ficha que no carga.
   */
  it('encuentra también por el id crudo, que es la URL de antes', () => {
    expect(cocheDeSegmento(flota, 'b2')?.id).toBe('b2');
  });

  it('lo que no existe devuelve null, no el primero de la lista', () => {
    expect(cocheDeSegmento(flota, 'seat-ibiza')).toBeNull();
    expect(cocheDeSegmento(flota, '')).toBeNull();
  });
});
