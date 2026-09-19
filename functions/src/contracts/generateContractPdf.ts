/**
 * generateContractPdf
 *
 * Callable (auth required).
 *
 * Reads the reservation, the linked client, vehicle, pickup inspection
 * (if any) and payment summary, builds the full Contract snapshot,
 * renders the PDF, uploads it to Storage under
 * `contracts/{reservationId}/contract-original.pdf`, and creates or
 * updates the contract document.
 *
 * The contract id is the same as the reservationId for simplicity
 * (one contract per reservation in the MVP). Re-running this function
 * overwrites the previous PDF and snapshot.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { buildContractPdf } from './pdf';
import { CONTRACT_CLAUSES } from './clauses';
import { firestore, storageBucket } from '../admin-guard';
import { companyConfig } from '../company-config';
import type { ContractLocale } from './contract-types';

interface GenerateRequest {
  reservationId: string;
  /** Language of the platform when the operator pressed the button. */
  locale?: ContractLocale;
  /**
   * Sustituir un contrato **ya firmado** por uno nuevo, archivando el anterior.
   *
   * ⚠️ **Sin esta bandera, un contrato firmado no se toca.** Hasta el 15 de
   * septiembre de 2026 esta function escribía con `set(merge: true)` **sin
   * mirar el estado**, así que volver a llamarla sobre una reserva ya firmada
   * dejaba el documento en `generated` con un `pdfUrl` nuevo y los campos de la
   * firma —`signedAt`, la huella, el código de verificación— colgando de un
   * fichero que ya no era ese. La pantalla lo impedía (`canGenerateContract`
   * deniega si está firmado), pero eso es la interfaz, no la seguridad:
   * bastaba llamar al callable.
   *
   * Y no es un detalle interno: la verificación pública busca por
   * `verificationCode` en este mismo documento, así que el cliente que
   * escaneara el QR de **su copia en papel** se habría encontrado los datos de
   * otro contrato y una huella que no cuadra — la página le diría que su
   * contrato está alterado.
   */
  supersede?: boolean;
  /** Obligatorio con `supersede`: por qué se rehace. Se guarda en el archivo. */
  supersedeReason?: string;
}

interface GenerateResponse {
  contractId: string;
  pdfUrl: string;
  pdfPath: string;
  /** El id del contrato archivado, si esta llamada sustituyó a uno firmado. */
  supersededId?: string;
}

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return undefined;
}

function asString(value: any, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

// A `stripUndefined()` helper used to sit here and wrap every payload before
// `.set()`. It corrupted data: it rebuilt each object with `Object.entries()`,
// and a `FieldValue.serverTimestamp()` sentinel is an object with no own
// enumerable properties, so it was flattened to `{}`. Contracts were written
// with `createdAt` and `generatedAt` as empty maps instead of timestamps, and
// the contract list then crashed the Angular date pipe with "Invalid Date".
//
// It was redundant anyway: `ignoreUndefinedProperties` in admin-guard.ts
// already makes Firestore skip undefined fields, and unlike the helper it
// leaves sentinels, Timestamps and DocumentReferences untouched.
// Do not reintroduce a generic deep-clean on Firestore payloads.

export const generateContractPdf = functions.https.onCall(
  async (request): Promise<GenerateResponse> => {
    const data = request.data as GenerateRequest;
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión');
    }
    if (!data?.reservationId) {
      throw new functions.https.HttpsError('invalid-argument', 'reservationId es requerido');
    }

    const reservationId = data.reservationId;
    functions.logger.info(`generateContractPdf: reservation=${reservationId}`);

    const db = firestore();
    const storage = storageBucket();

    // 1. Load reservation
    const resSnap = await db.collection('reservations').doc(reservationId).get();
    if (!resSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Reserva no encontrada');
    }
    const reservation = resSnap.data() as any;

    // 1 bis. ⚠️ Un contrato FIRMADO no se pisa.
    //
    // Se comprueba aquí, antes de componer y subir nada: rechazar al final
    // dejaría el PDF nuevo huérfano en Storage con su token de descarga vivo.
    //
    // Ver la nota de `supersede` arriba para lo que esto evita. El motivo es
    // obligatorio por lo mismo que en una excepción de workflow: dentro de seis
    // meses, un contrato archivado sin explicación no le sirve a nadie.
    const contractRefEarly = db.collection('contracts').doc(reservationId);
    const previo = await contractRefEarly.get();
    const previoFirmado = previo.exists && (previo.data() as any)?.status === 'signed';
    if (previoFirmado && !data.supersede) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'contracts.errors.alreadySigned'
      );
    }
    if (previoFirmado && !String(data.supersedeReason || '').trim()) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'contracts.errors.supersedeReasonRequired'
      );
    }

    // 2. Load client snapshot (prefer reservation snapshot to avoid extra read)
    const clientSnapshot = {
      fullName: asString(reservation.clientSnapshot?.fullName, 'Cliente'),
      phone: reservation.clientSnapshot?.phone,
      email: reservation.clientSnapshot?.email,
      documentType: reservation.clientSnapshot?.documentType,
      documentNumber: reservation.clientSnapshot?.documentNumber,
      address: reservation.clientSnapshot?.address,
      drivingLicenseNumber: reservation.clientSnapshot?.drivingLicenseNumber
    };

    // Optional: enrich with current client doc values
    if (reservation.clientId) {
      try {
        const clientSnap = await db.collection('clients').doc(reservation.clientId).get();
        if (clientSnap.exists) {
          const c = clientSnap.data() as any;
          clientSnapshot.fullName = c.fullName || clientSnapshot.fullName;
          clientSnapshot.phone = c.phone || clientSnapshot.phone;
          clientSnapshot.email = c.email || clientSnapshot.email;
          clientSnapshot.documentType = c.documentType || clientSnapshot.documentType;
          clientSnapshot.documentNumber = c.documentNumber || clientSnapshot.documentNumber;
          clientSnapshot.address = c.address || clientSnapshot.address;
          clientSnapshot.drivingLicenseNumber = c.drivingLicenseNumber || clientSnapshot.drivingLicenseNumber;
        }
      } catch (err) {
        functions.logger.warn('Failed to enrich client snapshot, using reservation snapshot', err);
      }
    }

    // 3. Load vehicle snapshot
    const vehicleSnapshot: {
      brand: string;
      model: string;
      version?: string;
      plateNumber: string;
      acrissCode?: string;
      year?: number;
      fuelType?: string;
      transmission?: string;
      hasGpsTracker?: boolean;
      insurerName?: string;
      insurancePolicy?: string;
      roadsideAssistancePhone?: string;
    } = {
      brand: asString(reservation.vehicleSnapshot?.brand, ''),
      model: asString(reservation.vehicleSnapshot?.model, ''),
      version: reservation.vehicleSnapshot?.version,
      plateNumber: asString(reservation.vehicleSnapshot?.plateNumber, ''),
      acrissCode: reservation.vehicleSnapshot?.acrissCode,
      year: reservation.vehicleSnapshot?.year,
      fuelType: reservation.vehicleSnapshot?.fuelType,
      transmission: reservation.vehicleSnapshot?.transmission,
      hasGpsTracker: reservation.vehicleSnapshot?.hasGpsTracker
    };

    /**
     * El seguro se lee de la **ficha del coche**, no del snapshot de la reserva.
     *
     * Todo lo de arriba viene congelado porque describe lo que se alquiló: la
     * marca y la matrícula de ese día. El seguro no es eso — es la póliza que
     * cubre el vehículo, y se renueva. Lo que el contrato tiene que imprimir es
     * la vigente el día que se firma, no la que hubiera cuando se creó la
     * reserva: si el cliente llama al teléfono de asistencia en mitad del
     * alquiler, tiene que responder la compañía que le cubre hoy.
     *
     * Una reserva creada en enero y firmada en marzo, con renovación por medio,
     * sale con la póliza de marzo. Los contratos **ya firmados** no se mueven:
     * el PDF sellado es inmutable.
     *
     * Si el coche ya no existe —lo borraron—, no se imprime nada. Es el mismo
     * comportamiento que con los campos vacíos, y mejor que inventar un dato.
     */
    if (reservation.vehicleId) {
      try {
        const vehicleDoc = await db.collection('vehicles').doc(reservation.vehicleId).get();
        const v = vehicleDoc.data();
        if (v) {
          vehicleSnapshot.insurerName = v.insurerName;
          vehicleSnapshot.insurancePolicy = v.insurancePolicy;
          vehicleSnapshot.roadsideAssistancePhone = v.roadsideAssistancePhone;
        }
      } catch (err) {
        functions.logger.warn('Failed to load vehicle insurance details', err);
      }
    }

    // 4. Find pickup inspection (if any)
    let pickupInspection: any = null;
    try {
      const inspQ = await db.collection('inspections')
        .where('reservationId', '==', reservationId)
        .where('type', '==', 'pickup')
        .limit(1)
        .get();
      if (!inspQ.empty) {
        pickupInspection = inspQ.docs[0].data();
      }
    } catch (err) {
      functions.logger.warn('Failed to load pickup inspection', err);
    }

    // 5. Load payment summary (deposit)
    const paymentSummary = reservation.paymentSummary || {};
    const depositRequired = reservation.deposit?.requiredAmount || paymentSummary.depositRequired || 0;

    // 6. Determine contract number
    const contractNumber = `C-${reservationId.slice(0, 6).toUpperCase()}-${new Date().getFullYear()}`;

    // 6b. Contract language.
    //
    // The caller's language wins: the operator issues the document in whatever
    // language the platform is set to, which is the one they are speaking to
    // the customer in. Then anything frozen on the reservation, then the
    // configured default, and finally Spanish.
    const preferredLocale: ContractLocale = (() => {
      const candidates = [
        data.locale,
        (reservation as any).contractLocale as ContractLocale | undefined,
        process.env.VELTO_DEFAULT_CONTRACT_LOCALE as ContractLocale | undefined
      ];
      for (const candidate of candidates) {
        if (candidate && CONTRACT_CLAUSES.available.includes(candidate)) return candidate;
      }
      return 'es';
    })();

    const company = companyConfig();

    // 7. Build the PDF
    const pdfBytes = await buildContractPdf(
      {
        contractNumber,
        company,
        client: clientSnapshot,
        // Conductores autorizados además del arrendatario (cláusula 2). Se
        // copian de la reserva tal cual: son un snapshot, como el cliente.
        additionalDrivers: Array.isArray(reservation.additionalDrivers)
          ? reservation.additionalDrivers
          : undefined,
        vehicle: vehicleSnapshot,
        reservation: {
          pickupDateTime: toDate(reservation.pickupDateTime),
          returnDateTime: toDate(reservation.returnDateTime),
          totalDays: reservation.totalDays,
          pickupLocation: reservation.pickupLocation,
          returnLocation: reservation.returnLocation,
          finalPrice: reservation.pricingSnapshot?.finalPrice,
          depositAmount: depositRequired,
          tariffPrice: reservation.pricingSnapshot?.basePrice,
          loyaltyDiscountPercent: reservation.pricingSnapshot?.loyaltyDiscountPercent,
          loyaltyDiscount: reservation.pricingSnapshot?.loyaltyDiscount,
          manualAdjustment: reservation.pricingSnapshot?.manualAdjustment,
          netPrice: reservation.pricingSnapshot?.netPrice,
          vatRate: reservation.pricingSnapshot?.vatRate,
          // Fuera de `pricingSnapshot` en la reserva, y por eso se leen aparte.
          deliveryPickupFee: reservation.deliveryFees?.pickupFee,
          deliveryReturnFee: reservation.deliveryFees?.returnFee,
          // Lo que se pactó, no lo que hoy diga la ficha del coche.
          includedKmPerDay: reservation.pricingSnapshot?.includedKmPerDay,
          extraKmPrice: reservation.pricingSnapshot?.extraKmPrice
        },
        inspection: pickupInspection
          ? {
              pickupKm: pickupInspection.km,
              pickupFuelLevel: pickupInspection.fuelLevel
            }
          : undefined,
        clauses: CONTRACT_CLAUSES,
        preferredLocale,
        generatedAt: new Date()
      },
      false
    );

    // 8. Upload to Storage
    const pdfPath = `contracts/${reservationId}/contract-original.pdf`;
    const file = storage.bucket().file(pdfPath);
    const downloadToken = require('crypto').randomUUID();
    await file.save(Buffer.from(pdfBytes), {
      contentType: 'application/pdf',
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken
        }
      },
      resumable: false
    });
    const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${storage.bucket().name}/o/${encodeURIComponent(pdfPath)}?alt=media&token=${downloadToken}`;

    // 9. Upsert the contract document
    const now = admin.firestore.FieldValue.serverTimestamp();
    const contractRef = db.collection('contracts').doc(reservationId);
    const existing = await contractRef.get();
    const baseUpdate: any = {
      reservationId,
      clientId: reservation.clientId,
      vehicleId: reservation.vehicleId,
      status: 'generated',
      contractNumber,
      locale: preferredLocale,
      reservationSnapshot: {
        pickupDateTime: reservation.pickupDateTime,
        returnDateTime: reservation.returnDateTime,
        totalDays: reservation.totalDays,
        pickupLocation: reservation.pickupLocation,
        returnLocation: reservation.returnLocation,
        finalPrice: reservation.pricingSnapshot?.finalPrice,
        depositAmount: depositRequired,
        // Frozen alongside the price so re-rendering the PDF at signing time
        // reproduces exactly the same breakdown, even if the client's discount
        // or the VAT rate has moved in the meantime.
        tariffPrice: reservation.pricingSnapshot?.basePrice,
        loyaltyDiscountPercent: reservation.pricingSnapshot?.loyaltyDiscountPercent,
        loyaltyDiscount: reservation.pricingSnapshot?.loyaltyDiscount,
        manualAdjustment: reservation.pricingSnapshot?.manualAdjustment,
        netPrice: reservation.pricingSnapshot?.netPrice,
        vatRate: reservation.pricingSnapshot?.vatRate,
        // Se congelan en el contrato como el resto del dinero: el documento
        // firmado tiene que seguir diciendo qué se pactó por el desplazamiento.
        deliveryPickupFee: reservation.deliveryFees?.pickupFee,
        deliveryReturnFee: reservation.deliveryFees?.returnFee
      },
      clientSnapshot,
      // Se congelan en el contrato igual que el arrendatario: el documento
      // tiene que seguir diciendo quién estaba autorizado el día que se firmó,
      // aunque después se toque la reserva.
      additionalDrivers: Array.isArray(reservation.additionalDrivers)
        ? reservation.additionalDrivers
        : [],
      vehicleSnapshot,
      companySnapshot: company,
      // Persist a copy of the clauses bundle so the contract is reproducible
      // even if clauses.ts is edited later.
      clauses: CONTRACT_CLAUSES,
      inspectionSnapshot: pickupInspection
        ? {
            pickupKm: pickupInspection.km,
            pickupFuelLevel: pickupInspection.fuelLevel
          }
        : null,
      paymentSnapshot: {
        rentalTotal: reservation.pricingSnapshot?.finalPrice,
        depositRequired,
        depositPaid: reservation.deposit?.paidAmount,
        totalPaid: paymentSummary.totalPaid
      },
      pdfUrl,
      pdfPath,
      generatedAt: now,
      updatedAt: now,
      updatedBy: request.auth!.uid || null
    };
    if (!existing.exists) {
      baseUpdate.createdAt = now;
      baseUpdate.createdBy = request.auth!.uid || null;
    }

    // 9 bis. Sustitución: el firmado se ARCHIVA, no se pierde.
    //
    // Se copia entero a un documento propio —con su PDF firmado, su huella y su
    // código de verificación— y se marca `superseded`. Así el cliente que tenga
    // la copia en papel la sigue pudiendo comprobar en `/v/:codigo`, y queda
    // escrito qué se acordó antes y por qué se rehízo.
    //
    // ⚠️ **El id lleva un sufijo `-v{n}` y se comprueba que está libre.** Con un
    // id fijo, sustituir dos veces machacaría el primer archivo — que es
    // exactamente el fallo que este bloque existe para no cometer.
    let supersededId: string | undefined;
    if (previoFirmado) {
      const anterior = previo.data() as any;
      let n = 1;
      // No hay carrera que valga aquí: sustituir un contrato es una acción de
      // mostrador, no concurrente. Lo que se evita es el despiste de dos
      // sustituciones seguidas.
      while ((await db.collection('contracts').doc(`${reservationId}-v${n}`).get()).exists) {
        n += 1;
      }
      supersededId = `${reservationId}-v${n}`;
      await db.collection('contracts').doc(supersededId).set({
        ...anterior,
        status: 'superseded',
        supersededAt: now,
        supersededBy: request.auth!.uid || null,
        supersededReason: String(data.supersedeReason || '').trim(),
        supersededById: reservationId
      });
      baseUpdate.supersedesId = supersededId;

      // ⚠️ **Lo de la firma anterior hay que BORRARLO a mano.** `merge: true`
      // conserva todo lo que no se nombre, así que sin esto el contrato nuevo
      // —sin firmar— nacería con el `signedAt`, la huella y el código de
      // verificación del anterior pegados encima: la verificación pública
      // encontraría dos contratos con el mismo código y la ficha diría que hay
      // una firma donde no la hay.
      const borrar = admin.firestore.FieldValue.delete();
      for (const campo of [
        'signedAt',
        'signedPdfUrl',
        'signedPdfPath',
        'signedPdfSha256',
        'signatureUrl',
        'signaturePath',
        'verificationCode',
        'digitallySealed',
        'signingTokenId',
        'signingLinkPath',
        'emailedAt'
      ]) {
        baseUpdate[campo] = borrar;
      }
    }

    await contractRef.set(baseUpdate, { merge: true });

    // 10. Update reservation contractStatus and contractInfo
    await db.collection('reservations').doc(reservationId).set(
      {
        contractStatus: 'generated',
        contractInfo: {
          contractId: reservationId,
          contractNumber,
          pdfUrl
        },
        updatedAt: now
      },
      { merge: true }
    );

    return {
      contractId: reservationId,
      pdfUrl,
      pdfPath,
      supersededId
    };
  }
);
