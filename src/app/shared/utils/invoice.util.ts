/**
 * La aritmética y las reglas de la factura, en un solo sitio.
 *
 * Igual que `pricing.util.ts` es la única autoridad sobre el precio de un
 * alquiler, esto lo es sobre lo que dice una factura. No dupliques estos
 * cálculos en un componente: el mismo `calculateInvoiceTotals()` que pinta la
 * pantalla lo vuelve a ejecutar la Cloud Function antes de emitir, porque lo
 * que se congela en un documento fiscal no puede fiarse de la cifra que enseñó
 * la UI.
 *
 * Ver `docs/facturacion.md` para el porqué legal de cada regla.
 */

import {
  Invoice,
  InvoiceLine,
  InvoicePaymentMethod,
  InvoiceRecipient,
  InvoiceTotals,
  MAX_CASH_PAYMENT,
  RectifyingReason,
  RectifyingType,
  TaxRegime,
  VatSubtotal
} from '@shared/models/invoice.model';
import { FieldProblems } from '@shared/utils/form-problems.util';
import { roundMoney } from '@shared/utils/payment-summary.util';

/** Ancho del contador: `2026/0001`. Cuatro dígitos dan para 9.999 al año. */
export const INVOICE_NUMBER_PADDING = 4;

/** Prefijo de la serie de rectificativas, que la ley obliga a separar. */
export const RECTIFYING_SERIES_PREFIX = 'R';

/**
 * `2026` para una factura de 2026, `R2026` para su rectificativa.
 *
 * La serie es el ejercicio **de expedición**, no el de la operación: una
 * factura emitida en febrero de 2027 por un alquiler de noviembre de 2026 va en
 * la serie `2027`. La fecha de operación es la que dice cuándo se prestó el
 * servicio; la serie solo ordena cuándo se emitió.
 */
export function invoiceSeriesFor(date: Date, rectifying = false): string {
  const year = date.getFullYear();
  return rectifying ? `${RECTIFYING_SERIES_PREFIX}${year}` : String(year);
}

/** `2026` + `1` → `2026/0001`. */
export function formatInvoiceNumber(series: string, number: number): string {
  return `${series}/${String(number).padStart(INVOICE_NUMBER_PADDING, '0')}`;
}

/**
 * Los totales de una factura, con el desglose por tipo impositivo.
 *
 * ⚠️ **El IVA se SUMA al precio de línea**, que es neto — la misma dirección que
 * en `pricing.util.ts` y la contraria que en `expense.util.ts`, donde se extrae
 * de un bruto. Confundirlas no da un error: da una cifra creíble y equivocada.
 *
 * ⚠️ **Cada línea se redondea antes de sumar**, no después. Sumando en crudo y
 * redondeando al final, la base impresa y la suma de las líneas impresas pueden
 * diferir en un céntimo — y en una factura eso es un descuadre que hay que
 * explicar. Redondeando por línea, lo que se ve es lo que suma.
 */
export function calculateInvoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  const porTipo = new Map<number, VatSubtotal>();
  let exento = 0;
  let rebuTotal = 0;
  // Los dos acumuladores del régimen general van aparte del desglose por tipo,
  // que mezcla el general con el margen del REBU.
  let totalGeneral = 0;
  let vatGeneral = 0;

  for (const line of lines || []) {
    const cantidad = Number(line.quantity) || 0;
    const precio = Number(line.unitPrice) || 0;
    const tipo = Number(line.vatRate) || 0;
    const regimen = line.taxRegime || 'standard';
    if (!cantidad || !precio) continue;

    const importe = roundMoney(cantidad * precio);

    /**
     * Exentas y con inversión del sujeto pasivo: **el importe entra en el
     * total, pero no genera cuota ni subtotal por tipo**.
     *
     * No es lo mismo que un 0 %: una exenta se declara aparte y la factura
     * tiene que decir por qué lo está. Meterlas en `byVatRate` como si fueran
     * un tipo cero imprimiría «IVA 0 %», que es exactamente lo que la norma no
     * quiere ver — el art. 6.1.j) pide la referencia a la exención, no un tipo
     * inventado.
     */
    if (regimen !== 'standard' && regimen !== 'rebu') {
      exento = roundMoney(exento + importe);
      continue;
    }

    /**
     * REBU: la base imponible es **el margen**, no el precio de venta.
     *
     * `base = (venta − compra) × 100 / (100 + tipo)`, con los dos precios IVA
     * incluido, que es como lo define la norma. Y si el margen es negativo
     * —se vendió con pérdida— la base es cero: no existe una cuota negativa.
     *
     * ⚠️ Lo que se cobra al cliente sigue siendo el **precio de venta
     * completo**, y por eso el importe entra entero en el total. La cuota no se
     * suma encima: va dentro.
     */
    if (regimen === 'rebu') {
      rebuTotal = roundMoney(rebuTotal + importe);
      const compra = roundMoney((Number(line.purchasePrice) || 0) * cantidad);
      const margen = Math.max(0, roundMoney(importe - compra));
      const baseMargen = roundMoney((margen * 100) / (100 + tipo * 100));
      const cuotaMargen = roundMoney(margen - baseMargen);
      const acumuladoRebu = porTipo.get(tipo);
      if (acumuladoRebu) {
        acumuladoRebu.base = roundMoney(acumuladoRebu.base + baseMargen);
        acumuladoRebu.vat = roundMoney(acumuladoRebu.vat + cuotaMargen);
      } else {
        porTipo.set(tipo, { vatRate: tipo, base: baseMargen, vat: cuotaMargen });
      }
      continue;
    }

    // Régimen general: el IVA se suma al neto.
    const cuota = roundMoney(importe * tipo);
    totalGeneral = roundMoney(totalGeneral + importe);
    vatGeneral = roundMoney(vatGeneral + cuota);
    const acumulado = porTipo.get(tipo);
    if (acumulado) {
      acumulado.base = roundMoney(acumulado.base + importe);
      acumulado.vat = roundMoney(acumulado.vat + cuota);
    } else {
      porTipo.set(tipo, { vatRate: tipo, base: importe, vat: cuota });
    }
  }

  // De mayor a menor tipo: el 21 % primero, que es el caso normal y el que el
  // ojo busca.
  const byVatRate = [...porTipo.values()].sort((a, b) => b.vatRate - a.vatRate);
  const baseGravada = roundMoney(byVatRate.reduce((s, x) => s + x.base, 0));
  const vat = roundMoney(byVatRate.reduce((s, x) => s + x.vat, 0));

  /**
   * ⚠️ **La cuota del margen REBU NO se suma al total.**
   *
   * Es el error que cazó su test: el importe REBU ya lleva el impuesto dentro,
   * así que sumar además su cuota cobraba el IVA dos veces — 7.260,33 € por un
   * coche vendido en 7.000 €.
   *
   * La base y la cuota del margen se calculan igual porque hacen falta para el
   * modelo 303, pero al total solo entra la cuota de las líneas en **régimen
   * general**. Y en la factura ni siquiera se imprimen: el art. 138 LIVA
   * prohíbe consignar la cuota por separado, para que el comprador no pueda
   * deducírsela.
   */
  return {
    base: baseGravada,
    vat,
    total: roundMoney(totalGeneral + vatGeneral + exento + rebuTotal),
    byVatRate,
    exemptTotal: exento,
    rebuTotal
  };
}

/** El importe de una línea, sin IVA. Lo que se pinta en la columna «BASE». */
export function lineBase(line: InvoiceLine): number {
  return roundMoney((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
}

/** ¿Hay alguna línea en este régimen? Para que la pantalla pida lo que falte. */
export function hasRegime(lines: InvoiceLine[], regime: TaxRegime): boolean {
  return (lines || []).some((l) => (l.taxRegime || 'standard') === regime);
}

/**
 * El margen de una línea REBU, ya redondeado. Cero si se vendió con pérdida.
 *
 * Se expone porque la pantalla lo enseña mientras se teclea: es la única forma
 * de que el operador vea que el impuesto sale del margen y no del precio.
 */
export function rebuMargin(line: InvoiceLine): number {
  const venta = lineBase(line);
  const compra = roundMoney((Number(line.purchasePrice) || 0) * (Number(line.quantity) || 0));
  return Math.max(0, roundMoney(venta - compra));
}

/**
 * ¿Se puede cobrar esto en efectivo?
 *
 * ⚠️ Mira el **total de la operación**, no lo que quede pendiente. La ley
 * prohíbe fraccionar: un alquiler de 1.400 € no se puede cobrar en dos entregas
 * de 700 € en efectivo, así que si el total llega a 1.000 € el efectivo queda
 * descartado **aunque el saldo pendiente sea menor**.
 */
export function cashAllowedFor(total: number): boolean {
  return (Number(total) || 0) < MAX_CASH_PAYMENT;
}

/**
 * La forma de pago que la aplicación propone sola.
 *
 * Si no queda nada por cobrar, la factura sale **pagada** y sin datos
 * bancarios: no hay nada que pedirle al cliente. Si queda saldo, la propuesta
 * es transferencia, que es lo que Dorel usa hoy; el operador puede cambiarla.
 */
export function suggestPaymentMethod(total: number, alreadyPaid: number): InvoicePaymentMethod {
  const pendiente = roundMoney((Number(total) || 0) - (Number(alreadyPaid) || 0));
  return pendiente <= 0 ? 'paid' : 'transfer';
}

/**
 * Todo lo que impide emitir, campo a campo.
 *
 * **Una sola función**, la misma que consulta la pantalla y la que ejecuta la
 * Cloud Function antes de escribir. El orden de las comprobaciones es el de los
 * campos en el formulario, para que el resumen se lea de arriba abajo igual que
 * la pantalla.
 */
/**
 * Los prefijos de NIF-IVA de la Unión.
 *
 * ⚠️ **No son los códigos ISO.** Grecia usa `EL` y no `GR`, e Irlanda del Norte
 * tiene el suyo, `XI`, desde el Brexit. Sacando la lista de ISO 3166 se quedaría
 * fuera todo cliente griego.
 *
 * ⚠️ **Duplicado a propósito** en `functions/src/invoices/verifactu.ts`: la app
 * y las functions compilan con tsconfigs separados y no pueden compartir módulo.
 * Si cambia una, cambia la otra.
 */
const EU_VAT_PREFIXES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI',
  'SK', 'XI'
]);

/**
 * ¿El identificador dice ya de qué país es su titular?
 *
 * Un NIF, un NIE o un CIF españoles y un NIF-IVA europeo lo llevan dentro; un
 * pasaporte, no. Es la línea que separa a quien tiene que declarar el país
 * aparte para que su factura se pueda remitir.
 */
export function taxIdCarriesCountry(taxId: string): boolean {
  const clean = (taxId || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (!clean) return true;
  const sinPrefijo = clean.startsWith('ES') ? clean.slice(2) : clean;
  const esEspanol =
    /^\d{8}[A-Z]$/.test(sinPrefijo) ||
    /^[XYZ]\d{7}[A-Z]$/.test(sinPrefijo) ||
    /^[A-HJ-NP-SUVW]\d{7}[0-9A-J]$/.test(sinPrefijo);
  if (esEspanol) return true;
  return /^[0-9A-Z]+$/.test(clean.slice(2)) && EU_VAT_PREFIXES.has(clean.slice(0, 2));
}

/**
 * Todo lo que impide emitir, campo a campo.
 *
 * **Una sola función**, la misma que consulta la pantalla y la que ejecuta la
 * Cloud Function antes de escribir. El orden de las comprobaciones es el de los
 * campos en el formulario, para que el resumen se lea de arriba abajo igual que
 * la pantalla.
 */
export function validateInvoice(input: {
  recipient?: Partial<InvoiceRecipient> | null;
  lines?: InvoiceLine[] | null;
  paymentMethod?: InvoicePaymentMethod | null;
  /**
   * ⚠️ Una rectificativa **por diferencias** declara el ajuste con su signo, y
   * ese signo puede ser negativo: es como se anula una factura entera. En una
   * factura ordinaria un negativo sigue estando mal.
   */
  allowNegative?: boolean;
  /**
   * ¿Puede este entorno emitir con régimen intracomunitario? Lo sirve el
   * backend (`getComplianceStatus`), porque depende del ROI y del entorno, no
   * del código de la aplicación.
   *
   * ⚠️ **Sin valor, NO.** Falla cerrado: quien se olvide de pasarlo bloquea dos
   * regímenes que hoy no se deben usar. Al revés sería una factura fiscalmente
   * incorrecta que ya no se puede editar.
   */
  euRegimesEnabled?: boolean;
}): FieldProblems {
  const problems: FieldProblems = {};
  const recipient = input.recipient || {};
  const lines = input.lines || [];

  // --- Destinatario. Los tres son obligatorios en toda factura (art. 6.1) ---
  if (!recipient.name?.trim()) {
    problems['recipientName'] = 'invoices.problems.recipientNameRequired';
  }
  if (!recipient.taxId?.trim()) {
    problems['recipientTaxId'] = 'invoices.problems.recipientTaxIdRequired';
  }
  if (!recipient.address?.trim()) {
    problems['recipientAddress'] = 'invoices.problems.recipientAddressRequired';
  }

  /**
   * El país, **cuando el identificador no dice de dónde es su titular**.
   *
   * ⚠️ **Se pide aquí, antes de emitir, porque después no tiene arreglo.** La
   * AEAT rechaza el registro con el `1111` —«El campo CodigoPais es obligatorio
   * cuando IDType es distinto de NIF-IVA (02)»— y una factura emitida no se
   * puede editar: quedaría una factura buena que no se puede remitir nunca.
   *
   * Un NIF español y un NIF-IVA europeo llevan el país dentro; un pasaporte, no.
   * Y el pasaporte es el caso normal aquí: un turista alquilando un coche.
   * Descubierto contra preproducción el 9 de septiembre de 2026.
   */
  if (
    recipient.taxId?.trim() &&
    !taxIdCarriesCountry(recipient.taxId) &&
    !/^[A-Z]{2}$/.test((recipient.countryCode || '').trim().toUpperCase())
  ) {
    problems['recipientCountry'] = 'invoices.problems.recipientCountryRequired';
  }

  // --- Líneas ---
  const conContenido = lines.filter(
    (l) => l.description?.trim() || Number(l.quantity) || Number(l.unitPrice)
  );
  if (!conContenido.length) {
    problems['lines'] = 'invoices.problems.linesRequired';
  }

  conContenido.forEach((line, i) => {
    if (!line.description?.trim()) {
      problems[`lines[${i}].description`] = 'invoices.problems.lineDescriptionRequired';
    }
    if (!(Math.abs(Number(line.quantity)) > 0)) {
      problems[`lines[${i}].quantity`] = 'invoices.problems.lineQuantityRequired';
    }
    // Cero está permitido —un concepto a coste cero es una línea legítima— pero
    // un negativo en una factura ordinaria no: eso es una rectificativa.
    if (!input.allowNegative && !(Number(line.unitPrice) >= 0)) {
      problems[`lines[${i}].unitPrice`] = 'invoices.problems.linePriceInvalid';
    }
    if (!(Number(line.vatRate) >= 0)) {
      problems[`lines[${i}].vatRate`] = 'invoices.problems.lineVatInvalid';
    }

    // Cada régimen pide lo suyo, y sin ello la factura sale incompleta o con el
    // impuesto mal calculado.
    const regimen = line.taxRegime || 'standard';
    if (regimen === 'rebu' && !(Number(line.purchasePrice) > 0)) {
      // Sin precio de compra el margen sería el precio entero, así que el REBU
      // dejaría de serlo sin que nada avisara.
      problems[`lines[${i}].purchasePrice`] = 'invoices.problems.rebuPurchasePriceRequired';
    }
    if (regimen === 'exempt_other' && !line.exemptionNote?.trim()) {
      // El art. 6.1.j) exige la referencia a la norma que ampara la exención.
      problems[`lines[${i}].exemptionNote`] = 'invoices.problems.exemptionNoteRequired';
    }
    /**
     * ⚠️ **Sin ROI, estos dos no se pueden usar.** La entrega intracomunitaria
     * exenta (art. 25) y la inversión del sujeto pasivo exigen que el emisor
     * esté en el Registro de Operadores Intracomunitarios, y VELTO no lo está.
     *
     * La misma comprobación está en `functions/src/invoices/invoice-core.ts`, y
     * la que manda es esa: aquí es para que el formulario lo diga antes de
     * mandar, no para impedirlo. Duplicada como todo lo que la app y las
     * functions no pueden compartir.
     */
    if (!input.euRegimesEnabled && (regimen === 'exempt_eu' || regimen === 'reverse_charge')) {
      problems[`lines[${i}].taxRegime`] = 'invoices.problems.euRegimeNotAvailable';
    }
  });

  /**
   * Una entrega intracomunitaria exenta **necesita el NIF-IVA del comprador**.
   *
   * Es lo que sostiene la exención del art. 25: sin un NIF-IVA válido de otro
   * Estado miembro la operación no está exenta, y la factura estaría dejando de
   * repercutir un IVA que sí se debe.
   */
  if ((lines || []).some((l) => l.taxRegime === 'exempt_eu')) {
    const nif = (recipient.taxId || '').trim().toUpperCase();
    // Un NIF-IVA intracomunitario empieza por el código de país; el español
    // «ES» incluido, que en una entrega a otro Estado no valdría.
    if (!/^[A-Z]{2}/.test(nif) || nif.startsWith('ES')) {
      problems['recipientTaxId'] = 'invoices.problems.euVatIdRequired';
    }
  }

  // --- Forma de pago ---
  if (!input.paymentMethod) {
    problems['paymentMethod'] = 'invoices.problems.paymentMethodRequired';
  } else if (input.paymentMethod === 'cash') {
    const { total } = calculateInvoiceTotals(conContenido);
    if (!cashAllowedFor(total)) {
      problems['paymentMethod'] = 'invoices.problems.cashLimitExceeded';
    }
  }

  return problems;
}

/**
 * Lo que impide emitir una **rectificativa**, además de lo de una factura
 * normal.
 *
 * Las dos modalidades piden cosas distintas, y esa es la razón de que esto no
 * sea un `if` dentro de `validateInvoice()`: en `S` hay que informar de la base
 * y la cuota rectificadas, y en `I` **no** — son campos distintos del registro
 * que se enviará a la AEAT, no una preferencia de formato.
 */
export function validateRectifying(input: {
  rectifies?: { invoiceId?: string; fullNumber?: string } | null;
  rectifyingType?: RectifyingType | null;
  rectifyingReason?: RectifyingReason | null;
  rectifyingNote?: string | null;
  rectifiedBase?: number | null;
  rectifiedVat?: number | null;
}): FieldProblems {
  const problems: FieldProblems = {};

  if (!input.rectifies?.invoiceId) {
    problems['rectifies'] = 'invoices.problems.rectifiedInvoiceRequired';
  }
  if (!input.rectifyingType) {
    problems['rectifyingType'] = 'invoices.problems.rectifyingTypeRequired';
  }
  if (!input.rectifyingReason) {
    problems['rectifyingReason'] = 'invoices.problems.rectifyingReasonRequired';
  }
  // El motivo en palabras no lo pide la norma con ese nombre, pero el art. 15
  // exige que consten los elementos que se modifican. Una rectificativa sin
  // explicación es la que nadie sabe justificar dos años después.
  if (!input.rectifyingNote?.trim()) {
    problems['rectifyingNote'] = 'invoices.problems.rectifyingNoteRequired';
  }

  if (input.rectifyingType === 'S') {
    if (!(Number(input.rectifiedBase) >= 0)) {
      problems['rectifiedBase'] = 'invoices.problems.rectifiedBaseRequired';
    }
    if (!(Number(input.rectifiedVat) >= 0)) {
      problems['rectifiedVat'] = 'invoices.problems.rectifiedVatRequired';
    }
  }

  return problems;
}

/**
 * ¿Puede rectificarse esta factura?
 *
 * Solo una **emitida**. Un borrador se edita, y una ya rectificada no se
 * vuelve a rectificar desde aquí: para eso se rectifica la rectificativa, que
 * es una cadena distinta y hay que verla entera para no perderse.
 */
export function canRectify(invoice: Pick<Invoice, 'status' | 'kind'>): boolean {
  return invoice.status === 'issued' && invoice.kind === 'invoice';
}

/**
 * En una rectificativa **por diferencias los importes pueden ser negativos**:
 * es como se declara un ajuste a la baja, y como se anula una factura entera.
 *
 * Por eso `validateInvoice()` no vale tal cual para una rectificativa `I` — su
 * regla de «un negativo es una rectificativa, no una factura» es justamente lo
 * contrario aquí.
 */
export function allowsNegativeAmounts(kind: Invoice['kind'], type?: RectifyingType): boolean {
  return kind === 'rectifying' && type === 'I';
}

/**
 * Las líneas que **propone** una reserva, en el idioma del operador.
 *
 * Solo una propuesta: a partir de aquí la factura vive por su cuenta y el
 * importe se puede subir o bajar. Por eso esto devuelve líneas sueltas y no
 * escribe nada.
 */
export function linesFromReservation(input: {
  description: string;
  netPrice: number;
  vatRate: number;
}): InvoiceLine[] {
  return [
    {
      description: input.description,
      quantity: 1,
      unitPrice: roundMoney(Number(input.netPrice) || 0),
      vatRate: Number(input.vatRate) || 0
    }
  ];
}

/**
 * ¿El importe facturado se ha separado del de la reserva de origen?
 *
 * No bloquea nada —facturar otro importe es legítimo— pero se anota con autor
 * en la factura, igual que el descuento de fidelidad o una excepción de
 * workflow. Un descuadre entre Facturas y Pagos es información correcta; lo que
 * no puede pasar es tener que reconstruirlo de memoria un año después.
 */
export function differsFromReservation(
  invoiceTotal: number,
  reservationTotal: number | null | undefined
): boolean {
  if (reservationTotal === null || reservationTotal === undefined) return false;
  return roundMoney(invoiceTotal) !== roundMoney(reservationTotal);
}

/**
 * La fecha de operación solo se imprime **si difiere** de la de expedición.
 *
 * El art. 6.1.f) la exige en ese caso y solo en ese caso; ponerla siempre
 * repetiría la misma fecha dos veces en la cabecera.
 */
export function needsOperationDate(issueDate: Date, operationDate?: Date | null): boolean {
  if (!operationDate) return false;
  return issueDate.toDateString() !== operationDate.toDateString();
}

/**
 * ¿Se ha pasado el plazo de expedición?
 *
 * Cuando el destinatario es empresario o profesional, la factura debe expedirse
 * **antes del día 16 del mes siguiente** al devengo (art. 11 RD 1619/2012). A un
 * particular se le entrega cuando la pida, así que ahí no hay plazo que vigilar.
 *
 * No bloquea: **avisa**. La sanción por emitir tarde es del 2 % del importe, y
 * desde 2027 las fechas quedan registradas en la AEAT, así que llegar tarde pasa
 * de invisible a comprobable.
 */
export function invoiceDeadlineFor(operationDate: Date): Date {
  return new Date(operationDate.getFullYear(), operationDate.getMonth() + 1, 16);
}

export function isInvoiceOverdue(input: {
  recipientType: InvoiceRecipient['type'];
  operationDate: Date;
  now?: Date;
}): boolean {
  if (input.recipientType !== 'company') return false;
  const now = input.now || new Date();
  return now >= invoiceDeadlineFor(input.operationDate);
}

/** ¿Está emitida, y por tanto es intocable? */
export function isIssued(invoice: Pick<Invoice, 'status'>): boolean {
  return invoice.status !== 'draft';
}
