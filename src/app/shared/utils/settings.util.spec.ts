import { describe, expect, it } from 'vitest';
import { resolveSettings, validateSettings } from './settings.util';
import { DEFAULT_OPERATION_SETTINGS } from '@shared/models/settings.model';

describe('mientras nadie haya guardado ajustes', () => {
  /**
   * Estrenar la pantalla de ajustes no puede cambiar nada por sí solo: sin
   * documento, rige exactamente lo que el código traía escrito.
   */
  it('mandan las constantes del código', () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_OPERATION_SETTINGS);
    expect(resolveSettings(undefined)).toEqual(DEFAULT_OPERATION_SETTINGS);
    expect(resolveSettings({})).toEqual(DEFAULT_OPERATION_SETTINGS);
  });

  /**
   * Un documento a medias es lo normal en cuanto se añade un ajuste nuevo: los
   * que ya estaban guardados no lo tienen. Que eso tirase toda la configuración
   * sería peor que no tenerla.
   */
  it('un documento incompleto conserva lo que sí trae', () => {
    const resolved = resolveSettings({ quoteValidityDays: 15 });
    expect(resolved.quoteValidityDays).toBe(15);
    expect(resolved.vatRate).toBe(DEFAULT_OPERATION_SETTINGS.vatRate);
    expect(resolved.defaultDepositAmount).toBe(DEFAULT_OPERATION_SETTINGS.defaultDepositAmount);
  });
});

describe('los valores imposibles no llegan a la operación', () => {
  it('recorta lo que se sale de rango', () => {
    const resolved = resolveSettings({
      defaultDepositAmount: -50,
      quoteValidityDays: 0,
      signingLinkExpiryDays: 999,
      vatRate: 21, // alguien que escribió el porcentaje en vez de la fracción
      defaultIncludedKmPerDay: -1
    });
    expect(resolved.defaultDepositAmount).toBe(0);
    expect(resolved.quoteValidityDays).toBe(1);
    expect(resolved.signingLinkExpiryDays).toBe(90);
    expect(resolved.vatRate).toBe(1);
    expect(resolved.defaultIncludedKmPerDay).toBe(0);
  });

  it('ignora lo que no es un número', () => {
    const resolved = resolveSettings({
      vatRate: 'mucho' as any,
      quoteValidityDays: NaN,
      defaultDepositAmount: Infinity as any
    });
    expect(resolved.vatRate).toBe(DEFAULT_OPERATION_SETTINGS.vatRate);
    expect(resolved.quoteValidityDays).toBe(DEFAULT_OPERATION_SETTINGS.quoteValidityDays);
    expect(resolved.defaultDepositAmount).toBe(DEFAULT_OPERATION_SETTINGS.defaultDepositAmount);
  });

  it('los días son días enteros: no existe medio día de caducidad', () => {
    const resolved = resolveSettings({ quoteValidityDays: 7.6, signingLinkExpiryDays: 3.2 });
    expect(resolved.quoteValidityDays).toBe(8);
    expect(resolved.signingLinkExpiryDays).toBe(3);
  });

  /** Una fianza de 0 es legítima: a un cliente conocido no se le pide. */
  it('acepta el cero donde el cero significa algo', () => {
    const resolved = resolveSettings({ defaultDepositAmount: 0, vatRate: 0 });
    expect(resolved.defaultDepositAmount).toBe(0);
    expect(resolved.vatRate).toBe(0);
  });
});

describe('lo que impide guardar', () => {
  it('acepta unos ajustes razonables', () => {
    expect(validateSettings(DEFAULT_OPERATION_SETTINGS)).toEqual({});
  });

  /**
   * Se avisa en vez de recortar en silencio: recortar un 50 % de IVA a un 100 %
   * dejaría al operador convencido de haber guardado otra cosa.
   *
   * Y la clave del mapa es el nombre del campo, que es lo que permite marcar
   * **ese** en rojo en vez de soltar un mensaje suelto.
   */
  it('avisa del IVA escrito como porcentaje, que es el error fácil', () => {
    expect(validateSettings({ ...DEFAULT_OPERATION_SETTINGS, vatRate: 21 })['vatRate']).toBe(
      'settings.errors.vatRate'
    );
  });

  it('avisa de una caducidad de cero días, que nace caducada', () => {
    expect(
      validateSettings({ ...DEFAULT_OPERATION_SETTINGS, quoteValidityDays: 0 })['quoteValidityDays']
    ).toBe('settings.errors.quoteValidity');
    expect(
      validateSettings({ ...DEFAULT_OPERATION_SETTINGS, signingLinkExpiryDays: 0 })[
        'signingLinkExpiryDays'
      ]
    ).toBe('settings.errors.signingExpiry');
  });

  it('avisa de una fianza negativa', () => {
    expect(
      validateSettings({ ...DEFAULT_OPERATION_SETTINGS, defaultDepositAmount: -1 })[
        'defaultDepositAmount'
      ]
    ).toBe('settings.errors.deposit');
  });
});
