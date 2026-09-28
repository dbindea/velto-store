/**
 * La cifra y el nombre de la cifra, comprobados JUNTOS.
 *
 * ⚠️ **Es la única forma de cazar el fallo que originó este util**, porque no da
 * error en ninguna parte: el número era correcto, la pantalla compilaba, los
 * tests pasaban y el despliegue iba bien. Lo único que fallaba era la palabra, y
 * eso solo se ve mirando la pantalla — o afirmando aquí, caso por caso, cómo se
 * llama lo que se está sumando.
 *
 * El caso que lo destapó está abajo con su nombre: `waived` + resto vivo, que es
 * el normal de cobrar el alquiler de una vez, salía como «Señal pendiente».
 */

import { describe, expect, it } from 'vitest';
import {
  rentalDebtOf,
  DEBT_SCOPE_LABELS,
  DEBT_MOMENT_HINTS,
  type DebtScope,
  type DebtMoment
} from './rental-debt.util';
import type { Reservation } from '@shared/models/reservation.model';

/** Una reserva con lo justo para que `rentalDebtOf()` decida. */
function reserva(opciones: {
  estado?: Reservation['reservationStatus'];
  señal?: { requiredAmount: number; paidAmount: number; status: 'pending' | 'paid' | 'waived' };
  resto?: { requiredAmount: number; paidAmount: number; status: 'pending' | 'paid' };
}): Reservation {
  return {
    reservationStatus: opciones.estado ?? 'confirmed',
    initialPayment: opciones.señal ?? { requiredAmount: 0, paidAmount: 0, status: 'waived' },
    remainingPayment: opciones.resto ?? { requiredAmount: 0, paidAmount: 0, status: 'paid' }
  } as unknown as Reservation;
}

describe('rentalDebtOf — cuánto se debe', () => {
  it('suma la señal pendiente y el resto pendiente', () => {
    const d = rentalDebtOf(
      reserva({
        señal: { requiredAmount: 50, paidAmount: 0, status: 'pending' },
        resto: { requiredAmount: 600, paidAmount: 0, status: 'pending' }
      })
    );
    expect(d?.amount).toBe(650);
  });

  it('descuenta lo ya cobrado a cuenta de cada tramo', () => {
    const d = rentalDebtOf(
      reserva({
        señal: { requiredAmount: 50, paidAmount: 20, status: 'pending' },
        resto: { requiredAmount: 600, paidAmount: 100, status: 'pending' }
      })
    );
    expect(d?.amount).toBe(530);
  });

  it('redondea el dinero derivado', () => {
    // 108.9 - 50 da 58.900000000000006 sin redondear.
    const d = rentalDebtOf(
      reserva({
        señal: { requiredAmount: 108.9, paidAmount: 50, status: 'pending' },
        resto: { requiredAmount: 0, paidAmount: 0, status: 'paid' }
      })
    );
    expect(d?.amount).toBe(58.9);
  });

  it('no hay deuda si los dos tramos están cobrados', () => {
    expect(
      rentalDebtOf(
        reserva({
          señal: { requiredAmount: 50, paidAmount: 50, status: 'paid' },
          resto: { requiredAmount: 600, paidAmount: 600, status: 'paid' }
        })
      )
    ).toBeNull();
  });

  it('mira el ESTADO, no la resta: una señal renunciada no es una deuda de 0 €', () => {
    // Con `waived` y requiredAmount 0 la resta también daría 0, pero el día que
    // alguien renuncie a una señal con importe puesto, la resta sí mentiría.
    const d = rentalDebtOf(
      reserva({
        señal: { requiredAmount: 50, paidAmount: 0, status: 'waived' },
        resto: { requiredAmount: 600, paidAmount: 0, status: 'pending' }
      })
    );
    expect(d?.amount).toBe(600);
  });

  it.each(['closed', 'cancelled'] as const)('una reserva %s no tiene deuda que avisar', (estado) => {
    expect(
      rentalDebtOf(
        reserva({
          estado,
          resto: { requiredAmount: 600, paidAmount: 0, status: 'pending' }
        })
      )
    ).toBeNull();
  });
});

describe('rentalDebtOf — cómo se llama lo que se debe', () => {
  it('EL CASO DE PRODUCCIÓN: señal renunciada y el alquiler entero en el resto → «alquiler», nunca «señal»', () => {
    // 28 de septiembre de 2026: la tarjeta del panel decía «SEÑAL PENDIENTE —
    // 650,00 €» sobre una reserva a la que no se le pidió ninguna señal.
    const d = rentalDebtOf(
      reserva({
        señal: { requiredAmount: 0, paidAmount: 0, status: 'waived' },
        resto: { requiredAmount: 650, paidAmount: 0, status: 'pending' }
      })
    );
    expect(d?.amount).toBe(650);
    expect(d?.scope).toBe('rental');
    expect(d?.scope).not.toBe('signal');
  });

  it('señal ya cobrada y resto vivo → «resto», que es lo que de verdad queda', () => {
    const d = rentalDebtOf(
      reserva({
        señal: { requiredAmount: 100, paidAmount: 100, status: 'paid' },
        resto: { requiredAmount: 550, paidAmount: 0, status: 'pending' }
      })
    );
    expect(d?.scope).toBe('remaining');
  });

  it('solo la señal viva → «señal»', () => {
    const d = rentalDebtOf(
      reserva({
        señal: { requiredAmount: 50, paidAmount: 0, status: 'pending' },
        resto: { requiredAmount: 600, paidAmount: 600, status: 'paid' }
      })
    );
    expect(d?.scope).toBe('signal');
  });

  it('los dos tramos vivos → «alquiler», porque la cifra ya no es ninguno de los dos', () => {
    const d = rentalDebtOf(
      reserva({
        señal: { requiredAmount: 50, paidAmount: 0, status: 'pending' },
        resto: { requiredAmount: 600, paidAmount: 0, status: 'pending' }
      })
    );
    expect(d?.scope).toBe('rental');
  });
});

describe('rentalDebtOf — dónde está el coche', () => {
  it.each([
    ['reserved', 'before_pickup'],
    ['confirmed', 'before_pickup'],
    ['delivered', 'delivered'],
    ['returned', 'returned']
  ] as const)('%s → %s', (estado, esperado) => {
    const d = rentalDebtOf(
      reserva({ estado, resto: { requiredAmount: 600, paidAmount: 0, status: 'pending' } })
    );
    expect(d?.moment).toBe(esperado);
  });
});

describe('los mapas de texto', () => {
  // Sin esto, un estado nuevo se queda sin clave y el texto simplemente NO SALE:
  // la plantilla pinta una cadena vacía y no falla nada. Es la razón por la que
  // los `Record` van tipados por la unión completa.
  const ALCANCES: DebtScope[] = ['signal', 'remaining', 'rental'];
  const MOMENTOS: DebtMoment[] = ['before_pickup', 'delivered', 'returned'];

  it.each(ALCANCES)('%s tiene clave de rótulo', (s) => {
    expect(DEBT_SCOPE_LABELS[s]).toBeTruthy();
    expect(DEBT_SCOPE_LABELS[s]).toMatch(/^dashboard\.pendingPayment\.scope\./);
  });

  it.each(MOMENTOS)('%s tiene clave de subtexto', (m) => {
    expect(DEBT_MOMENT_HINTS[m]).toBeTruthy();
    expect(DEBT_MOMENT_HINTS[m]).toMatch(/^dashboard\.pendingPayment\.moment\./);
  });

  it('ninguna clave se repite: dos estados con el mismo texto es un estado sin nombre', () => {
    const rotulos = ALCANCES.map((s) => DEBT_SCOPE_LABELS[s]);
    expect(new Set(rotulos).size).toBe(ALCANCES.length);
    const subtextos = MOMENTOS.map((m) => DEBT_MOMENT_HINTS[m]);
    expect(new Set(subtextos).size).toBe(MOMENTOS.length);
  });
});
