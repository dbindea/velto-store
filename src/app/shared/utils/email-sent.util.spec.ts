import { describe, it, expect } from 'vitest';
import { readInstant, emailSentOf, EMAIL_NOT_SENT } from './email-sent.util';

describe('readInstant — el lector estricto', () => {
  it('lee las cuatro formas que llegan de verdad en este proyecto', () => {
    const esperado = Date.UTC(2026, 10, 9, 18, 4, 0);

    // Date
    expect(readInstant(new Date(esperado))?.getTime()).toBe(esperado);
    // Timestamp del SDK
    expect(readInstant({ toDate: () => new Date(esperado) })?.getTime()).toBe(esperado);
    // el mapa plano de `toTimestamp()`
    expect(readInstant({ seconds: esperado / 1000, nanoseconds: 0 })?.getTime()).toBe(esperado);
    // la variante con guion bajo, que devuelve la API REST
    expect(readInstant({ _seconds: esperado / 1000 })?.getTime()).toBe(esperado);
    // la cadena ISO que escribe `sendSignedContractEmail` en la reserva
    expect(readInstant(new Date(esperado).toISOString())?.getTime()).toBe(esperado);
    // milisegundos
    expect(readInstant(esperado)?.getTime()).toBe(esperado);
  });

  /**
   * El motivo de que este util exista: `toDate()` de `reservation-date.util`
   * contesta HOY ante lo ilegible, y aquí eso sería inventarse la fecha.
   */
  it('contesta null ante lo ilegible, NUNCA hoy', () => {
    expect(readInstant(undefined)).toBeNull();
    expect(readInstant(null)).toBeNull();
    expect(readInstant('')).toBeNull();
    expect(readInstant('no es una fecha')).toBeNull();
    expect(readInstant({})).toBeNull();
    expect(readInstant({ seconds: 'ayer' })).toBeNull();
    expect(readInstant(new Date('vaya'))).toBeNull();
    expect(readInstant(Number.NaN)).toBeNull();
  });

  it('no se cae si el `toDate` del Timestamp revienta', () => {
    expect(readInstant({ toDate: () => { throw new Error('roto'); } })).toBeNull();
    expect(readInstant({ toDate: () => 'no soy una fecha' })).toBeNull();
  });

  /**
   * `{ seconds: 0 }` es una fecha absurda para un correo y aun así es un valor
   * LEÍDO. Un `if (v.seconds)` la descartaría — el mismo descuido que
   * `Number(null)` con `ownerSharePercent`.
   */
  it('acepta el segundo CERO, que es una fecha leída y no un hueco', () => {
    expect(readInstant({ seconds: 0 })?.getTime()).toBe(0);
  });
});

describe('emailSentOf — presencia y fecha son dos preguntas', () => {
  it('sin ningún candidato, no se envió', () => {
    expect(emailSentOf()).toEqual(EMAIL_NOT_SENT);
    expect(emailSentOf(undefined, null, '')).toEqual(EMAIL_NOT_SENT);
  });

  it('con una fecha legible, se envió y se sabe cuándo', () => {
    const d = new Date(Date.UTC(2026, 10, 9, 18, 4));
    const r = emailSentOf(d.toISOString());
    expect(r.sent).toBe(true);
    expect(r.at?.getTime()).toBe(d.getTime());
  });

  /**
   * ⚠️ El caso que decide el diseño. Un `emailedAt` guardado pero ilegible
   * significa que el correo SALIÓ: esconder el sobre diría que no, y lo
   * siguiente es el envío duplicado que esto existe para evitar.
   */
  it('presente pero ilegible: se envió, sin fecha', () => {
    const r = emailSentOf({ vaya: 'esto no es una fecha' });
    expect(r.sent).toBe(true);
    expect(r.at).toBeNull();
  });

  it('manda el primer candidato PRESENTE, aunque el segundo sí se pueda leer', () => {
    const legible = new Date(Date.UTC(2026, 10, 9, 18, 4)).toISOString();
    const r = emailSentOf({ ilegible: true }, legible);
    expect(r.sent).toBe(true);
    expect(r.at).toBeNull();
  });

  it('se salta los huecos y llega al candidato de la reserva', () => {
    const legible = new Date(Date.UTC(2026, 10, 9, 18, 4)).toISOString();
    const r = emailSentOf(undefined, null, '', legible);
    expect(r.sent).toBe(true);
    expect(r.at?.getTime()).toBe(new Date(legible).getTime());
  });

  /**
   * Las dos formas reales del MISMO envío: `serverTimestamp()` en el contrato y
   * cadena ISO en la reserva. Las dos tienen que dar el mismo instante.
   */
  it('las dos formas del mismo envío dan el mismo instante', () => {
    const ms = Date.UTC(2026, 10, 9, 18, 4);
    const porElContrato = emailSentOf({ toDate: () => new Date(ms) });
    const porLaReserva = emailSentOf(new Date(ms).toISOString());
    expect(porElContrato.at?.getTime()).toBe(porLaReserva.at?.getTime());
  });
});
