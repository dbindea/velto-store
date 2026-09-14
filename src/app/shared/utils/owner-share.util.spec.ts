import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OWNER_SHARE_PERCENT,
  ownerShareAmount,
  ownerSharePercentProblem,
  ownerShareSnapshotOf,
  vehicleOwnershipProblem,
  veltoSharePercent,
  veltoShareAmount
} from './owner-share.util';

describe('el reparto con el propietario', () => {
  it('el 75 % de 200 € son 150 €, y a Velto le quedan 50 €', () => {
    expect(ownerShareAmount(200, 75)).toBe(150);
    expect(veltoShareAmount(200, 75)).toBe(50);
  });

  /**
   * ⚠️ **La prueba que da sentido a todo esto.** La base es el neto: si se
   * repartiera el importe con IVA, se le pagaría al propietario un porcentaje de
   * un impuesto que no es de nadie de los dos. Con un 21 % y un 75 % de reparto
   * son 15,75 € de más por cada cien euros.
   *
   * Es el mismo test que protege las comisiones de captación, y está aquí otra
   * vez porque son dos cálculos distintos que pueden equivocarse por separado.
   */
  it('100 y 121 NO dan lo mismo: la base es el neto, nunca el total con IVA', () => {
    expect(ownerShareAmount(100, 75)).toBe(75);
    expect(ownerShareAmount(121, 75)).toBe(90.75);
    expect(ownerShareAmount(121, 75)).not.toBe(ownerShareAmount(100, 75));
  });

  it('las dos partes suman exactamente la base, al céntimo', () => {
    for (const base of [200, 133.1, 99.99, 1234.56, 0.03]) {
      for (const pct of [75, 50, 33, 12.5]) {
        const suma = ownerShareAmount(base, pct) + veltoShareAmount(base, pct);
        expect(Math.abs(suma - base), `${base} al ${pct}%`).toBeLessThan(0.005);
      }
    }
  });

  it('sin base o sin porcentaje no se debe nada', () => {
    expect(ownerShareAmount(0, 75)).toBe(0);
    expect(ownerShareAmount(200, 0)).toBe(0);
    expect(ownerShareAmount(-50, 75)).toBe(0);
  });

  it('el complementario se calcula, no se guarda', () => {
    expect(veltoSharePercent(75)).toBe(25);
    expect(veltoSharePercent(100)).toBe(0);
    expect(veltoSharePercent(0)).toBe(100);
  });

  it('el reparto por defecto es 75/25', () => {
    expect(DEFAULT_OWNER_SHARE_PERCENT).toBe(75);
    expect(veltoSharePercent(DEFAULT_OWNER_SHARE_PERCENT)).toBe(25);
  });
});

describe('qué porcentaje se puede pactar', () => {
  /**
   * El 0 y el 100 existen los dos: un coche cedido gratis, y uno en el que Velto
   * solo pone la gestión y se cobra por otra vía. No son un error de tecleo.
   */
  it('del 0 al 100, los extremos incluidos', () => {
    expect(ownerSharePercentProblem(0)).toBeNull();
    expect(ownerSharePercentProblem(75)).toBeNull();
    expect(ownerSharePercentProblem(100)).toBeNull();
  });

  it('ni negativo ni de más del total', () => {
    expect(ownerSharePercentProblem(-1)).toBe('vehicles.problems.ownerShareRange');
    expect(ownerSharePercentProblem(101)).toBe('vehicles.problems.ownerShareRange');
  });

  it('vacío no es cero: hay que decirlo', () => {
    expect(ownerSharePercentProblem(undefined)).toBe('vehicles.problems.ownerShareRequired');
    expect(ownerSharePercentProblem(null)).toBe('vehicles.problems.ownerShareRequired');
  });
});

describe('la propiedad del vehículo', () => {
  it('un coche de Velto no pide nada más', () => {
    expect(vehicleOwnershipProblem({ ownership: 'own' })).toEqual({});
    expect(vehicleOwnershipProblem({})).toEqual({});
  });

  /**
   * ⚠️ **El caso que hay que impedir al guardar.** Un coche marcado «de
   * colaborador» sin colaborador dice que hay que pagarle a alguien y no dice a
   * quién — y eso no se descubre hasta que se cierra el primer alquiler y toca
   * repartir.
   */
  it('«de colaborador» sin colaborador no se guarda', () => {
    const p = vehicleOwnershipProblem({ ownership: 'collaborator', ownerSharePercent: 75 });
    expect(p['ownerCollaboratorId']).toBe('vehicles.problems.ownerRequired');
  });

  it('«de colaborador» sin porcentaje tampoco', () => {
    const p = vehicleOwnershipProblem({ ownership: 'collaborator', ownerCollaboratorId: 'c1' });
    expect(p['ownerSharePercent']).toBe('vehicles.problems.ownerShareRequired');
  });

  it('con los dos, pasa', () => {
    expect(
      vehicleOwnershipProblem({
        ownership: 'collaborator',
        ownerCollaboratorId: 'c1',
        ownerSharePercent: 75
      })
    ).toEqual({});
  });
});

describe('lo que se congela en la reserva', () => {
  const coche = {
    ownership: 'collaborator' as const,
    ownerCollaboratorId: 'c1',
    ownerSharePercent: 60
  };

  it('un coche de Velto no congela nada', () => {
    expect(ownerShareSnapshotOf({ ownership: 'own' }, 'Juan')).toBeNull();
    expect(ownerShareSnapshotOf(null, 'Juan')).toBeNull();
  });

  it('un coche de colaborador congela a quién y cuánto', () => {
    expect(ownerShareSnapshotOf(coche, 'Juan Pérez')).toEqual({
      collaboratorId: 'c1',
      collaboratorName: 'Juan Pérez',
      sharePercent: 60
    });
  });

  /**
   * ⚠️ **El nombre va dentro a propósito**, aunque se pueda buscar por el id.
   * Es el mismo criterio que `clientSnapshot` y `vehicleSnapshot`: una
   * liquidación de hace ocho meses tiene que poder explicarse sin depender de
   * que la ficha siga existiendo y de que siga llamándose igual.
   */
  it('guarda el nombre, no solo el id', () => {
    expect(ownerShareSnapshotOf(coche, 'Juan Pérez')?.collaboratorName).toBe('Juan Pérez');
    expect(ownerShareSnapshotOf(coche, undefined)?.collaboratorName).toBe('—');
  });

  it('marcado como de colaborador pero sin colaborador, no congela nada', () => {
    expect(ownerShareSnapshotOf({ ownership: 'collaborator' }, 'Juan')).toBeNull();
  });
});
