/**
 * Pricing utilities for vehicle rental calculations.
 * 
 * Each vehicle has its own pricing rules (stored in Firestore).
 * When a reservation is created, calculateBasePrice() will be used
 * to determine the price based on the number of calendar days.
 * 
 * IMPORTANT: Reservations should save a pricingSnapshot so that
 * future changes to vehicle pricing rules don't affect past reservations.
 */

import { VehiclePricingRule } from '@shared/models/vehicle.model';
// El primitivo del dinero, no el resumen de pagos: este fichero es el que aquel
// importa para el IVA del servicio a domicilio, y cogerlo de allí los dejaría
// importándose en círculo. Ver `money.util.ts`.
import { roundMoney } from '@shared/utils/money.util';
import { TranslatableMessage } from '@shared/utils/i18n-params.util';

/**
 * Spanish standard VAT rate, as a FRACTION (0.21 = 21 %).
 *
 * Renting a vehicle without a driver is taxed at the general rate on the
 * mainland. The rate is frozen into `pricingSnapshot.vatRate` when the
 * reservation is created, so a future change never moves the figures of a
 * contract already signed.
 */
export const DEFAULT_VAT_RATE = 0.21;

/**
 * Ceiling for the per-client loyalty discount, as a PERCENTAGE (30 = 30 %).
 * Note the different convention from `DEFAULT_VAT_RATE`, which is a fraction.
 */
export const MAX_LOYALTY_DISCOUNT_PERCENT = 30;

export interface VatBreakdown {
  /** The rate applied, as a fraction. */
  rate: number;
  /** Taxable base, VAT excluded. */
  base: number;
  /** The tax itself. */
  vat: number;
  /** What the customer pays. Always `base + vat`, to the cent. */
  total: number;
}

/**
 * Add VAT to a net amount.
 *
 * `vat` is derived by subtraction from the rounded total rather than by
 * multiplying: `base + vat === total` has to hold to the cent, and rounding
 * both parts independently drifts often enough to be noticed on a contract.
 */
export function addVat(net: number, rate: number = DEFAULT_VAT_RATE): VatBreakdown {
  const safeNet = isFinite(net) && net > 0 ? roundMoney(net) : 0;
  const safeRate = isFinite(rate) && rate > 0 ? rate : 0;
  const total = roundMoney(safeNet * (1 + safeRate));

  return {
    rate: safeRate,
    base: safeNet,
    vat: roundMoney(total - safeNet),
    total
  };
}

/**
 * The tax breakdown of a reservation.
 *
 * ⚠️ **The tariff is NET and VAT is added on top.** A vehicle at 30 €/day means
 * 30 € of taxable base and the customer pays 36,30 €. The reason is commercial:
 * the round number is the one that gets negotiated, and a customer who does not
 * want an invoice pays exactly that round net.
 *
 * `netPrice` is the number that was agreed, so it is what drives the split —
 * never `finalPrice`, which is derived from it.
 */
export function vatBreakdownOf(snapshot: { netPrice?: number; vatRate?: number }): VatBreakdown {
  return addVat(snapshot.netPrice ?? 0, resolveVatRate(snapshot.vatRate));
}

/**
 * The rate to apply, defaulting to the general one.
 *
 * The rate is frozen per reservation in `pricingSnapshot.vatRate` so that a
 * future change of the general rate never moves a contract already signed. The
 * fallback is a safety net for a snapshot that somehow lacks it, not a
 * compatibility path.
 */
export function resolveVatRate(rate: number | null | undefined): number {
  return typeof rate === 'number' && isFinite(rate) && rate >= 0 ? rate : DEFAULT_VAT_RATE;
}

/**
 * ¿Este alquiler lleva IVA?
 *
 * ⚠️ **El tipo a 0 es la única señal, y no hace falta otra.** Se pensó en un
 * campo aparte —`vatExempt`— y sobra: dos datos para un mismo hecho son dos
 * datos que pueden discrepar, y el día que discrepen el contrato diría una cosa
 * y el importe otra. Un tipo de cero **es** «aquí no hay IVA», y `resolveVatRate`
 * ya lo respeta en vez de caer al general.
 *
 * ⚠️ **Y decide TEXTO, no solo aritmética.** Con el tipo a 0 la resta ya sale
 * bien sola; para lo que existe esta función es para que el contrato, el
 * presupuesto y el justificante **no mencionen el impuesto**: ni la fila del
 * desglose, ni la nota que explica que se suma, ni el «(no sujeta a IVA)» de la
 * fianza. Es la lección de F-36 —una frase sobrevivió al cambio de convención y
 * el presupuesto siguió diciendo lo contrario de lo que sumaba—, con la
 * diferencia de que ahora la frase y el número los decide el mismo dato.
 *
 * El caso es de Dorel: al cliente que no va a pedir factura se le cobran los
 * 200 € pactados y el papel no habla de impuestos.
 */
export function chargesVat(snapshot: { vatRate?: number | null }): boolean {
  return resolveVatRate(snapshot?.vatRate) > 0;
}

// ---------------------------------------------------------------------------
// Entrega y recogida a domicilio
// ---------------------------------------------------------------------------

export interface DeliveryFeeBreakdown {
  /** Lo tecleado por llevar el coche, y lo que el cliente paga por ello. */
  pickupNet: number;
  pickupGross: number;
  /** Lo tecleado por ir a recogerlo, y lo que el cliente paga por ello. */
  returnNet: number;
  returnGross: number;
  /** Los dos trayectos juntos. */
  net: number;
  vat: number;
  gross: number;
  /** Verdadero si se cobra algo por alguno de los dos trayectos. */
  any: boolean;
}

/**
 * Lo que cuesta llevar el coche al cliente y volver a por él.
 *
 * ⚠️ **Los importes tecleados son NETOS y el IVA se SUMA**, igual que la tarifa
 * del alquiler: el operador escribe el número redondo que pactó por teléfono y
 * el cliente paga eso más impuesto. Con el tipo de la reserva a 0 —la casilla
 * «sin IVA»— paga exactamente lo tecleado. Extraer el IVA de lo tecleado, que es
 * lo que hace un gasto, daría una cifra creíble y equivocada; son las dos
 * direcciones que `expense.util.ts` y este fichero mantienen separadas a
 * propósito.
 *
 * ⚠️ **Cada trayecto se redondea por su cuenta antes de sumarlos**, porque cada
 * uno abre su propia fila de cobro: si el total se redondeara y las filas no,
 * el contrato y los pagos discreparían en un céntimo — y un céntimo que no
 * cuadra obliga a mirar dónde está el error cada vez.
 *
 * ⚠️ **Y no entra en `pricingSnapshot`.** Ver la nota de `ReservationDeliveryFees`:
 * el reparto con el dueño del coche se calcula sobre el neto del alquiler, y el
 * desplazamiento lo pone la agencia, no el coche.
 */
export function deliveryFeeBreakdown(
  fees: { pickupFee?: number | null; returnFee?: number | null } | null | undefined,
  vatRate?: number | null
): DeliveryFeeBreakdown {
  const rate = resolveVatRate(vatRate);
  const ida = addVat(sanearImporte(fees?.pickupFee), rate);
  const vuelta = addVat(sanearImporte(fees?.returnFee), rate);

  return {
    pickupNet: ida.base,
    pickupGross: ida.total,
    returnNet: vuelta.base,
    returnGross: vuelta.total,
    net: roundMoney(ida.base + vuelta.base),
    vat: roundMoney(ida.vat + vuelta.vat),
    gross: roundMoney(ida.total + vuelta.total),
    any: ida.base > 0 || vuelta.base > 0
  };
}

/**
 * Un importe de servicio tal y como puede llegar de un formulario.
 *
 * ⚠️ `Number(null)` y `Number('')` son **0**, no `NaN`, así que un campo vacío
 * ya significa «no se cobra» sin ayuda. Lo que sí hay que atajar es un negativo:
 * un suplemento en negativo es un descuento que nadie pactó, y se colaría en el
 * contrato como una línea a favor del cliente.
 */
function sanearImporte(valor: number | null | undefined): number {
  const n = Number(valor);
  return isFinite(n) && n > 0 ? roundMoney(n) : 0;
}

/**
 * Clamp a loyalty discount to something sane: never negative, never above the
 * ceiling, at most two decimals.
 */
export function normalizeLoyaltyDiscountPercent(percent: number | null | undefined): number {
  if (percent === null || percent === undefined) return 0;
  if (!isFinite(percent) || percent <= 0) return 0;
  return Math.min(roundMoney(percent), MAX_LOYALTY_DISCOUNT_PERCENT);
}

export interface RentalPriceBreakdown {
  /**
   * What the vehicle's pricing rules say, before any discount. NET: a vehicle
   * at 30 €/day for 7 days is 210 € of taxable base.
   */
  tariffPrice: number;
  /** The clamped percentage actually applied (5 = 5 %). 0 when there is none. */
  loyaltyDiscountPercent: number;
  /** Signed money taken off by the loyalty discount. Negative, or 0. Net. */
  loyaltyDiscount: number;
  /** Tariff after the loyalty discount, before any hand-agreed price. Net. */
  discountedPrice: number;
  /** Signed difference between the agreed price and `discountedPrice`. Net. */
  manualAdjustment: number;
  /**
   * Taxable base actually agreed — the round number the operator negotiates
   * and the amount a customer who wants no invoice pays.
   */
  netPrice: number;
  /** The tax on `netPrice`. */
  vatAmount: number;
  /** What the customer actually pays: `netPrice + vatAmount`. */
  finalPrice: number;
  /** True when an operator overrode `discountedPrice` by hand. */
  priceOverridden: boolean;
}

/**
 * The one place that decides what a rental costs.
 *
 * Order of application: tariff → loyalty discount → hand-agreed price on top.
 *
 * ⚠️ **Un precio acordado a mano DEROGA el descuento de fidelidad**, no se suma
 * a él. Decisión de Dorel del 19 de septiembre de 2026, y el caso que la motiva
 * sale en el contrato:
 *
 *     Importe alquiler (tarifa):   60,00 €
 *     Descuento fidelidad (5 %):   -3,00 €
 *     Ajuste acordado:             +3,00 €
 *     TOTAL                        60,00 €
 *
 * Aritméticamente impecable y comercialmente absurdo: el cliente lee que le han
 * hecho un descuento y se lo han vuelto a sumar. Y no es un caso raro — sale
 * **siempre** que el precio a mano coincide con la tarifa, que es lo más normal
 * al cerrar un trato en un número redondo.
 *
 * Con la derogación, el ajuste se mide contra la **tarifa**: ese contrato no
 * imprime ninguna línea y dice 60,00 €, que es lo que se pactó. Y un trato a 50 €
 * imprime una sola línea de −10,00 €, que es lo que de verdad pasó.
 *
 * ⚠️ **No mueve ni un céntimo.** `netPrice` sigue siendo el precio acordado
 * pase lo que pase; lo único que cambia es **cómo se descompone** para
 * explicarlo. Por eso es seguro: ningún alquiler vale distinto después de esto.
 *
 * ⚠️ **El porcentaje SÍ se conserva** en `loyaltyDiscountPercent`. A lo que se
 * renuncia es al dinero, no al dato: dentro de seis meses hay que poder decir
 * que este cliente tenía un 5 % y que aun así se cerró en 60.
 *
 * `agreedPrice` of `undefined`/`null` means "no override": use the discounted
 * tariff. A negative or unparseable override is ignored rather than written as
 * a nonsense price.
 *
 * ⚠️ **Everything up to `netPrice` is NET.** The tariff, both discounts and the
 * hand-agreed price are all taxable base, so the number an operator types is
 * the round one they agreed over the phone. VAT is added last, and only
 * `finalPrice` is what the customer pays.
 */
export function resolveRentalPrice(
  tariffPrice: number,
  loyaltyPercent: number | null | undefined,
  agreedPrice?: number | null,
  vatRate: number = DEFAULT_VAT_RATE
): RentalPriceBreakdown {
  const tariff = isFinite(tariffPrice) && tariffPrice > 0 ? roundMoney(tariffPrice) : 0;
  const percent = normalizeLoyaltyDiscountPercent(loyaltyPercent);
  // `tariff > 0` also keeps the result off negative zero, which would be
  // written to Firestore as `-0` and read back as a discount that is not one.
  const loyaltyDiscount = percent > 0 && tariff > 0 ? -roundMoney((tariff * percent) / 100) : 0;
  const discountedPrice = roundMoney(tariff + loyaltyDiscount);

  const hasOverride =
    agreedPrice !== null &&
    agreedPrice !== undefined &&
    isFinite(agreedPrice) &&
    agreedPrice >= 0 &&
    roundMoney(agreedPrice) !== discountedPrice;

  const netPrice = hasOverride ? roundMoney(agreedPrice!) : discountedPrice;
  const vat = addVat(netPrice, vatRate);

  /**
   * ⚠️ **Con precio a mano, el descuento de fidelidad no se aplica** y el ajuste
   * se mide contra la tarifa. Ver la nota de arriba: lo que se evita es un
   * contrato que resta 3 € y los vuelve a sumar.
   *
   * La **detección** del override sí sigue comparando contra el precio con
   * descuento, y tiene que ser así: teclear exactamente los 57 € que ya ofrecía
   * la pantalla no es negociar nada, es aceptar la tarifa con su descuento.
   */
  return {
    tariffPrice: tariff,
    loyaltyDiscountPercent: percent,
    loyaltyDiscount: hasOverride ? 0 : loyaltyDiscount,
    discountedPrice,
    manualAdjustment: hasOverride ? roundMoney(netPrice - tariff) : 0,
    netPrice,
    vatAmount: vat.vat,
    finalPrice: vat.total,
    priceOverridden: hasOverride
  };
}

/**
 * Default pricing rules for new vehicles.
 * These are the standard rates that can be customized per vehicle.
 */
export function getDefaultPricingRules(): VehiclePricingRule[] {
  return [
    { minDays: 1, maxDays: 1, pricePerDay: 60, label: '1 día' },
    { minDays: 2, maxDays: 3, pricePerDay: 55, label: '2-3 días' },
    { minDays: 4, maxDays: 7, pricePerDay: 50, label: '4-7 días' },
    { minDays: 8, maxDays: 15, pricePerDay: 45, label: '8-15 días' },
    { minDays: 16, maxDays: 30, pricePerDay: 38, label: '16-30 días' },
    { minDays: 31, maxDays: null, pricePerDay: 35, label: '+30 días' }
  ];
}

/**
 * Sort pricing rules by minDays ascending.
 */
export function sortPricingRules(rules: VehiclePricingRule[]): VehiclePricingRule[] {
  return [...rules].sort((a, b) => a.minDays - b.minDays);
}

/**
 * Cómo se nombra un tramo en un mensaje de error.
 *
 * El rótulo que escribió el operador si lo hay, y si no el rango en crudo. Antes
 * era `fila ${i + 1}`, que además de ser español dentro del código contaba desde
 * la lista **ya ordenada**: con las filas en otro orden en pantalla, señalaba una
 * distinta de la que fallaba.
 */
function ruleName(rule: VehiclePricingRule): string {
  if (rule.label?.trim()) return rule.label.trim();
  return rule.maxDays === null ? `${rule.minDays}+` : `${rule.minDays}-${rule.maxDays}`;
}

/**
 * Qué impide que estos tramos sirvan para cobrar un alquiler.
 *
 * ⚠️ **Un hueco entre tramos alquila el coche a 0 €, y en silencio.** Es el
 * fallo que motivó las dos comprobaciones nuevas del 24 de septiembre de 2026:
 * con los tramos `1-1` y `3-5`, un alquiler de **2 días** no encuentra regla,
 * `findPricingRuleByDays()` devuelve `null` y `calculateBasePrice()` contesta
 * `basePrice: 0`. Nada falla: la reserva se crea, el contrato se genera y el
 * coche sale a la calle gratis. Lo mismo si el último tramo tiene días máximos
 * —un alquiler más largo que ese techo cae fuera de todo—.
 *
 * Por eso los tramos tienen que **cubrir de 1 a infinito sin interrupción**:
 * empezar en el día 1, encadenar sin huecos y terminar en un tramo abierto
 * (`maxDays: null`). No es una preferencia de forma, es la única manera de que
 * `findPricingRuleByDays()` no pueda contestar `null`.
 *
 * ⚠️ **Y `minimumRentalDays` no vale como excusa para no empezar en el día 1**:
 * hoy no lo comprueba nadie al crear una reserva, así que un alquiler de un día
 * entra igual. Si algún día se hiciera valer, esta comprobación se revisa
 * entonces, no antes.
 *
 * Devuelve claves de i18n con sus sustituciones, no frases: esto se pinta en la
 * ficha del vehículo y la lee un operador que puede tener la aplicación en
 * rumano. Lista vacía = los tramos sirven.
 */
export function validatePricingRules(rules: VehiclePricingRule[]): TranslatableMessage[] {
  const errors: TranslatableMessage[] = [];

  if (!rules || rules.length === 0) {
    return [{ key: 'vehicles.errors.pricingNoRules' }];
  }

  const sorted = sortPricingRules(rules);

  for (let i = 0; i < sorted.length; i++) {
    const rule = sorted[i];
    const name = ruleName(rule);

    if (!rule.minDays || rule.minDays < 1) {
      errors.push({ key: 'vehicles.errors.pricingMinDays', params: { rule: name } });
    }

    if (!rule.pricePerDay || rule.pricePerDay <= 0) {
      errors.push({ key: 'vehicles.errors.pricingPrice', params: { rule: name } });
    }

    if (rule.maxDays !== null && rule.maxDays < rule.minDays) {
      errors.push({ key: 'vehicles.errors.pricingMaxBeforeMin', params: { rule: name } });
    }

    // Solape con el siguiente.
    if (i < sorted.length - 1 && rule.maxDays !== null) {
      const next = sorted[i + 1];
      if (rule.maxDays >= next.minDays) {
        errors.push({
          key: 'vehicles.errors.pricingOverlap',
          params: { rule: name, next: ruleName(next) }
        });
      }
    }
  }

  /**
   * La cobertura se mira solo si los tramos son coherentes de uno en uno. Con un
   * `maxDays` menor que su `minDays` de por medio, «falta cubrir del día 7 al 3»
   * es ruido encima del error de verdad, y el operador acaba persiguiendo el
   * mensaje equivocado.
   */
  if (errors.length > 0) return errors;

  if (sorted[0].minDays !== 1) {
    errors.push({
      key: 'vehicles.errors.pricingDoesNotStartAtOne',
      params: { from: String(sorted[0].minDays) }
    });
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const rule = sorted[i];
    const next = sorted[i + 1];
    // Un tramo abierto antes del último se come todo lo que viene detrás: el
    // hueco no existe, pero los tramos siguientes no se aplican nunca.
    if (rule.maxDays === null) {
      errors.push({
        key: 'vehicles.errors.pricingOpenNotLast',
        params: { rule: ruleName(rule), next: ruleName(next) }
      });
      continue;
    }
    if (rule.maxDays + 1 < next.minDays) {
      const desde = rule.maxDays + 1;
      const hasta = next.minDays - 1;
      /**
       * Un solo día tiene su propia frase. «Faltan los días 3 a 3» es lo que
       * salía, y se lee como un error del programa antes que como el aviso que
       * es — además de ser el caso más común, porque el hueco aparece al quitar
       * un día del final de un tramo.
       */
      errors.push(
        desde === hasta
          ? { key: 'vehicles.errors.pricingGapSingle', params: { day: String(desde) } }
          : { key: 'vehicles.errors.pricingGap', params: { from: String(desde), to: String(hasta) } }
      );
    }
  }

  const last = sorted[sorted.length - 1];
  if (last.maxDays !== null) {
    errors.push({
      key: 'vehicles.errors.pricingLastNotOpen',
      params: { rule: ruleName(last), days: String(last.maxDays + 1) }
    });
  }

  return errors;
}

/**
 * Find the pricing rule that applies to a given number of days.
 * Returns null if no rule matches.
 */
export function findPricingRuleByDays(
  rules: VehiclePricingRule[],
  totalDays: number
): VehiclePricingRule | null {
  if (!rules || totalDays < 1) return null;

  const sorted = sortPricingRules(rules);

  for (const rule of sorted) {
    if (totalDays >= rule.minDays) {
      if (rule.maxDays === null || totalDays <= rule.maxDays) {
        return rule;
      }
    }
  }

  return null;
}

/**
 * Calculate the base price for a given number of days.
 * Returns detailed calculation info.
 */
export function calculateBasePrice(
  rules: VehiclePricingRule[],
  totalDays: number
): {
  totalDays: number;
  appliedRule: VehiclePricingRule | null;
  pricePerDay: number;
  basePrice: number;
} {
  const rule = findPricingRuleByDays(rules, totalDays);

  if (!rule) {
    return {
      totalDays,
      appliedRule: null,
      pricePerDay: 0,
      basePrice: 0
    };
  }

  return {
    totalDays,
    appliedRule: rule,
    pricePerDay: rule.pricePerDay,
    basePrice: totalDays * rule.pricePerDay
  };
}

/**
 * Get the lowest price per day from a list of rules.
 * Useful for "from X €/day" display.
 */
export function getLowestPricePerDay(rules: VehiclePricingRule[]): number | null {
  if (!rules || rules.length === 0) return null;
  
  return Math.min(...rules.map(r => r.pricePerDay));
}

/**
 * Cuánto habría que cobrar por los kilómetros de más, si se cobraran.
 *
 * ⚠️ **Devuelve una sugerencia, no un cargo.** La decisión de Dorel del 31 de
 * agosto de 2026 es **no cobrar el kilometraje extra durante el primer año**,
 * para captar clientela. Y el motivo de que esto no rellene el campo es suyo y
 * es bueno: un importe prerrellenado se guarda de un despiste y le acaba
 * cobrando al cliente algo que no quería cobrarle. Un texto no se guarda solo.
 *
 * Así que esto alimenta un aviso bajo el campo; quien lo escribe es el
 * operador, a mano y a sabiendas.
 *
 * Devuelve `null` cuando no hay nada que sugerir, que incluye el caso de que
 * falte cualquier dato: sin kilómetros de entrega, sin tarifa o sin días no se
 * inventa una cifra.
 */
export function suggestExtraKmCharge(input: {
  pickupKm?: number;
  returnKm?: number;
  totalDays?: number;
  includedKmPerDay?: number;
  extraKmPrice?: number;
}): { extraKm: number; amount: number; includedKm: number } | null {
  const { pickupKm, returnKm, totalDays, includedKmPerDay, extraKmPrice } = input;

  if (
    pickupKm === undefined ||
    returnKm === undefined ||
    !totalDays ||
    !includedKmPerDay ||
    !extraKmPrice
  ) {
    return null;
  }

  const driven = returnKm - pickupKm;
  if (driven <= 0) return null;

  const includedKm = includedKmPerDay * totalDays;
  const extraKm = driven - includedKm;
  if (extraKm <= 0) return null;

  return {
    extraKm,
    includedKm,
    amount: roundMoney(extraKm * extraKmPrice)
  };
}
