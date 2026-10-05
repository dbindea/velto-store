/**
 * Ordenar y filtrar la lista de coches libres.
 *
 * ⚠️ **Aparte de la página y con tests, por la misma razón que el calendario y
 * el aspa: lo que decide qué coche sale ARRIBA no se puede comprobar
 * mirando.** Una lista ordenada al revés tiene exactamente la misma pinta que
 * una bien ordenada, y aquí el primero de la lista es el que más se pulsa.
 *
 * ⚠️ **Y el filtro es del NAVEGADOR, no de la API.** Los coches libres ya están
 * descargados: volver a preguntar por cada toque de un filtro añadiría una
 * espera a algo que es instantáneo, y encima podría devolver otra lista si
 * entre medias cambiara la disponibilidad — el visitante vería aparecer y
 * desaparecer coches al filtrar.
 */

import type { CocheDisponible } from './api';
import { categoria } from './api';

/**
 * Los cuatro criterios, y ninguno más.
 *
 * ⚠️ **No hay «relevancia» ni «recomendados».** Sería un orden que nadie puede
 * explicar y que el visitante no puede comprobar; y en un escaparate de una
 * agencia pequeña, «recomendado» se lee como «el que os interesa colocar».
 * Los cuatro de aquí son verificables mirando la propia tarjeta.
 */
export type Orden = 'precio-asc' | 'precio-desc' | 'plazas' | 'maletas';

export const ORDENES: { valor: Orden; rotulo: string }[] = [
  { valor: 'precio-asc', rotulo: 'Precio: de menor a mayor' },
  { valor: 'precio-desc', rotulo: 'Precio: de mayor a menor' },
  { valor: 'plazas', rotulo: 'Más plazas' },
  { valor: 'maletas', rotulo: 'Más maletas' },
];

export const ORDEN_POR_DEFECTO: Orden = 'precio-asc';

export function esOrden(v: string | null): v is Orden {
  return !!v && ORDENES.some((o) => o.valor === v);
}

/**
 * Ordena **una copia**.
 *
 * ⚠️ **`sort` muta el array que recibe**, y aquí eso sería un fallo silencioso:
 * la lista que llega de la API es la que guarda la página para volver a
 * filtrar, así que ordenarla en sitio perdería el orden original y el conteo de
 * las chapas dejaría de cuadrar con lo que se pinta.
 *
 * ⚠️ **Y todos los criterios desempatan por PRECIO.** Con «más plazas», cinco
 * coches de cinco plazas saldrían en el orden en que los devolviera la API —o
 * sea, en cualquier orden, y distinto entre dos búsquedas iguales—. Empatados,
 * manda el más barato, que es lo que el visitante espera de una lista de
 * precios.
 */
export function ordenar(coches: CocheDisponible[], orden: Orden): CocheDisponible[] {
  const porPrecio = (a: CocheDisponible, b: CocheDisponible) => a.price.gross - b.price.gross;
  const copia = [...coches];
  switch (orden) {
    case 'precio-desc':
      return copia.sort((a, b) => b.price.gross - a.price.gross);
    case 'plazas':
      return copia.sort((a, b) => b.seats - a.seats || porPrecio(a, b));
    case 'maletas':
      return copia.sort((a, b) => b.luggageCapacity - a.luggageCapacity || porPrecio(a, b));
    default:
      return copia.sort(porPrecio);
  }
}

export interface ChapaCategoria {
  /** `null` es «todos». */
  clave: string | null;
  rotulo: string;
  cuantos: number;
}

/**
 * Las categorías que **de verdad hay** en esta búsqueda, con su cuenta.
 *
 * ⚠️ **Se derivan de los resultados, no de una lista fija.** Con las nueve
 * categorías del modelo escritas a mano, una búsqueda de cuatro coches sacaría
 * siete chapas que no filtran nada y dos que sí — y un filtro que deja la lista
 * vacía se lee como que la web está rota, no como que no hay coches de esa
 * clase. Es además la razón de que cada chapa lleve su número: así se sabe lo
 * que va a pasar **antes** de pulsarla.
 *
 * ⚠️ **Y se ordenan por cuenta**, no alfabéticamente: lo que más hay, primero.
 * Empatadas, por rótulo, para que dos búsquedas iguales no salgan distintas.
 */
export function chapasDeCategoria(coches: CocheDisponible[]): ChapaCategoria[] {
  const cuenta = new Map<string, number>();
  for (const c of coches) cuenta.set(c.category, (cuenta.get(c.category) ?? 0) + 1);

  const chapas = [...cuenta.entries()]
    .map(([clave, cuantos]) => ({ clave, rotulo: categoria(clave), cuantos }))
    .sort((a, b) => b.cuantos - a.cuantos || a.rotulo.localeCompare(b.rotulo, 'es'));

  /*
   * ⚠️ **Con una sola categoría no se enseña ninguna chapa.** «Todos (4)» y
   * «SUV (4)» filtrando lo mismo es un mando que no hace nada, y la regla de
   * la casa es que un botón que no hace nada es un fallo.
   */
  if (chapas.length < 2) return [];
  return [{ clave: null, rotulo: 'Todos', cuantos: coches.length }, ...chapas];
}

export function filtrar(coches: CocheDisponible[], clave: string | null): CocheDisponible[] {
  return clave ? coches.filter((c) => c.category === clave) : coches;
}

/**
 * «4 coches libres · 4 días».
 *
 * ⚠️ **Dice cuántos se están enseñando, no cuántos había.** Con un filtro
 * puesto, mantener el total de la búsqueda deja el rótulo contando coches que
 * no están debajo.
 */
export function resumen(cuantos: number, dias: number): string {
  const coches = cuantos === 1 ? '1 coche libre' : `${cuantos} coches libres`;
  return `${coches} · ${dias === 1 ? '1 día' : `${dias} días`}`;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * «Del 1 al 4 de octubre» — las fechas que se están mirando, en cristiano.
 *
 * ⚠️ **Existe porque el resumen decía «4 días» y no CUÁLES.** Quien llega a
 * los resultados desde la portada trae sus fechas en la cabeza, pero quien
 * vuelve a la pestaña media hora después, no; y las del formulario están
 * escritas en `01/10/2026 10:00`, que se lee pero no se recuerda.
 *
 * ⚠️ **Y el mes solo se repite si cambia.** «Del 30 de septiembre al 2 de
 * octubre» sí; «del 1 de octubre al 4 de octubre», no.
 */
export function rotuloFechas(desde: string, hasta: string): string {
  const a = new Date(desde);
  const b = new Date(hasta);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '';
  const mismoMes = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const ini = mismoMes ? `${a.getDate()}` : `${a.getDate()} de ${MESES[a.getMonth()]}`;
  return `Del ${ini} al ${b.getDate()} de ${MESES[b.getMonth()]}`;
}
