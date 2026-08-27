/**
 * Layout guarantees for every PDF the company issues.
 *
 * These render the real documents and inspect where each run of text landed.
 * Two things are checked, and both have already gone wrong in production:
 *
 *   1. **Nothing overlaps.** Text is drawn at absolute coordinates, so a long
 *      label and a right-aligned value silently print on top of each other on
 *      somebody's real data.
 *   2. **Every glyph exists.** Gotham has no €, ă, ș or ț. Set a price or a
 *      Romanian sentence in it and pdf-lib draws blank boxes without error.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildContractPdf, PdfBuilder, formatIdDocument, companyFooterLines } from '../contracts/pdf';
import { buildQuotePdf, buildBookingConfirmationPdf } from './documents-pdf';
import { CONTRACT_CLAUSES } from '../contracts/clauses';
import { COMPANY_ADDRESS, COMPANY_LEGAL_NAME, COMPANY_REGISTRY } from '../company-config';
import type { ContractLocale } from '../contracts/contract-types';

const company = {
  legalName: COMPANY_LEGAL_NAME,
  taxId: 'B88866900',
  registry: COMPANY_REGISTRY,
  address: COMPANY_ADDRESS,
  phone: '+34 623 766 181',
  email: 'reservas@veltorent.com',
  website: 'www.veltorent.com'
};

// Deliberately awkward: a long legal name and a long address are exactly what
// used to collide with the value column.
const client = {
  fullName: 'EUROCONSTRUCCIONES 2020, SOCIEDAD LIMITADA UNIPERSONAL',
  documentType: 'nie',
  documentNumber: 'x9876543m',
  phone: '+34 678 901 234',
  email: 'administracion.facturacion@euroconstrucciones2020.example.com',
  address: 'Urbanización El Romeral, parcela 12, portal 3, 28500 Arganda del Rey (Madrid)'
};

const vehicle = {
  brand: 'Renault',
  model: 'Megane',
  version: 'Sport Tourer Business dCi 115',
  plateNumber: '4466LKK',
  year: 2024,
  fuelType: 'Diésel',
  transmission: 'Automático'
};

const rental = {
  pickupDateTime: new Date('2026-09-04T10:00:00Z'),
  returnDateTime: new Date('2026-09-11T10:00:00Z'),
  totalDays: 7,
  pickupLocation: 'Arganda Del Rey — Vereda Del Melero, 3',
  returnLocation: 'Aeropuerto Adolfo Suárez Madrid-Barajas, Terminal 4'
};

const pricing = {
  finalPrice: 3630,
  depositAmount: 150,
  tariffPrice: 4000,
  loyaltyDiscountPercent: 5,
  loyaltyDiscount: -200,
  manualAdjustment: -170,
  vatRate: 0.21
};

const LOCALES: ContractLocale[] = ['es', 'en', 'ro'];

/** Renders a document and hands back the builder so its boxes can be read. */
async function renderQuote(locale: ContractLocale) {
  const bytes = await buildQuotePdf({
    company,
    client,
    vehicle,
    rental,
    pricing,
    locale,
    generatedAt: new Date('2026-08-27T09:00:00Z'),
    validUntil: new Date('2026-09-03T09:00:00Z')
  });
  return bytes;
}

async function renderBooking(locale: ContractLocale) {
  return buildBookingConfirmationPdf({
    company,
    client,
    vehicle,
    rental,
    pricing,
    payments: {
      initialRequired: 500,
      initialPaid: 500,
      remainingRequired: 3130,
      remainingPaid: 0,
      remainingDueDate: new Date('2026-09-02T10:00:00Z'),
      depositRequired: 150,
      depositPaid: 0
    },
    locator: 'R-P2RJP0',
    contractSigned: false,
    locale,
    generatedAt: new Date('2026-08-27T09:00:00Z')
  });
}

async function renderContract(locale: ContractLocale) {
  return buildContractPdf(
    {
      contractNumber: 'C-P2RJP0-2026',
      company,
      client,
      vehicle,
      reservation: { ...rental, ...pricing },
      clauses: CONTRACT_CLAUSES,
      preferredLocale: locale,
      generatedAt: new Date('2026-08-27T09:00:00Z')
    },
    false
  );
}

describe('the real documents, in every language', () => {
  /**
   * Renders one document and returns the builder that laid it out, so the
   * assertions run against the same geometry that reached the page.
   */
  async function layoutOf(
    kind: 'quote' | 'booking' | 'contract',
    locale: ContractLocale
  ): Promise<PdfBuilder> {
    let captured: PdfBuilder | null = null;
    const onLayout = (b: PdfBuilder) => {
      captured = b;
    };

    if (kind === 'quote') {
      await buildQuotePdf({
        company,
        client,
        vehicle,
        rental,
        pricing,
        locale,
        generatedAt: new Date('2026-08-27T09:00:00Z'),
        validUntil: new Date('2026-09-03T09:00:00Z'),
        onLayout
      });
    } else if (kind === 'booking') {
      await buildBookingConfirmationPdf({
        company,
        client,
        vehicle,
        rental,
        pricing,
        payments: {
          initialRequired: 500,
          initialPaid: 500,
          remainingRequired: 3130,
          remainingPaid: 0,
          remainingDueDate: new Date('2026-09-02T10:00:00Z'),
          depositRequired: 150,
          depositPaid: 0
        },
        locator: 'R-P2RJP0',
        contractSigned: false,
        locale,
        generatedAt: new Date('2026-08-27T09:00:00Z'),
        onLayout
      });
    } else {
      await buildContractPdf(
        {
          contractNumber: 'C-P2RJP0-2026',
          company,
          client,
          vehicle,
          reservation: { ...rental, ...pricing },
          clauses: CONTRACT_CLAUSES,
          preferredLocale: locale,
          generatedAt: new Date('2026-08-27T09:00:00Z'),
          onLayout
        },
        false
      );
    }

    if (!captured) throw new Error(`onLayout was never called for ${kind}`);
    return captured;
  }

  const KINDS = ['quote', 'booking', 'contract'] as const;

  for (const kind of KINDS) {
    for (const locale of LOCALES) {
      it(`${kind} / ${locale}: no run of text overlaps another`, async () => {
        const b = await layoutOf(kind, locale);
        expect(b.assertNoOverlaps()).toEqual([]);
      }, 30_000);

      it(`${kind} / ${locale}: every glyph exists in the font it was set in`, async () => {
        const b = await layoutOf(kind, locale);
        expect(b.assertNoMissingGlyphs()).toEqual([]);
      }, 30_000);

      it(`${kind} / ${locale}: nothing is drawn over the legal footer`, async () => {
        const b = await layoutOf(kind, locale);
        expect(b.assertInsideMargins()).toEqual([]);
      }, 30_000);

      it(`${kind} / ${locale}: no heading is clipped`, async () => {
        const b = await layoutOf(kind, locale);
        // An ellipsis in large type means a title or a total got cut. The
        // contract title used to print as "CONTRATO DE ALQUILER …".
        const clipped = b.boxes
          .filter((box) => box.height >= 10 && box.text.endsWith('…'))
          .map((box) => `p${box.page}: "${box.text}"`);
        expect(clipped).toEqual([]);
      }, 30_000);
    }
  }

  it('renders every document to a non-trivial PDF', async () => {
    for (const locale of LOCALES) {
      const bytes = await Promise.all([
        renderQuote(locale),
        renderBooking(locale),
        renderContract(locale)
      ]);
      for (const b of bytes) expect(b.length).toBeGreaterThan(1000);
    }
  }, 60_000);
});

describe('no text overlaps', () => {
  /**
   * The builder records every run it draws, so the check runs against the same
   * geometry that reaches the page.
   */
  async function overlapsFor(draw: (b: PdfBuilder) => void): Promise<string[]> {
    const doc = await PDFDocument.create();
    const b = new PdfBuilder(doc);
    await b.init('TEST', 'REF-1', companyFooterLines(company));
    draw(b);
    b.finalizeFooters();
    return b.assertNoOverlaps();
  }

  it('keeps a long label off a long value in twoColumn', async () => {
    const problems = await overlapsFor((b) => {
      b.twoColumn(
        'Datos registrales de la sociedad arrendadora y su inscripción:',
        'Sociedad Limitada inscrita en el Registro Mercantil de Madrid, Hoja M-893718',
        true,
        true
      );
    });
    expect(problems).toEqual([]);
  });

  it('keeps the two info columns apart when both are full', async () => {
    const problems = await overlapsFor((b) => {
      b.infoColumns(
        [
          { label: 'Fecha de expedición', value: '07/08/2026 a las 14:35 (Europe/Madrid)' },
          { label: 'Contrato', value: 'CGLSY9F-2026-EXTENDIDO-LARGO' }
        ],
        [
          { value: client.fullName, strong: true },
          { label: 'Documento', value: formatIdDocument('nie', client.documentNumber) }
        ]
      );
    });
    expect(problems).toEqual([]);
  });

  it('keeps totals labels off their amounts', async () => {
    const problems = await overlapsFor((b) => {
      b.totalsBlock([
        { label: 'Base imponible del arrendamiento sin conductor', value: '3.000,00 €' },
        { label: 'IVA (21 %)', value: '630,00 €' },
        { label: 'Total alquiler (IVA incl.)', value: '3.630,00 €', total: true }
      ]);
    });
    expect(problems).toEqual([]);
  });

  it('keeps signature captions inside their own column', async () => {
    const problems = await overlapsFor((b) => {
      b.signatureBlocks({
        lessorRole: 'EL ARRENDADOR (VELTO MOBILITY, S.L.)',
        lessorName: COMPANY_LEGAL_NAME,
        lessorId: 'NIF B88866900',
        renterRole: 'EL ARRENDATARIO',
        renterName: client.fullName,
        renterId: formatIdDocument('nie', client.documentNumber)
      });
    });
    expect(problems).toEqual([]);
  });
});

describe('identity documents', () => {
  it('writes the type and the number in capitals', () => {
    expect(formatIdDocument('nie', 'x9876543m')).toBe('NIE X9876543M');
    expect(formatIdDocument('dni', '51234567h')).toBe('DNI 51234567H');
    expect(formatIdDocument('passport', 'ab123456')).toBe('PASAPORTE AB123456');
  });

  it('still prints the number when the type is unknown or missing', () => {
    expect(formatIdDocument(undefined, 'x9876543m')).toBe('X9876543M');
    expect(formatIdDocument('other', 'x9876543m')).toBe('X9876543M');
  });

  it('returns nothing rather than a stray label when there is no number', () => {
    expect(formatIdDocument(undefined, undefined)).toBe('');
  });
});

describe('company footer', () => {
  it('puts the identity on one line and the registry on the next', () => {
    const lines = companyFooterLines(company);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('VELTO MOBILITY, S.L.');
    expect(lines[0]).toContain('NIF B88866900');
    expect(lines[1]).toContain('Registro Mercantil de Madrid');
  });

  it('uppercases the tax id even if it arrives in lower case', () => {
    const lines = companyFooterLines({ ...company, taxId: 'b88866900' });
    expect(lines[0]).toContain('NIF B88866900');
  });
});
