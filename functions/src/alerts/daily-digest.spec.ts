import { describe, expect, it } from 'vitest';
import { asuntoDe, horaEn, mereceEnvio, rangoManana, type Resumen } from './daily-digest';

const TZ = 'Europe/Madrid';

/** Un instante UTC a partir de una hora de Madrid, para que las pruebas se lean. */
const madrid = (iso: string) => new Date(iso);

describe('el día de mañana, en Madrid y no en UTC', () => {
  /**
   * ⚠️ **La prueba que da sentido a todo esto.** Las Cloud Functions arrancan en
   * UTC, y en verano Madrid va dos horas por delante: el día de mañana empieza a
   * las 22:00 UTC de hoy. Con un rango calculado en UTC, una entrega temprana no
   * saldría en el correo de nadie.
   */
  it('en verano el día empieza a las 22:00 UTC del día anterior', () => {
    // 10 de septiembre, 20:00 en Madrid = 18:00 UTC. Mañana es el 11.
    const r = rangoManana(madrid('2026-09-10T18:00:00Z'), TZ);
    expect(r.etiqueta).toBe('11/09/2026');
    expect(r.desde.toISOString()).toBe('2026-09-10T22:00:00.000Z');
    expect(r.hasta.toISOString()).toBe('2026-09-11T22:00:00.000Z');
  });

  it('en invierno empieza a las 23:00 UTC, porque el desfase es otro', () => {
    // 10 de diciembre, 20:00 en Madrid = 19:00 UTC.
    const r = rangoManana(madrid('2026-12-10T19:00:00Z'), TZ);
    expect(r.etiqueta).toBe('11/12/2026');
    expect(r.desde.toISOString()).toBe('2026-12-10T23:00:00.000Z');
    expect(r.hasta.toISOString()).toBe('2026-12-11T23:00:00.000Z');
  });

  /**
   * ⚠️ El desfase depende del instante y el instante es lo que se busca, así que
   * el cálculo se hace dos veces. Los dos domingos del año en que cambia la hora
   * son los únicos en que la primera respuesta cae al otro lado del cambio.
   */
  it('la víspera del cambio de hora de octubre dura 25 horas', () => {
    // En 2026 el cambio a horario de invierno es el domingo 25 de octubre.
    const r = rangoManana(madrid('2026-10-24T18:00:00Z'), TZ);
    expect(r.etiqueta).toBe('25/10/2026');
    const horas = (r.hasta.getTime() - r.desde.getTime()) / 3_600_000;
    expect(horas).toBe(25);
  });

  it('y la de marzo dura 23', () => {
    // El cambio a horario de verano es el domingo 29 de marzo de 2026.
    const r = rangoManana(madrid('2026-03-28T19:00:00Z'), TZ);
    expect(r.etiqueta).toBe('29/03/2026');
    const horas = (r.hasta.getTime() - r.desde.getTime()) / 3_600_000;
    expect(horas).toBe(23);
  });

  it('el último día del mes, mañana es el primero del siguiente', () => {
    expect(rangoManana(madrid('2026-01-31T19:00:00Z'), TZ).etiqueta).toBe('01/02/2026');
  });

  it('y en Nochevieja, el 1 de enero del año que viene', () => {
    expect(rangoManana(madrid('2026-12-31T19:00:00Z'), TZ).etiqueta).toBe('01/01/2027');
  });

  /**
   * ⚠️ Se manda a las 9:00 de Madrid, que en UTC son las 07:00 en verano y las
   * 08:00 en invierno. En las dos, «mañana» tiene que ser el mismo día.
   */
  it('a las 9:00 de Madrid, mañana es mañana en las dos épocas del año', () => {
    expect(rangoManana(madrid('2026-07-15T07:00:00Z'), TZ).etiqueta).toBe('16/07/2026');
    expect(rangoManana(madrid('2026-01-15T08:00:00Z'), TZ).etiqueta).toBe('16/01/2026');
  });

  it('la hora se pinta en la del negocio, no en UTC', () => {
    expect(horaEn(madrid('2026-09-11T07:00:00Z'), TZ)).toBe('09:00');
    expect(horaEn(madrid('2026-12-11T08:00:00Z'), TZ)).toBe('09:00');
  });
});

const vacio: Resumen = {
  fecha: '11/09/2026',
  entregas: [],
  devoluciones: [],
  vencimientos: [],
  sinFirmar: 0
};

const entrega = (contratoSinFirmar = false) => ({
  reservationId: 'r1',
  hora: '09:00',
  cliente: 'Cliente Pruebas',
  vehiculo: 'Kia Ceed · 7777ATM',
  contratoSinFirmar
});

describe('cuándo se manda y cuándo se calla', () => {
  /**
   * ⚠️ **Un correo diario que casi siempre dice «nada» se acaba filtrando**, y
   * con él se filtra el que sí importaba. El silencio es la señal.
   */
  it('un día sin nada NO genera correo', () => {
    expect(mereceEnvio(vacio)).toBe(false);
  });

  it('una sola entrega ya lo justifica', () => {
    expect(mereceEnvio({ ...vacio, entregas: [entrega()] })).toBe(true);
  });

  it('y un vencimiento solo, también: no hace falta que haya movimiento', () => {
    expect(
      mereceEnvio({
        ...vacio,
        vencimientos: [
          { vehiculo: '0951LTL', concepto: 'ITV', fecha: '17/09/2026', diasRestantes: 7 }
        ]
      })
    ).toBe(true);
  });
});

describe('el asunto, que es lo único que se lee sin abrir', () => {
  /**
   * ⚠️ **Lo que urge va delante.** Sin contrato firmado no se puede entregar el
   * coche, y enterarse por la mañana deja sin margen para llamar al cliente.
   */
  it('un contrato sin firmar manda sobre todo lo demás', () => {
    const s = asuntoDe(
      { ...vacio, entregas: [entrega(true), entrega()], sinFirmar: 1 },
      'VELTO MOBILITY'
    );
    expect(s).toBe('VELTO MOBILITY · Mañana 11/09/2026: 1 SIN FIRMAR · 2 entregas');
  });

  it('sin nada urgente, cuenta el día', () => {
    const s = asuntoDe(
      { ...vacio, entregas: [entrega()], devoluciones: [entrega(), entrega()] },
      'VELTO MOBILITY'
    );
    expect(s).toBe('VELTO MOBILITY · Mañana 11/09/2026: 1 entrega · 2 devoluciones');
  });

  /** Un vencimiento pasado y uno futuro no son la misma noticia. */
  it('distingue lo ya vencido de lo que está por vencer', () => {
    const porVencer = asuntoDe(
      {
        ...vacio,
        vencimientos: [{ vehiculo: '0951LTL', concepto: 'ITV', fecha: '17/09/2026', diasRestantes: 7 }]
      },
      'VELTO'
    );
    expect(porVencer).toContain('1 por vencer');

    const vencido = asuntoDe(
      {
        ...vacio,
        vencimientos: [{ vehiculo: '0951LTL', concepto: 'ITV', fecha: '01/09/2026', diasRestantes: -9 }]
      },
      'VELTO'
    );
    expect(vencido).toContain('1 vencido');
  });
});
