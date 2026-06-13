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
 *   VELTO_COMPANY_NAME (default: Velto Rent)
 *   VELTO_PUBLIC_BASE_URL (origin used to build absolute signing URLs)
 *
 * Functions:
 *   - createRedsysPaymentLink           (auth) — Redsys checkout
 *   - redsysNotificationWebhook         (public, signed) — Redsys webhook
 *   - generateContractPdf               (auth) — build PDF from a reservation
 *   - createContractSigningLink         (auth) — issue one-time token
 *   - cancelContractSigningLink         (auth) — cancel active link
 *   - getContractForSigning             (public, token) — read-only summary
 *   - signContract                      (public, token) — apply signature
 *   - sendSignedContractEmail           (auth) — Resend email
 */

export { createRedsysPaymentLink, redsysNotificationWebhook } from './redsys';

// Contracts
export { generateContractPdf } from './contracts/generateContractPdf';
export { createContractSigningLink, cancelContractSigningLink } from './contracts/signingLink';
export { getContractForSigning } from './contracts/getContractForSigning';
export { signContract } from './contracts/signContract';
export { sendSignedContractEmail } from './contracts/sendSignedContractEmail';
