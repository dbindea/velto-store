/**
 * Los casos que hicieron falta para que esta regla exista.
 *
 * ⚠️ **No son inventados: los cuatro primeros salieron impresos.** Por eso se
 * prueban aquí otra vez aunque el backoffice y las functions ya los prueben en
 * sus copias — una copia sin sus tests es una copia que se puede recortar sin
 * que nada avise, y esta es la que escribe lo que el visitante ve mientras
 * teclea su localidad.
 */

import { describe, expect, it } from 'vitest';
import { capitalizarNombre } from './texto';

describe('capitalizarNombre', () => {
  it('capitaliza cada palabra', () => {
    expect(capitalizarNombre('arganda del rey')).toBe('Arganda del Rey');
  });

  it('doma lo escrito en mayúsculas, que es para lo que está', () => {
    expect(capitalizarNombre('RIVAS VACIAMADRID')).toBe('Rivas Vaciamadrid');
  });

  it('parte por el guion y no solo por el espacio', () => {
    expect(capitalizarNombre('madrid-barajas')).toBe('Madrid-Barajas');
  });

  it('respeta el apóstrofo', () => {
    expect(capitalizarNombre("o'donnell")).toBe("O'Donnell");
  });

  it('deja en minúscula las preposiciones internas, pero no la primera palabra', () => {
    expect(capitalizarNombre('las rozas de madrid')).toBe('Las Rozas de Madrid');
    expect(capitalizarNombre('san fernando de henares')).toBe('San Fernando de Henares');
  });

  it('empieza en la primera letra CON CAJA: «2ºA» no puede salir «2ºa»', () => {
    // El ordinal «º» es letra para Unicode y no tiene caja: buscar \p{L} no
    // habría servido.
    expect(capitalizarNombre('2ºA')).toBe('2ºA');
    expect(capitalizarNombre('(MADRID)')).toBe('(Madrid)');
  });

  it('no toca una palabra que ya mezcla cajas a propósito', () => {
    expect(capitalizarNombre('BlueHDi')).toBe('BlueHDi');
  });

  it('devuelve tal cual lo que no tiene ninguna letra con caja', () => {
    expect(capitalizarNombre('28500')).toBe('28500');
    expect(capitalizarNombre('')).toBe('');
  });

  it('sobrevive a lo que se teclea a medias, que es el caso normal aquí', () => {
    // Se llama en cada tecla, así que la mitad de las entradas reales son
    // palabras sin terminar y separadores sueltos al final.
    expect(capitalizarNombre('san ')).toBe('San ');
    expect(capitalizarNombre('san f')).toBe('San F');
    expect(capitalizarNombre('arganda d')).toBe('Arganda D');
  });
});
