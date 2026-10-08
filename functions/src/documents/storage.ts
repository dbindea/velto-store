/**
 * Uploading a generated PDF to Storage and handing back a shareable URL.
 *
 * The download token is what makes the URL work without a signed-in user,
 * which is the whole point: the operator pastes this link into WhatsApp.
 */

import { randomUUID } from 'crypto';
import { storageBucket } from '../admin-guard';
import { disposicionEnLinea } from './nombre-descarga';

export interface UploadedPdf {
  pdfUrl: string;
  pdfPath: string;
}

/**
 * Save `bytes` at `path` and return a public download URL.
 *
 * When a file already exists at that path its download token is REUSED.
 * Writing a fresh token would silently break the link the customer already
 * has in their chat — regenerating a document must not revoke the copy that
 * was already sent.
 *
 * ⚠️ **`nombreDescarga` es lo que impide que se baje una CARPETA**, y por eso
 * todos los que llaman aquí lo pasan. Sin `Content-Disposition`, el navegador
 * saca el nombre de la ruta de la URL —`…/o/reservations%2F<id>%2Fbooking-confirmation.pdf`—
 * y trata cada barra como un directorio. Lo contó Dorel el 8 de octubre de 2026
 * descargando un justificante de producción, y le pasa igual al cliente que abre
 * el enlace corto desde su WhatsApp. Ver `nombre-descarga.ts`.
 *
 * ⚠️ **Es opcional en la firma y no debería serlo.** Lo es porque obligar
 * rompería a quien llame desde fuera de este repositorio, pero un PDF sin nombre
 * vuelve a bajar la carpeta: si añades un documento, pásalo.
 *
 * ⚠️ **Y solo vale para lo que se suba A PARTIR DE AHORA.** Los objetos que ya
 * están en Storage conservan sus metadatos, así que un justificante de agosto
 * seguirá bajando mal hasta que alguien lo regenere. No se tocan en masa a
 * propósito: reescribir metadatos de ficheros de producción para arreglar un
 * nombre es mucho riesgo para muy poco.
 */
export async function uploadPdf(
  path: string,
  bytes: Uint8Array,
  nombreDescarga?: string
): Promise<UploadedPdf> {
  const storage = storageBucket();
  const bucket = storage.bucket();
  const file = bucket.file(path);

  let token: string | undefined;
  try {
    const [exists] = await file.exists();
    if (exists) {
      const [metadata] = await file.getMetadata();
      token = (metadata?.metadata as Record<string, string> | undefined)
        ?.firebaseStorageDownloadTokens;
      // The field holds a comma-separated list; the first one is enough.
      if (token) token = token.split(',')[0];
    }
  } catch {
    // A missing or unreadable object just means we mint a new token.
  }

  const downloadToken = token || randomUUID();

  await file.save(Buffer.from(bytes), {
    contentType: 'application/pdf',
    metadata: {
      /*
       * ⚠️ **`contentDisposition` va DENTRO de `metadata`, y esto lo cazó el
       * compilador en el fichero de al lado.** Aquí estuvo un rato arriba, junto
       * a `contentType`, **y compilaba**: iba detrás de un `...(cond ? {} : {})`
       * y el spread de un objeto condicional **se salta la comprobación de
       * propiedades de más**. O sea que la cabecera no se habría puesto nunca y
       * el PDF habría seguido bajando como carpeta, sin un solo error en
       * ninguna parte. Escrito así, un nombre mal puesto es un fallo de
       * compilación.
       *
       * (`contentType` sí es una opción de `save()`; es la excepción, no la
       * regla.)
       */
      ...(nombreDescarga ? { contentDisposition: disposicionEnLinea(nombreDescarga) } : {}),
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    },
    resumable: false
  });

  return {
    pdfPath: path,
    pdfUrl:
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
      `/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`
  };
}
