/**
 * Dónde se recoge el coche, y qué cuesta llevarlo allí.
 *
 * ⚠️ **Esto NO es un autocompletado de ciudades: es un catálogo de zonas de
 * servicio con su tarifa.** Se llegó a plantear Google Places —o una lista de
 * los 166 municipios a menos de 50 km—, y Dorel lo cortó con la frase que
 * define el problema de verdad: «no quiero muchas porque es una locura». Lo que
 * le interesa al visitante no es que la web reconozca su pueblo, es saber si se
 * lo llevan y cuánto cuesta.
 *
 * ⚠️ **Y el precio que sale de aquí es una PROMESA pública.** Lo que se
 * escriba en este fichero aparece en la portada, así que tiene que ser lo que
 * de verdad se cobra: en el backoffice, la entrega a domicilio se teclea a mano
 * por reserva (`deliveryFees`, con sus dos trayectos independientes), y esta
 * lista es lo que el operador va a tener que respetar al crear esa reserva.
 * Añadir una zona aquí es comprometerse con su importe.
 */

export interface ZonaRecogida {
  /** Lo que se enseña y lo que viaja en la URL. */
  nombre: string;
  /**
   * Lo que cuesta llegar, ya redactado.
   *
   * ⚠️ **El texto va DENTRO de la opción, no en una línea aparte.** Hubo una
   * pista debajo del campo que decía «entrega y recogida sin coste» y Dorel la
   * quitó el 29 de septiembre de 2026: «no tiene sentido, complica demasiado».
   * Tenía razón por partida doble — una línea que aparece y desaparece bajo el
   * campo obliga a reservarle sitio para que el buscador no dé un salto, y
   * repite a pie de campo lo que la propia opción podía decir al elegirla.
   *
   * ⚠️ **Y por eso es una cadena y no un número.** Con un importe suelto había
   * que decidir en el sitio de pintar cómo se dice un 0 —«0 €» se lee como un
   * dato que falta— y cómo se dice lo que no está decidido. Aquí se dice una
   * vez y se lee tal cual.
   */
  coste: string;
}

/**
 * ⚠️ **La primera es la que manda**: es la que el buscador trae puesta, porque
 * casi todos los alquileres salen de la oficina.
 *
 * ⚠️ **Son TRES, y antes fueron cinco.** Estaban además Mejorada del Campo y
 * Coslada, las dos con el suplemento sin decidir, y Barajas figuraba con su
 * nombre largo. La lista la fijó Dorel el 29 de septiembre de 2026 y el recorte
 * es la mitad del arreglo: una lista de zonas en la que dos filas dicen «a
 * consultar» no es un catálogo de precios, es una lista de dudas — y el
 * visitante que ve dos precios sin resolver deja de fiarse también de los que
 * sí están.
 */
export const ZONAS: ZonaRecogida[] = [
  { nombre: 'Arganda del Rey', coste: 'gratuito' },
  { nombre: 'Rivas', coste: 'gratuito' },
  { nombre: 'Aeropuerto', coste: '+30 €' },
];

/** La que trae escrita el buscador. */
export const ZONA_POR_DEFECTO = ZONAS[0].nombre;

/**
 * Busca una zona por su nombre exacto. `null` si es texto libre.
 *
 * ⚠️ **El texto libre NO se rechaza, y ese es el diseño entero del campo.** La
 * empresa va más lejos de estas tres; lo que pasa es que el importe se acuerda
 * por teléfono. Un campo que solo admitiera la lista perdería al cliente que
 * vive un pueblo más allá, que es justo el que llama.
 */
export function zonaPorNombre(nombre: string): ZonaRecogida | null {
  const limpio = nombre.trim().toLowerCase();
  return ZONAS.find((z) => z.nombre.toLowerCase() === limpio) ?? null;
}
