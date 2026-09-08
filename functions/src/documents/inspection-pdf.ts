/**
 * El parte de entrega y el parte de devolución.
 *
 * ⚠️ **El contrato remite a estos dos documentos cuatro veces**, y hasta hoy no
 * existían: la inspección se guardaba en Firestore y no había nada que enseñar
 * ni que entregar. Las cláusulas 1, 2, 5 y 6 hablaban de «el parte de entrega,
 * que ambas partes firman», así que el contrato prometía un papel firmado que
 * nadie había firmado nunca.
 *
 * El 8 de septiembre de 2026, decisión de Dorel: **se quita la firma, no el
 * documento**. Hacer firmar dos veces al cliente —y a cada conductor de una
 * cuadrilla— es molesto en la calle, y el negocio es de clientes conocidos. Las
 * cláusulas se reescribieron para no exigir firma, pero siguen remitiendo al
 * parte porque el kilometraje y el combustible de salida **no pueden estar en
 * el contrato**: se firma antes de la entrega.
 *
 * De ahí sale la regla que gobierna este PDF:
 *
 * ⚠️ **Las fotografías son la prueba.** Sin firma, lo que sostiene un cargo por
 * combustible, kilómetros o dotación faltante es el estado del coche
 * fotografiado con su fecha. Un parte sin fotos es un papel que dice lo que
 * decimos nosotros; con ellas, es lo que el contrato promete que se conserva y
 * se pone a disposición del cliente.
 */

import { PDFDocument, PDFImage } from 'pdf-lib';
import {
  PdfBuilder,
  companyFooterLines,
  companyHeaderLines,
  formatDate,
  formatMoney,
  formatNumber
} from '../contracts/pdf';
import type { ContractLocale } from '../contracts/contract-types';

export type InspectionKind = 'pickup' | 'return';

export interface InspectionPdfCompany {
  brandName: string;
  legalName: string;
  taxId: string;
  address: string;
  officeAddress?: string;
  phone?: string;
  email: string;
  registry?: string;
}

export interface InspectionPdfPhoto {
  /** Bytes ya descargados; quien llama decide si usa la miniatura o el original. */
  bytes: Uint8Array;
  contentType?: string;
  label?: string;
}

export interface InspectionPdfDamage {
  area?: string;
  description?: string;
  severity?: string;
  isNewDamage?: boolean;
}

export interface InspectionPdfInput {
  locale: ContractLocale;
  kind: InspectionKind;
  company: InspectionPdfCompany;
  /** `R-P2RJP0`, el mismo que imprimen el justificante y el recibo. */
  locator: string;
  contractNumber?: string;
  clientName: string;
  clientDocument?: string;
  vehicleLabel: string;
  /** Cuándo se hizo la inspección, no cuándo se imprime el papel. */
  inspectedAt: Date;
  issuedAt: Date;
  km?: number;
  /** Ya traducido: `fuelLevel` y `cleanliness` llegan crudos de Firestore. */
  fuelLabel?: string;
  cleanlinessLabel?: string;
  /** Comprobaciones marcadas, ya traducidas. Es la dotación del art. 1. */
  checkedItems?: string[];
  uncheckedItems?: string[];
  damages?: InspectionPdfDamage[];
  photos?: InspectionPdfPhoto[];
  /** Solo en el parte de devolución, y solo si hay algo. */
  charges?: { label: string; amount: number }[];
  chargesTotal?: number;
  notes?: string;
  onLayout?: (b: PdfBuilder) => void;
}

function labels(loc: ContractLocale) {
  const en = loc === 'en';
  const ro = loc === 'ro';
  return {
    pickupTitle: en ? 'PICK-UP REPORT' : ro ? 'PROCES-VERBAL DE PREDARE' : 'PARTE DE ENTREGA',
    returnTitle: en ? 'RETURN REPORT' : ro ? 'PROCES-VERBAL DE RETURNARE' : 'PARTE DE DEVOLUCIÓN',
    /**
     * ⚠️ Dice **qué es** el documento, y por eso va arriba: un parte suelto,
     * sin decir de qué contrato cuelga, no acredita nada.
     */
    pickupIntro: en
      ? 'Annex to the rental contract. It records the condition of the vehicle and the equipment handed over at the start of the rental.'
      : ro
        ? 'Anexă la contractul de închiriere. Consemnează starea vehiculului și dotarea predată la începutul închirierii.'
        : 'Anexo al contrato de alquiler. Recoge el estado del vehículo y la dotación entregada al inicio del alquiler.',
    returnIntro: en
      ? 'Annex to the rental contract. It records the condition of the vehicle at the end of the rental, compared against the pick-up report.'
      : ro
        ? 'Anexă la contractul de închiriere. Consemnează starea vehiculului la finalul închirierii, comparată cu procesul-verbal de predare.'
        : 'Anexo al contrato de alquiler. Recoge el estado del vehículo al final del alquiler, comparado con el parte de entrega.',
    data: en ? 'Details' : ro ? 'Date' : 'Datos',
    renter: en ? 'Renter' : ro ? 'Locatar' : 'Arrendatario',
    date: en ? 'Date' : ro ? 'Data' : 'Fecha',
    contract: en ? 'Contract' : ro ? 'Contract' : 'Contrato',
    booking: en ? 'Booking' : ro ? 'Rezervare' : 'Reserva',
    vehicle: en ? 'Vehicle' : ro ? 'Vehicul' : 'Vehículo',
    condition: en ? 'Vehicle condition' : ro ? 'Starea vehiculului' : 'Estado del vehículo',
    km: en ? 'Odometer' : ro ? 'Kilometraj' : 'Kilómetros',
    fuel: en ? 'Fuel level' : ro ? 'Nivel combustibil' : 'Nivel de combustible',
    cleanliness: en ? 'Cleanliness' : ro ? 'Curățenie' : 'Limpieza',
    equipment: en ? 'Equipment and checks' : ro ? 'Dotare și verificări' : 'Dotación y comprobaciones',
    notChecked: en ? 'Not checked' : ro ? 'Nebifate' : 'Sin marcar',
    damages: en ? 'Damage recorded' : ro ? 'Daune consemnate' : 'Daños registrados',
    newDamage: en ? 'new' : ro ? 'nouă' : 'nuevo',
    photos: en ? 'Photographs' : ro ? 'Fotografii' : 'Fotografías',
    charges: en ? 'Charges' : ro ? 'Costuri' : 'Cargos',
    total: en ? 'Total charges' : ro ? 'Total costuri' : 'Total cargos',
    notes: en ? 'Notes' : ro ? 'Observații' : 'Observaciones',
    noPhotos: en
      ? 'No photographs were taken during this inspection.'
      : ro
        ? 'Nu s-au făcut fotografii la această inspecție.'
        : 'No se tomaron fotografías en esta inspección.'
  };
}

/**
 * Incrusta las fotos, saltándose las que no se puedan leer.
 *
 * ⚠️ **Una foto rota no se lleva por delante el parte.** Si una imagen falla
 * —formato raro, descarga a medias—, el documento sale con las demás: quedarse
 * sin parte por una foto sería perder también las que sí valían.
 */
async function embedPhotos(
  doc: PDFDocument,
  photos: InspectionPdfPhoto[]
): Promise<{ img: PDFImage; width: number; height: number; label?: string }[]> {
  const out: { img: PDFImage; width: number; height: number; label?: string }[] = [];
  for (const photo of photos) {
    try {
      const esPng =
        photo.contentType === 'image/png' ||
        // Firma PNG: los ocho primeros bytes. El `contentType` de Storage no
        // siempre llega, y pdf-lib no adivina.
        (photo.bytes[0] === 0x89 && photo.bytes[1] === 0x50);
      const img = esPng ? await doc.embedPng(photo.bytes) : await doc.embedJpg(photo.bytes);
      out.push({ img, width: img.width, height: img.height, label: photo.label });
    } catch {
      // Se ignora esta foto y sigue el resto.
    }
  }
  return out;
}

export async function buildInspectionPdf(input: InspectionPdfInput): Promise<Uint8Array> {
  const loc = input.locale;
  const L = labels(loc);
  const company = input.company;
  const esEntrega = input.kind === 'pickup';
  const titulo = esEntrega ? L.pickupTitle : L.returnTitle;

  const doc = await PDFDocument.create();
  doc.setTitle(`${company.brandName} — ${titulo} ${input.locator}`);
  doc.setAuthor(company.brandName);
  doc.setSubject(`${titulo} ${input.locator}`);
  doc.setCreator(company.brandName);
  doc.setProducer(`${company.brandName} · pdf-lib`);

  const b = new PdfBuilder(doc);
  await b.init(titulo, input.locator, companyFooterLines(company));

  b.documentHeader({
    companyName: company.brandName,
    companyLines: companyHeaderLines(company),
    title: titulo,
    reference: input.locator
  });

  b.text(esEntrega ? L.pickupIntro : L.returnIntro, { size: 8.4, gap: 4 });
  b.separator();

  const izquierda: { label?: string; value: string; wrap?: boolean }[] = [
    { label: L.date, value: formatDate(input.inspectedAt, loc) },
    { label: L.booking, value: input.locator }
  ];
  if (input.contractNumber) izquierda.push({ label: L.contract, value: input.contractNumber });
  izquierda.push({ label: L.vehicle, value: input.vehicleLabel });

  const derecha: { label?: string; value: string; wrap?: boolean }[] = [
    { label: L.renter, value: input.clientName || '—', wrap: true }
  ];
  if (input.clientDocument) derecha.push({ value: input.clientDocument });

  b.section(L.data, { lead: 6 });
  b.y += 4;
  b.infoColumns(izquierda, derecha, { size: 8.2 });

  // Estado del vehículo: las tres cifras de las que cuelgan los cargos.
  b.y -= 6;
  b.section(L.condition, { lead: 6 });
  if (input.km !== undefined && input.km !== null) {
    b.twoColumnWrap(`${L.km}:`, `${formatNumber(input.km, loc)} km`, true);
  }
  if (input.fuelLabel) b.twoColumnWrap(`${L.fuel}:`, input.fuelLabel, true);
  if (input.cleanlinessLabel) b.twoColumnWrap(`${L.cleanliness}:`, input.cleanlinessLabel, true);

  /**
   * La dotación.
   *
   * La cláusula 1 enumera lo que se entrega —rueda de repuesto, triángulos o
   * V16, chaleco, documentación, llaves— y dice que el detalle consta aquí. Lo
   * que NO se marcó se imprime aparte y a propósito: un parte que solo enseña
   * lo que salió bien no sirve para discutir lo que salió mal.
   */
  if (input.checkedItems?.length || input.uncheckedItems?.length) {
    b.y -= 6;
    b.section(L.equipment, { lead: 6 });
    for (const item of input.checkedItems || []) {
      b.text(`·  ${item}`, { size: 8.4, gap: 1 });
    }
    if (input.uncheckedItems?.length) {
      b.y -= 4;
      b.text(`${L.notChecked}:`, { size: 8.2, bold: true, gap: 1 });
      for (const item of input.uncheckedItems) {
        b.text(`·  ${item}`, { size: 8.4, color: [0.45, 0.45, 0.45], gap: 1 });
      }
    }
  }

  if (input.damages?.length) {
    b.y -= 6;
    b.section(L.damages, { lead: 6 });
    for (const d of input.damages) {
      const cabeza = [d.area, d.severity].filter(Boolean).join(' · ');
      const marca = d.isNewDamage ? ` (${L.newDamage})` : '';
      b.text(`·  ${cabeza}${marca}${d.description ? `: ${d.description}` : ''}`, {
        size: 8.4,
        gap: 1
      });
    }
  }

  // Los cargos solo tienen sentido en la devolución: en la entrega no hay nada
  // que cobrar todavía.
  if (!esEntrega && input.charges?.length) {
    b.y -= 6;
    b.section(L.charges, { lead: 6 });
    const filas = input.charges.map((c) => ({
      label: c.label,
      value: formatMoney(c.amount, loc)
    }));
    filas.push({
      label: L.total,
      value: formatMoney(input.chargesTotal ?? 0, loc),
      ...{ total: true }
    });
    b.totalsBlock(filas as { label: string; value: string; total?: boolean }[]);
  }

  if (input.notes) {
    b.y -= 6;
    b.section(L.notes, { lead: 6 });
    b.text(input.notes, { size: 8.4, gap: 2 });
  }

  // Las fotos, al final y a página completa: son lo que ocupa sitio, y arriba
  // empujarían fuera de la primera página lo que hay que leer primero.
  b.y -= 6;
  b.section(L.photos, { lead: 6 });
  const imagenes = await embedPhotos(doc, input.photos || []);
  if (imagenes.length) {
    b.photoGrid(imagenes, { columns: 3 });
  } else {
    b.text(L.noPhotos, { size: 8.2, color: [0.45, 0.45, 0.45], gap: 2 });
  }

  b.finalizeFooters();
  input.onLayout?.(b);
  return await doc.save();
}
