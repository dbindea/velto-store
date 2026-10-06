/**
 * En qué entorno corre esto, y cómo se marca lo que sale de desarrollo.
 *
 * ⚠️ **Existe porque los dos entornos escriben al MISMO buzón.** Desde que
 * producción trabaja en real, un aviso de una solicitud o un resumen diario de
 * desarrollo llega indistinguible del de verdad — y actuar sobre el que no era
 * es llamar a un cliente que no existe, o peor, no llamar al que sí.
 */

/**
 * El proyecto de producción. Lo pone el runtime de Cloud Functions en
 * `GCLOUD_PROJECT`; `GCP_PROJECT` es el nombre antiguo y se mira por si acaso.
 */
const PROYECTO_PRODUCCION = 'rentalcar-veltomobility';

/**
 * ⚠️ **La pregunta se hace al revés a propósito: es producción SOLO el proyecto
 * de producción.** Preguntando «¿es desarrollo?» contra `velto-store`, un
 * entorno nuevo —una copia para probar una migración, un proyecto de otro
 * país— saldría sin marcar y se leería como producción. Así, lo que no se
 * reconozca se marca: equivocarse hacia el aviso de más es inocuo, hacia el de
 * menos no.
 *
 * ⚠️ **Y no se lee de un `.env`.** Esa variable habría que acordarse de ponerla
 * en el fichero de desarrollo, y el día que se olvide el correo vuelve a salir
 * sin marcar: justo el fallo que esto viene a quitar. El id del proyecto lo
 * pone el runtime y no se puede olvidar.
 */
export function esProduccion(): boolean {
  const proyecto = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
  return proyecto === PROYECTO_PRODUCCION;
}

/**
 * El asunto tal y como debe salir, con el prefijo si no es producción.
 *
 * ⚠️ **Se aplica donde se ENVÍA, no donde se redacta.** Las cinco salidas de
 * correo pasan por aquí; metiéndolo en cada plantilla habría que acordarse una
 * vez por correo, y el que se añada mañana saldría sin marcar. Es la misma
 * razón por la que la cáscara de los correos vive en un solo sitio.
 *
 * ⚠️ **Va DELANTE.** Los clientes de correo recortan el asunto por la derecha y
 * en el móvil caben unos 35 caracteres: al final no se vería, que es tanto como
 * no ponerlo.
 */
export function asuntoDeCorreo(asunto: string): string {
  return esProduccion() ? asunto : `(DEV) ${asunto}`;
}
