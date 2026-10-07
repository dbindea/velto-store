import { describe, expect, it } from 'vitest';
import {
  comoValor,
  horasValidas,
  minutosDelPaso,
  minutosValidos,
  parseFecha,
  parseFechaHora,
  parseLimite,
  rejillaDelMes,
  sumarMeses,
} from './fecha-picker';

/**
 * ⚠️ **Estos tests son la mitad del port, no un extra.**
 *
 * El panel del backoffice tiene los suyos (`date-picker.util.spec.ts`), y al
 * traerse la aritmética a `web/` se traía **sin red**: esta build no tenía
 * runner, ni lint, ni ninguna de las cuatro auditorías. Y el sitio donde
 * aterriza es el buscador de la portada, o sea lo que decide si alguien
 * reserva. Por eso `web/package.json` estrena `vitest` en la misma tanda.
 *
 * Lo que se comprueba aquí es justo lo que no se ve mirando la pantalla: de qué
 * día empieza la semana, qué pasa en el cambio de mes, y las dos correcciones
 * que este módulo hace sobre el original.
 */

describe('leer lo que guarda el campo', () => {
  it('construye la fecha LOCAL, no la UTC', () => {
    const d = parseFecha('2026-10-10')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    // Lo que de verdad se comprueba: que no es el día 9. `new Date('2026-10-10')`
    // se lee como medianoche UTC y en cualquier huso al oeste da el día anterior.
    expect(d.getDate()).toBe(10);
  });

  it('lee la hora de un datetime-local', () => {
    const d = parseFechaHora('2026-10-10T18:45')!;
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(45);
  });

  it('descarta lo que no es una fecha, en vez de inventarse una', () => {
    expect(parseFecha('')).toBeNull();
    expect(parseFecha('10/10/2026')).toBeNull();
    expect(parseFechaHora('2026-10-10')).toBeNull();
    expect(parseFechaHora('2026-10-10T99:99')).toBeNull();
  });

  it('ida y vuelta: lo que escribe comoValor lo vuelve a leer parseFechaHora', () => {
    const d = new Date(2026, 1, 28, 9, 5);
    expect(comoValor(d)).toBe('2026-02-28T09:05');
    expect(parseFechaHora(comoValor(d))!.getTime()).toBe(d.getTime());
  });
});

/**
 * La corrección nº 1. En el backoffice esto devuelve `null` y el calendario no
 * bloquea ni un día.
 */
describe('parseLimite acepta las DOS formas de escribir un limite', () => {
  it('lee el dia suelto', () => {
    expect(parseLimite('2026-09-29')!.getDate()).toBe(29);
  });

  it('lee el dia CON hora, que es lo que lleva un datetime-local', () => {
    const d = parseLimite('2026-09-29T10:30')!;
    expect(d.getDate()).toBe(29);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
  });

  it('y por eso un min con hora SI bloquea el dia anterior', () => {
    const min = parseLimite('2026-09-29T10:30');
    const celdas = rejillaDelMes(new Date(2026, 8, 1), { min, hoy: new Date(2026, 8, 29) });
    const dia28 = celdas.find((c) => c.delMes && c.fecha.getDate() === 28)!;
    const dia29 = celdas.find((c) => c.delMes && c.fecha.getDate() === 29)!;
    expect(dia28.bloqueada).toBe(true);
    // El día del propio límite NO se bloquea: se alquila hoy por la tarde.
    expect(dia29.bloqueada).toBe(false);
  });
});

describe('la rejilla del mes', () => {
  it('siempre trae 42 celdas, aunque el mes quepa en menos filas', () => {
    // Febrero de 2027 empieza en lunes y tiene 28 días: cabe en cuatro filas.
    expect(rejillaDelMes(new Date(2027, 1, 1)).length).toBe(42);
    expect(rejillaDelMes(new Date(2026, 9, 1)).length).toBe(42);
  });

  it('empieza en LUNES', () => {
    const celdas = rejillaDelMes(new Date(2026, 9, 1));
    expect(celdas[0].fecha.getDay()).toBe(1);
  });

  it('un mes que empieza en domingo NO deja la primera fila vacia', () => {
    // El 1 de noviembre de 2026 es domingo: hay que retroceder seis días, no uno.
    const celdas = rejillaDelMes(new Date(2026, 10, 1));
    expect(celdas[0].fecha.getDate()).toBe(26);
    expect(celdas[0].fecha.getMonth()).toBe(9);
    const primeroDelMes = celdas.findIndex((c) => c.delMes && c.fecha.getDate() === 1);
    expect(primeroDelMes).toBe(6);
  });

  it('marca lo que es del mes y lo que viene de al lado', () => {
    const celdas = rejillaDelMes(new Date(2026, 9, 1));
    expect(celdas.filter((c) => c.delMes).length).toBe(31);
  });

  it('marca hoy y lo elegido por separado', () => {
    const celdas = rejillaDelMes(new Date(2026, 9, 1), {
      hoy: new Date(2026, 9, 15),
      elegida: new Date(2026, 9, 20, 18, 30),
    });
    expect(celdas.filter((c) => c.hoy).length).toBe(1);
    expect(celdas.find((c) => c.hoy)!.fecha.getDate()).toBe(15);
    // Lo elegido lleva hora dentro y aun así casa por día.
    expect(celdas.find((c) => c.elegida)!.fecha.getDate()).toBe(20);
  });

  it('bloquea por encima de max', () => {
    const celdas = rejillaDelMes(new Date(2026, 9, 1), { max: parseLimite('2026-10-10') });
    expect(celdas.find((c) => c.delMes && c.fecha.getDate() === 10)!.bloqueada).toBe(false);
    expect(celdas.find((c) => c.delMes && c.fecha.getDate() === 11)!.bloqueada).toBe(true);
  });
});

describe('sumarMeses no deja que un dia 31 se cuele en el mes siguiente', () => {
  it('del 31 de enero pasa a febrero, no a marzo', () => {
    const d = sumarMeses(new Date(2026, 0, 31), 1);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(1);
  });

  it('cambia de ano hacia atras', () => {
    const d = sumarMeses(new Date(2026, 0, 15), -1);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11);
  });
});

/**
 * La corrección nº 2. Con los cinco minutos del backoffice y `step="900"` el
 * campo queda `stepMismatch` y el botón deja de hacer nada, sin error.
 */
describe('los minutos salen del step del campo', () => {
  it('con step=900 son los cuartos, y NADA mas', () => {
    expect(minutosDelPaso(900)).toEqual([0, 15, 30, 45]);
  });

  it('con step=300 son los cinco minutos de siempre', () => {
    expect(minutosDelPaso(300)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it('con step=1800 son las medias', () => {
    expect(minutosDelPaso(1800)).toEqual([0, 30]);
  });

  it('un step que no divide la hora cae a los cuartos, no a una lista rara', () => {
    expect(minutosDelPaso(420)).toEqual([0, 15, 30, 45]);
    expect(minutosDelPaso(3600)).toEqual([0, 15, 30, 45]);
    expect(minutosDelPaso(1)).toEqual([0, 15, 30, 45]);
  });

  it('sin step, o con un step ilegible, tambien', () => {
    expect(minutosDelPaso(null)).toEqual([0, 15, 30, 45]);
    expect(minutosDelPaso(undefined)).toEqual([0, 15, 30, 45]);
    expect(minutosDelPaso(0)).toEqual([0, 15, 30, 45]);
    expect(minutosDelPaso(NaN)).toEqual([0, 15, 30, 45]);
  });
});

describe('hoy no vale cualquier hora', () => {
  const min = new Date(2026, 8, 29, 10, 30);

  it('el dia del min recorta las horas ya pasadas', () => {
    const horas = horasValidas(new Date(2026, 8, 29), min);
    expect(horas).not.toContain(9);
    expect(horas).toContain(10);
    expect(horas).toContain(23);
  });

  it('al dia siguiente valen todas las de oficina, de 07:00 a 23:00', () => {
    const horas = horasValidas(new Date(2026, 8, 30), min);
    expect(horas).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  });

  /**
   * ⚠️ **La madrugada no se ofrece NUNCA, ni el día del `min` ni los demás.**
   * Este test decía «al día siguiente valen las 24» hasta el 8 de octubre de
   * 2026, y era cierto: el panel ofrecía de 00:00 a 06:00, horas a las que no
   * hay nadie en la oficina. Se comprueba aparte del recorte por `min` porque
   * son dos reglas distintas que se aplican sobre la misma lista.
   */
  it('la madrugada no sale aunque no haya limites', () => {
    const horas = horasValidas(new Date(2026, 8, 30));
    expect(horas[0]).toBe(7);
    expect(horas).not.toContain(0);
    expect(horas).not.toContain(6);
  });

  it('en la hora exacta del min se recortan los minutos', () => {
    const paso = minutosDelPaso(900);
    expect(minutosValidos(new Date(2026, 8, 29), 10, paso, min)).toEqual([30, 45]);
    // Una hora más tarde ya valen los cuatro.
    expect(minutosValidos(new Date(2026, 8, 29), 11, paso, min)).toEqual([0, 15, 30, 45]);
  });

  it('max recorta por arriba', () => {
    const max = new Date(2026, 8, 29, 14, 15);
    expect(horasValidas(new Date(2026, 8, 29), null, max)).not.toContain(15);
    expect(minutosValidos(new Date(2026, 8, 29), 14, minutosDelPaso(900), null, max)).toEqual([
      0, 15,
    ]);
  });
});
