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
 *
 * The id is the secret, exactly as the Storage download token was. Quote ids
 * are freshly random; the reservation form is stable on purpose, so
 * regenerating a booking confirmation does not kill the link the customer
 * already has in their chat.
 */

import * as functions from 'firebase-functions';
import { storageBucket } from '../admin-guard';
import { publicBaseUrl } from '../public-url';

/** Ids we mint: URL-safe, no separators, nothing to mistype over the phone. */
const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export type DocumentKind = 'quote' | 'booking';

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

  if (kind === 'q') return `quotes/${id}/quote.pdf`;
  if (kind === 'r') return `reservations/${id}/booking-confirmation.pdf`;
  return null;
}

/** The short id for a document, given the id of the thing it describes. */
export function shortIdFor(kind: DocumentKind, id: string): string {
  return (kind === 'quote' ? 'q' : 'r') + id;
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

export const documentLink = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Behind the Hosting rewrite the path arrives as /d/{id}; called directly on
  // the function URL it arrives as /{id}. Take the last segment either way.
  const segments = req.path.split('/').filter(Boolean);
  const shortId = segments[segments.length - 1] || '';
  const path = resolveDocumentPath(shortId);

  if (!path) {
    res.status(404).send('Documento no encontrado');
    return;
  }

  try {
    const file = storageBucket().bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).send('Documento no encontrado');
      return;
    }

    const filename = path.endsWith('quote.pdf') ? 'presupuesto.pdf' : 'reserva.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    // `inline` so WhatsApp's in-app browser shows it instead of downloading a
    // file the customer then has to hunt for.
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
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
        functions.logger.error('documentLink: stream failed', { path, err });
        if (!res.headersSent) res.status(500).send('No se pudo leer el documento');
      })
      .pipe(res);
  } catch (err) {
    functions.logger.error('documentLink: unexpected failure', { path, err });
    res.status(500).send('No se pudo leer el documento');
  }
});
