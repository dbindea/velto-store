import { describe, expect, it } from 'vitest';
import {
  EMPTY_INVOICE_FILTER,
  filterInvoices,
  filteredTotal,
  hasFilter,
  invoiceKinds,
  invoiceYears
} from './invoice-filter.util';
import type { Invoice, InvoiceKind } from '@shared/models/invoice.model';

const factura = (
  fullNumber: string,
  iso: string | null,
  kind: InvoiceKind = 'invoice',
  total = 100
): Invoice =>
  ({
    id: fullNumber,
    fullNumber,
    kind,
    status: 'issued',
    issueDate: iso ? new Date(iso) : undefined,
    totals: { total }
  }) as unknown as Invoice;

const datos: Invoice[] = [
  factura('2026/0001', '2026-01-15T10:00:00', 'invoice', 121),
  factura('2026/0002', '2026-09-30T18:00:00', 'invoice', 242),
  factura('R2026/0001', '2026-09-30T19:00:00', 'rectifying', -36.3),
  factura('2025/0009', '2025-11-02T09:00:00', 'invoice', 60.5)
];

describe('los años que se ofrecen', () => {
  /**
   * ⚠️ **Salen de los datos.** Un rango inventado llena el desplegable de años
   * vacíos y esconde el único que interesa; y una lista fija se queda corta el
   * 1 de enero.
   */
  it('son solo los que tienen facturas, del más reciente al más antiguo', () => {
    expect(invoiceYears(datos)).toEqual([2026, 2025]);
  });

  it('una factura sin fecha no inventa un año', () => {
    expect(invoiceYears([factura('BORRADOR', null)])).toEqual([]);
  });
});

describe('los tipos que se ofrecen', () => {
  it('son los que hay, en orden', () => {
    expect(invoiceKinds(datos)).toEqual(['invoice', 'rectifying']);
  });

  /**
   * ⚠️ **La proforma no se guarda en Firestore** —no consume número, no se
   * encadena y no escribe nada—, así que ofrecerla sería un filtro que no
   * encuentra nada jamás.
   */
  it('y la proforma no aparece, porque no se guarda', () => {
    expect(invoiceKinds(datos)).not.toContain('proforma');
  });
});

describe('el filtro', () => {
  it('sin nada puesto, devuelve todo', () => {
    expect(filterInvoices(datos, EMPTY_INVOICE_FILTER)).toHaveLength(4);
    expect(hasFilter(EMPTY_INVOICE_FILTER)).toBe(false);
  });

  it('por año', () => {
    const r = filterInvoices(datos, { ...EMPTY_INVOICE_FILTER, year: 2025 });
    expect(r.map((i) => i.fullNumber)).toEqual(['2025/0009']);
  });

  it('por tipo', () => {
    const r = filterInvoices(datos, { ...EMPTY_INVOICE_FILTER, kind: 'rectifying' });
    expect(r.map((i) => i.fullNumber)).toEqual(['R2026/0001']);
  });

  /**
   * ⚠️ **El fallo clásico de un rango de fechas.** Un `<input type="date">` da
   * la medianoche del 30, así que comparar contra eso deja fuera todas las
   * facturas de ese día — justo el que se acaba de teclear. Con varias facturas
   * al mes, «no aparece la de hoy» parece que se han perdido.
   */
  it('«hasta el 30» INCLUYE el 30 entero', () => {
    const r = filterInvoices(datos, {
      ...EMPTY_INVOICE_FILTER,
      to: new Date('2026-09-30T00:00:00')
    });
    expect(r.map((i) => i.fullNumber)).toContain('2026/0002'); // emitida a las 18:00
    expect(r.map((i) => i.fullNumber)).toContain('R2026/0001'); // a las 19:00
  });

  it('y «desde el 30» incluye el 30 desde las cero horas', () => {
    const r = filterInvoices(datos, {
      ...EMPTY_INVOICE_FILTER,
      from: new Date('2026-09-30T00:00:00')
    });
    expect(r).toHaveLength(2);
  });

  it('los criterios se acumulan: año Y tipo Y rango', () => {
    const r = filterInvoices(datos, {
      year: 2026,
      kind: 'invoice',
      from: new Date('2026-09-01T00:00:00'),
      to: new Date('2026-09-30T00:00:00')
    });
    expect(r.map((i) => i.fullNumber)).toEqual(['2026/0002']);
  });

  /**
   * ⚠️ Un borrador no tiene fecha. Con un rango puesto no se puede afirmar que
   * esté dentro, así que se queda fuera; sin rango, sale como todo lo demás.
   */
  it('una factura sin fecha sale sin filtro de fechas y no sale con él', () => {
    const conBorrador = [...datos, factura('BORRADOR', null)];
    expect(filterInvoices(conBorrador, EMPTY_INVOICE_FILTER)).toHaveLength(5);
    expect(
      filterInvoices(conBorrador, {
        ...EMPTY_INVOICE_FILTER,
        from: new Date('2026-01-01T00:00:00')
      }).map((i) => i.fullNumber)
    ).not.toContain('BORRADOR');
  });

  it('un año sin facturas no devuelve nada, y no revienta', () => {
    expect(filterInvoices(datos, { ...EMPTY_INVOICE_FILTER, year: 2019 })).toEqual([]);
  });
});

describe('el total de lo filtrado', () => {
  it('suma lo que se está mirando, no todo', () => {
    const soloRectificativas = filterInvoices(datos, {
      ...EMPTY_INVOICE_FILTER,
      kind: 'rectifying'
    });
    expect(filteredTotal(soloRectificativas)).toBe(-36.3);
  });

  /** Sumar céntimos en coma flotante da 423.20000000000005 sin redondear. */
  it('redondea al céntimo', () => {
    expect(filteredTotal(datos)).toBe(387.2);
  });
});
