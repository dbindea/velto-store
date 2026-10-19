/**
 * El dominio con el que hablamos al cliente.
 *
 * `VELTO_PUBLIC_BASE_URL` vive en `functions/.env.<proyecto>` —no es un secreto
 * y así llega a `process.env` sin declararlo en ninguna function—, y gobierna
 * **todas** las URL que acaban en un WhatsApp: enlaces cortos de documentos,
 * enlace de firma y ahora el de verificación del contrato. Apuntarla al dominio
 * propio los mueve todos a la vez.
 */

/**
 * Origen absoluto, sin barra final.
 *
 * Sin la variable cae al dominio de Hosting del proyecto en vez de devolver una
 * ruta relativa: un enlace relativo pegado en un chat está muerto, y este en
 * concreto va **impreso dentro de un PDF** que el cliente puede tener en papel.
 */
export function publicBaseUrl(): string {
  const configured = (process.env.VELTO_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  const project = process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || '';
  return project ? `https://${project}.web.app` : '';
}

/** El mismo origen sin `https://`, para imprimirlo donde el esquema sobra. */
export function publicBaseHost(): string {
  return publicBaseUrl().replace(/^https?:\/\//, '');
}

/**
 * El **escaparate**, que no es lo mismo que el de arriba.
 *
 * ⚠️ **Son dos sitios distintos del mismo proyecto de Firebase**, y confundirlos
 * manda al cliente al sitio que no es: `publicBaseUrl()` es el **backoffice**
 * —de donde cuelgan `/pay/:id`, `/sign-contract/:token` y los `/d/…`— y éste es
 * `veltomobility.com`, donde vive la política de devoluciones y la página de
 * pagar la señal.
 *
 * ⚠️ **Y aquí NO hay respaldo al dominio del proyecto**, al revés que arriba.
 * Vacío significa «no está configurado» y quien llama **no pinta el enlace**:
 * adivinar `https://<proyecto>.web.app` apuntaría al backoffice, que es
 * justamente el sitio equivocado. Estuvo vacía en producción hasta el 17 de
 * octubre de 2026 y lo que se perdió fue el enlace a las devoluciones en la
 * pantalla de pago — en el único entorno con dinero de verdad.
 */
export function webBaseUrl(): string {
  return (process.env.VELTO_WEB_BASE_URL || '').replace(/\/$/, '');
}
