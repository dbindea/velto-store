import { describe, expect, it } from 'vitest';
import { interpolate } from './i18n-params.util';

// ---------------------------------------------------------------------------
// La sustitución de `{nombre}` sobre un texto ya traducido.
//
// Es pequeña y estaba escrita tres veces —la pila de avisos, el diálogo de
// confirmación y a punto de una cuarta en los errores de tarifa—, que es
// exactamente el tamaño en el que una copia se hace sin pensar. Estos tests son
// para que la única que queda no se pueda romper sin enterarse.
// ---------------------------------------------------------------------------

describe('interpolate', () => {
  it('sustituye el hueco por su valor', () => {
    expect(interpolate('Se han retenido {amount} €', { amount: '145,00' }))
      .toBe('Se han retenido 145,00 €');
  });

  it('sin parámetros devuelve el texto tal cual', () => {
    expect(interpolate('No hay nada que sustituir')).toBe('No hay nada que sustituir');
    expect(interpolate('Con {hueco} y sin params')).toBe('Con {hueco} y sin params');
  });

  it('sustituye todas las apariciones del mismo hueco', () => {
    expect(interpolate('{x} y otra vez {x}', { x: 'ya' })).toBe('ya y otra vez ya');
  });

  it('varios huecos a la vez', () => {
    expect(interpolate('Faltan los días {from} a {to}', { from: '4', to: '7' }))
      .toBe('Faltan los días 4 a 7');
  });

  /**
   * ⚠️ **El orden de los huecos lo decide el TEXTO, no el objeto.** Es toda la
   * razón de traducir primero y sustituir después: en rumano o en inglés la
   * frase no coloca los datos donde los coloca el español, y construyéndola por
   * trozos se acaba con un orden de palabras que solo funciona en un idioma.
   */
  it('respeta el orden que tiene la frase traducida, no el del objeto', () => {
    const params = { from: '4', to: '7' };
    expect(interpolate('Days {from} to {to} are missing', params))
      .toBe('Days 4 to 7 are missing');
    expect(interpolate('Lipsesc zilele {from} până la {to}', params))
      .toBe('Lipsesc zilele 4 până la 7');
  });

  /**
   * Un hueco que la traducción no usa simplemente no aparece: quien llama no
   * tiene que saber qué huecos tiene cada idioma, y una traducción que se deja
   * uno no puede romper la frase entera.
   */
  it('un parámetro que la frase no nombra se ignora', () => {
    expect(interpolate('Sin huecos', { amount: '10' })).toBe('Sin huecos');
  });

  /**
   * Y uno que la frase nombra pero nadie pasa se queda escrito. Es feo a
   * propósito: se ve en pantalla, que es como se descubre que falta un dato —
   * mejor que borrarlo y dejar una frase que parece correcta y no lo es.
   */
  it('un hueco sin valor se queda a la vista', () => {
    expect(interpolate('Faltan {from} a {to}', { from: '4' })).toBe('Faltan 4 a {to}');
  });
});
