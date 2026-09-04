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
// Public, reached through the /d/** Hosting rewrite: short links for WhatsApp.
export { documentLink } from './documents/documentLink';
