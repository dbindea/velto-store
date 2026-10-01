/**
 * Lo que un calendario roto NO enseña.
 *
 * El caso que este fichero existe para impedir es el cuarto: elegir el 3 y el
 * 9 cuando el coche está alquilado del 5 al 7. La selección se vería
 * perfectamente —seis días pintados— y el coche está fuera en medio.
 */

import { describe, expect, it } from 'vitest';
import {
  RANGO_VACIO,
  comoCampo,
  diaIso,
  diasDelRango,
  elegirDia,
  estadoDelDia,
  hayOcupadoEntre,
  parseDiaIso,
  posicionEnRango,
  previsualizar,
} from './calendario-coche';

const dia = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
};

const OCUPADOS = new Set(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);

describe('diaIso', () => {
  it('es la fecha LOCAL, no la UTC', () => {
    // `toISOString()` daría el día anterior en cualquier huso al oeste de
    // Greenwich, que es el fallo clásico de todo calendario.
    expect(diaIso(new Date(2026, 9, 1, 0, 30))).toBe('2026-10-01');
    expect(diaIso(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });
});

describe('diasDelRango — la cuenta del buscador, no la de un hotel', () => {
  it('del 1 al 4 son TRES días: 72 horas', () => {
    // Recoger el 1 a las 12:00 y devolver el 4 a las 12:00 son 72 horas. Es
    // /api/availability tras ensanchar la ventana a días completos: si aquí se
    // 1 de octubre de 2026: antes cotizaba 4 y era un día de más.
    expect(diasDelRango(dia('2026-10-01'), dia('2026-10-04'))).toBe(3);
  });

  it('un alquiler de un día son DOS casillas: recogida y devolución', () => {
    expect(diasDelRango(dia('2026-10-18'), dia('2026-10-19'))).toBe(1);
  });

  it('la misma casilla dos veces son CERO días, no uno', () => {
    expect(diasDelRango(dia('2026-10-01'), dia('2026-10-01'))).toBe(0);
  });

  it('al revés da 0 en vez de un negativo', () => {
    expect(diasDelRango(dia('2026-10-04'), dia('2026-10-01'))).toBe(0);
  });

  it('cruza el cambio de mes y el de año', () => {
    expect(diasDelRango(dia('2026-10-30'), dia('2026-11-02'))).toBe(3);
    expect(diasDelRango(dia('2026-12-31'), dia('2027-01-01'))).toBe(1);
  });
});

describe('hayOcupadoEntre', () => {
  it('ve la reserva que queda en medio', () => {
    expect(hayOcupadoEntre(dia('2026-10-03'), dia('2026-10-09'), OCUPADOS)).toBe(true);
  });

  it('un tramo limpio pasa', () => {
    expect(hayOcupadoEntre(dia('2026-10-01'), dia('2026-10-04'), OCUPADOS)).toBe(false);
    expect(hayOcupadoEntre(dia('2026-10-09'), dia('2026-10-12'), OCUPADOS)).toBe(false);
  });

  it('mira los dos extremos, no solo lo de en medio', () => {
    expect(hayOcupadoEntre(dia('2026-10-05'), dia('2026-10-05'), OCUPADOS)).toBe(true);
    expect(hayOcupadoEntre(dia('2026-10-08'), dia('2026-10-10'), OCUPADOS)).toBe(true);
  });
});

describe('elegirDia', () => {
  it('el primer clic empieza el rango', () => {
    const r = elegirDia(RANGO_VACIO, dia('2026-10-01'), OCUPADOS);
    expect(diaIso(r.desde!)).toBe('2026-10-01');
    expect(r.hasta).toBeNull();
  });

  it('el segundo lo cierra', () => {
    const r = elegirDia({ desde: dia('2026-10-01'), hasta: null }, dia('2026-10-04'), OCUPADOS);
    expect(diaIso(r.hasta!)).toBe('2026-10-04');
  });

  it('un día ocupado no hace nada', () => {
    const antes = { desde: dia('2026-10-01'), hasta: null };
    expect(elegirDia(antes, dia('2026-10-06'), OCUPADOS)).toBe(antes);
  });

  it('⚠️ NO deja saltar por encima de una reserva: vuelve a empezar', () => {
    // El fallo que este módulo existe para impedir. Del 3 al 9 con el coche
    // alquilado del 5 al 8 se vería como una selección perfecta.
    const r = elegirDia({ desde: dia('2026-10-03'), hasta: null }, dia('2026-10-09'), OCUPADOS);
    expect(diaIso(r.desde!)).toBe('2026-10-09');
    expect(r.hasta).toBeNull();
  });

  it('pulsar antes de la recogida empieza de nuevo ahí', () => {
    const r = elegirDia({ desde: dia('2026-10-10'), hasta: null }, dia('2026-10-02'), OCUPADOS);
    expect(diaIso(r.desde!)).toBe('2026-10-02');
    expect(r.hasta).toBeNull();
  });

  it('con el rango cerrado, el siguiente clic empieza otro', () => {
    const r = elegirDia(
      { desde: dia('2026-10-01'), hasta: dia('2026-10-04') },
      dia('2026-10-12'),
      OCUPADOS
    );
    expect(diaIso(r.desde!)).toBe('2026-10-12');
    expect(r.hasta).toBeNull();
  });

  it('el mismo día dos veces NO cierra el rango: serían cero días', () => {
    const abierto = { desde: dia('2026-10-01'), hasta: null };
    const r = elegirDia(abierto, dia('2026-10-01'), OCUPADOS);
    expect(r.hasta).toBeNull();
    expect(diaIso(r.desde!)).toBe('2026-10-01');
  });
});

describe('previsualizar', () => {
  it('enseña el tramo que se va a coger', () => {
    const r = previsualizar({ desde: dia('2026-10-01'), hasta: null }, dia('2026-10-03'), OCUPADOS);
    expect(diaIso(r.hasta!)).toBe('2026-10-03');
  });

  it('NO lo enseña si hay una reserva en medio, que es para lo que sirve', () => {
    const r = previsualizar({ desde: dia('2026-10-03'), hasta: null }, dia('2026-10-09'), OCUPADOS);
    expect(r.hasta).toBeNull();
  });

  it('con el rango ya cerrado no cambia nada', () => {
    const cerrado = { desde: dia('2026-10-01'), hasta: dia('2026-10-04') };
    expect(previsualizar(cerrado, dia('2026-10-10'), OCUPADOS)).toBe(cerrado);
  });
});

describe('estadoDelDia', () => {
  const hoy = dia('2026-10-01');
  const horizonte = dia('2026-12-30');

  it('lo de ayer es pasado', () => {
    expect(estadoDelDia(dia('2026-09-30'), OCUPADOS, hoy, horizonte)).toBe('pasado');
  });

  it('hoy no es pasado', () => {
    expect(estadoDelDia(hoy, OCUPADOS, hoy, horizonte)).toBe('libre');
  });

  it('lo reservado es ocupado', () => {
    expect(estadoDelDia(dia('2026-10-06'), OCUPADOS, hoy, horizonte)).toBe('ocupado');
  });

  it('⚠️ más allá del horizonte NO es libre', () => {
    // El backend mira 180 días; más allá no ha comprobado nada, y un día en
    // blanco se lee como disponible.
    expect(estadoDelDia(dia('2026-12-31'), OCUPADOS, hoy, horizonte)).toBe('fuera-de-horizonte');
  });

  it('sin horizonte declarado, no se inventa uno', () => {
    expect(estadoDelDia(dia('2027-05-01'), OCUPADOS, hoy, null)).toBe('libre');
  });
});

describe('posicionEnRango', () => {
  const r = { desde: dia('2026-10-01'), hasta: dia('2026-10-04') };

  it('distingue los cuatro sitios', () => {
    expect(posicionEnRango(dia('2026-10-01'), r)).toBe('inicio');
    expect(posicionEnRango(dia('2026-10-02'), r)).toBe('medio');
    expect(posicionEnRango(dia('2026-10-04'), r)).toBe('fin');
    expect(posicionEnRango(dia('2026-10-05'), r)).toBe('fuera');
  });

  it('un rango de un día es «único», no inicio y fin a la vez', () => {
    const uno = { desde: dia('2026-10-01'), hasta: dia('2026-10-01') };
    expect(posicionEnRango(dia('2026-10-01'), uno)).toBe('unico');
  });

  it('con solo la recogida puesta, ese día ya es «único»', () => {
    expect(posicionEnRango(dia('2026-10-01'), { desde: dia('2026-10-01'), hasta: null })).toBe('unico');
  });
});

describe('comoCampo', () => {
  it('sale con la hora de apertura, no a medianoche', () => {
    expect(comoCampo(dia('2026-10-01'))).toBe('2026-10-01T10:00');
  });
});

describe('parseDiaIso', () => {
  it('construye la fecha LOCAL, no la UTC', () => {
    // `new Date('2026-10-10')` da medianoche UTC: en Canarias en invierno, o
    // en América, el horizonte del calendario se correría un día.
    const d = parseDiaIso('2026-10-10')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(0);
  });

  it('lo que no sea una fecha da null, y entonces no hay horizonte', () => {
    expect(parseDiaIso(undefined)).toBeNull();
    expect(parseDiaIso('')).toBeNull();
    expect(parseDiaIso('2026-10-10T10:00')).toBeNull();
  });
});
