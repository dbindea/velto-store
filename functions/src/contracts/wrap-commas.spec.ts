import { describe, expect, it } from 'vitest';
import { wrapPreferringCommas } from './pdf';

/**
 * Cómo se parte una dirección larga.
 *
 * Es una decisión tipográfica con consecuencias reales: el domicilio fiscal es
 * contenido obligatorio de la factura (art. 6.1.c), y partido por donde se
 * acaba la columna sale un topónimo cortado en dos —«28850 Torrejón / de Ardoz
 * (Madrid)»— que se lee como si faltara algo.
 *
 * La medida se simula con un límite de caracteres para poder probar la regla
 * sin cargar una fuente, que es justo por lo que la función vive fuera del
 * builder.
 */
const cabeEn = (n: number) => (t: string) => t.length <= n;
const porPalabras = (n: number) => (t: string) => {
  const palabras = t.split(/\s+/);
  const lineas: string[] = [];
  let linea = '';
  for (const w of palabras) {
    const test = linea ? `${linea} ${w}` : w;
    if (test.length <= n) linea = test;
    else {
      if (linea) lineas.push(linea);
      linea = w;
    }
  }
  if (linea) lineas.push(linea);
  return lineas;
};

const partir = (s: string, n: number) => wrapPreferringCommas(s, cabeEn(n), porPalabras(n));

describe('una dirección se parte por sus comas', () => {
  it('si cabe entera, no se parte aunque tenga comas', () => {
    // Tres líneas para «C/ María Zambrano, 4» serían absurdas.
    expect(partir('C/ María Zambrano, 4', 40)).toEqual(['C/ María Zambrano, 4']);
  });

  it('cuando no cabe, el salto cae después de una coma', () => {
    expect(partir('C/ Vereda del Melero, 3, 28500 Arganda del Rey (Madrid)', 30)).toEqual([
      'C/ Vereda del Melero, 3,',
      '28500 Arganda del Rey (Madrid)'
    ]);
  });

  it('junta tramos mientras quepan en vez de una línea por coma', () => {
    const partes = partir(
      'Urbanización El Romeral, parcela 12, portal 3, 28500 Arganda del Rey (Madrid)',
      45
    );
    expect(partes).toEqual([
      'Urbanización El Romeral, parcela 12,',
      'portal 3, 28500 Arganda del Rey (Madrid)'
    ]);
  });

  /**
   * La coma se queda al final de la línea. Es parte del dato que tecleó el
   * operador y en una factura el domicilio es contenido obligatorio: no se le
   * quitan caracteres para que quede bonito.
   */
  it('la coma no se pierde al cortar', () => {
    const partes = partir('Calle Larga del Ejemplo, 3, 28500 Arganda', 26);
    expect(partes.join(' ')).toBe('Calle Larga del Ejemplo, 3, 28500 Arganda');
  });

  it('sin comas, cae al corte por palabras de siempre', () => {
    expect(partir('Pol Ind Las Monjas nave 7 Torrejón de Ardoz', 20)).toEqual([
      'Pol Ind Las Monjas',
      'nave 7 Torrejón de',
      'Ardoz'
    ]);
  });

  it('un tramo entre comas que no cabe ni solo se parte por palabras', () => {
    expect(partir('Avenida, de los Reyes Católicos de Castilla numero 44', 20)).toEqual([
      'Avenida,',
      'de los Reyes',
      'Católicos de',
      'Castilla numero 44'
    ]);
  });

  it('un valor vacío no produce líneas', () => {
    expect(partir('', 20)).toEqual([]);
    expect(partir('   ', 20)).toEqual([]);
  });
});
