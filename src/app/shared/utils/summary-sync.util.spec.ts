import { describe, expect, it } from 'vitest';
import { summaryNeedsSync } from './summary-sync.util';
import { ReservationPaymentSummary } from '@shared/models/reservation.model';

/**
 * ⚠️ **El test que faltaba el 26 de septiembre de 2026**, cuando una reserva de
 * producción se quedó pidiendo una señal que el operador había quitado.
 *
 * La comparación que decide si la copia del resumen está vieja era una lista de
 * campos escrita a mano, y le faltaban los tres `*Required`. No lo cazó nadie
 * porque no había forma de cazarlo: un test de los campos que la lista SÍ mira
 * habría pasado igual.
 *
 * Por eso el test de abajo no comprueba campos concretos: **recorre el resumen
 * entero**. Es el mismo patrón con el que `payment-groups.util.spec.ts` recorre
 * `PAYMENT_TYPE_LABELS` — lo que el compilador obliga a tener completo, el test
 * obliga a tener cubierto.
 */

/** Un resumen completo y coherente: 50 de señal, 600 de resto, 150 de fianza. */
function resumen(): ReservationPaymentSummary {
  return {
    rentalTotal: 650,
    initialPaymentRequired: 50,
    initialPaymentPaid: 0,
    remainingPaymentRequired: 600,
    remainingPaymentPaid: 0,
    depositRequired: 150,
    depositPaid: 0,
    depositReturned: 0,
    depositRetained: 0,
    extrasTotal: 0,
    extrasRequired: 0,
    extrasPending: 0,
    servicesRequired: 0,
    servicesPaid: 0,
    servicesPending: 0,
    totalPaid: 0,
    totalPending: 650,
    balance: 0,
    paymentStatus: 'pending'
  } as ReservationPaymentSummary;
}

describe('summaryNeedsSync', () => {
  it('dice que no hay que sincronizar cuando los dos son iguales', () => {
    expect(summaryNeedsSync(resumen(), resumen())).toBe(false);
  });

  it('una copia ausente siempre hay que escribirla', () => {
    expect(summaryNeedsSync(resumen(), undefined)).toBe(true);
    expect(summaryNeedsSync(resumen(), null)).toBe(true);
  });

  /**
   * ⚠️ **El test que de verdad importa.** Mueve CADA campo del resumen, uno a
   * uno, y exige que la comparación lo note. Un campo nuevo que alguien añada
   * entra aquí solo: si la comparación no lo mira, este test se pone rojo sin
   * que nadie tenga que acordarse de venir a escribirlo.
   */
  it('detecta un cambio en CUALQUIER campo del resumen, sin excepción', () => {
    const base = resumen();
    // `string[]` y no `keyof`: `keyof` incluye `symbol`, que no vale como
    // índice. Lo que se recorre son las claves reales del objeto.
    const claves = Object.keys(base);

    // Guardia contra el propio test: si el objeto de prueba se queda corto
    // respecto al modelo, este test daría una falsa sensación de cobertura.
    expect(claves.length).toBeGreaterThanOrEqual(19);

    for (const clave of claves) {
      // `as unknown as` y no un cast directo: `ReservationPaymentSummary` no
      // tiene índice de cadena, y el compilador de Angular —más estricto que
      // vitest a secas— rechaza la conversión sin ese paso intermedio.
      const movido = { ...base } as unknown as Record<string, unknown>;
      const valor = (base as unknown as Record<string, unknown>)[clave];
      // Mover cada campo a algo distinto, sea número o texto.
      movido[clave] = typeof valor === 'number' ? valor + 25 : 'paid';

      expect(
        summaryNeedsSync(movido as unknown as ReservationPaymentSummary, base),
        `mover «${String(clave)}» tiene que detectarse, y no se detecta`
      ).toBe(true);
    }
  });

  /**
   * ⚠️ **El caso REAL que se escapó**, escrito como caso propio además de
   * entrar en el recorrido de arriba: bajar la señal a 0 sube el resto, así que
   * el total pendiente **no se mueve**. Con una comparación que solo mire
   * `totalPending` y lo pagado, esto pasa desapercibido para siempre.
   */
  it('detecta un reparto entre señal y resto aunque el total pendiente no cambie', () => {
    const antes = resumen();
    const despues: ReservationPaymentSummary = {
      ...antes,
      initialPaymentRequired: 0,
      remainingPaymentRequired: 650
    };

    // La premisa del caso: el total es invariante. Si esto dejara de ser cierto,
    // el test estaría probando otra cosa.
    expect(despues.totalPending).toBe(antes.totalPending);
    expect(despues.paymentStatus).toBe(antes.paymentStatus);

    expect(summaryNeedsSync(despues, antes)).toBe(true);
  });

  it('no se dispara por un error de coma flotante', () => {
    const antes = resumen();
    // 108.9 - 50 es 58.900000000000006: el caso que `roundMoney` existe para
    // evitar, y que sin margen dejaría el reconciliador reescribiendo en bucle.
    const despues = { ...antes, totalPending: antes.totalPending + 0.000000000000006 };
    expect(summaryNeedsSync(despues, antes)).toBe(false);
  });

  it('un céntimo SÍ es una diferencia', () => {
    const antes = resumen();
    expect(summaryNeedsSync({ ...antes, totalPending: 650.01 }, antes)).toBe(true);
  });
});
