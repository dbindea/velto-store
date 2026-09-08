/**
 * generateInspectionReport — el parte de entrega o de devolución, en PDF.
 *
 * Callable con autenticación. Lo pide el operador desde la ficha de la reserva
 * cuando el cliente quiere su copia, que es la única vía que Dorel quiso: **no
 * se manda solo**.
 *
 * ⚠️ **El contrato remite a este documento cuatro veces.** Hasta hoy no existía
 * —la inspección se guardaba en Firestore y no había nada que enseñar—, así que
 * las cláusulas 1, 2, 5 y 6 hablaban de un parte que nadie podía ver. Se quitó
 * de ellas la exigencia de firma, pero **no la remisión**: el kilometraje y el
 * combustible de salida no caben en el contrato porque se firma antes de la
 * entrega.
 *
 * ⚠️ **No escribe NADA en Firestore.** Como el presupuesto, la proforma y el
 * recibo: es un documento informativo, no un paso del flujo. Lo único que queda
 * es el PDF, que es lo que el enlace necesita.
 */

import * as functions from 'firebase-functions';
import { firestore, storageBucket } from '../admin-guard';
import { companyConfig } from '../company-config';
import { uploadPdf } from './storage';
import { documentLinkUrl, shortIdFor } from './documentLink';
import { reservationLocator } from './locator';
import { buildInspectionPdf, InspectionKind, InspectionPdfPhoto } from './inspection-pdf';
import type { ContractLocale } from '../contracts/contract-types';

interface ReportRequest {
  inspectionId: string;
  locale?: string;
}

interface ReportResponse {
  pdfUrl: string;
  shortUrl: string;
}

const LOCALES: ContractLocale[] = ['es', 'en', 'ro'];

function resolveLocale(value?: string): ContractLocale {
  return LOCALES.includes(value as ContractLocale) ? (value as ContractLocale) : 'es';
}

/**
 * ⚠️ Tope de fotos incrustadas.
 *
 * La inspección recomienda ocho; nadie hace veinticinco. El límite existe para
 * que una carpeta con cien fotos no reviente la memoria de la function ni
 * produzca un PDF que no se pueda abrir en un móvil, no porque se espere
 * llegar a él.
 */
const MAX_PHOTOS = 24;

/**
 * Los códigos, traducidos.
 *
 * ⚠️ Llegan **crudos de Firestore** (`three_quarters`, `very_dirty`) y no son
 * texto libre. Duplicados aquí a propósito: los JSON de i18n viven en
 * `src/assets/` de la aplicación, y app y functions no comparten módulo. Si se
 * añade un nivel, se añade en los dos sitios.
 */
const FUEL: Record<string, Record<ContractLocale, string>> = {
  empty: { es: 'Vacío', en: 'Empty', ro: 'Gol' },
  quarter: { es: '1/4', en: '1/4', ro: '1/4' },
  half: { es: '1/2', en: '1/2', ro: '1/2' },
  three_quarters: { es: '3/4', en: '3/4', ro: '3/4' },
  full: { es: 'Lleno', en: 'Full', ro: 'Plin' }
};

const CLEANLINESS: Record<string, Record<ContractLocale, string>> = {
  clean: { es: 'Limpio', en: 'Clean', ro: 'Curat' },
  normal: { es: 'Normal', en: 'Normal', ro: 'Normal' },
  dirty: { es: 'Sucio', en: 'Dirty', ro: 'Murdar' },
  very_dirty: { es: 'Muy sucio', en: 'Very dirty', ro: 'Foarte murdar' }
};

/** Las comprobaciones del checklist. Son la dotación de la cláusula 1. */
const CHECKLIST: Record<string, Record<ContractLocale, string>> = {
  clientIdentityChecked: {
    es: 'Identidad del cliente verificada',
    en: 'Customer identity verified',
    ro: 'Identitatea clientului verificată'
  },
  drivingLicenseChecked: {
    es: 'Carnet de conducir verificado',
    en: 'Driving licence verified',
    ro: 'Permis de conducere verificat'
  },
  contractChecked: {
    es: 'Contrato firmado y revisado',
    en: 'Contract signed and checked',
    ro: 'Contract semnat și verificat'
  },
  paymentChecked: { es: 'Pago realizado', en: 'Payment made', ro: 'Plată efectuată' },
  depositChecked: { es: 'Fianza depositada', en: 'Deposit taken', ro: 'Garanție depusă' },
  keysDelivered: { es: 'Llaves entregadas', en: 'Keys handed over', ro: 'Chei predate' },
  keysReturned: { es: 'Llaves devueltas', en: 'Keys returned', ro: 'Chei returnate' },
  vehicleDocumentsDelivered: {
    es: 'Documentación entregada',
    en: 'Vehicle documents handed over',
    ro: 'Documente predate'
  },
  accessoriesChecked: {
    es: 'Accesorios revisados',
    en: 'Accessories checked',
    ro: 'Accesorii verificate'
  }
};

const DAMAGE_AREA: Record<string, Record<ContractLocale, string>> = {
  front: { es: 'Frontal', en: 'Front', ro: 'Față' },
  rear: { es: 'Trasera', en: 'Rear', ro: 'Spate' },
  left_side: { es: 'Lateral izquierdo', en: 'Left side', ro: 'Lateral stânga' },
  right_side: { es: 'Lateral derecho', en: 'Right side', ro: 'Lateral dreapta' },
  roof: { es: 'Techo', en: 'Roof', ro: 'Plafon' },
  interior: { es: 'Interior', en: 'Interior', ro: 'Interior' },
  wheels: { es: 'Ruedas', en: 'Wheels', ro: 'Roți' },
  windows: { es: 'Lunas', en: 'Windows', ro: 'Geamuri' },
  other: { es: 'Otros', en: 'Other', ro: 'Altele' }
};

const SEVERITY: Record<string, Record<ContractLocale, string>> = {
  minor: { es: 'Leve', en: 'Minor', ro: 'Ușoară' },
  medium: { es: 'Media', en: 'Medium', ro: 'Medie' },
  serious: { es: 'Grave', en: 'Serious', ro: 'Gravă' }
};

const PHOTO_CATEGORY: Record<string, Record<ContractLocale, string>> = {
  front: { es: 'Frontal', en: 'Front', ro: 'Față' },
  rear: { es: 'Trasera', en: 'Rear', ro: 'Spate' },
  left_side: { es: 'Lateral izquierdo', en: 'Left side', ro: 'Lateral stânga' },
  right_side: { es: 'Lateral derecho', en: 'Right side', ro: 'Lateral dreapta' },
  interior: { es: 'Interior', en: 'Interior', ro: 'Interior' },
  dashboard: { es: 'Cuadro de mandos', en: 'Dashboard', ro: 'Bord' },
  fuel: { es: 'Combustible', en: 'Fuel', ro: 'Combustibil' },
  damage: { es: 'Daño', en: 'Damage', ro: 'Daună' },
  other: { es: 'Otras', en: 'Other', ro: 'Altele' }
};

const CHARGE_LABEL: Record<string, Record<ContractLocale, string>> = {
  extraKmCharge: { es: 'Kilómetros extra', en: 'Extra mileage', ro: 'Kilometri suplimentari' },
  fuelCharge: { es: 'Combustible', en: 'Fuel', ro: 'Combustibil' },
  refuelPenalty: {
    es: 'Penalización por no repostar',
    en: 'Refuelling penalty',
    ro: 'Penalizare pentru nealimentare'
  },
  cleaningCharge: { es: 'Limpieza', en: 'Cleaning', ro: 'Curățenie' },
  damageCharge: { es: 'Daños', en: 'Damage', ro: 'Daune' },
  fineCharge: { es: 'Multas', en: 'Fines', ro: 'Amenzi' },
  otherCharge: { es: 'Otros cargos', en: 'Other charges', ro: 'Alte costuri' }
};

function pick(
  table: Record<string, Record<ContractLocale, string>>,
  key: unknown,
  loc: ContractLocale
): string | undefined {
  const entry = typeof key === 'string' ? table[key] : undefined;
  return entry ? entry[loc] : undefined;
}

/** Las tres formas en que una fecha llega de Firestore. La tercera ya costó una factura. */
function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const any = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof any.toDate === 'function') return any.toDate();
  const seconds = any.seconds ?? any._seconds;
  if (typeof seconds === 'number') return new Date(seconds * 1000);
  const parsed = new Date(value as string);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export const generateInspectionReport = functions.https.onCall(
  async (request): Promise<ReportResponse> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }

    const data = request.data as ReportRequest;
    const inspectionId = (data?.inspectionId || '').trim();
    if (!inspectionId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'inspections.report.problems.inspectionRequired'
      );
    }

    const db = firestore();
    const snap = await db.collection('inspections').doc(inspectionId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'inspections.report.problems.notFound'
      );
    }
    const inspection: Record<string, any> = { ...(snap.data() as Record<string, any>) };

    const locale = resolveLocale(data?.locale);
    const company = companyConfig();
    const kind: InspectionKind = inspection['type'] === 'return' ? 'return' : 'pickup';

    /**
     * La reserva: el número de contrato y **el respaldo de los snapshots**.
     *
     * ⚠️ No toda inspección guardó `clientSnapshot` y `vehicleSnapshot`. Con
     * una de ellas vacía el parte salía con «Arrendatario: —» y el vehículo en
     * blanco: un documento que dice acreditar el estado de un coche entregado a
     * una persona, sin decir de qué coche ni de qué persona. La reserva sí los
     * tiene, y ya se lee aquí para el número de contrato.
     */
    let contractNumber: string | undefined;
    let reserva: Record<string, any> | undefined;
    const reservationId: string = inspection['reservationId'] || '';
    if (reservationId) {
      try {
        const snapReserva = await db.collection('reservations').doc(reservationId).get();
        reserva = (snapReserva.data() as Record<string, any>) || undefined;
        contractNumber = reserva?.['contractInfo']?.['contractNumber'];
      } catch (err) {
        // Sin la reserva el parte sigue valiendo: lleva el localizador.
        functions.logger.warn('generateInspectionReport: reserva no legible', { err });
      }
    }

    const vehicle = inspection['vehicleSnapshot'] || reserva?.['vehicleSnapshot'] || {};
    const vehicleLabel = [
      [vehicle.brand, vehicle.model].filter(Boolean).join(' '),
      vehicle.plateNumber
    ]
      .filter(Boolean)
      .join(' · ');

    /**
     * El checklist, partido en dos: lo comprobado y lo que no. Un parte que
     * solo enseñe lo que salió bien no sirve para discutir lo que salió mal.
     *
     * ⚠️ **Y filtrado por fase.** `InspectionChecklist` es un único objeto para
     * las dos inspecciones, así que sin filtrar, un parte de DEVOLUCIÓN sacaba
     * «Sin marcar: identidad del cliente verificada, fianza depositada,
     * contrato firmado…» — comprobaciones de la entrega que en la devolución no
     * se hacen porque ya se hicieron. El documento venía a decir que no se
     * había identificado al cliente. Solo se ve leyendo el PDF.
     */
    const checklist = (inspection['checklist'] || {}) as Record<string, boolean>;
    const DE_LA_FASE: Record<InspectionKind, string[]> = {
      pickup: [
        'clientIdentityChecked',
        'drivingLicenseChecked',
        'contractChecked',
        'paymentChecked',
        'depositChecked',
        'keysDelivered',
        'vehicleDocumentsDelivered',
        'accessoriesChecked'
      ],
      return: ['keysReturned', 'accessoriesChecked']
    };
    const checkedItems: string[] = [];
    const uncheckedItems: string[] = [];
    for (const key of DE_LA_FASE[kind]) {
      const label = pick(CHECKLIST, key, locale);
      if (!label) continue;
      (checklist[key] ? checkedItems : uncheckedItems).push(label);
    }

    const damages = ((inspection['damages'] || []) as Record<string, any>[]).map((d) => ({
      area: pick(DAMAGE_AREA, d['area'], locale) || d['area'],
      description: d['description'],
      severity: pick(SEVERITY, d['severity'], locale),
      isNewDamage: !!d['isNewDamage']
    }));

    /**
     * Las fotos, desde Storage.
     *
     * Se usa la **miniatura** cuando existe: son 400 px, que a tres columnas en
     * un A4 se ven perfectamente, y evita traerse ocho fotos de móvil a la
     * memoria de la function para reducirlas después.
     */
    const bucket = storageBucket().bucket();
    const fotos = ((inspection['photos'] || []) as Record<string, any>[]).slice(0, MAX_PHOTOS);
    const photos: InspectionPdfPhoto[] = [];
    for (const foto of fotos) {
      const path: string | undefined = foto['thumbnailPath'] || foto['path'];
      if (!path) continue;
      try {
        const [bytes] = await bucket.file(path).download();
        photos.push({
          bytes: new Uint8Array(bytes),
          contentType: foto['contentType'],
          label: pick(PHOTO_CATEGORY, foto['category'], locale) || foto['label']
        });
      } catch (err) {
        // Una foto que no se puede bajar no impide emitir el parte.
        functions.logger.warn('generateInspectionReport: foto no descargada', { path, err });
      }
    }

    // Los cargos, solo en la devolución y solo los que tienen importe.
    const extra = (inspection['extraCharges'] || {}) as Record<string, number>;
    const charges = Object.entries(CHARGE_LABEL)
      .map(([key, table]) => ({ label: table[locale], amount: Number(extra[key]) || 0 }))
      .filter((c) => c.amount > 0);

    const pdf = await buildInspectionPdf({
      locale,
      kind,
      company: {
        brandName: company.brandName,
        legalName: company.legalName,
        taxId: company.taxId,
        address: company.address,
        officeAddress: company.officeAddress,
        phone: company.phone,
        email: company.email,
        registry: company.registry
      },
      locator: reservationLocator(reservationId),
      contractNumber,
      clientName:
        inspection['clientSnapshot']?.fullName || reserva?.['clientSnapshot']?.fullName || '',
      clientDocument:
        inspection['clientSnapshot']?.documentNumber ||
        reserva?.['clientSnapshot']?.documentNumber,
      vehicleLabel,
      inspectedAt:
        toDate(inspection['completedAt']) || toDate(inspection['createdAt']) || new Date(),
      issuedAt: new Date(),
      km: typeof inspection['km'] === 'number' ? inspection['km'] : undefined,
      fuelLabel: pick(FUEL, inspection['fuelLevel'], locale),
      cleanlinessLabel: pick(CLEANLINESS, inspection['cleanliness'], locale),
      checkedItems,
      uncheckedItems,
      damages,
      photos,
      charges,
      chargesTotal: Number(extra['totalExtraCharges']) || 0,
      notes: inspection['notes']
    });

    /**
     * El enlace es **estable**, como el del justificante de reserva: regenerar
     * el parte —porque se añadió una foto— no puede matar el enlace que el
     * cliente ya tiene. El id de la inspección no es secreto de ninguna otra
     * ruta, así que aquí sí se puede usar; el del recibo no podía.
     */
    const shortId = shortIdFor('inspection', inspectionId);
    const subido = await uploadPdf(`inspections/${inspectionId}/report.pdf`, pdf);

    functions.logger.info('Inspection report generated', {
      inspectionId,
      kind,
      photos: photos.length
    });

    return { pdfUrl: subido.pdfUrl, shortUrl: documentLinkUrl(shortId) };
  }
);
