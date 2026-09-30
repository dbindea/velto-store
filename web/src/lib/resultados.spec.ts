/**
 * Lo que decide qué coche sale primero.
 *
 * ⚠️ **Una lista mal ordenada tiene la misma pinta que una bien ordenada**, que
 * es la misma razón por la que el QR del contrato y el aspa tienen sus tests.
 * Y aquí el primero de la lista es el que más se pulsa: en el backoffice ya
 * pasó que un coche con la tarifa rota salía a 0,00 € y, al ordenar por precio,
 * el primero de todos.
 */

import { describe, expect, it } from 'vitest';
import type { CocheDisponible } from './api';
import {
  chapasDeCategoria,
  filtrar,
  ordenar,
  resumen,
  rotuloFechas,
  esOrden,
} from './resultados';

function coche(
  id: string,
  gross: number,
  seats: number,
  luggageCapacity: number,
  category = 'economy'
): CocheDisponible {
  return {
    id,
    brand: 'Marca',
    model: id,
    year: 2024,
    category,
    bodyType: 'hatchback',
    fuelType: 'petrol',
    transmission: 'manual',
    seats,
    luggageCapacity,
    totalDays: 4,
    price: { net: gross / 1.21, gross, vatRate: 0.21, currency: 'EUR' },
  };
}

const CLIO = coche('clio', 241.95, 5, 2, 'economy');
const BERLINGO = coche('berlingo', 250.95, 5, 6, 'van');
const TRESMIL = coche('3008', 313.95, 5, 4, 'suv');
const COROLLA = coche('corolla', 199.95, 7, 3, 'suv');
const TODOS = [CLIO, BERLINGO, TRESMIL, COROLLA];

describe('ordenar', () => {
  it('por precio ascendente, que es el orden de salida', () => {
    expect(ordenar(TODOS, 'precio-asc').map((c) => c.id)).toEqual([
      'corolla', 'clio', 'berlingo', '3008',
    ]);
  });

  it('por precio descendente', () => {
    expect(ordenar(TODOS, 'precio-desc').map((c) => c.id)).toEqual([
      '3008', 'berlingo', 'clio', 'corolla',
    ]);
  });

  it('por plazas, y los empatados por precio', () => {
    // Tres coches de cinco plazas: sin desempate saldrían como los devolviera
    // la API, o sea distinto entre dos búsquedas iguales.
    expect(ordenar(TODOS, 'plazas').map((c) => c.id)).toEqual([
      'corolla', 'clio', 'berlingo', '3008',
    ]);
  });

  it('por maletas, y los empatados por precio', () => {
    expect(ordenar(TODOS, 'maletas').map((c) => c.id)).toEqual([
      'berlingo', '3008', 'corolla', 'clio',
    ]);
  });

  it('NO toca el array que recibe', () => {
    // La página guarda la lista de la API para volver a filtrar: ordenarla en
    // sitio perdería el orden original y el conteo de las chapas dejaría de
    // cuadrar con lo que se pinta.
    const original = [...TODOS];
    ordenar(TODOS, 'precio-desc');
    expect(TODOS).toEqual(original);
  });

  it('un criterio desconocido cae en precio ascendente', () => {
    expect(ordenar(TODOS, 'lo-que-sea' as never)[0].id).toBe('corolla');
  });
});

describe('esOrden', () => {
  it('acepta los cuatro y rechaza lo demás', () => {
    expect(esOrden('precio-asc')).toBe(true);
    expect(esOrden('maletas')).toBe(true);
    expect(esOrden('relevancia')).toBe(false);
    expect(esOrden(null)).toBe(false);
  });
});

describe('chapasDeCategoria', () => {
  it('solo las categorías que hay, con su cuenta y «Todos» delante', () => {
    expect(chapasDeCategoria(TODOS)).toEqual([
      { clave: null, rotulo: 'Todos', cuantos: 4 },
      { clave: 'suv', rotulo: 'SUV', cuantos: 2 },
      { clave: 'economy', rotulo: 'Económico', cuantos: 1 },
      { clave: 'van', rotulo: 'Furgoneta', cuantos: 1 },
    ]);
  });

  it('con una sola categoría no hay chapas: serían dos mandos que filtran igual', () => {
    expect(chapasDeCategoria([CLIO])).toEqual([]);
    expect(chapasDeCategoria([TRESMIL, COROLLA])).toEqual([]);
  });

  it('sin coches, ninguna', () => {
    expect(chapasDeCategoria([])).toEqual([]);
  });

  it('las empatadas van por rótulo, para que dos búsquedas iguales salgan igual', () => {
    const chapas = chapasDeCategoria(TODOS).filter((c) => c.cuantos === 1);
    expect(chapas.map((c) => c.rotulo)).toEqual(['Económico', 'Furgoneta']);
  });
});

describe('filtrar', () => {
  it('por categoría', () => {
    expect(filtrar(TODOS, 'suv').map((c) => c.id)).toEqual(['3008', 'corolla']);
  });

  it('sin clave, devuelve todo', () => {
    expect(filtrar(TODOS, null)).toHaveLength(4);
  });
});

describe('resumen', () => {
  it('concuerda en singular y en plural', () => {
    expect(resumen(1, 1)).toBe('1 coche libre · 1 día');
    expect(resumen(4, 4)).toBe('4 coches libres · 4 días');
  });
});

describe('rotuloFechas', () => {
  it('no repite el mes cuando es el mismo', () => {
    expect(rotuloFechas('2026-10-01T10:00', '2026-10-04T10:00')).toBe('Del 1 al 4 de octubre');
  });

  it('lo repite cuando cambia', () => {
    expect(rotuloFechas('2026-09-30T10:00', '2026-10-02T10:00')).toBe(
      'Del 30 de septiembre al 2 de octubre'
    );
  });

  it('con una fecha ilegible devuelve vacío en vez de «Invalid Date»', () => {
    expect(rotuloFechas('', '2026-10-04T10:00')).toBe('');
    expect(rotuloFechas('lo que sea', 'tampoco')).toBe('');
  });
});
