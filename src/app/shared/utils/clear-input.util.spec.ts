import { describe, expect, it } from 'vitest';
import { DESPLAZAMIENTO_FECHA_PX, ZONA_ASPA_PX, enZonaDelAspa } from './clear-input.util';

/**
 * Un campo ancho de sobra que acaba en x = 400. Las cuentas se leen mejor
 * restando de ahí, que es como se piensa la zona: «los 34 píxeles de la
 * derecha».
 */
const CAMPO = { left: 100, right: 400 };
const DERECHA = CAMPO.right;

describe('enZonaDelAspa · campo de texto', () => {
  it('acierta en el centro de la zona', () => {
    expect(enZonaDelAspa(CAMPO, DERECHA - 17, false)).toBe(true);
  });

  it('deja fuera el interior del campo, que es donde se escribe', () => {
    expect(enZonaDelAspa(CAMPO, CAMPO.left + 10, false)).toBe(false);
    expect(enZonaDelAspa(CAMPO, DERECHA - ZONA_ASPA_PX - 1, false)).toBe(false);
  });

  it('incluye el borde izquierdo de la zona y excluye el derecho', () => {
    // Cerrado por la izquierda: el primer píxel de la banda ya vacía.
    expect(enZonaDelAspa(CAMPO, DERECHA - ZONA_ASPA_PX, false)).toBe(true);
    // Abierto por la derecha: el borde del campo ya no es del aspa. En un campo
    // de fecha ese píxel es del calendario, y contarlo dos veces haría que un
    // clic vaciara el campo y abriera el panel a la vez.
    expect(enZonaDelAspa(CAMPO, DERECHA, false)).toBe(false);
  });
});

describe('enZonaDelAspa · campo de fecha, hora o fecha-hora', () => {
  it('acierta en la banda desplazada', () => {
    expect(enZonaDelAspa(CAMPO, DERECHA - DESPLAZAMIENTO_FECHA_PX - 17, true)).toBe(true);
  });

  /**
   * ⚠️ El caso que de verdad importa: la banda del calendario. Si esto diera
   * `true`, pulsar el calendario vaciaría la fecha en vez de abrir el panel —y
   * el icono seguiría teniendo exactamente el mismo aspecto de siempre.
   */
  it('NO invade la zona del calendario', () => {
    expect(enZonaDelAspa(CAMPO, DERECHA - 1, true)).toBe(false);
    expect(enZonaDelAspa(CAMPO, DERECHA - 17, true)).toBe(false);
    expect(enZonaDelAspa(CAMPO, DERECHA - DESPLAZAMIENTO_FECHA_PX, true)).toBe(false);
  });

  it('las dos bandas son contiguas y ningún píxel queda en tierra de nadie', () => {
    const frontera = DERECHA - DESPLAZAMIENTO_FECHA_PX;
    expect(enZonaDelAspa(CAMPO, frontera - 1, true)).toBe(true);
    expect(enZonaDelAspa(CAMPO, frontera, true)).toBe(false);
  });

  it('deja fuera lo que queda a la izquierda de su banda', () => {
    const inicio = DERECHA - DESPLAZAMIENTO_FECHA_PX - ZONA_ASPA_PX;
    expect(enZonaDelAspa(CAMPO, inicio, true)).toBe(true);
    expect(enZonaDelAspa(CAMPO, inicio - 1, true)).toBe(false);
  });
});

describe('enZonaDelAspa · la banda no se sale del campo', () => {
  /**
   * Un campo más estrecho que las dos bandas juntas. Restando a secas, la zona
   * empezaría en una abscisa **anterior** al borde izquierdo y contestaría que
   * sí a clics que ni siquiera caen dentro del campo.
   */
  const estrecho = { left: 0, right: 60 };

  it('no reclama píxeles a la izquierda del campo', () => {
    expect(enZonaDelAspa(estrecho, -5, true)).toBe(false);
  });

  it('dentro de un campo estrecho sigue contestando, recortada', () => {
    expect(enZonaDelAspa(estrecho, 10, true)).toBe(true);
    expect(enZonaDelAspa(estrecho, estrecho.right - DESPLAZAMIENTO_FECHA_PX, true)).toBe(false);
  });

  it('un campo sin anchura no tiene zona', () => {
    expect(enZonaDelAspa({ left: 200, right: 200 }, 200, false)).toBe(false);
  });
});
