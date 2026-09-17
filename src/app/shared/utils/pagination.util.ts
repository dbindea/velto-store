/**
 * Cuántos registros trae un listado de entrada, y cuántos añade cada vez que se
 * pide más.
 *
 * ⚠️ **Los listados traían la colección ENTERA.** Pagos, Reservas, Contratos e
 * Inspecciones hacían `orderBy('createdAt','desc')` sin límite, así que abrir
 * la pantalla leía todos los registros que hubiera desde el primer día. Hoy no
 * se nota porque la base está casi vacía; con el volumen de un negocio de diez
 * coches a cuatro años son del orden de 6.000 filas de cobro y 1.760 reservas —
 * y cada documento lleva sus snapshots dentro, así que no son filas pequeñas.
 *
 * La regla de negocio detrás del número: lo que se mira a diario es lo de
 * **ahora**. Un cobro de hace dos años se busca, no se hojea. 50 entra de sobra
 * en lo que cabe en varias pantallas de móvil y deja la carga en un tamaño
 * constante, se lleve la empresa un año o diez.
 */
export const PAGINA = 50;

/**
 * El siguiente tamaño de página al pulsar «cargar más antiguos».
 *
 * ⚠️ **Crece el límite en vez de encadenar cursores**, y es una decisión
 * consciente. Con `startAfter` habría que guardar el último documento de cada
 * tramo, y si entre medias entra un cobro nuevo —que entra: la lista de Pagos
 * está **escuchando**— el cursor apunta a un sitio que ya no es el que era y
 * aparecen huecos o repetidos. Subiendo el tope, la consulta sigue siendo una
 * sola y siempre coherente consigo misma.
 *
 * Lo que se paga es releer los primeros N, y se paga poco: Firestore los sirve
 * de su caché local. En una pantalla que mueve dinero, que no haya huecos vale
 * más que ahorrarse esa relectura.
 */
export function siguientePagina(actual: number): number {
  return actual + PAGINA;
}

/**
 * ¿Merece la pena ofrecer «cargar más»?
 *
 * Solo si lo que se ha recibido llena el tope: si vienen menos, es que no hay
 * más y el botón no haría nada. Un botón que no hace nada es un fallo.
 */
export function hayMas(recibidos: number, tope: number): boolean {
  return recibidos >= tope;
}
