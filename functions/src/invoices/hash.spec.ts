/**
 * La huella se prueba porque **una huella mal calculada tiene el mismo aspecto
 * que una buena**: 64 caracteres hexadecimales que no se pueden mirar y decir
 * si están bien. Es el mismo motivo por el que el QR del contrato tiene un test
 * que lo rasteriza y lo lee.
 *
 * Lo que se comprueba es el formato exacto de la cadena de entrada —fechas,
 * importes, orden de los campos— porque ahí es donde se rompe la coincidencia
 * con lo que calcule la AEAT, y no se notaría hasta 2027.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRegistroAltaString,
  computeRegistroAltaHash,
  formatFechaExpedicion,
  formatFechaHoraHuso,
  formatImporte,
  RegistroAltaHashInput
} from './hash';

const base: RegistroAltaHashInput = {
  idEmisorFactura: 'B88866900',
  numSerieFactura: '2026/0001',
  fechaExpedicion: new Date('2026-09-08T10:00:00Z'),
  tipoFactura: 'F1',
  cuotaTotal: 34.65,
  importeTotal: 199.65,
  huellaAnterior: '',
  fechaHoraGenRegistro: new Date('2026-09-08T10:00:00Z'),
  timeZone: 'Europe/Madrid'
};

describe('formatFechaExpedicion', () => {
  it('usa dd-mm-aaaa, que es lo que pide la especificación', () => {
    expect(formatFechaExpedicion(base.fechaExpedicion, 'Europe/Madrid')).toBe('08-09-2026');
  });

  it('compone en la zona del negocio, no en la del runtime', () => {
    // 00:30 del día 9 en Madrid es todavía el día 8 en UTC. Las functions
    // corren en UTC: sin fijar la zona, la factura llevaría la fecha de ayer.
    const madrugada = new Date('2026-09-08T22:30:00Z'); // 00:30 del 9 en Madrid
    expect(formatFechaExpedicion(madrugada, 'Europe/Madrid')).toBe('09-09-2026');
    expect(formatFechaExpedicion(madrugada, 'UTC')).toBe('08-09-2026');
  });
});

describe('formatFechaHoraHuso', () => {
  it('lleva el huso y no una Z, en horario de verano', () => {
    expect(formatFechaHoraHuso(new Date('2026-09-08T10:00:00Z'), 'Europe/Madrid')).toBe(
      '2026-09-08T12:00:00+02:00'
    );
  });

  it('cambia el huso en invierno, sin tocar nada', () => {
    expect(formatFechaHoraHuso(new Date('2026-01-15T10:00:00Z'), 'Europe/Madrid')).toBe(
      '2026-01-15T11:00:00+01:00'
    );
  });

  it('nunca escribe «GMT», que no es ISO 8601', () => {
    const s = formatFechaHoraHuso(new Date('2026-09-08T10:00:00Z'), 'UTC');
    expect(s).toBe('2026-09-08T10:00:00+00:00');
    expect(s).not.toContain('GMT');
  });
});

describe('formatImporte', () => {
  it('siempre dos decimales, aunque el número no los traiga', () => {
    expect(formatImporte(199.6)).toBe('199.60');
    expect(formatImporte(3000)).toBe('3000.00');
  });

  it('usa punto decimal, no coma', () => {
    expect(formatImporte(34.65)).toContain('.');
    expect(formatImporte(34.65)).not.toContain(',');
  });

  it('redondea a céntimo', () => {
    expect(formatImporte(22.869)).toBe('22.87');
  });
});

describe('buildRegistroAltaString', () => {
  it('respeta el orden y el formato de la especificación', () => {
    expect(buildRegistroAltaString(base)).toBe(
      'IDEmisorFactura=B88866900' +
        '&NumSerieFactura=2026/0001' +
        '&FechaExpedicionFactura=08-09-2026' +
        '&TipoFactura=F1' +
        '&CuotaTotal=34.65' +
        '&ImporteTotal=199.65' +
        '&Huella=' +
        '&FechaHoraHusoGenRegistro=2026-09-08T12:00:00+02:00'
    );
  });

  it('encadena la huella anterior cuando existe', () => {
    const s = buildRegistroAltaString({ ...base, huellaAnterior: 'ABC123' });
    expect(s).toContain('&Huella=ABC123&');
  });
});

describe('computeRegistroAltaHash', () => {
  it('devuelve 64 hexadecimales en MAYÚSCULAS', () => {
    const h = computeRegistroAltaHash(base);
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9A-F]{64}$/);
  });

  it('es estable: los mismos datos dan la misma huella', () => {
    expect(computeRegistroAltaHash(base)).toBe(computeRegistroAltaHash({ ...base }));
  });

  it('cambia si cambia el importe — que es para lo que sirve', () => {
    expect(computeRegistroAltaHash(base)).not.toBe(
      computeRegistroAltaHash({ ...base, importeTotal: 199.66 })
    );
  });

  it('cambia si cambia la huella anterior: eso es el encadenamiento', () => {
    const primera = computeRegistroAltaHash(base);
    const segunda = computeRegistroAltaHash({ ...base, huellaAnterior: primera });
    expect(segunda).not.toBe(primera);
  });

  it('alterar una factura del medio invalida todas las siguientes', () => {
    // Tres facturas encadenadas.
    const h1 = computeRegistroAltaHash(base);
    const dos = { ...base, numSerieFactura: '2026/0002', huellaAnterior: h1 };
    const h2 = computeRegistroAltaHash(dos);
    const h3 = computeRegistroAltaHash({
      ...base,
      numSerieFactura: '2026/0003',
      huellaAnterior: h2
    });

    // Alguien toca el importe de la segunda.
    const dosTocada = { ...dos, importeTotal: 1.0 };
    const h2Tocada = computeRegistroAltaHash(dosTocada);
    expect(h2Tocada).not.toBe(h2);

    // Y la tercera ya no cuadra con la cadena.
    const h3Recalculada = computeRegistroAltaHash({
      ...base,
      numSerieFactura: '2026/0003',
      huellaAnterior: h2Tocada
    });
    expect(h3Recalculada).not.toBe(h3);
  });
});
