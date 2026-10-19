import { describe, expect, it } from 'vitest';
import {
  importeSenal,
  puedePagarSenal,
  SENAL_NORMAL,
  SENAL_REDUCIDA,
  type SolicitudParaCobrar
} from './signal-core';

const AHORA = new Date('2026-10-19T12:00:00Z');
const DENTRO_DE_UN_RATO = new Date('2026-10-20T12:00:00Z');
const HACE_UN_RATO = new Date('2026-10-18T12:00:00Z');

const vigente = (extra: Partial<SolicitudParaCobrar> = {}): SolicitudParaCobrar => ({
  status: 'new',
  quoteSnapshot: { gross: 302.5 },
  priceGuaranteedUntil: DENTRO_DE_UN_RATO,
  ...extra
});

describe('importeSenal', () => {
  /*
   * ⚠️ **Los dos números van FIJADOS, no derivados.** Son copia de
   * `APP_DEFAULTS` y la copia es lo que este test protege: si alguien cambia la
   * señal en la app y no aquí, el cliente que paga desde la web pagaría una
   * cifra y el que paga por el enlace de Dorel otra, por el mismo alquiler.
   */
  it('vale 50 € y 25 €, los mismos que APP_DEFAULTS', () => {
    expect(SENAL_NORMAL).toBe(50);
    expect(SENAL_REDUCIDA).toBe(25);
  });

  it('pide la señal normal en un alquiler corriente', () => {
    expect(importeSenal(302.5)).toBe(50);
    expect(importeSenal(50)).toBe(50);
  });

  it('pide la reducida cuando el alquiler vale menos que la señal', () => {
    expect(importeSenal(49.99)).toBe(25);
    expect(importeSenal(30)).toBe(25);
  });

  /*
   * El tramo que el `min` final protege: por debajo de la señal reducida, la
   * señal es el alquiler entero y no puede ser más.
   */
  it('nunca pide más de lo que vale el alquiler', () => {
    expect(importeSenal(20)).toBe(20);
    expect(importeSenal(1)).toBe(1);
  });

  it('contesta 0 a lo que no es un importe', () => {
    expect(importeSenal(0)).toBe(0);
    expect(importeSenal(-10)).toBe(0);
    expect(importeSenal(NaN)).toBe(0);
    expect(importeSenal(Infinity)).toBe(0);
  });

  it('redondea al céntimo', () => {
    expect(importeSenal(12.345)).toBe(12.35);
  });
});

describe('puedePagarSenal', () => {
  it('deja pagar una solicitud nueva con el precio en pie', () => {
    const d = puedePagarSenal(vigente(), AHORA, true);
    expect(d).toEqual({ ok: true, importe: 50 });
  });

  it('deja pagar una ya contactada: hablar no cierra nada', () => {
    expect(puedePagarSenal(vigente({ status: 'contacted' }), AHORA, true).ok).toBe(true);
  });

  /*
   * ⚠️ **La bandera manda sobre todo lo demás.** Con el pago apagado no se
   * mira ni la solicitud: es lo que hace que producción no pueda cobrar por
   * esta vía ni aunque alguien llame al endpoint a mano.
   */
  it('con el pago apagado no deja, ni siquiera con todo correcto', () => {
    expect(puedePagarSenal(vigente(), AHORA, false)).toEqual({ ok: false, motivo: 'disabled' });
  });

  it('no deja pagar lo que no existe', () => {
    expect(puedePagarSenal(null, AHORA, true)).toEqual({ ok: false, motivo: 'not-found' });
    expect(puedePagarSenal(undefined, AHORA, true)).toEqual({ ok: false, motivo: 'not-found' });
  });

  /*
   * Una convertida ya tiene su reserva con sus propias filas de cobro: pagar
   * aquí sembraría un cobro suelto que no cuadra con ninguna.
   */
  it('no deja pagar una convertida ni una descartada', () => {
    expect(puedePagarSenal(vigente({ status: 'converted' }), AHORA, true)).toEqual({
      ok: false,
      motivo: 'closed'
    });
    expect(puedePagarSenal(vigente({ status: 'discarded' }), AHORA, true)).toEqual({
      ok: false,
      motivo: 'closed'
    });
  });

  it('no deja pagar con el precio caducado', () => {
    const d = puedePagarSenal(vigente({ priceGuaranteedUntil: HACE_UN_RATO }), AHORA, true);
    expect(d).toEqual({ ok: false, motivo: 'expired' });
  });

  /*
   * ⚠️ **El instante exacto de caducar ya NO vale.** Es un `<=`: a la hora en
   * punto el precio prometido se acabó, y la alternativa —dejarlo pasar por un
   * milisegundo— solo sirve para discutir después qué decía el reloj.
   */
  it('justo al vencer ya no deja', () => {
    const d = puedePagarSenal(vigente({ priceGuaranteedUntil: AHORA }), AHORA, true);
    expect(d).toEqual({ ok: false, motivo: 'expired' });
  });

  /*
   * ⚠️ **Lo ilegible cuenta como caducado**, que es la regla de toda la web
   * pública: ante la duda, que llame. Darlo por vigente cobraría un precio que
   * no sabemos si sostenemos.
   */
  it('una fecha ilegible, o ausente, cuenta como caducada', () => {
    for (const malo of [undefined, null, 'mañana', {}, NaN, new Date('x')]) {
      expect(puedePagarSenal(vigente({ priceGuaranteedUntil: malo }), AHORA, true)).toEqual({
        ok: false,
        motivo: 'expired'
      });
    }
  });

  it('entiende las cuatro formas en que Firestore devuelve una fecha', () => {
    const seg = Math.floor(DENTRO_DE_UN_RATO.getTime() / 1000);
    const formas: unknown[] = [
      DENTRO_DE_UN_RATO,
      { seconds: seg, nanoseconds: 0 },
      { _seconds: seg, _nanoseconds: 0 },
      { toDate: () => DENTRO_DE_UN_RATO },
      DENTRO_DE_UN_RATO.toISOString()
    ];
    for (const forma of formas) {
      expect(puedePagarSenal(vigente({ priceGuaranteedUntil: forma }), AHORA, true).ok).toBe(true);
    }
  });

  it('sin presupuesto no hay señal que pedir', () => {
    expect(puedePagarSenal(vigente({ quoteSnapshot: null }), AHORA, true)).toEqual({
      ok: false,
      motivo: 'no-amount'
    });
    expect(puedePagarSenal(vigente({ quoteSnapshot: { gross: 0 } }), AHORA, true)).toEqual({
      ok: false,
      motivo: 'no-amount'
    });
  });

  /*
   * ⚠️ **El caso que impide cobrar dos veces.** Si ya hay cobro creado se
   * devuelve ESE, no se crea otro: el cliente que se fue a la pasarela y volvió
   * sin pagar, o al que Dorel ya mandó el enlace desde el panel, tiene que
   * acabar en la misma fila. Dos filas de 50 € para la misma señal son 100 €
   * cobrables por error.
   */
  it('con cobro ya creado lo devuelve en vez de dejar crear otro', () => {
    const d = puedePagarSenal(vigente({ signalPaymentId: 'pago-1' }), AHORA, true);
    expect(d).toEqual({ ok: true, importe: 50, yaCreado: 'pago-1' });
  });

  it('un id en blanco no cuenta como cobro creado', () => {
    const d = puedePagarSenal(vigente({ signalPaymentId: '   ' }), AHORA, true);
    expect(d).toEqual({ ok: true, importe: 50 });
  });

  /*
   * ⚠️ **Caducada Y con cobro creado sigue siendo caducada.** El orden importa:
   * devolver el enlace viejo de un precio que ya no se sostiene es exactamente
   * lo que la comprobación del plazo viene a impedir.
   */
  it('el plazo manda sobre el cobro ya creado', () => {
    const d = puedePagarSenal(
      vigente({ signalPaymentId: 'pago-1', priceGuaranteedUntil: HACE_UN_RATO }),
      AHORA,
      true
    );
    expect(d).toEqual({ ok: false, motivo: 'expired' });
  });
});
