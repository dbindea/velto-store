import { describe, expect, it } from 'vitest';
import {
  buildEventList,
  daysUntil,
  horizonEnd,
  withinHorizon,
  type UpcomingEvent
} from './events.util';

const AHORA = new Date('2026-09-10T09:00:00');

const evento = (extra: Partial<UpcomingEvent> & { date: Date }): UpcomingEvent => ({
  key: 'k',
  source: 'reminder',
  title: 'Algo',
  ...extra
});

const enDias = (d: number, hora = 10) => {
  const f = new Date(AHORA);
  f.setDate(f.getDate() + d);
  f.setHours(hora, 0, 0, 0);
  return f;
};

describe('el horizonte', () => {
  /**
   * ⚠️ **«A 7 días» llega hasta el final del séptimo día.** Cortando a la hora
   * actual, una entrega de dentro de una semana a las seis de la tarde
   * desaparece de la lista por haberla mirado a las nueve de la mañana.
   */
  it('llega hasta las 23:59 del último día', () => {
    const fin = horizonEnd(7, AHORA);
    expect(fin.getDate()).toBe(17);
    expect(fin.getHours()).toBe(23);
    expect(fin.getMinutes()).toBe(59);
  });

  it('con 0, el límite es el final de hoy — no «hasta ahora mismo»', () => {
    const fin = horizonEnd(0, AHORA);
    expect(fin.getDate()).toBe(10);
    expect(fin.getHours()).toBe(23);
    // Una entrega de hoy a las 18:00 entra aunque se mire a las 9:00.
    expect(withinHorizon(evento({ date: enDias(0, 18) }), 0, AHORA)).toBe(true);
  });

  it('lo que cae dentro entra y lo de después no', () => {
    expect(withinHorizon(evento({ date: enDias(7, 18) }), 7, AHORA)).toBe(true);
    expect(withinHorizon(evento({ date: enDias(8) }), 7, AHORA)).toBe(false);
  });

  /**
   * ⚠️ **La prueba que importa.** Una ITV que caducó hace tres días no deja de
   * importar por haber elegido «hoy»: es lo más urgente que hay. Un filtro de
   * «entre hoy y dentro de N» la escondería justo cuando más falta hace verla.
   */
  it('lo YA VENCIDO entra siempre, mire el horizonte que mire', () => {
    const vencido = evento({ date: enDias(-3) });
    expect(withinHorizon(vencido, 0, AHORA)).toBe(true);
    expect(withinHorizon(vencido, 7, AHORA)).toBe(true);
    expect(withinHorizon(vencido, 30, AHORA)).toBe(true);
  });
});

describe('la lista', () => {
  it('va ordenada por fecha', () => {
    const lista = buildEventList(
      [
        evento({ key: 'c', date: enDias(5) }),
        evento({ key: 'a', date: enDias(1) }),
        evento({ key: 'b', date: enDias(3) })
      ],
      { horizon: 7, now: AHORA }
    );
    expect(lista.map((e) => e.key)).toEqual(['a', 'b', 'c']);
  });

  /**
   * ⚠️ Dos cosas a la misma hora no son igual de urgentes si una dice que falta
   * la firma del contrato. Lo que lleva aviso se lee primero.
   */
  it('a igualdad de fecha, lo que tiene aviso va delante', () => {
    const lista = buildEventList(
      [
        evento({ key: 'normal', date: enDias(1) }),
        evento({ key: 'urgente', date: enDias(1), alert: 'Falta la firma' })
      ],
      { horizon: 7, now: AHORA }
    );
    expect(lista.map((e) => e.key)).toEqual(['urgente', 'normal']);
  });

  /**
   * ⚠️ **Lo hecho se esconde, no se borra.** Saber que el ambientador se compró
   * el mes pasado es lo que permite decidir si toca otra vez.
   */
  it('lo hecho no sale por defecto, pero se puede pedir', () => {
    const eventos = [
      evento({ key: 'pendiente', date: enDias(1) }),
      evento({ key: 'hecho', date: enDias(1), done: true })
    ];
    expect(buildEventList(eventos, { horizon: 7, now: AHORA }).map((e) => e.key)).toEqual([
      'pendiente'
    ]);
    expect(
      buildEventList(eventos, { horizon: 7, showDone: true, now: AHORA }).length
    ).toBe(2);
  });

  it('con horizonte «hoy» solo queda lo de hoy y lo vencido', () => {
    const lista = buildEventList(
      [
        evento({ key: 'hoy', date: enDias(0, 18) }),
        evento({ key: 'manana', date: enDias(1) }),
        evento({ key: 'vencido', date: enDias(-2) })
      ],
      { horizon: 0, now: AHORA }
    );
    expect(lista.map((e) => e.key)).toEqual(['vencido', 'hoy']);
  });
});

describe('los días que quedan', () => {
  /**
   * ⚠️ **Se cuentan por calendario, no por horas.** Con la resta cruda, algo de
   * mañana a las 8:00 mirado hoy a las 20:00 sale «0 días» y se lee como hoy.
   */
  it('mañana es 1 día aunque falten menos de veinticuatro horas', () => {
    const tarde = new Date('2026-09-10T20:00:00');
    const mananaTemprano = new Date('2026-09-11T08:00:00');
    expect(daysUntil(mananaTemprano, tarde)).toBe(1);
  });

  it('hoy es 0 y lo pasado es negativo', () => {
    expect(daysUntil(enDias(0, 23), AHORA)).toBe(0);
    expect(daysUntil(enDias(-3), AHORA)).toBe(-3);
  });
});
