import { describe, expect, it } from 'vitest';
import {
  addMonths,
  formatDateTimeValue,
  formatDateValue,
  formatTimeValue,
  minuteSteps,
  monthGrid,
  outOfRange,
  parseDateTimeValue,
  parseDateValue,
  parseTimeValue
} from './date-picker.util';

// ---------------------------------------------------------------------------
// El calendario propio
//
// Lo que se equivoca en un selector de fechas no es el dibujo: es de qué día
// empieza la semana, qué pasa al cambiar de mes y en qué huso horario se lee
// una cadena. Eso es lo que hay aquí.
// ---------------------------------------------------------------------------

describe('parseDateValue', () => {
  /**
   * ⚠️ El fallo clásico: `new Date('2026-10-10')` es medianoche **UTC**, que en
   * medio mundo cae el día 9. Se construye por partes.
   */
  it('lee la fecha en hora LOCAL, no en UTC', () => {
    const d = parseDateValue('2026-10-10')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9); // octubre
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(0);
  });

  it('y lo que no tiene forma de fecha no se inventa', () => {
    expect(parseDateValue('')).toBeNull();
    expect(parseDateValue('10/10/2026')).toBeNull();
    expect(parseDateValue(undefined)).toBeNull();
  });

  it('ida y vuelta sin perder el día', () => {
    expect(formatDateValue(parseDateValue('2026-01-01')!)).toBe('2026-01-01');
    expect(formatDateValue(parseDateValue('2026-12-31')!)).toBe('2026-12-31');
  });
});

describe('parseTimeValue', () => {
  it('cuenta minutos desde medianoche', () => {
    expect(parseTimeValue('00:00')).toBe(0);
    expect(parseTimeValue('12:30')).toBe(750);
    expect(parseTimeValue('23:59')).toBe(1439);
  });

  /** El navegador puede mandar segundos; no cambian la hora elegida. */
  it('los segundos sobran y no estorban', () => {
    expect(parseTimeValue('09:15:00')).toBe(555);
  });

  it('una hora imposible no es una hora', () => {
    expect(parseTimeValue('24:00')).toBeNull();
    expect(parseTimeValue('12:60')).toBeNull();
    expect(parseTimeValue('')).toBeNull();
  });

  it('se escribe con dos cifras siempre', () => {
    expect(formatTimeValue(0)).toBe('00:00');
    expect(formatTimeValue(555)).toBe('09:15');
  });
});

describe('parseDateTimeValue', () => {
  it('lee día y hora juntos', () => {
    const d = parseDateTimeValue('2026-10-10T12:00')!;
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(12);
    expect(formatDateTimeValue(d)).toBe('2026-10-10T12:00');
  });

  /** Sin hora, medianoche: es lo que hace el propio campo del navegador. */
  it('sin hora, medianoche', () => {
    expect(parseDateTimeValue('2026-10-10')!.getHours()).toBe(0);
  });
});

describe('monthGrid', () => {
  const OCTUBRE = new Date(2026, 9, 1); // 1 de octubre de 2026, un jueves

  it('siempre 42 casillas, para que el panel no cambie de alto', () => {
    expect(monthGrid(OCTUBRE)).toHaveLength(42);
    // Febrero de 2027 empieza en lunes y tiene 28 días: cabe en cuatro filas.
    expect(monthGrid(new Date(2027, 1, 1))).toHaveLength(42);
  });

  it('la semana empieza en lunes', () => {
    const celdas = monthGrid(OCTUBRE);
    expect(celdas[0].date.getDay()).toBe(1);
  });

  it('y el mes de verdad empieza donde toca', () => {
    const celdas = monthGrid(OCTUBRE);
    const primeroDeOctubre = celdas.findIndex((c) => c.inMonth);
    expect(celdas[primeroDeOctubre].date.getDate()).toBe(1);
    // Del 28 de septiembre (lunes) al 1 de octubre (jueves) van tres días.
    expect(primeroDeOctubre).toBe(3);
  });

  /**
   * ⚠️ El caso que rompe los calendarios escritos a mano: un mes que empieza
   * en domingo. Con `(dia - primerDia + 7) % 7` salen seis días atrás; sin el
   * `+ 7`, un número negativo y la rejilla se descuadra.
   */
  it('un mes que empieza en domingo no descuadra la rejilla', () => {
    const noviembre2026 = new Date(2026, 10, 1); // domingo
    const celdas = monthGrid(noviembre2026);
    expect(celdas[0].date.getDay()).toBe(1);
    expect(celdas.filter((c) => c.inMonth)).toHaveLength(30);
    expect(celdas.findIndex((c) => c.inMonth)).toBe(6);
  });

  it('los días de fuera se enseñan pero se marcan', () => {
    const celdas = monthGrid(OCTUBRE);
    expect(celdas[0].inMonth).toBe(false);
    expect(celdas[0].date.getMonth()).toBe(8); // septiembre
  });

  it('marca hoy y lo elegido', () => {
    const celdas = monthGrid(OCTUBRE, {
      today: new Date(2026, 9, 5),
      selected: new Date(2026, 9, 20)
    });
    expect(celdas.filter((c) => c.today)).toHaveLength(1);
    expect(celdas.find((c) => c.today)!.date.getDate()).toBe(5);
    expect(celdas.find((c) => c.selected)!.date.getDate()).toBe(20);
  });

  it('lo que cae fuera de min/max se ve y no se puede elegir', () => {
    const celdas = monthGrid(OCTUBRE, { min: new Date(2026, 9, 10) });
    const dia9 = celdas.find((c) => c.inMonth && c.date.getDate() === 9)!;
    const dia10 = celdas.find((c) => c.inMonth && c.date.getDate() === 10)!;
    expect(dia9.disabled).toBe(true);
    // El día del límite sí vale: `min` es una fecha, no un instante.
    expect(dia10.disabled).toBe(false);
  });
});

describe('outOfRange', () => {
  it('el propio día del límite entra', () => {
    const min = new Date(2026, 9, 10);
    expect(outOfRange(new Date(2026, 9, 10, 23, 59), min)).toBe(false);
    expect(outOfRange(new Date(2026, 9, 9, 23, 59), min)).toBe(true);
  });

  it('sin límites, nada queda fuera', () => {
    expect(outOfRange(new Date(1990, 0, 1))).toBe(false);
  });
});

describe('addMonths', () => {
  /** Un 31 sumado a un mes de 30 no puede caer en el siguiente. */
  it('el 31 de enero más un mes es febrero, no marzo', () => {
    const r = addMonths(new Date(2026, 0, 31), 1);
    expect(r.getMonth()).toBe(1);
    expect(r.getDate()).toBe(1);
  });

  it('diciembre más uno es enero del año siguiente', () => {
    const r = addMonths(new Date(2026, 11, 15), 1);
    expect(r.getFullYear()).toBe(2027);
    expect(r.getMonth()).toBe(0);
  });
});

describe('minuteSteps', () => {
  it('doce por hora con saltos de cinco', () => {
    expect(minuteSteps()).toHaveLength(12);
    expect(minuteSteps()[1]).toBe(5);
  });
});
