/**
 * documentLink — short, branded links for the customer-facing PDFs.
 *
 * Public HTTPS endpoint, reached through a Hosting rewrite so the URL sits on
 * the app's own domain:
 *
 *     https://velto-store.web.app/d/qA1b2C3d4E5f6G7h
 *     https://veltorent.com/d/qA1b2C3d4E5f6G7h      ← once the domain is attached
 *
 * instead of the ~160-character Firebase Storage URL, which looks like a
 * phishing attempt when pasted into WhatsApp.
 *
 * ⚠️ There is NO lookup table and NO Firestore document behind this. The id
 * maps straight onto a Storage path, so the quote stays exactly as ephemeral
 * as it was:
 *
 *     /d/q{id}   →  quotes/{id}/quote.pdf
 *     /d/r{id}   →  reservations/{id}/booking-confirmation.pdf
 *     /d/c{id}   →  receipts/{id}/receipt.pdf
 *     /d/i{id}   →  inspections/{id}/report.pdf
 *
 * The id is the secret, exactly as the Storage download token was. Quote ids
 * are freshly random; the reservation form is stable on purpose, so
 * regenerating a booking confirmation does not kill the link the customer
 * already has in their chat.
 *
 * ⚠️ El del recibo es **aleatorio y NO el id del pago**, aunque el pago sea lo
 * que documenta. El id del pago es el secreto de `/pay/:paymentId`, el enlace
 * que se le manda al cliente para que pague desde el móvil: derivar de él la
 * ruta del recibo dejaría que cualquiera con ese enlace reenviado se
 * descargase un PDF con el nombre del cliente, justo lo que
 * `getPaymentCheckout` se cuida de no revelar.
 *
 * ⚠️ **El nombre del fichero se LEE de los metadatos del objeto; aquí no se
 * compone.** Esta function no redirige a Storage: lee el fichero y lo escribe
 * ella, así que la cabecera que vale es la suya — y estuvo poniendo cuatro
 * nombres fijos (`presupuesto.pdf`, `recibo.pdf`, `parte.pdf`, `reserva.pdf`)
 * que **pisaban** el `contentDisposition` que `uploadPdf()` escribe desde el 7
 * de octubre de 2026. O sea que el arreglo del PDF que bajaba como carpeta
 * dejaba fuera justo la vía que decía arreglar «sobre todo»: el cliente abría
 * el enlace de su WhatsApp, le daba a guardar y se bajaba `reserva.pdf` en vez
 * de `Justificante_1234JKL_Marius-Ionescu-Pavel.pdf`. Y en español, para un
 * cliente rumano. Corregido el 8 de octubre de 2026.
 *
 * Leerlo de ahí —en vez de recomponerlo— es lo que hace que no puedan
 * discrepar, y trae gratis el idioma: quien generó el PDF ya puso la palabra en
 * el idioma del documento (`palabraDocumento(tipo, locale)`). Recomponerlo aquí
 * exigiría ir a Firestore por la matrícula y el cliente, y eso es precisamente
 * lo que este endpoint no hace.
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { storageBucket } from '../admin-guard';
import { publicBaseUrl } from '../public-url';
import { disposicionEnLinea, nombreDePdf, palabraDocumento } from './nombre-descarga';

/** Ids we mint: URL-safe, no separators, nothing to mistype over the phone. */
const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export type DocumentKind = 'quote' | 'booking' | 'receipt' | 'inspection';

/** Prefijo de cada tipo. Un sitio, para que el que sirve y el que crea no puedan discrepar. */
const PREFIXES: Record<DocumentKind, string> = {
  quote: 'q',
  booking: 'r',
  receipt: 'c',
  inspection: 'i'
};

/**
 * Storage path for a short id, or null when the id is malformed.
 *
 * Kept deliberately dumb: a prefix and a folder, no database. If this ever
 * needs a lookup, the quote stops being ephemeral and that is a product
 * decision, not a refactor.
 */
export function resolveDocumentPath(shortId: string): string | null {
  if (!shortId || shortId.length < 2) return null;
  const kind = shortId[0];
  const id = shortId.slice(1);
  if (!ID_PATTERN.test(id)) return null;

  if (kind === PREFIXES.quote) return `quotes/${id}/quote.pdf`;
  if (kind === PREFIXES.booking) return `reservations/${id}/booking-confirmation.pdf`;
  if (kind === PREFIXES.receipt) return `receipts/${id}/receipt.pdf`;
  if (kind === PREFIXES.inspection) return `inspections/${id}/report.pdf`;
  return null;
}

/** The short id for a document, given the id of the thing it describes. */
export function shortIdFor(kind: DocumentKind, id: string): string {
  return PREFIXES[kind] + id;
}

/**
 * Qué clase de documento hay detrás de un id corto.
 *
 * ⚠️ **Sale de invertir `PREFIXES`, no de mirar el final de la ruta.** El
 * prefijo es quien decide la carpeta, así que preguntándole a él el tipo y la
 * carpeta no pueden discrepar; con un `path.endsWith('report.pdf')` serían dos
 * sitios donde está escrita la misma relación. Y pasa por
 * `resolveDocumentPath()` a propósito: un id inválido no tiene tipo, o
 * `/d/q` contestaría «presupuesto» sin que haya ningún documento.
 */
export function documentKindOf(shortId: string): DocumentKind | null {
  if (!resolveDocumentPath(shortId)) return null;
  const prefijo = shortId[0];
  const entrada = (Object.entries(PREFIXES) as [DocumentKind, string][]).find(
    ([, p]) => p === prefijo
  );
  return entrada ? entrada[0] : null;
}

/**
 * El `filename` que lleva dentro un `Content-Disposition`, o `null`.
 *
 * ⚠️ **Se sanea aunque venga de nuestros propios metadatos.** Lo que se
 * devuelve acaba en una cabecera HTTP, y un salto de línea ahí es una inyección
 * de cabecera — Node lo rechaza con un `ERR_INVALID_CHAR`, así que el cliente
 * vería un 500 al abrir su enlace. Solo pasa ASCII imprimible, sin comillas ni
 * barras invertidas, que es exactamente lo que `trozo()` produce al subir.
 *
 * ⚠️ **No se mira `filename*=UTF-8''…`** (RFC 5987) porque no se escribe nunca:
 * `nombre-descarga.ts` solo compone ASCII, a propósito. Si algún día apareciera,
 * esto cae al nombre genérico en vez de entregar basura.
 */
function filenameDe(disposicion: string | null | undefined): string | null {
  if (!disposicion) return null;
  const encontrado = /;\s*filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposicion);
  const crudo = (encontrado?.[1] ?? encontrado?.[2] ?? '').trim();
  const limpio = crudo
    .replace(/[^ -~]/g, '')
    .replace(/["\\]/g, '')
    .trim();
  return limpio || null;
}

/**
 * Con qué nombre se guarda el PDF que sirve este endpoint.
 *
 * Lo manda el objeto. El respaldo —un objeto subido **antes** del 7 de octubre
 * de 2026, que no lleva metadato— es la palabra del tipo a secas:
 * `Justificante.pdf`. No arregla la carpeta de nadie por arte de magia, pero es
 * un nombre, que es lo único que impide que el navegador se invente uno desde
 * la ruta.
 *
 * ⚠️ **Ese respaldo va en ESPAÑOL y no en el idioma del navegador del
 * cliente.** El idioma que corresponde es el del PDF, y de un objeto sin
 * metadato no se sabe cuál es: `Rezervare.pdf` sobre un documento en español
 * sería una cifra creíble y equivocada. El español es el idioma por defecto de
 * los documentos de la casa, así que es la apuesta honesta.
 */
export function nombreDeDescarga(
  disposicionDelObjeto: string | null | undefined,
  kind: DocumentKind
): string {
  return filenameDe(disposicionDelObjeto) ?? nombreDePdf(palabraDocumento(kind));
}

/**
 * Absolute link an operator can paste into WhatsApp.
 *
 * `VELTO_PUBLIC_BASE_URL` is the same secret the signing links already use, so
 * pointing it at the custom domain moves every customer-facing URL at once.
 */
export function documentLinkUrl(shortId: string): string {
  // Sin la variable, `publicBaseUrl()` cae al dominio de Hosting del proyecto en
  // vez de devolver una ruta relativa: un enlace relativo pegado en un chat está
  // muerto.
  return `${publicBaseUrl()}/d/${shortId}`;
}

export const documentLink = onRequest(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Behind the Hosting rewrite the path arrives as /d/{id}; called directly on
  // the function URL it arrives as /{id}. Take the last segment either way.
  const segments = req.path.split('/').filter(Boolean);
  const shortId = segments[segments.length - 1] || '';
  const path = resolveDocumentPath(shortId);
  const kind = documentKindOf(shortId);

  if (!path || !kind) {
    res.status(404).send('Documento no encontrado');
    return;
  }

  try {
    const file = storageBucket().bucket().file(path);

    /*
     * ⚠️ **`getMetadata()` y no `exists()`.** Hace falta el
     * `contentDisposition` que escribió quien generó el PDF, y pedir los
     * metadatos ya contesta si el objeto está: una llamada en vez de dos, en el
     * camino que recorre el cliente desde su WhatsApp. Un 404 de aquí es «no
     * está»; cualquier otro fallo sube al `catch` de abajo y sale como 500, que
     * es lo honesto — un problema de permisos no es un documento inexistente.
     */
    let metadata: { contentDisposition?: string | null } | undefined;
    try {
      [metadata] = await file.getMetadata();
    } catch (err) {
      if (Number((err as { code?: number | string } | null)?.code) === 404) {
        res.status(404).send('Documento no encontrado');
        return;
      }
      throw err;
    }

    res.setHeader('Content-Type', 'application/pdf');
    // `inline` so WhatsApp's in-app browser shows it instead of downloading a
    // file the customer then has to hunt for. La decisión de que sea `inline`
    // vive en `nombre-descarga.ts`, que es el único sitio que la explica: un
    // `attachment` convertiría los botones de «Abrir» en botones de descargar.
    res.setHeader(
      'Content-Disposition',
      disposicionEnLinea(nombreDeDescarga(metadata?.contentDisposition, kind))
    );
    // Short cache: the booking confirmation is regenerated in place, and a
    // customer reopening the link should see the current state of their booking.
    res.setHeader('Cache-Control', 'public, max-age=300');

    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }

    file
      .createReadStream()
      .on('error', (err) => {
        logger.error('documentLink: stream failed', { path, err });
        if (!res.headersSent) res.status(500).send('No se pudo leer el documento');
      })
      .pipe(res);
  } catch (err) {
    logger.error('documentLink: unexpected failure', { path, err });
    res.status(500).send('No se pudo leer el documento');
  }
});
