import { describe, expect, it } from 'vitest';
import { ZONA_ASPA_PX, enZonaDelAspa } from './clear-input.util';

/**
 * Un campo ancho de sobra que acaba en x = 400. Las cuentas se leen mejor
 * restando de ahí, que es como se piensa la zona: «los 44 píxeles de la
 * derecha».
 */
const CAMPO = { left: 100, right: 400 };
const DERECHA = CAMPO.right;

describe('enZonaDelAspa', () => {
  it('acierta en el centro de la zona', () => {
    expect(enZonaDelAspa(CAMPO, DERECHA - 22)).toBe(true);
  });

  it('deja fuera el interior del campo, que es donde se escribe', () => {
    expect(enZonaDelAspa(CAMPO, CAMPO.left + 10)).toBe(false);
    expect(enZonaDelAspa(CAMPO, DERECHA - ZONA_ASPA_PX - 1)).toBe(false);
  });

  it('incluye el borde izquierdo de la zona y excluye el derecho', () => {
    // Cerrado por la izquierda: el primer píxel de la banda ya vacía.
    expect(enZonaDelAspa(CAMPO, DERECHA - ZONA_ASPA_PX)).toBe(true);
    // Abierto por la derecha, que es la convención de cualquier intervalo.
    expect(enZonaDelAspa(CAMPO, DERECHA)).toBe(false);
  });

  /**
   * ⚠️ La zona mide un dedo, no un icono. Estuvo en 34 px —el ancho del icono
   * del calendario— y con el pulgar se fallaba; 44 es el mínimo que piden las
   * guías de Apple y de Android. Este caso es el que se rompería si alguien la
   * devolviera a 34 «para que cuadre con el dibujo».
   */
  it('llega a los 44 px que pide un objetivo táctil', () => {
    expect(ZONA_ASPA_PX).toBeGreaterThanOrEqual(44);
    expect(enZonaDelAspa(CAMPO, DERECHA - 43)).toBe(true);
  });
});

describe('enZonaDelAspa · la banda no se sale del campo', () => {
  /**
   * Un campo más estrecho que la banda. Restando a secas, la zona empezaría en
   * una abscisa **anterior** al borde izquierdo y contestaría que sí a clics
   * que ni siquiera caen dentro del campo.
   */
  const estrecho = { left: 0, right: 30 };

  it('no reclama píxeles a la izquierda del campo', () => {
    expect(enZonaDelAspa(estrecho, -5)).toBe(false);
  });

  it('dentro de un campo estrecho sigue contestando, recortada', () => {
    expect(enZonaDelAspa(estrecho, 10)).toBe(true);
    expect(enZonaDelAspa(estrecho, estrecho.right)).toBe(false);
  });

  it('un campo sin anchura no tiene zona', () => {
    expect(enZonaDelAspa({ left: 200, right: 200 }, 200)).toBe(false);
  });
});
