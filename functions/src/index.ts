/**
 * Cloud Functions for Velto.
 *
 * The frontend NEVER handles Redsys secrets, Resend keys, signing secrets,
 * or PDF rendering. All sensitive operations are implemented here.
 *
 * Required environment / secrets (configure with `firebase functions:secrets:set`):
 *   REDSYS_MERCHANT_CODE / REDSYS_TERMINAL / REDSYS_SECRET_KEY
 *   REDSYS_ENVIRONMENT (test | live)
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL (default: reservas@veltorent.com)
 *   VELTO_COMPANY_NAME (default: VELTO MOBILITY)
 *   VELTO_PUBLIC_BASE_URL (origin used to build absolute signing URLs)
 *
 * Functions:
 *   - createRedsysPaymentLink           (auth) — Redsys checkout
 *   - getPaymentCheckout                (public) — el cliente paga desde su móvil
 *   - redsysNotificationWebhook         (public, signed) — Redsys webhook
 *   - generateContractPdf               (auth) — build PDF from a reservation
 *   - createContractSigningLink         (auth) — issue one-time token
 *   - cancelContractSigningLink         (auth) — cancel active link
 *   - getContractForSigning             (public, token) — read-only summary
 *   - signContract                      (public, token) — apply signature
 *   - getContractVerification           (public, code) — CSV del contrato
 *   - sendSignedContractEmail           (auth) — Resend email
 *   - generateQuotePdf                  (auth) — quote, before any reservation
 *   - generateBookingConfirmationPdf    (auth) — booking proof, before signing
 */

// ⚠️ PRIMERA línea ejecutable del backend: fija la región de todas las
// functions. Tiene que ir antes que cualquier 'export ... from', porque esos
// evalúan sus módulos —y definen sus functions— antes que nada de aquí.
import './global-options';

export { createRedsysPaymentLink, getPaymentCheckout, redsysNotificationWebhook } from './redsys';

// Contracts
export { generateContractPdf } from './contracts/generateContractPdf';
export { createContractSigningLink, cancelContractSigningLink } from './contracts/signingLink';
export { getContractForSigning } from './contracts/getContractForSigning';
export { signContract } from './contracts/signContract';
// Pública: la abre quien escanea el QR de un contrato en papel. Devuelve cinco
// datos y ningún dato personal.
export { getContractVerification } from './contracts/getContractVerification';
export { sendSignedContractEmail } from './contracts/sendSignedContractEmail';

// Customer-facing documents that are NOT the contract. Neither touches the
// reservation, so neither can advance the workflow.
export { generateQuotePdf } from './documents/generateQuotePdf';
export { generateBookingConfirmationPdf } from './documents/generateBookingConfirmationPdf';
// El parte de entrega y el de devolución, a los que el contrato remite cuatro
// veces. No se firman —decisión de Dorel, 8 de septiembre de 2026— y lo que
// sostiene un cargo son las fotos con su fecha.
export { generateInspectionReport } from './documents/generateInspectionReport';
// Public, reached through the /d/** Hosting rewrite: short links for WhatsApp.
export { documentLink } from './documents/documentLink';

// Facturación. `issueInvoice` es el único camino por el que una factura puede
// nacer: asigna el número correlativo y calcula la huella encadenada dentro de
// una transacción, y `firestore.rules` cierra la puerta a crear facturas desde
// el cliente precisamente porque una regla no sabe cuál es el siguiente número.
export { issueInvoice } from './invoices/issueInvoice';
// La proforma NO pasa por `issueInvoice`: no consume número de la serie fiscal,
// no se encadena y no escribe en Firestore. Es un PDF y nada más, como el
// presupuesto.
export { generateProforma } from './invoices/generateProforma';
// El recibo tampoco: justifica un cobro que ya consta en `payments`, no
// devenga IVA y no lleva número de serie. Lee el importe del pago en vez de
// aceptarlo en la petición, que es lo que impide que el papel diga que la
// empresa recibió algo que no recibió.
export { generateReceipt } from './invoices/generateReceipt';
// La declaración responsable del art. 15 de la Orden HAC/1177/2024. Le toca a
// Velto porque la aplicación es desarrollo propio: no hay fabricante externo
// que pueda declarar por ella. Una por cada versión del sistema.
export {
  issueComplianceDeclaration,
  getComplianceStatus
} from './invoices/issueComplianceDeclaration';
// La remisión a la AEAT. Va SEPARADA de la emisión a propósito: una factura se
// emite aunque el servicio esté caído, y el envío reintenta hasta conseguirlo.
// `sweepVerifactuRecords` es la que hace que esto cumpla — un envío que solo
// ocurre al pulsar un botón depende de que alguien se acuerde.
export {
  sendVerifactuRecords,
  sweepVerifactuRecords,
  getVerifactuStatus,
  // La autenticación se prueba desde la function, no entrando en la sede con el
  // navegador: allí el certificado lo presenta el navegador y aquí lo presenta
  // Node. Sirve además para ver cuándo caduca el certificado de la FNMT, que es
  // lo que va a pasar seguro y hoy solo se notaría con una factura sin remitir.
  checkVerifactuConnection,
  // Un rechazo para la cadena a propósito, porque casi siempre hay algo que
  // arreglar. Esto es lo que permite reanudarla una vez arreglado — sin ello,
  // «bloqueado» sería un callejón sin salida.
  retryVerifactuRecord
} from './invoices/sendVerifactuRecords';

// El resumen de la mañana con lo que hay que preparar para MAÑANA. Existe
// porque el panel solo avisa si alguien entra, y el día que no se entra es
// justo el día en que hace falta. Sale a las 9:00 para que quede jornada por
// delante: a las 20:00 ya no se puede llamar a un cliente que no ha firmado.
export { sendDailyDigest, previewDailyDigest } from './alerts/sendDailyDigest';
