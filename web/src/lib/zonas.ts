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
 *
 * ⚠️ **Son dos trayectos, no uno.** El backoffice cobra la entrega y la
 * recogida por separado —hay quien recoge en la oficina y solo pide que vayan a
 * buscarlo—, así que este importe es **por trayecto**. La portada lo dice.
 */

export interface ZonaRecogida {
  /** Lo que se enseña y lo que viaja en la URL. */
  nombre: string;
  /**
   * Suplemento por trayecto, en euros y con IVA incluido.
   *
   * `0` es gratis y se dice así, con la palabra: un «0 €» en una lista de
   * precios se lee como que falta el dato.
   *
   * `null` es **a consultar**, y no es lo mismo que gratis ni que caro: es que
   * ese importe todavía no está decidido. Mientras sea `null`, la web no
   * inventa una cifra.
   */
  suplemento: number | null;
}

/**
 * ⚠️ **La primera es la que manda**: es la que el buscador trae puesta, porque
 * casi todos los alquileres salen de la oficina.
 */
export const ZONAS: ZonaRecogida[] = [
  { nombre: 'Arganda del Rey', suplemento: 0 },
  { nombre: 'Mejorada del Campo', suplemento: 0 },
  { nombre: 'Rivas-Vaciamadrid', suplemento: null },
  { nombre: 'Coslada', suplemento: null },
  { nombre: 'Aeropuerto de Barajas', suplemento: 30 },
];

/** La que trae escrita el buscador. */
export const ZONA_POR_DEFECTO = ZONAS[0].nombre;

/**
 * Cómo se le cuenta al visitante lo que cuesta llegar a su zona.
 *
 * ⚠️ **«Gratis» se dice con la palabra, no con un 0.** En una lista donde las
 * demás llevan cifra, un «0 €» se lee como un dato que falta o como un error de
 * la web; «sin coste» no se puede malinterpretar.
 *
 * ⚠️ **Y lo que no está decidido se dice «a consultar»**, que es cierto, en vez
 * de inventar un importe o de callarlo. Callarlo sería peor: el visitante
 * supondría que es gratis.
 */
export function textoSuplemento(zona: ZonaRecogida): string {
  if (zona.suplemento === null) return 'suplemento a consultar';
  if (zona.suplemento === 0) return 'entrega y recogida sin coste';
  return `${zona.suplemento} € por trayecto`;
}

/** Busca una zona por su nombre exacto. `null` si es texto libre. */
export function zonaPorNombre(nombre: string): ZonaRecogida | null {
  const limpio = nombre.trim().toLowerCase();
  return ZONAS.find((z) => z.nombre.toLowerCase() === limpio) ?? null;
}
