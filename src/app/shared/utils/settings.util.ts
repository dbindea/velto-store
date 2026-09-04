/**
 * Saneado de los ajustes de la operación.
 *
 * Vive aparte del servicio para poder comprobarlo: son cinco números que
 * gobiernan dinero y caducidades, y un valor absurdo guardado por un dedo
 * torcido —un IVA del 2100 %, una caducidad de 0 días— no se nota en la pantalla
 * de ajustes, se nota en el siguiente contrato.
 */

import {
  DEFAULT_OPERATION_SETTINGS,
  OperationSettings
} from '@shared/models/settings.model';
import { FieldProblems } from '@shared/utils/form-problems.util';

/** Límites de cada campo, y el porqué de cada uno. */
const LIMITS = {
  // Una fianza puede ser 0 —a un cliente conocido no se le pide— pero no
  // negativa, que sería devolverle dinero por alquilar.
  defaultDepositAmount: { min: 0, max: 5000 },
  // Un presupuesto de 0 días nace caducado; más de un año no es un presupuesto.
  quoteValidityDays: { min: 1, max: 365 },
  // Lo mismo para el enlace de firma: al menos un día para que dé tiempo.
  signingLinkExpiryDays: { min: 1, max: 90 },
  // Fracción, no porcentaje. El 0 es legítimo; el 1 sería un IVA del 100 %.
  vatRate: { min: 0, max: 1 },
  defaultIncludedKmPerDay: { min: 0, max: 100000 }
} as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Los ajustes efectivos a partir de lo que haya en Firestore.
 *
 * ⚠️ **Campo a campo, no todo o nada.** Si el documento existe pero le falta
 * `vatRate`, se usa el del código para ese campo y se respetan los demás. Un
 * documento a medias es lo normal cuando se añade un ajuste nuevo, y hacer que
 * eso tirase toda la configuración sería peor que no tenerla.
 */
export function resolveSettings(raw: Partial<OperationSettings> | null | undefined): OperationSettings {
  const base = DEFAULT_OPERATION_SETTINGS;
  if (!raw) return { ...base };

  return {
    defaultDepositAmount: clampNumber(
      raw.defaultDepositAmount,
      LIMITS.defaultDepositAmount.min,
      LIMITS.defaultDepositAmount.max,
      base.defaultDepositAmount
    ),
    quoteValidityDays: Math.round(
      clampNumber(
        raw.quoteValidityDays,
        LIMITS.quoteValidityDays.min,
        LIMITS.quoteValidityDays.max,
        base.quoteValidityDays
      )
    ),
    signingLinkExpiryDays: Math.round(
      clampNumber(
        raw.signingLinkExpiryDays,
        LIMITS.signingLinkExpiryDays.min,
        LIMITS.signingLinkExpiryDays.max,
        base.signingLinkExpiryDays
      )
    ),
    vatRate: clampNumber(raw.vatRate, LIMITS.vatRate.min, LIMITS.vatRate.max, base.vatRate),
    defaultIncludedKmPerDay: Math.round(
      clampNumber(
        raw.defaultIncludedKmPerDay,
        LIMITS.defaultIncludedKmPerDay.min,
        LIMITS.defaultIncludedKmPerDay.max,
        base.defaultIncludedKmPerDay
      )
    )
  };
}

/**
 * Lo que impide guardar, en claves de i18n.
 *
 * Se valida antes de escribir y no solo se recorta: recortar en silencio un 50 %
 * de IVA a un 100 % dejaría al operador convencido de haber guardado otra cosa.
 * Aquí se le dice.
 */
export function validateSettings(settings: Partial<OperationSettings>): FieldProblems {
  const problems: FieldProblems = {};

  const outOfRange = (value: unknown, min: number, max: number) => {
    const n = typeof value === 'number' ? value : Number(value);
    return !isFinite(n) || n < min || n > max;
  };

  if (outOfRange(settings.defaultDepositAmount, LIMITS.defaultDepositAmount.min, LIMITS.defaultDepositAmount.max)) {
    problems['defaultDepositAmount'] = 'settings.errors.deposit';
  }
  if (outOfRange(settings.vatRate, LIMITS.vatRate.min, LIMITS.vatRate.max)) {
    problems['vatRate'] = 'settings.errors.vatRate';
  }
  if (outOfRange(settings.quoteValidityDays, LIMITS.quoteValidityDays.min, LIMITS.quoteValidityDays.max)) {
    problems['quoteValidityDays'] = 'settings.errors.quoteValidity';
  }
  if (outOfRange(settings.signingLinkExpiryDays, LIMITS.signingLinkExpiryDays.min, LIMITS.signingLinkExpiryDays.max)) {
    problems['signingLinkExpiryDays'] = 'settings.errors.signingExpiry';
  }
  if (
    outOfRange(
      settings.defaultIncludedKmPerDay,
      LIMITS.defaultIncludedKmPerDay.min,
      LIMITS.defaultIncludedKmPerDay.max
    )
  ) {
    problems['defaultIncludedKmPerDay'] = 'settings.errors.includedKm';
  }

  return problems;
}
