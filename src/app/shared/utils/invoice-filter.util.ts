/**
 * Filtrar el listado de facturas.
 *
 * Va aparte de `invoice.util.ts` a propósito: aquello es la aritmética y las
 * reglas fiscales —lo que decide cuánto se cobra y qué se puede emitir—, y esto
 * es presentación. Mezclarlos haría que un cambio en cómo se busca tocara el
 * fichero que calcula el IVA.
 */

import { Invoice, InvoiceKind } from '@shared/models/invoice.model';
import { toDate } from '@shared/utils/reservation-date.util';

export interface InvoiceFilter {
  /** `null` = todos los ejercicios. */
  year: number | null;
  /** `null` = facturas y rectificativas. */
  kind: InvoiceKind | null;
  /** Desde, inclusive. `null` = sin límite por abajo. */
  from: Date | null;
  /** Hasta, **inclusive el día entero**. `null` = sin límite por arriba. */
  to: Date | null;
}

export const EMPTY_INVOICE_FILTER: InvoiceFilter = {
  year: null,
  kind: null,
  from: null,
  to: null
};

/** ¿Hay algún filtro puesto? Sirve para ofrecer «quitar filtros» solo si toca. */
export function hasFilter(f: InvoiceFilter): boolean {
  return f.year !== null || f.kind !== null || f.from !== null || f.to !== null;
}

/**
 * La fecha de emisión de una factura, como `Date`.
 *
 * ⚠️ Llega de Firestore como `Timestamp`, y compararlo con un `Date` da siempre
 * falso sin convertir — es la misma trampa que dejó en blanco la fecha de la
 * declaración responsable y que hizo invisible una ITV. Se usa el conversor del
 * proyecto y no uno propio.
 */
function fechaDe(invoice: Invoice): Date | null {
  if (!invoice.issueDate) return null;
  const d = toDate(invoice.issueDate);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Los ejercicios que de verdad tienen facturas, de más reciente a más antiguo.
 *
 * ⚠️ **Salen de los datos, no de un rango inventado.** Ofrecer 2020…2030 en un
 * desplegable llena la lista de años vacíos y esconde el único que interesa; y
 * una lista fija se queda corta el 1 de enero.
 */
export function invoiceYears(invoices: Invoice[]): number[] {
  const años = new Set<number>();
  for (const inv of invoices) {
    const d = fechaDe(inv);
    if (d) años.add(d.getFullYear());
  }
  return [...años].sort((a, b) => b - a);
}

/**
 * Los tipos que de verdad hay, por el mismo motivo que los años.
 *
 * ⚠️ **La proforma no aparece nunca aquí**, y no es un olvido: no se guarda en
 * Firestore —no consume número, no se encadena y no escribe nada—, así que
 * ofrecerla como filtro sería un desplegable que no encuentra nada jamás.
 */
export function invoiceKinds(invoices: Invoice[]): InvoiceKind[] {
  const orden: InvoiceKind[] = ['invoice', 'rectifying', 'proforma'];
  const presentes = new Set(invoices.map((i) => i.kind).filter(Boolean));
  return orden.filter((k) => presentes.has(k));
}

/**
 * El final de un día, para que «hasta el 30» incluya el 30.
 *
 * ⚠️ **Es el fallo clásico de un rango de fechas y aquí se nota enseguida.** Un
 * `<input type="date">` da la medianoche del 30; comparar contra eso deja fuera
 * todas las facturas de ese día, que es justo el que se acaba de teclear. Con
 * varias facturas al mes, «no aparece la de hoy» parece que se han perdido.
 */
function finDelDia(d: Date): Date {
  const fin = new Date(d);
  fin.setHours(23, 59, 59, 999);
  return fin;
}

/** El principio del día, por simetría: «desde el 1» incluye el 1 entero. */
function inicioDelDia(d: Date): Date {
  const ini = new Date(d);
  ini.setHours(0, 0, 0, 0);
  return ini;
}

/**
 * Las facturas que pasan el filtro.
 *
 * Los criterios se acumulan: año **y** tipo **y** rango. Una factura sin fecha
 * —un borrador recién creado— sale solo cuando no hay ningún filtro de fecha
 * puesto: no se puede afirmar que esté dentro de un rango que no tiene.
 */
export function filterInvoices(invoices: Invoice[], f: InvoiceFilter): Invoice[] {
  const desde = f.from ? inicioDelDia(f.from) : null;
  const hasta = f.to ? finDelDia(f.to) : null;

  return invoices.filter((inv) => {
    if (f.kind && inv.kind !== f.kind) return false;

    const fecha = fechaDe(inv);
    if (f.year !== null) {
      if (!fecha || fecha.getFullYear() !== f.year) return false;
    }
    if (desde || hasta) {
      if (!fecha) return false;
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
    }
    return true;
  });
}

/** Lo que suman las facturas filtradas, para saber qué se está mirando. */
export function filteredTotal(invoices: Invoice[]): number {
  const total = invoices.reduce((suma, i) => suma + (Number(i.totals?.total) || 0), 0);
  return Math.round(total * 100) / 100;
}
