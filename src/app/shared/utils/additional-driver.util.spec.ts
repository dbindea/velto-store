import { describe, expect, it } from 'vitest';
import type { Client } from '@shared/models/client.model';
import type { AdditionalDriver } from '@shared/models/reservation.model';
import {
  MAX_ADDITIONAL_DRIVERS,
  buildAdditionalDriver,
  driverFromClient,
  formatAdditionalDriver,
  validateAdditionalDriver
} from './additional-driver.util';

describe('buildAdditionalDriver', () => {
  it('normaliza el documento y el carné como referencias', () => {
    // Misma convención que el resto de la aplicación: mayúsculas y sin
    // espacios. Lo que se teclea en el mostrador viene como viene.
    const d = buildAdditionalDriver({
      fullName: '  Juan   Pérez  ',
      documentNumber: ' 12345678z ',
      drivingLicenseNumber: 'b 1234567'
    });
    expect(d.fullName).toBe('Juan Pérez');
    expect(d.documentNumber).toBe('12345678Z');
    expect(d.drivingLicenseNumber).toBe('B1234567');
  });

  it('omite los campos vacíos en vez de guardarlos en blanco', () => {
    // Firestore prohíbe `undefined`, pero un `''` guardado se imprimiría como
    // una etiqueta vacía en el contrato.
    const d = buildAdditionalDriver({ fullName: 'Ana', documentNumber: '  ' });
    expect(d).toEqual({ fullName: 'Ana' });
    expect('documentNumber' in d).toBe(false);
  });

  it('guarda de dónde salió cuando se eligió de un cliente', () => {
    const d = buildAdditionalDriver({ clientId: 'c1', fullName: 'Ana' });
    expect(d.clientId).toBe('c1');
  });
});

describe('driverFromClient', () => {
  it('copia los datos, no la referencia', () => {
    // Es un snapshot: si mañana esa ficha cambia, el contrato firmado no se
    // mueve. Misma regla que el `clientSnapshot` del arrendatario.
    const client = {
      id: 'c1',
      fullName: 'Juan Pérez',
      documentNumber: '12345678z',
      drivingLicenseNumber: 'b1234567'
    } as Client;

    const d = driverFromClient(client);
    expect(d).toEqual({
      clientId: 'c1',
      fullName: 'Juan Pérez',
      documentNumber: '12345678Z',
      drivingLicenseNumber: 'B1234567'
    });
  });
});

describe('validateAdditionalDriver', () => {
  const valido = {
    fullName: 'Juan Pérez',
    documentNumber: '12345678Z',
    drivingLicenseNumber: 'B1234567'
  };

  it('acepta un conductor completo', () => {
    expect(validateAdditionalDriver(valido)).toEqual({});
  });

  it('exige nombre, documento y carné', () => {
    // Los tres salen de la cláusula 2: identificación nominal y la garantía de
    // que quien conduce está habilitado.
    const p = validateAdditionalDriver({ fullName: '', documentNumber: '', drivingLicenseNumber: '' });
    expect(Object.keys(p).sort()).toEqual(['documentNumber', 'drivingLicenseNumber', 'fullName']);
  });

  it('no deja añadir dos veces al mismo, aunque se teclee distinto', () => {
    const existing: AdditionalDriver[] = [{ fullName: 'Juan', documentNumber: '12345678Z' }];
    const p = validateAdditionalDriver({ ...valido, documentNumber: ' 12345678z ' }, existing);
    expect(p['documentNumber']).toBe('reservations.drivers.errors.duplicate');
  });

  it('deja añadir a otro distinto', () => {
    const existing: AdditionalDriver[] = [{ fullName: 'Juan', documentNumber: '12345678Z' }];
    expect(validateAdditionalDriver({ ...valido, documentNumber: '87654321X' }, existing)).toEqual({});
  });

  it('pone un tope', () => {
    const llenos: AdditionalDriver[] = Array.from({ length: MAX_ADDITIONAL_DRIVERS }, (_, i) => ({
      fullName: 'C' + i,
      documentNumber: '0000000' + i
    }));
    expect(validateAdditionalDriver(valido, llenos)['fullName'])
      .toBe('reservations.drivers.errors.tooMany');
  });
});

describe('formatAdditionalDriver', () => {
  const labels = { document: 'DNI/NIE', license: 'Permiso' };

  it('compone la línea que va al contrato', () => {
    expect(formatAdditionalDriver(
      { fullName: 'Juan Pérez', documentNumber: '12345678Z', drivingLicenseNumber: 'B1234567' },
      labels
    )).toBe('Juan Pérez · DNI/NIE 12345678Z · Permiso B1234567');
  });

  it('no deja separadores sueltos cuando falta un dato', () => {
    // Un « · » colgando al final de una línea de un contrato se lee como un
    // error de la aplicación.
    expect(formatAdditionalDriver({ fullName: 'Ana' }, labels)).toBe('Ana');
    expect(formatAdditionalDriver({ fullName: 'Ana', documentNumber: 'X1' }, labels))
      .toBe('Ana · DNI/NIE X1');
  });
});
