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
import { roundMoney } from '@shared/utils/payment-summary.util';

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
 * ⚠️ **Tariff prices are NET — VAT is added on top.**
 *
 * This is the opposite of how the app started. A vehicle priced at 30 €/day
 * means 30 € of taxable base, and the customer pays 36,30 €. The reason is
 * commercial: the round number is the one that gets negotiated, and a customer
 * who does not want an invoice pays exactly that round net.
 *
 * ⚠️ **Reservations created before this change stored the tariff as
 * VAT-INCLUSIVE**, and they must keep reading that way or every contract
 * already signed stops adding up. The direction is therefore frozen per
 * reservation in `pricingSnapshot.tariffIncludesVat`; missing means the old,
 * inclusive behaviour. Never infer it from anything else.
 */
export const TARIFF_INCLUDES_VAT = false;

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
 * Split a VAT-inclusive amount into base and tax.
 *
 * `vat` is derived by subtraction rather than by multiplying the base, so
 * `base + vat === total` exactly. Rounding both independently drifts by a cent
 * often enough to be noticed on a contract.
 */
export function extractVat(total: number, rate: number = DEFAULT_VAT_RATE): VatBreakdown {
  const safeTotal = isFinite(total) && total > 0 ? roundMoney(total) : 0;
  const safeRate = isFinite(rate) && rate > 0 ? rate : 0;
  const base = roundMoney(safeTotal / (1 + safeRate));

  return {
    rate: safeRate,
    base,
    vat: roundMoney(safeTotal - base),
    total: safeTotal
  };
}

/**
 * Add VAT to a net amount: the direction the tariff works in now.
 *
 * `vat` is derived by subtraction from the rounded total for the same reason
 * `extractVat` does it: `base + vat === total` has to hold to the cent, or the
 * contract does not add up.
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
 * The tax breakdown of a reservation, in whichever direction that reservation
 * was created with.
 *
 * Reading `tariffIncludesVat` off the snapshot rather than off today's constant
 * is what keeps old contracts intact: they were priced VAT-inclusive and have
 * to keep splitting that way.
 */
export function vatBreakdownOf(snapshot: {
  finalPrice?: number;
  netPrice?: number;
  vatRate?: number;
  tariffIncludesVat?: boolean;
}): VatBreakdown {
  const rate = resolveVatRate(snapshot.vatRate);

  // Absent means "created before the change", i.e. VAT-inclusive tariffs.
  const includesVat = snapshot.tariffIncludesVat ?? true;
  if (includesVat) return extractVat(snapshot.finalPrice ?? 0, rate);

  // Exclusive: the net is the number that was agreed, so it drives the split.
  return addVat(snapshot.netPrice ?? 0, rate);
}

/**
 * The rate to apply to a reservation created before VAT was recorded.
 *
 * Reservations from before this feature have no `vatRate` in their snapshot,
 * but their price was always VAT-inclusive at the general rate — the field
 * records the rate, it never changed it. Falling back keeps old contracts and
 * old detail screens showing the same figures as new ones.
 */
export function resolveVatRate(rate: number | null | undefined): number {
  return typeof rate === 'number' && isFinite(rate) && rate >= 0 ? rate : DEFAULT_VAT_RATE;
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
 * The two discounts stay SEPARATE on purpose. They answer different questions
 * — "what is this customer entitled to" versus "what did we close this deal
 * at" — and the contract has to be able to justify each line on its own. Merged
 * into a single number, the VAT breakdown could not explain where the price
 * came from.
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

  return {
    tariffPrice: tariff,
    loyaltyDiscountPercent: percent,
    loyaltyDiscount,
    discountedPrice,
    manualAdjustment: hasOverride ? roundMoney(netPrice - discountedPrice) : 0,
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
 * Validate pricing rules and return array of error messages.
 * Returns empty array if all validations pass.
 */
export function validatePricingRules(rules: VehiclePricingRule[]): string[] {
  const errors: string[] = [];

  if (!rules || rules.length === 0) {
    errors.push('Debe existir al menos una regla de precio');
    return errors;
  }

  const sorted = sortPricingRules(rules);

  for (let i = 0; i < sorted.length; i++) {
    const rule = sorted[i];

    // Check minDays
    if (!rule.minDays || rule.minDays < 1) {
      errors.push(`La regla "${rule.label || `fila ${i + 1}`}" debe tener días mínimos mayor a 0`);
    }

    // Check pricePerDay
    if (!rule.pricePerDay || rule.pricePerDay <= 0) {
      errors.push(`La regla "${rule.label || `fila ${i + 1}`}" debe tener precio por día mayor a 0`);
    }

    // Check maxDays
    if (rule.maxDays !== null && rule.maxDays < rule.minDays) {
      errors.push(`La regla "${rule.label || `fila ${i + 1}`}" tiene días máximos menor a días mínimos`);
    }

    // Check for overlaps with next rule
    if (i < sorted.length - 1 && rule.maxDays !== null) {
      const nextRule = sorted[i + 1];
      if (rule.maxDays >= nextRule.minDays) {
        errors.push(`Los rangos "${rule.label}" y "${nextRule.label}" se solapan`);
      }
    }
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