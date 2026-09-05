/**
 * getContractForSigning
 *
 * Public, no auth. Accepts a token and returns ONLY the minimum data
 * needed by the public signing page:
 *   - client name (no document number, no email)
 *   - vehicle brand/model/plate
 *   - pickup/return dates
 *   - final price
 *   - deposit amount
 *   - contract number
 *   - status of the token (active / used / expired / cancelled)
 *   - PDF url so the customer can preview the contract
 *   - 9 high-level highlights from the contract (the "front page")
 *   - preferred locale of the body (so the signing page can show
 *     clauses in es/en/ro)
 *
 * Internal fields (signing token id, original signed path, etc.) are
 * NOT returned. Internal-only fields never leak through this endpoint.
 *
 * The function does NOT throw a 404 for a wrong token. Instead it
 * returns status='invalid'. This avoids leaking which tokens exist
 * (basic enumeration defence).
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { firestore } from '../admin-guard';
import { companyConfig } from '../company-config';
import type { ContractLocale } from './contract-types';
import { pickBundle } from './clauses';

export interface PublicContractView {
  contractNumber?: string;
  clientName: string;
  vehicleLabel: string;
  vehiclePlate: string;
  pickupDate?: string;
  returnDate?: string;
  totalDays?: number;
  finalPrice?: number;
  depositAmount?: number;
  pickupLocation?: string;
  returnLocation?: string;
  pdfUrl?: string;
  /** The 9 front-page highlights for the public signing page. */
  highlights: string[];
  /** Locale of the highlights + clauses; 'es' by default. */
  locale: ContractLocale;
  status: 'active' | 'used' | 'expired' | 'cancelled' | 'invalid';
  companyName: string;
  /** Correo de contacto, por entorno. Ver `companyEmail`. */
  companyEmail: string;
}

/**
 * La página pública de firma habla de tú a tú con el cliente, así que lleva la
 * **marca**. Antes leía `VELTO_COMPANY_NAME`, que es la razón social: coincidía
 * de puro azar, porque ese valor no está puesto y caía al literal de aquí. En
 * cuanto alguien lo configurase, al cliente le habría aparecido «S.L.» en la
 * cabecera de la pantalla donde firma.
 */
const brandName = () => companyConfig().brandName;
/**
 * El correo que el cliente ve al pie de la pantalla de firma.
 *
 * Viaja desde aquí y no desde el frontend a propósito: en la app es una
 * constante compilada, la misma para los dos entornos, y en producción salía
 * el correo de desarrollo debajo del botón de firmar mientras el contrato
 * adjunto llevaba el bueno. Aquí sale de `.env.<proyecto>`, que sí distingue.
 */
const companyEmail = () => companyConfig().email;

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return undefined;
}

/** See the note in pdf.ts — Cloud Functions run with TZ=UTC. */
const CONTRACT_TIME_ZONE = process.env.VELTO_TIME_ZONE || 'Europe/Madrid';

function formatDate(d?: Date): string | undefined {
  if (!d) return undefined;
  try {
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: CONTRACT_TIME_ZONE
    });
  } catch {
    return undefined;
  }
}

interface Request {
  token: string;
}

export const getContractForSigning = functions.https.onCall(
  async (request): Promise<PublicContractView> => {
    const data = request.data as Request;
    if (!data?.token) {
      return invalidView();
    }
    const db = firestore();

    // 1. Find the token document
    const tokenQ = await db.collection('contractSigningTokens')
      .where('token', '==', data.token)
      .limit(1)
      .get();

    if (tokenQ.empty) {
      return invalidView();
    }
    const tokenDoc = tokenQ.docs[0];
    const tokenData = tokenDoc.data() as any;

    // 2. Expire the token if its TTL has passed
    const now = new Date();
    const expiresAt = toDate(tokenData.expiresAt);
    let effectiveStatus: 'active' | 'used' | 'expired' | 'cancelled' = tokenData.status;
    if (effectiveStatus === 'active' && expiresAt && expiresAt < now) {
      effectiveStatus = 'expired';
      await tokenDoc.ref.update({
        status: 'expired',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // 3. Load the contract
    const contractSnap = await db.collection('contracts').doc(tokenData.contractId).get();
    if (!contractSnap.exists) {
      return invalidView();
    }
    const contract = contractSnap.data() as any;

    return {
      contractNumber: contract.contractNumber,
      clientName: contract.clientSnapshot?.fullName || '',
      vehicleLabel: `${contract.vehicleSnapshot?.brand || ''} ${contract.vehicleSnapshot?.model || ''}`.trim(),
      vehiclePlate: contract.vehicleSnapshot?.plateNumber || '',
      pickupDate: formatDate(toDate(contract.reservationSnapshot?.pickupDateTime)),
      returnDate: formatDate(toDate(contract.reservationSnapshot?.returnDateTime)),
      totalDays: contract.reservationSnapshot?.totalDays,
      finalPrice: contract.reservationSnapshot?.finalPrice,
      depositAmount: contract.reservationSnapshot?.depositAmount,
      pickupLocation: contract.reservationSnapshot?.pickupLocation,
      returnLocation: contract.reservationSnapshot?.returnLocation,
      pdfUrl: contract.pdfUrl,
      highlights: buildHighlights(contract),
      locale: resolveLocale(contract),
      status: effectiveStatus,
      companyName: brandName(),
      companyEmail: companyEmail()
    };
  }
);

function invalidView(): PublicContractView {
  return {
    clientName: '',
    vehicleLabel: '',
    vehiclePlate: '',
    highlights: [],
    locale: 'es',
    status: 'invalid',
    companyName: brandName(),
    companyEmail: companyEmail()
  };
}

/**
 * Pick the highlights (and locale) from the contract's frozen clause
 * bundle. Falls back to the static import if the contract predates
 * the schema.
 */
function buildHighlights(contract: any): string[] {
  try {
    const clauses = contract.clauses;
    if (clauses && clauses.t) {
      const { bundle } = pickBundle(clauses, contract.locale);
      return bundle.highlights;
    }
    // Legacy: import the static bundle on demand
    const { CONTRACT_CLAUSES } = require('./clauses');
    const { bundle } = pickBundle(CONTRACT_CLAUSES, contract.locale);
    return bundle.highlights;
  } catch (err) {
    functions.logger.warn('Failed to load contract highlights:', err);
    return [];
  }
}

function resolveLocale(contract: any): ContractLocale {
  const loc = contract.locale as ContractLocale | undefined;
  if (loc === 'es' || loc === 'en' || loc === 'ro') return loc;
  return 'es';
}
