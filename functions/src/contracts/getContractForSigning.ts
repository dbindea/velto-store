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

interface PublicContractView {
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
  status: 'active' | 'used' | 'expired' | 'cancelled' | 'invalid';
  companyName: string;
}

const VELTO_COMPANY_NAME = process.env.VELTO_COMPANY_NAME || 'Velto Rent';

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return undefined;
}

function formatDate(d?: Date): string | undefined {
  if (!d) return undefined;
  try {
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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
      status: effectiveStatus,
      companyName: VELTO_COMPANY_NAME
    };
  }
);

function invalidView(): PublicContractView {
  return {
    clientName: '',
    vehicleLabel: '',
    vehiclePlate: '',
    status: 'invalid',
    companyName: VELTO_COMPANY_NAME
  };
}
