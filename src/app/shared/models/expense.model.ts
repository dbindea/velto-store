/**
 * Gastos de la empresa.
 *
 * Un gasto es **dinero que sale**, al revés que `payments`, que es dinero que
 * entra. Vive en la colección `expenses`, plana, para poder sumar por vehículo,
 * por reserva o del conjunto sin recorrer nada más.
 *
 * ⚠️ **El IVA de un gasto se EXTRAE del total; el de un alquiler se SUMA al
 * neto.** No es una incoherencia, son dos situaciones distintas: en un alquiler
 * el número que se negocia es el neto, y en un gasto lo que tienes en la mano es
 * una factura con su total. Escribir el total y que la aplicación deduzca base e
 * IVA es lo único que no obliga a hacer cuentas con el ticket delante. La
 * aritmética vive en `expense.util.ts` y está separada de `pricing.util.ts`
 * justo para que nadie confunda las dos direcciones.
 *
 * ⚠️ **El mantenimiento de vehículos NO se duplica aquí.** Una reparación se
 * sigue registrando en `vehicleMaintenance`, que es donde además vive el aviso
 * de la próxima ITV o la próxima revisión por km. El módulo de Gastos **lee** su
 * coste y lo suma; escribirla dos veces daría dos fuentes de verdad para el
 * mismo euro, que es exactamente lo que este proyecto no hace con el dinero.
 */

/** Contra qué se imputa el gasto. */
export type ExpenseScope = 'vehicle' | 'reservation' | 'general';

export type ExpenseCategory =
  // De un vehículo
  | 'insurance'
  | 'road_tax'
  | 'itv'
  | 'repair'
  | 'tires'
  | 'fuel'
  | 'cleaning'
  | 'parking'
  | 'tolls'
  | 'fine'
  // De la empresa
  | 'accounting'
  | 'advertising'
  | 'software'
  | 'phone'
  | 'bank_fees'
  | 'rent'
  | 'supplies'
  | 'other';

export type ExpensePaymentMethod =
  | 'cash'
  | 'bank_transfer'
  | 'card'
  | 'direct_debit'
  | 'other';

export interface Expense {
  id?: string;

  scope: ExpenseScope;

  /** Obligatorio si `scope === 'vehicle'`. */
  vehicleId?: string;
  /** Congelado al crear: un gasto de 2026 no puede cambiar de matrícula. */
  vehicleSnapshot?: {
    brand: string;
    model: string;
    plateNumber: string;
  };

  /** Obligatorio si `scope === 'reservation'`. */
  reservationId?: string;
  reservationSnapshot?: {
    /** `R-XXXXXX`, la misma convención que el justificante. */
    locator?: string;
    plateNumber?: string;
    clientName?: string;
  };

  category: ExpenseCategory;
  /** Lo que fue, en una línea: «Cambio de aceite», «Cuota gestoría julio». */
  concept: string;

  /**
   * Lo que se pagó, **con IVA**. Es lo que pone el ticket.
   *
   * `netAmount` y `vatAmount` se derivan de aquí y se guardan calculados, para
   * que un cambio futuro del tipo general no mueva un gasto ya registrado.
   */
  amount: number;
  netAmount: number;
  vatAmount: number;
  /** El tipo aplicado, como **fracción** (0.21). Congelado, como en la reserva. */
  vatRate: number;

  /** Fecha del gasto, no la de cuando se teclea. */
  date: any;

  supplier?: string;
  invoiceNumber?: string;
  paymentMethod?: ExpensePaymentMethod;

  /** Factura o ticket en Storage: `expenses/{expenseId}/{ts}-{fichero}`. */
  documentUrl?: string;
  documentPath?: string;

  notes?: string;

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

/**
 * Una fila de la lista de gastos.
 *
 * Puede venir de la colección `expenses` o de un mantenimiento ya realizado. La
 * distinción no es cosmética: **lo que nace en mantenimiento se edita en
 * mantenimiento**, y por eso la fila lo dice y lleva enlace a su ficha en vez de
 * un botón de editar que escribiría en el sitio equivocado.
 */
export interface ExpenseRow {
  id: string;
  origin: 'expense' | 'maintenance';
  scope: ExpenseScope;
  category: ExpenseCategory;
  concept: string;
  /** Bruto, con IVA. */
  amount: number;
  /**
   * Desglose, **solo si se conoce**.
   *
   * Un coste de mantenimiento se teclea como un importe suelto, sin tipo de
   * IVA: inventarle un 21 % sería inventarse una base imponible que la gestoría
   * daría por buena. Cuando no se sabe, se dice que no se sabe.
   */
  netAmount?: number;
  vatAmount?: number;
  date: Date | null;
  vehicleId?: string;
  vehiclePlate?: string;
  reservationId?: string;
  supplier?: string;
  /** Para llevar a la ficha de origen cuando `origin === 'maintenance'`. */
  sourceVehicleId?: string;
}

export const EXPENSE_SCOPE_LABELS: Record<ExpenseScope, string> = {
  vehicle: 'expenses.scope.vehicle',
  reservation: 'expenses.scope.reservation',
  general: 'expenses.scope.general'
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  insurance: 'expenses.category.insurance',
  road_tax: 'expenses.category.roadTax',
  itv: 'expenses.category.itv',
  repair: 'expenses.category.repair',
  tires: 'expenses.category.tires',
  fuel: 'expenses.category.fuel',
  cleaning: 'expenses.category.cleaning',
  parking: 'expenses.category.parking',
  tolls: 'expenses.category.tolls',
  fine: 'expenses.category.fine',
  accounting: 'expenses.category.accounting',
  advertising: 'expenses.category.advertising',
  software: 'expenses.category.software',
  phone: 'expenses.category.phone',
  bank_fees: 'expenses.category.bankFees',
  rent: 'expenses.category.rent',
  supplies: 'expenses.category.supplies',
  other: 'expenses.category.other'
};

export const EXPENSE_CATEGORY_ICONS: Record<ExpenseCategory, string> = {
  insurance: 'pi pi-shield',
  road_tax: 'pi pi-building',
  itv: 'pi pi-verified',
  repair: 'pi pi-wrench',
  tires: 'pi pi-circle',
  fuel: 'pi pi-bolt',
  cleaning: 'pi pi-sparkles',
  parking: 'pi pi-map-marker',
  tolls: 'pi pi-directions',
  fine: 'pi pi-exclamation-triangle',
  accounting: 'pi pi-briefcase',
  advertising: 'pi pi-megaphone',
  software: 'pi pi-desktop',
  phone: 'pi pi-phone',
  bank_fees: 'pi pi-credit-card',
  rent: 'pi pi-home',
  supplies: 'pi pi-box',
  other: 'pi pi-file'
};

export const EXPENSE_PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  cash: 'expenses.method.cash',
  bank_transfer: 'expenses.method.bankTransfer',
  card: 'expenses.method.card',
  direct_debit: 'expenses.method.directDebit',
  other: 'expenses.method.other'
};

/**
 * Las categorías que se ofrecen según contra qué se impute.
 *
 * No es una validación —nada se rompe si un gasto general lleva «neumáticos»—
 * sino una lista más corta en el desplegable: con dieciocho categorías, la
 * mitad no tienen sentido en el caso que el operador tiene delante.
 */
export const EXPENSE_CATEGORIES_BY_SCOPE: Record<ExpenseScope, ExpenseCategory[]> = {
  vehicle: [
    'insurance',
    'road_tax',
    'itv',
    'repair',
    'tires',
    'fuel',
    'cleaning',
    'parking',
    'tolls',
    'fine',
    'other'
  ],
  reservation: ['fuel', 'cleaning', 'parking', 'tolls', 'fine', 'repair', 'other'],
  general: [
    'accounting',
    'advertising',
    'software',
    'phone',
    'bank_fees',
    'rent',
    'supplies',
    'other'
  ]
};
