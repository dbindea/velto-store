import { describe, expect, it } from 'vitest';
import { fechaHoraEnZona, instanteEnZona, offsetMinutos } from './zona';

const MADRID = 'Europe/Madrid';

/**
 * ⚠️ **Lo que estos tests protegen es un descuadre que llegó a un cliente.**
 * El 5 de octubre de 2026 una pre-reserva real pidió las **10:00**, el correo
 * dijo **00:00** y el presupuesto en PDF **12:00**. La causa: las Cloud
 * Functions corren en UTC y la hora del visitante se construía con
 * `new Date(y, m, d, h)`, que usa la zona del proceso.
 */
describe('una hora de pared de Madrid se convierte al instante correcto', () => {
  it('en VERANO Madrid va dos horas por delante de UTC', () => {
    // 24 de octubre de 2026: todavía en horario de verano (cambia el día 25).
    const d = instanteEnZona(2026, 10, 24, 10, 0, MADRID);
    expect(d.toISOString()).toBe('2026-10-24T08:00:00.000Z');
  });

  it('en INVIERNO va solo una', () => {
    // 26 de octubre: el cambio ya ha pasado.
    const d = instanteEnZona(2026, 10, 26, 10, 0, MADRID);
    expect(d.toISOString()).toBe('2026-10-26T09:00:00.000Z');
  });

  /**
   * ⚠️ **El caso exacto que se vio en producción.** Las 10:00 del 24 entraban
   * como 10:00 UTC, que son las 12:00 de Madrid: el PDF imprimía 12:00 porque
   * fija la zona, y era fiel a un instante que ya estaba mal.
   */
  it('las 10:00 pedidas se LEEN como 10:00, no como las 12:00', () => {
    const d = instanteEnZona(2026, 10, 24, 10, 0, MADRID);
    expect(fechaHoraEnZona(d, MADRID)).toBe('24/10/2026 a las 10:00');
  });

  /**
   * ⚠️ **Sin la segunda vuelta del cálculo, dos días al año entra mal.** El
   * desfase depende del instante y el instante es lo que se busca: se parte de
   * tratar la hora como UTC y se corrige, y en el domingo del cambio la primera
   * respuesta cae al otro lado.
   */
  it('el domingo del cambio de hora no se desplaza el día', () => {
    // 25 de octubre de 2026, el día en que Madrid vuelve a +01:00.
    const d = instanteEnZona(2026, 10, 25, 11, 0, MADRID);
    expect(fechaHoraEnZona(d, MADRID)).toBe('25/10/2026 a las 11:00');
  });

  it('y la medianoche del cambio sigue siendo del día que es', () => {
    const d = instanteEnZona(2026, 10, 25, 0, 0, MADRID);
    expect(fechaHoraEnZona(d, MADRID)).toBe('25/10/2026 a las 00:00');
  });

  it('una recogida de madrugada no se va al día anterior', () => {
    const d = instanteEnZona(2026, 7, 15, 0, 30, MADRID);
    expect(fechaHoraEnZona(d, MADRID)).toBe('15/07/2026 a las 00:30');
  });
});

describe('el desfase de la zona', () => {
  it('es +120 en verano y +60 en invierno', () => {
    expect(offsetMinutos(new Date('2026-07-15T12:00:00Z'), MADRID)).toBe(120);
    expect(offsetMinutos(new Date('2026-01-15T12:00:00Z'), MADRID)).toBe(60);
  });

  /** Una zona desconocida no puede tumbar una pre-reserva: se queda en UTC. */
  it('una zona que no existe cae a 0 en vez de lanzar', () => {
    expect(offsetMinutos(new Date('2026-07-15T12:00:00Z'), 'UTC')).toBe(0);
  });
});

/**
 * ⚠️ **El formateador existe para que NADIE vuelva a usar `getHours()`.** Esa
 * llamada lee la zona del proceso —UTC en el contenedor— y es justo lo que hacía
 * que el correo dijera una hora y el PDF adjunto a ese mismo correo otra.
 */
describe('cómo se imprime una fecha para una persona', () => {
  it('va en la zona del negocio, no en la del proceso', () => {
    const instante = new Date('2026-10-24T08:00:00.000Z');
    expect(fechaHoraEnZona(instante, MADRID)).toBe('24/10/2026 a las 10:00');
    expect(fechaHoraEnZona(instante, 'UTC')).toBe('24/10/2026 a las 08:00');
  });

  it('con dos dígitos siempre, que es como se lee una hora', () => {
    const d = instanteEnZona(2026, 3, 5, 9, 5, MADRID);
    expect(fechaHoraEnZona(d, MADRID)).toBe('05/03/2026 a las 09:05');
  });
});
