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
  /**
   * La fila que **no es una zona**: vacía el campo y deja escribir.
   *
   * ⚠️ **Existe porque elegir «Otra» y que el campo se quedara escrito con la
   * palabra «Otra» no servía de nada.** Lo dijo Dorel el 30 de septiembre de
   * 2026 —«prefiero que al hacer clic en ella me deje escribir»—: lo que hace
   * falta saber es la localidad, y una opción que se limita a poner una
   * etiqueta genérica en el campo la esconde en vez de pedirla.
   *
   * ⚠️ **Y por eso también se excluye del `<datalist>` de respaldo**, en
   * `index.astro`. Ese respaldo es la lista del navegador para cuando el
   * JavaScript no llega a ejecutarse, y ahí no hay nada que pueda vaciar el
   * campo: elegirla escribiría «Prefiero especificar…» como si fuera el nombre
   * de un pueblo, que es exactamente lo que esto viene a quitar.
   */
  libre?: boolean;
}

/**
 * ⚠️ **La primera es la que manda**: es la que el buscador trae puesta, porque
 * casi todos los alquileres salen de la oficina.
 *
 * ⚠️ **Son CUATRO, y antes fueron cinco y luego tres.** Estaban además Mejorada
 * del Campo y Coslada, las dos con el suplemento sin decidir, y Barajas figuraba
 * con su nombre largo. La lista la fijó Dorel el 29 de septiembre de 2026 y el
 * recorte es la mitad del arreglo: una lista de zonas en la que dos filas dicen
 * «a consultar» no es un catálogo de precios, es una lista de dudas — y el
 * visitante que ve dos precios sin resolver deja de fiarse también de los que
 * sí están.
 *
 * ⚠️ **La cuarta es la puerta de salida y la puso Dorel el 30 de septiembre de
 * 2026.** No es una duda disfrazada de precio, que es lo que se recortó el día
 * anterior: las tres de arriba dicen exactamente lo que cuestan y esta dice que
 * hay conversación. La diferencia importa porque lo que se lee es la fila
 * entera — «Mejorada del Campo · a consultar» promete una tarifa que no existe,
 * y esta no promete ninguna.
 *
 * ⚠️ **Y se llama «Prefiero especificar…» y no «Otra» porque tiene que decir lo
 * que hace.** Nació como «Otra» esa misma mañana y duró unas horas: al elegirla
 * dejaba la palabra «Otra» escrita en el campo, o sea que el visitante que vive
 * en Cuenca acababa con un formulario que no nombra Cuenca. Ahora vacía el
 * campo y le pone el cursor dentro (`libre`), y el rótulo es la instrucción.
 */
export const ZONAS: ZonaRecogida[] = [
  { nombre: 'Arganda del Rey', coste: 'gratuito' },
  { nombre: 'Rivas', coste: 'gratuito' },
  { nombre: 'Aeropuerto', coste: '+30 €' },
  { nombre: 'Prefiero especificar…', coste: 'lo acordamos', libre: true },
];

/**
 * ⚠️ **Los 30 € del aeropuerto son POR TRAYECTO y CON IVA INCLUIDO.** Lo fijó
 * Dorel el 30 de septiembre de 2026, y hay que saberlo al crear la reserva
 * porque el backoffice trabaja al revés: `deliveryFees` se teclea **NETO** y el
 * IVA se suma encima.
 *
 * O sea que para que el contrato imprima **30,00 €** hay que teclear
 * **24,79** — no 30, que imprimiría 36,30 y cobraría seis euros de más de lo
 * que la web prometió. Es la misma trampa de los dos sentidos del IVA que
 * CLAUDE.md documenta: en un alquiler se suma, en un gasto se extrae, y
 * confundirlas no da un error sino una cifra creíble y equivocada.
 *
 * Y **son dos trayectos**: llevarlo y traerlo se cobran por separado, así que
 * ida y vuelta al aeropuerto son 60 € para el cliente (24,79 × 2 tecleados).
 */
export const AEROPUERTO_NETO_A_TECLEAR = 24.79;

/** La que trae escrita el buscador. */
export const ZONA_POR_DEFECTO = ZONAS[0].nombre;

/**
 * Hasta dónde llega la entrega **sin coste**, dicho como lo dijo Dorel el 30 de
 * septiembre de 2026: «es gratuita en Arganda y las localidades de alrededor de
 * los 10 km».
 *
 * ⚠️ **Es una promesa por DISTANCIA, y el sistema no mide distancias.** El
 * buscador trabaja con un catálogo de zonas por nombre; esto es una frase
 * comercial que cubre lo que el catálogo no nombra. Las dos tienen que decir lo
 * mismo, así que la página de entrega renderiza `ZONAS` para lo que ya tiene
 * precio decidido y usa este radio para el resto.
 */
export const RADIO_SIN_COSTE_KM = 10;

/**
 * Pueblos que se nombran en la página de entrega **sin precio**.
 *
 * ⚠️ **Sin cifra a propósito.** Nombrarlos trae las búsquedas de cada pueblo
 * —«alquiler de coches en Coslada»— y no ata a Velto a siete importes. El día
 * que uno tenga precio decidido, sube a `ZONAS` y sale del buscador con él.
 *
 * ⚠️ **Y están FUERA de los 10 km**, que es lo que los separa de los gratuitos.
 * Si alguno resulta estar dentro, no va aquí: va gratis, y entonces la página
 * diría dos cosas distintas sobre el mismo sitio.
 *
 * ⚠️ **La última no es un pueblo, y es deliberado.** Aquí ponía «Madrid
 * capital» y Dorel lo cortó el 30 de septiembre de 2026 —«lo de Madrid capital
 * no lo entiendo, pon Comunidad de Madrid y listo»—: singularizar la capital en
 * una lista de pueblos del corredor se lee como que la empresa llega a Madrid y
 * **no** a Alcalá o a Getafe, que es lo contrario de lo que pasa. Puesta como
 * región, la fila cierra la lista en vez de abrir una duda: los seis nombres de
 * arriba siguen trayendo las búsquedas de cada pueblo y este dice hasta dónde
 * se llega. Va la última a propósito, porque las contiene a todas.
 */
export const ZONAS_CERCANAS: string[] = [
  'Coslada',
  'San Fernando de Henares',
  'Torrejón de Ardoz',
  'Loeches',
  'Morata de Tajuña',
  'Perales de Tajuña',
  'Comunidad de Madrid',
];

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
  // La fila `libre` no es una zona: no tiene tarifa que devolver, y darla por
  // buena aquí convertiría un rótulo de instrucción en un nombre de pueblo.
  return ZONAS.find((z) => !z.libre && z.nombre.toLowerCase() === limpio) ?? null;
}
