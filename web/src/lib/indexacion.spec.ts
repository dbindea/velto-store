import { describe, expect, it } from 'vitest';
import { marcaRobots } from './indexacion';

/**
 * ⚠️ **Este test existe porque un `noindex` de más no se ve y uno de menos
 * tampoco.** Las dos averías son silenciosas y las dos han pasado de verdad en
 * esta casa: el sitio de desarrollo se publicó un tiempo ofreciéndose al índice
 * con una canónica apuntando a producción, y el respaldo de las fichas de coche
 * estuvo contestando `200` a cualquier id inventado sin decir que no se
 * indexara. Ninguna de las dos rompe un build, ni falla `astro check`, ni sale
 * en una pantalla: se ven midiendo el HTML servido, que no lo hace nadie.
 *
 * ⚠️ **Y por eso se comprueba también el CONTROL.** Afirmando solo lo que se
 * prohíbe, una función que marcara `noindex` en todo pasaría los tres casos
 * restrictivos y tiraría el escaparate entero sin que ningún test se quejara.
 */
describe('la marca de robots de una pagina', () => {
  it('no marca NADA en una pagina corriente del sitio real — el control', () => {
    // Lo que deja una página indexable es la AUSENCIA de etiqueta, no un
    // `index, follow` escrito. Si esto deja de ser `null`, el escaparate se
    // queda fuera del índice.
    expect(marcaRobots({ sitioReal: true })).toBeNull();
    expect(marcaRobots({ sitioReal: true, sinIndexar: false })).toBeNull();
  });

  it('saca del indice el sitio de desarrollo entero, enlaces incluidos', () => {
    expect(marcaRobots({ sitioReal: false })).toBe('noindex, nofollow');
  });

  it('saca del indice una pagina que lo pide, SIN tirar sus enlaces', () => {
    // El respaldo de las fichas: `noindex` para que no se indexe el HTML
    // genérico, y sin `nofollow` porque sus enlaces son la navegación de la
    // casa y a veces el único camino hacia un coche recién publicado.
    expect(marcaRobots({ sitioReal: true, sinIndexar: true })).toBe('noindex');
  });

  it('en desarrollo manda el sitio, aunque la pagina pida lo mismo', () => {
    // Las dos reglas se solapan y lo que no puede salir son dos etiquetas: la
    // del sitio es la más restrictiva y se queda ella sola.
    expect(marcaRobots({ sitioReal: false, sinIndexar: true })).toBe('noindex, nofollow');
  });
});
