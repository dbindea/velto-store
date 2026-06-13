/**
 * PDF generation for the rental contract.
 *
 * Uses pdf-lib (pure JS, no native deps) to produce a simple A4 contract
 * with the data captured in the Contract snapshots. The visual style is
 * intentionally clean and minimal - this is a basic rental agreement,
 * not a long legal document.
 *
 * If the signed variant is requested, the signature PNG is embedded at
 * the bottom of the document along with the signing timestamp.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import * as functions from 'firebase-functions';

export interface ContractPdfInput {
  contractNumber?: string;
  companyName: string;
  companyEmail: string;
  companyPhone?: string;
  companyAddress?: string;
  client: {
    fullName: string;
    documentType?: string;
    documentNumber?: string;
    phone?: string;
    email?: string;
    address?: string;
    drivingLicenseNumber?: string;
  };
  vehicle: {
    brand: string;
    model: string;
    version?: string;
    plateNumber: string;
    year?: number;
  };
  reservation: {
    pickupDateTime?: Date;
    returnDateTime?: Date;
    totalDays?: number;
    pickupLocation?: string;
    returnLocation?: string;
    finalPrice?: number;
    depositAmount?: number;
  };
  inspection?: {
    pickupKm?: number;
    pickupFuelLevel?: string;
    returnKm?: number;
    returnFuelLevel?: string;
  };
  payment?: {
    rentalTotal?: number;
    depositRequired?: number;
    depositPaid?: number;
    totalPaid?: number;
  };
  generatedAt?: Date;
  signaturePng?: Uint8Array | null;
  signedAt?: Date;
  signerName?: string;
}

const CONDITIONS_TEXT = [
  '1. El arrendatario se compromete a utilizar el vehículo de forma responsable y conforme a la legislación vigente.',
  '2. El conductor principal será el responsable de las multas, sanciones y peajes derivados del uso del vehículo durante el periodo de alquiler.',
  '3. Política de combustible: el vehículo se entrega y se devuelve con el mismo nivel de combustible. En caso contrario, se cobrará el repostaje más una penalización.',
  '4. Limpieza: si el vehículo se devuelve en condiciones de limpieza especiales, se aplicará un cargo de limpieza adicional.',
  '5. Daños: cualquier daño nuevo respecto a la inspección de salida será evaluado y cargado al arrendatario, total o parcialmente, según el caso.',
  '6. El vehículo deberá devolverse en la fecha y hora acordadas. Las devoluciones tardías pueden generar cargos adicionales.',
  '7. El arrendatario autoriza el tratamiento de sus datos personales para la gestión del alquiler y el cumplimiento de obligaciones legales.',
  '8. La fianza será devuelta una vez verificado el estado del vehículo, descontados, en su caso, los cargos aplicables.'
];

const FUEL_LABELS: Record<string, string> = {
  empty: 'Vacío',
  quarter: '1/4',
  half: '1/2',
  three_quarters: '3/4',
  full: 'Lleno'
};

function formatDate(d?: Date): string {
  if (!d) return '—';
  try {
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

function formatMoney(n?: number): string {
  if (n === undefined || n === null) return '—';
  return `${n.toFixed(2)} €`;
}

class PdfBuilder {
  private page!: PDFPage;
  private y = 0;
  private font!: PDFFont;
  private bold!: PDFFont;
  private doc: PDFDocument;
  private margin = 50;
  private pageWidth = 595.28; // A4
  private pageHeight = 841.89;

  constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  async init(): Promise<void> {
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.newPage();
  }

  private newPage(): void {
    this.page = this.doc.addPage([this.pageWidth, this.pageHeight]);
    this.y = this.pageHeight - this.margin;
  }

  private ensureSpace(h: number): void {
    if (this.y - h < this.margin) this.newPage();
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}): void {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const color = opts.color ? rgb(opts.color[0], opts.color[1], opts.color[2]) : rgb(0, 0, 0);
    const lines = this.wrap(s, size, font);
    const lineHeight = size * 1.4;
    for (const ln of lines) {
      this.ensureSpace(lineHeight);
      this.page.drawText(ln, {
        x: this.margin,
        y: this.y - size,
        size,
        font,
        color
      });
      this.y -= lineHeight;
    }
    if (opts.gap) this.y -= opts.gap;
  }

  private wrap(s: string, size: number, font: PDFFont): string[] {
    const maxWidth = this.pageWidth - this.margin * 2;
    const words = s.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      const width = font.widthOfTextAtSize(test, size);
      if (width > maxWidth) {
        if (line) lines.push(line);
        // Hard wrap very long tokens
        if (font.widthOfTextAtSize(w, size) > maxWidth) {
          let buf = '';
          for (const ch of w) {
            if (font.widthOfTextAtSize(buf + ch, size) > maxWidth) {
              lines.push(buf);
              buf = ch;
            } else {
              buf += ch;
            }
          }
          line = buf;
        } else {
          line = w;
        }
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  separator(): void {
    this.ensureSpace(20);
    this.y -= 4;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.pageWidth - this.margin, y: this.y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7)
    });
    this.y -= 10;
  }

  section(title: string): void {
    this.y -= 6;
    this.text(title, { size: 12, bold: true, color: [0.1, 0.4, 0.2], gap: 4 });
  }

  twoColumn(left: string, right: string, leftBold = false): void {
    const size = 10;
    const font = leftBold ? this.bold : this.font;
    this.ensureSpace(size * 1.5);
    this.page.drawText(left, { x: this.margin, y: this.y - size, size, font });
    this.page.drawText(right, {
      x: this.pageWidth - this.margin - font.widthOfTextAtSize(right, size),
      y: this.y - size,
      size,
      font
    });
    this.y -= size * 1.5;
  }

  addSignatureBlock(
    png: any,
    width: number,
    height: number,
    caption: string
  ): void {
    this.y -= 8;
    this.ensureSpace(height + 30);
    this.page.drawImage(png, {
      x: this.margin,
      y: this.y - height,
      width,
      height
    });
    this.y -= height;
    this.text(caption, { size: 9 });
  }

  addEmptySignatureBlock(): void {
    this.y -= 20;
    this.ensureSpace(40);
    this.text('Firma del cliente:', { size: 10, bold: true });
    this.y -= 30;
    this.text('_______________________________', { size: 11 });
  }

  skip(dy: number): void {
    this.y -= dy;
  }
}

/**
 * Build the unsigned or signed contract PDF.
 */
export async function buildContractPdf(input: ContractPdfInput, signed: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const b = new PdfBuilder(doc);
  await b.init();

  // Header
  b.text(input.companyName, { size: 18, bold: true, color: [0.1, 0.4, 0.2] });
  b.text('CONTRATO DE ALQUILER DE VEHÍCULO', { size: 14, bold: true });
  b.separator();
  b.twoColumn(
    'Nº de contrato:',
    input.contractNumber || '—',
    false
  );
  b.twoColumn(
    'Generado:',
    formatDate(input.generatedAt)
  );
  if (signed && input.signedAt) {
    b.twoColumn('Firmado:', formatDate(input.signedAt));
  }
  b.separator();

  // Client
  b.section('Datos del cliente');
  b.twoColumn('Nombre y apellidos:', input.client.fullName, true);
  if (input.client.documentType || input.client.documentNumber) {
    b.twoColumn('Documento:', `${input.client.documentType || ''} ${input.client.documentNumber || ''}`.trim());
  }
  if (input.client.drivingLicenseNumber) {
    b.twoColumn('Carnet de conducir:', input.client.drivingLicenseNumber);
  }
  if (input.client.phone) b.twoColumn('Teléfono:', input.client.phone);
  if (input.client.email) b.twoColumn('Email:', input.client.email);
  if (input.client.address) b.twoColumn('Dirección:', input.client.address);

  // Vehicle
  b.section('Datos del vehículo');
  b.twoColumn(
    'Vehículo:',
    `${input.vehicle.brand} ${input.vehicle.model}${input.vehicle.version ? ' ' + input.vehicle.version : ''}`,
    true
  );
  b.twoColumn('Matrícula:', input.vehicle.plateNumber);
  if (input.vehicle.year) b.twoColumn('Año:', String(input.vehicle.year));

  // Reservation
  b.section('Datos de la reserva');
  b.twoColumn('Fecha y hora de entrega:', formatDate(input.reservation.pickupDateTime), true);
  b.twoColumn('Fecha y hora de devolución:', formatDate(input.reservation.returnDateTime), true);
  if (input.reservation.totalDays) {
    b.twoColumn('Duración:', `${input.reservation.totalDays} día(s)`);
  }
  if (input.reservation.pickupLocation) {
    b.twoColumn('Lugar de entrega:', input.reservation.pickupLocation);
  }
  if (input.reservation.returnLocation) {
    b.twoColumn('Lugar de devolución:', input.reservation.returnLocation);
  }

  // Pricing
  b.section('Precio y fianza');
  b.twoColumn('Importe alquiler:', formatMoney(input.reservation.finalPrice), true);
  b.twoColumn('Fianza:', formatMoney(input.reservation.depositAmount), true);

  // Inspection snapshot
  if (input.inspection) {
    b.section('Estado del vehículo');
    if (input.inspection.pickupKm !== undefined) {
      b.twoColumn('Km salida:', String(input.inspection.pickupKm));
    }
    if (input.inspection.pickupFuelLevel) {
      b.twoColumn('Combustible salida:', FUEL_LABELS[input.inspection.pickupFuelLevel] || input.inspection.pickupFuelLevel);
    }
    if (input.inspection.returnKm !== undefined) {
      b.twoColumn('Km devolución:', String(input.inspection.returnKm));
    }
    if (input.inspection.returnFuelLevel) {
      b.twoColumn('Combustible devolución:', FUEL_LABELS[input.inspection.returnFuelLevel] || input.inspection.returnFuelLevel);
    }
  }

  // Conditions
  b.section('Condiciones del contrato');
  for (const line of CONDITIONS_TEXT) {
    b.text(line, { size: 9, gap: 2 });
  }

  // Signature block
  b.skip(10);
  b.text('El arrendatario manifiesta haber leído, comprendido y aceptado las condiciones anteriores.', {
    size: 9
  });

  if (signed && input.signaturePng) {
    try {
      const png = await doc.embedPng(input.signaturePng);
      const maxW = 200;
      const maxH = 70;
      const ratio = Math.min(maxW / png.width, maxH / png.height);
      const w = png.width * ratio;
      const h = png.height * ratio;
      b.addSignatureBlock(png, w, h, `Firmado por ${input.signerName || input.client.fullName} el ${formatDate(input.signedAt)}`);
    } catch (err) {
      functions.logger.warn('Failed to embed signature image:', err);
    }
  } else {
    b.addEmptySignatureBlock();
  }

  // Footer
  b.separator();
  b.text(
    `${input.companyName} · ${input.companyEmail}${input.companyPhone ? ' · ' + input.companyPhone : ''}`,
    { size: 8, color: [0.4, 0.4, 0.4] }
  );

  return await doc.save();
}
