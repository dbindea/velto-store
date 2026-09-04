/**
 * Sellado del contrato con el certificado FNMT de la empresa (N-8).
 *
 * Lo que aporta y lo que no, porque la diferencia importa:
 *
 * - **Sí**: acredita que el PDF no se ha alterado desde que lo emitimos, y que
 *   lo emitió VELTO MOBILITY y no cualquiera.
 * - **No**: no mejora la firma *del cliente*, que sigue siendo un trazo
 *   manuscrito digitalizado. Sellar con el certificado de la empresa no la
 *   convierte en cualificada.
 *
 * ⚠️ **Va el último.** Un PDF firmado no se puede tocar sin romper la firma, así
 * que esto se aplica después de incrustar la firma del cliente y justo antes de
 * guardar. Si algún día alguien añade una página después de aquí, el documento
 * saldrá con la firma inválida y Adobe lo dirá en rojo.
 *
 * De momento **sin sellado de tiempo** (decisión de Dorel, 3 de septiembre de
 * 2026): la firma acredita quién y qué, pero no la fecha ante un tercero. Se
 * puede añadir después sin rehacer nada.
 */

import * as functions from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { PDFDocument } from 'pdf-lib';

/** El `.p12` en base64. Ver README: se sube con `functions:secrets:set`. */
export const SIGNING_CERT = defineSecret('VELTO_SIGNING_CERT');
export const SIGNING_CERT_PASSWORD = defineSecret('VELTO_SIGNING_CERT_PASSWORD');

/** Los dos secrets, para el `secrets: [...]` de quien firme. */
export const SIGNING_SECRETS = [SIGNING_CERT, SIGNING_CERT_PASSWORD];

/**
 * True si hay certificado configurado.
 *
 * Se consulta **antes de dibujar** para decidir si el PDF puede prometer que va
 * firmado: la línea «Firmado digitalmente con certificado digital» solo se
 * imprime si de verdad se va a firmar. Antes se imprimía siempre, y el contrato
 * afirmaba una firma que no existía.
 */
export function isSigningConfigured(): boolean {
  try {
    return !!SIGNING_CERT.value() && !!SIGNING_CERT_PASSWORD.value();
  } catch {
    // `.value()` lanza si el secret no está montado en esta function.
    return false;
  }
}

/**
 * Sella el PDF y lo devuelve. Si no hay certificado, devuelve el original.
 *
 * **Nunca lanza.** Un fallo al sellar no puede impedir que el cliente firme su
 * contrato: se registra y se guarda el PDF sin sellar, que es exactamente lo
 * que había antes de N-8. Perder el sello es un problema; perder la firma del
 * cliente después de que la haya hecho, uno mucho peor.
 */
export async function signPdfWithCompanyCertificate(
  pdfBytes: Uint8Array,
  reason: string
): Promise<{ bytes: Uint8Array; signed: boolean }> {
  if (!isSigningConfigured()) {
    return { bytes: pdfBytes, signed: false };
  }

  try {
    const { SignPdf } = await import('@signpdf/signpdf');
    const { P12Signer } = await import('@signpdf/signer-p12');
    const { pdflibAddPlaceholder } = await import('@signpdf/placeholder-pdf-lib');

    const certificate = Buffer.from(SIGNING_CERT.value(), 'base64');
    const passphrase = SIGNING_CERT_PASSWORD.value();

    // El hueco de la firma se abre sobre el PDF ya montado. `pdf-lib` porque es
    // con lo que se genera el contrato: el placeholder para pdfkit habría
    // arrastrado `crypto-js` con vulnerabilidades críticas sin usarlo siquiera.
    const pdfDoc = await PDFDocument.load(pdfBytes);
    pdflibAddPlaceholder({
      pdfDoc,
      reason,
      contactInfo: '',
      name: '',
      location: '',
      /**
       * 32 KB de hueco.
       *
       * ⚠️ Empezó en 8192 «porque una firma ronda los 3-4 KB», y la primera
       * prueba con el certificado real falló con *Signature exceeds placeholder
       * length: 11916 > 8192*: el certificado FNMT de representante incrusta la
       * cadena completa de la autoridad, así que ocupa el triple de lo
       * estimado.
       *
       * Se sobredimensiona a propósito. Pasarse cuesta unos kilobytes en un PDF
       * que ya pesa más de un mega; quedarse corto cuesta el sellado entero, y
       * el margen tiene que aguantar además el día que se renueve el
       * certificado y la cadena crezca.
       */
      signatureLength: 32768
    });

    const withPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
    const signer = new P12Signer(certificate, { passphrase });
    const signed = await new SignPdf().sign(withPlaceholder, signer);

    return { bytes: new Uint8Array(signed), signed: true };
  } catch (err) {
    functions.logger.error('No se pudo sellar el contrato; se guarda sin firma digital', err);
    return { bytes: pdfBytes, signed: false };
  }
}
