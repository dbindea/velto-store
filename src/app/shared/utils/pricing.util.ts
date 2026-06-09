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