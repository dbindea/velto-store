import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAT_RATE,
  addVat,
  vatBreakdownOf,
  MAX_LOYALTY_DISCOUNT_PERCENT,
  normalizeLoyaltyDiscountPercent,
  resolveRentalPrice,
  resolveVatRate,
  suggestExtraKmCharge
} from './pricing.util';

// ---------------------------------------------------------------------------
// VAT
//
// The rule that costs money if broken: the tariff price is NET and the tax is
// ADDED to it. These tests exist mostly to pin that direction down.
// ---------------------------------------------------------------------------

describe('resolveVatRate', () => {
  it('falls back to the general rate when no rate is frozen', () => {
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
  // ⚠️ Tariffs are NET now. A vehicle at 30 €/day for 7 days is 210 € of base
  // and the customer pays 254,10 €. Everything below is written in those terms.

  it('adds VAT to the tariff instead of extracting it', () => {
    const price = resolveRentalPrice(210, 0);
    expect(price.netPrice).toBe(210);
    expect(price.vatAmount).toBe(44.1);
    expect(price.finalPrice).toBe(254.1);
  });

  it('keeps the net round, which is the whole point', () => {
    // The customer who wants no invoice pays exactly this.
    expect(resolveRentalPrice(30, 0).netPrice).toBe(30);
    expect(resolveRentalPrice(210, 0).netPrice).toBe(210);
  });

  it('applies the loyalty discount to the net, before tax', () => {
    const price = resolveRentalPrice(200, 10);
    expect(price.loyaltyDiscount).toBe(-20);
    expect(price.discountedPrice).toBe(180);
    expect(price.netPrice).toBe(180);
    expect(price.finalPrice).toBe(217.8);
  });

  it('stacks the agreed net ON TOP of the loyalty discount, keeping both', () => {
    // 600 € tariff, 10 % loyalty → 540 €, closed by hand at 500 € net.
    const price = resolveRentalPrice(600, 10, 500);
    expect(price.loyaltyDiscount).toBe(-60);
    expect(price.discountedPrice).toBe(540);
    expect(price.manualAdjustment).toBe(-40);
    expect(price.netPrice).toBe(500);
    expect(price.finalPrice).toBe(605);
    expect(price.priceOverridden).toBe(true);
  });

  it('measures the manual adjustment against the discounted net, not the tariff', () => {
    const price = resolveRentalPrice(600, 10, 500);
    expect(price.tariffPrice + price.loyaltyDiscount + price.manualAdjustment).toBe(
      price.netPrice
    );
  });

  it('reports no override when the agreed net equals the discounted one', () => {
    const price = resolveRentalPrice(200, 10, 180);
    expect(price.priceOverridden).toBe(false);
    expect(price.manualAdjustment).toBe(0);
  });

  it('ignores an unusable override rather than writing a nonsense price', () => {
    for (const bad of [-10, Number.NaN, null, undefined]) {
      expect(resolveRentalPrice(210, 0, bad as any).netPrice).toBe(210);
    }
  });

  it('accepts an agreed net above the tariff', () => {
    const price = resolveRentalPrice(200, 0, 250);
    expect(price.manualAdjustment).toBe(50);
    expect(price.finalPrice).toBe(302.5);
  });

  it('accepts a free rental agreed by hand', () => {
    const price = resolveRentalPrice(200, 0, 0);
    expect(price.netPrice).toBe(0);
    expect(price.finalPrice).toBe(0);
    expect(price.priceOverridden).toBe(true);
  });

  it('clamps a discount stored above the ceiling', () => {
    const price = resolveRentalPrice(100, 90);
    expect(price.loyaltyDiscountPercent).toBe(MAX_LOYALTY_DISCOUNT_PERCENT);
    expect(price.netPrice).toBe(70);
  });

  it('survives a vehicle with no pricing rule matched', () => {
    const price = resolveRentalPrice(0, 5);
    expect(price.netPrice).toBe(0);
    expect(price.finalPrice).toBe(0);
    expect(price.loyaltyDiscount).toBe(0);
  });
});

describe('addVat', () => {
  it('adds the tax on top instead of extracting it', () => {
    const vat = addVat(350);
    expect(vat.base).toBe(350);
    expect(vat.vat).toBe(73.5);
    expect(vat.total).toBe(423.5);
  });

  it('never lets the total drift: base + vat is exactly the total', () => {
    for (const net of [0.01, 9.99, 30, 45, 210, 1234.56]) {
      const vat = addVat(net);
      expect(vat.base + vat.vat).toBeCloseTo(vat.total, 10);
    }
  });

  it('honours a rate other than the default, including zero', () => {
    expect(addVat(100, 0.07).total).toBe(107);
    expect(addVat(100, 0).vat).toBe(0);
  });

  it('returns zeroes for a missing or nonsense net', () => {
    expect(addVat(0).total).toBe(0);
    expect(addVat(-50).base).toBe(0);
    expect(addVat(Number.NaN).vat).toBe(0);
  });
});

describe('vatBreakdownOf', () => {
  it('splits a reservation from its net, never from its total', () => {
    const vat = vatBreakdownOf({ netPrice: 210, vatRate: 0.21 });
    expect(vat.base).toBe(210);
    expect(vat.vat).toBe(44.1);
    expect(vat.total).toBe(254.1);
  });

  it('falls back to the general rate when the snapshot has none', () => {
    expect(vatBreakdownOf({ netPrice: 100 }).total).toBe(121);
  });

  it('agrees with what resolveRentalPrice produced', () => {
    const price = resolveRentalPrice(210, 0);
    const vat = vatBreakdownOf({ netPrice: price.netPrice, vatRate: DEFAULT_VAT_RATE });
    expect(vat.base).toBe(price.netPrice);
    expect(vat.vat).toBe(price.vatAmount);
    expect(vat.total).toBe(price.finalPrice);
  });
});

/**
 * La sugerencia del cargo por kilómetros de más.
 *
 * Es solo un aviso: hoy no se cobra el kilometraje extra (decisión de Dorel,
 * 31 de agosto de 2026, durante el primer año) y el campo se deja a 0 a
 * propósito, para que un importe prerrellenado no se guarde de un despiste.
 */
describe('suggestExtraKmCharge', () => {
  // El caso del recorrido del 31 de agosto.
  const base = {
    pickupKm: 42150,
    returnKm: 43900,
    totalDays: 3,
    includedKmPerDay: 500,
    extraKmPrice: 0.25
  };

  it('calcula el exceso sobre los km incluidos', () => {
    // 1.750 recorridos − 1.500 incluidos = 250 × 0,25 €
    expect(suggestExtraKmCharge(base)).toEqual({
      extraKm: 250,
      includedKm: 1500,
      amount: 62.5
    });
  });

  it('no sugiere nada si no se pasó de los incluidos', () => {
    expect(suggestExtraKmCharge({ ...base, returnKm: 43000 })).toBeNull();
    // Justo en el límite tampoco: 1.500 recorridos, 1.500 incluidos.
    expect(suggestExtraKmCharge({ ...base, returnKm: 43650 })).toBeNull();
  });

  it('no inventa una cifra cuando falta un dato', () => {
    // Sin tarifa de km extra, sin km incluidos, sin días o sin la entrega,
    // no hay cálculo posible y no se propone nada.
    expect(suggestExtraKmCharge({ ...base, extraKmPrice: undefined })).toBeNull();
    expect(suggestExtraKmCharge({ ...base, includedKmPerDay: undefined })).toBeNull();
    expect(suggestExtraKmCharge({ ...base, totalDays: undefined })).toBeNull();
    expect(suggestExtraKmCharge({ ...base, pickupKm: undefined })).toBeNull();
    expect(suggestExtraKmCharge({ ...base, returnKm: undefined })).toBeNull();
  });

  it('ignora un kilometraje de entrada menor que el de salida', () => {
    // Un error de tecleo no debe producir un cargo negativo.
    expect(suggestExtraKmCharge({ ...base, returnKm: 41000 })).toBeNull();
  });

  it('redondea a céntimos', () => {
    // 333 km × 0,17 € = 56,61 exacto; sin redondear arrastra coma flotante.
    const r = suggestExtraKmCharge({
      pickupKm: 0,
      returnKm: 333,
      totalDays: 1,
      includedKmPerDay: 0.0001,
      extraKmPrice: 0.17
    });
    expect(r?.amount).toBe(56.61);
  });
});
