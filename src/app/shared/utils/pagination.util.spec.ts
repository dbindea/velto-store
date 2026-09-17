import { describe, it, expect } from 'vitest';
import { PAGINA, hayMas, siguientePagina } from './pagination.util';

describe('hayMas — el botón solo si hay algo detrás', () => {
  it('con la página llena, hay más', () => {
    expect(hayMas(50, 50)).toBe(true);
  });

  it('con menos de lo pedido, NO hay más', () => {
    // Es lo que impide ofrecer un botón que no haría nada.
    expect(hayMas(13, 50)).toBe(false);
  });

  it('sin nada, tampoco', () => {
    expect(hayMas(0, 50)).toBe(false);
  });

  it('sigue habiendo más en la segunda página llena', () => {
    expect(hayMas(100, 100)).toBe(true);
  });

  it('la última página incompleta cierra el botón', () => {
    expect(hayMas(87, 100)).toBe(false);
  });
});

describe('siguientePagina — el tope crece, no se encadena', () => {
  it('sube de una página en una página', () => {
    expect(siguientePagina(PAGINA)).toBe(PAGINA * 2);
    expect(siguientePagina(PAGINA * 2)).toBe(PAGINA * 3);
  });

  it('cada llamada es una consulta entera, no un tramo', () => {
    // ⚠️ Esta es la propiedad que importa: el tope NUEVO contiene a todo lo
    // anterior. Con cursores, un cobro que entrara entre dos tramos —y entran,
    // porque la lista está escuchando— dejaría un hueco o un repetido.
    let tope = PAGINA;
    for (let i = 0; i < 4; i++) tope = siguientePagina(tope);
    expect(tope).toBe(PAGINA * 5);
    expect(tope).toBeGreaterThan(PAGINA);
  });
});

describe('PAGINA', () => {
  it('es un número razonable de filas para una pantalla', () => {
    expect(PAGINA).toBeGreaterThanOrEqual(20);
    expect(PAGINA).toBeLessThanOrEqual(100);
  });
});
