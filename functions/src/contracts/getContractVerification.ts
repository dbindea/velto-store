/**
 * getContractVerification (N-9)
 *
 * Pública, sin autenticación. Recibe el Código Seguro de Verificación impreso
 * en el contrato y responde **cinco datos y nada más**: número de contrato,
 * fecha de firma, matrícula, estado y huella SHA-256 del PDF firmado.
 *
 * ⚠️ **Ni un dato personal.** Quien escanee el QR de un contrato olvidado en un
 * mostrador no debe ver el nombre del cliente, su DNI, su teléfono, el importe
 * ni con quién trabajamos. Es la misma regla que `getPaymentCheckout`, y la
 * razón por la que esta función existe en vez de servir el PDF: el PDF los
 * lleva todos.
 *
 * ⚠️ **Lo que confirma y lo que no.** Confirma que el contrato existe, que está
 * firmado y —comparando la huella— que el fichero que tiene el cliente es el
 * que emitimos. **No valida la firma electrónica**: eso lo hace Adobe Reader o
 * VALIDe abriendo el PDF. Los textos de la página pública dicen exactamente
 * esto y no deben decir más.
 *
 * Un código mal formado, uno inexistente y uno de un contrato borrado responden
 * lo mismo: desde fuera no se puede averiguar qué códigos son reales.
 */

import * as functions from 'firebase-functions';
import { firestore } from '../admin-guard';
import { companyConfig } from '../company-config';
import { formatFingerprint, normalizeVerificationCode } from './verification';

export interface PublicVerificationView {
  /** `valid` solo si el contrato existe y está firmado. */
  state: 'valid' | 'cancelled' | 'unknown';
  contractNumber?: string;
  /** ISO 8601. La pantalla lo formatea en el idioma del que mira. */
  signedAt?: string;
  vehiclePlate?: string;
  /** SHA-256 en hexadecimal, agrupada de ocho en ocho para compararla a ojo. */
  fingerprint?: string;
  /** Si el PDF lleva además el sello con el certificado de la empresa. */
  digitallySealed?: boolean;
  /** La marca, nunca la razón social: esto le habla a un cliente. */
  brandName: string;
}

interface Request {
  code: string;
}

function toIso(value: any): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value.seconds) return new Date(value.seconds * 1000).toISOString();
  return undefined;
}

export const getContractVerification = functions.https.onCall(
  async (request): Promise<PublicVerificationView> => {
    const data = request.data as Request;
    const code = normalizeVerificationCode(data?.code || '');

    // Sin normalizar no se consulta: si no, cualquier cadena que alguien tire
    // se convierte en una lectura de Firestore que pagamos nosotros.
    if (!code) return unknownView();

    const snap = await firestore()
      .collection('contracts')
      .where('verificationCode', '==', code)
      .limit(1)
      .get();

    if (snap.empty) return unknownView();

    const contract = snap.docs[0].data() as any;
    if (contract.status === 'cancelled') {
      // Un contrato anulado sí se dice: quien tenga el papel en la mano tiene
      // que enterarse de que ya no vale. Lo que no se dice es por qué.
      return {
        state: 'cancelled',
        contractNumber: contract.contractNumber,
        brandName: companyConfig().brandName
      };
    }
    if (contract.status !== 'signed') return unknownView();

    return {
      state: 'valid',
      contractNumber: contract.contractNumber,
      signedAt: toIso(contract.signedAt),
      vehiclePlate: contract.vehicleSnapshot?.plateNumber || undefined,
      fingerprint: contract.signedPdfSha256
        ? formatFingerprint(contract.signedPdfSha256)
        : undefined,
      digitallySealed: contract.digitallySealed === true,
      brandName: companyConfig().brandName
    };
  }
);

function unknownView(): PublicVerificationView {
  return { state: 'unknown', brandName: companyConfig().brandName };
}
