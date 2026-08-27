import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAT_RATE,
  MAX_LOYALTY_DISCOUNT_PERCENT,
  extractVat,
  normalizeLoyaltyDiscountPercent,
  resolveRentalPrice,
  resolveVatRate
} from './pricing.util';

// ---------------------------------------------------------------------------
// VAT
//
// The rule that costs money if broken: the tariff price ALREADY includes the
// tax. These tests exist mostly to pin that direction down.
// ---------------------------------------------------------------------------

describe('extractVat', () => {
  it('extracts the tax from the price instead of adding it', () => {
    const vat = extractVat(350);
    expect(vat.total).toBe(350);
    expect(vat.base).toBe(289.26);
    expect(vat.vat).toBe(60.74);
  });

  it('never lets the total drift: base + vat is exactly the price', () => {
    // 0.01 steps around a value that rounds badly if both parts are rounded
    // independently.
    for (const total of [0.01, 9.99, 45, 60, 318.02, 350, 1234.56]) {
      const vat = extractVat(total);
      expect(vat.base + vat.vat).toBeCloseTo(vat.total, 10);
    }
  });

  it('honours a rate other than the default', () => {
    const vat = extractVat(107, 0.07);
    expect(vat.base).toBe(100);
    expect(vat.vat).toBe(7);
  });

  it('treats a zero rate as no tax at all', () => {
    const vat = extractVat(100, 0);
    expect(vat.base).toBe(100);
    expect(vat.vat).toBe(0);
  });

  it('returns zeroes for a missing or nonsense price', () => {
    expect(extractVat(0).total).toBe(0);
    expect(extractVat(-50).base).toBe(0);
    expect(extractVat(Number.NaN).vat).toBe(0);
  });
});

describe('resolveVatRate', () => {
  it('falls back to the general rate when a reservation predates the field', () => {
    expect(resolveVatRate(undefined)).toBe(DEFAULT_VAT_RATE);
    expect(resolveVatRate(null)).toBe(DEFAULT_VAT_RATE);
  });

  it('respects a rate frozen on the reservation, including zero', () => {
    expect(resolveVatRate(0.07)).toBe(0.07);
    expect(resolveVatRate(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Loyalty discount
// ---------------------------------------------------------------------------

describe('normalizeLoyaltyDiscountPercent', () => {
  it('treats absent, zero and negative as no discount', () => {
    expect(normalizeLoyaltyDiscountPercent(undefined)).toBe(0);
    expect(normalizeLoyaltyDiscountPercent(null)).toBe(0);
    expect(normalizeLoyaltyDiscountPercent(0)).toBe(0);
    expect(normalizeLoyaltyDiscountPercent(-5)).toBe(0);
  });

  it('caps at the ceiling instead of writing a 100 % discount', () => {
    expect(normalizeLoyaltyDiscountPercent(100)).toBe(MAX_LOYALTY_DISCOUNT_PERCENT);
    expect(normalizeLoyaltyDiscountPercent(31)).toBe(MAX_LOYALTY_DISCOUNT_PERCENT);
  });

  it('keeps a valid percentage, rounded to two decimals', () => {
    expect(normalizeLoyaltyDiscountPercent(5)).toBe(5);
    expect(normalizeLoyaltyDiscountPercent(7.555)).toBe(7.56);
  });
});

// ---------------------------------------------------------------------------
// The whole price
// ---------------------------------------------------------------------------

describe('resolveRentalPrice', () => {
  it('charges the tariff when there is neither discount nor agreed price', () => {
    const price = resolveRentalPrice(350, 0);
    expect(price.finalPrice).toBe(350);
    expect(price.loyaltyDiscount).toBe(0);
    expect(price.manualAdjustment).toBe(0);
    expect(price.priceOverridden).toBe(false);
  });

  it('applies the loyalty discount to the tariff', () => {
    const price = resolveRentalPrice(350, 5);
    expect(price.loyaltyDiscountPercent).toBe(5);
    expect(price.loyaltyDiscount).toBe(-17.5);
    expect(price.discountedPrice).toBe(332.5);
    expect(price.finalPrice).toBe(332.5);
    expect(price.priceOverridden).toBe(false);
  });

  it('stacks the agreed price ON TOP of the loyalty discount, keeping both', () => {
    // 600 € tariff, 10 % loyalty → 540 €, closed by hand at 500 €.
    const price = resolveRentalPrice(600, 10, 500);
    expect(price.loyaltyDiscount).toBe(-60);
    expect(price.discountedPrice).toBe(540);
    expect(price.manualAdjustment).toBe(-40);
    expect(price.finalPrice).toBe(500);
    expect(price.priceOverridden).toBe(true);
  });

  it('measures the manual adjustment against the discounted price, not the tariff', () => {
    // The whole point of keeping them apart: merged, the contract could not
    // explain where 40 € of the 100 € gap came from.
    const price = resolveRentalPrice(600, 10, 500);
    expect(price.loyaltyDiscount + price.manualAdjustment).toBe(-100);
    expect(price.tariffPrice + price.loyaltyDiscount + price.manualAdjustment).toBe(
      price.finalPrice
    );
  });

  it('reports no override when the agreed price equals the discounted one', () => {
    const price = resolveRentalPrice(350, 5, 332.5);
    expect(price.priceOverridden).toBe(false);
    expect(price.manualAdjustment).toBe(0);
  });

  it('ignores an unusable override rather than writing a nonsense price', () => {
    expect(resolveRentalPrice(350, 0, -10).finalPrice).toBe(350);
    expect(resolveRentalPrice(350, 0, Number.NaN).finalPrice).toBe(350);
    expect(resolveRentalPrice(350, 0, null).finalPrice).toBe(350);
    expect(resolveRentalPrice(350, 0, undefined).finalPrice).toBe(350);
  });

  it('accepts an agreed price above the tariff', () => {
    const price = resolveRentalPrice(350, 0, 400);
    expect(price.manualAdjustment).toBe(50);
    expect(price.priceOverridden).toBe(true);
  });

  it('accepts a free rental agreed by hand', () => {
    const price = resolveRentalPrice(350, 0, 0);
    expect(price.finalPrice).toBe(0);
    expect(price.priceOverridden).toBe(true);
  });

  it('clamps a discount stored above the ceiling', () => {
    const price = resolveRentalPrice(100, 90);
    expect(price.loyaltyDiscountPercent).toBe(MAX_LOYALTY_DISCOUNT_PERCENT);
    expect(price.finalPrice).toBe(70);
  });

  it('rounds the discount to the cent', () => {
    const price = resolveRentalPrice(333.33, 7);
    expect(price.loyaltyDiscount).toBe(-23.33);
    expect(price.discountedPrice).toBe(310);
  });

  it('survives a vehicle with no pricing rule matched', () => {
    const price = resolveRentalPrice(0, 5);
    expect(price.finalPrice).toBe(0);
    expect(price.loyaltyDiscount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The two features together
// ---------------------------------------------------------------------------

describe('discounted price and VAT together', () => {
  it('taxes what the customer actually pays, not the tariff', () => {
    const price = resolveRentalPrice(600, 10, 500);
    const vat = extractVat(price.finalPrice);

    expect(vat.total).toBe(500);
    expect(vat.base).toBe(413.22);
    expect(vat.vat).toBe(86.78);
    expect(vat.base + vat.vat).toBeCloseTo(price.finalPrice, 10);
  });
});
