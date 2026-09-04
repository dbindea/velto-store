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
