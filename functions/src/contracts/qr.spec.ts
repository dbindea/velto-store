/**
 * El QR del contrato **se lee**.
 *
 * Es la única propiedad que importa de un símbolo QR y la única que no se ve
 * mirando el PDF: un índice de fila invertido o una zona de silencio olvidada
 * producen un cuadrado con la pinta de siempre que ningún móvil descifra. Y
 * como va impreso dentro de un documento que después se sella, no hay una
 * segunda oportunidad de arreglarlo.
 *
 * El test rasteriza **los rectángulos que se dibujan de verdad** —los que
 * `qrRects()` le pasa a pdf-lib— y los descifra con un lector real.
 */

import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { buildQrMatrix, qrRects, type QrRect } from './qr';

/**
 * Pinta los rectángulos en un bitmap RGBA y lo descifra.
 *
 * `size` son puntos PDF; se rasteriza a `scale` píxeles por punto, con el eje
 * vertical invertido, que es la conversión que hace cualquier visor.
 */
function decode(rects: QrRect[], size: number, scale = 6): string | null {
  const side = Math.round(size * scale);
  const data = new Uint8ClampedArray(side * side * 4).fill(255);

  for (const r of rects) {
    const x0 = Math.round(r.x * scale);
    const x1 = Math.round((r.x + r.width) * scale);
    // El origen del PDF está abajo y el de la imagen arriba.
    const y0 = Math.round((size - r.y - r.height) * scale);
    const y1 = Math.round((size - r.y) * scale);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * side + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }

  return jsQR(data, side, side)?.data ?? null;
}

describe('el QR de verificación', () => {
  const SIZE = 68; // los mismos puntos que ocupa en el contrato

  it('se lee, y dice exactamente la URL de verificación', () => {
    const url = 'https://rentalcar.veltomobility.com/v/3F7K9QD2XR84';
    const rects = qrRects(buildQrMatrix(url), 0, 0, SIZE);
    expect(decode(rects, SIZE)).toBe(url);
  });

  /**
   * Los dos entornos tienen dominios de largo distinto, y el largo decide la
   * versión del símbolo. El corto es además el peor caso de densidad relativa.
   */
  it('se lee con el dominio de cualquiera de los dos entornos', () => {
    for (const url of [
      'https://store.veltorent.com/v/3F7K9QD2XR84',
      'https://rentalcar.veltomobility.com/v/3F7K9QD2XR84',
      'https://velto-store.web.app/v/3F7K9QD2XR84'
    ]) {
      const rects = qrRects(buildQrMatrix(url), 0, 0, SIZE);
      expect(decode(rects, SIZE), url).toBe(url);
    }
  });

  it('se lee esté donde esté en la página', () => {
    const url = 'https://store.veltorent.com/v/3F7K9QD2XR84';
    // Dibujado en (50, 600) y rasterizado restándole ese origen: si la
    // geometría dependiera de la posición absoluta, esto fallaría.
    const rects = qrRects(buildQrMatrix(url), 50, 600, SIZE).map((r) => ({
      ...r,
      x: r.x - 50,
      y: r.y - 600
    }));
    expect(decode(rects, SIZE)).toBe(url);
  });

  it('deja la zona de silencio en blanco a los cuatro lados', () => {
    const rects = qrRects(buildQrMatrix('https://store.veltorent.com/v/3F7K9QD2XR84'), 0, 0, SIZE);
    const matrix = buildQrMatrix('https://store.veltorent.com/v/3F7K9QD2XR84');
    const quiet = (SIZE / (matrix.count + 8)) * 4;

    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(quiet - 0.001);
      expect(r.y).toBeGreaterThanOrEqual(quiet - 0.001);
      expect(r.x + r.width).toBeLessThanOrEqual(SIZE - quiet + 0.001);
      expect(r.y + r.height).toBeLessThanOrEqual(SIZE - quiet + 0.001);
    }
  });
});

/**
 * El **QR tributario** de la factura, que es otro símbolo y con otras reglas.
 *
 * ⚠️ **Su URL es mucho más larga que la del contrato** —lleva NIF, número,
 * fecha e importe como parámetros—, así que el símbolo sale de una versión
 * mayor: más módulos en el mismo espacio y por tanto módulos más pequeños. Que
 * el del contrato se lea no dice nada del de la factura.
 *
 * El tamaño no es una decisión de diseño: el art. 21 de la Orden HAC/1177/2024
 * lo fija **entre 30×30 y 40×40 mm**. Iba a 62 pt —21,9 mm— y se quedaba por
 * debajo del mínimo.
 */
describe('el QR tributario de la factura', () => {
  /** 32 mm en puntos PDF, que es lo que dibuja `taxQr()`. */
  const SIZE = (32 / 25.4) * 72;

  const urlDe = (base: string, numero: string, importe: string) =>
    `${base}?nif=B88866900&numserie=${encodeURIComponent(numero)}&fecha=09-09-2026&importe=${importe}`;

  it('se lee, y dice exactamente la URL de cotejo', () => {
    const url = urlDe(
      'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
      '2026/0005',
      '127.05'
    );
    expect(decode(qrRects(buildQrMatrix(url), 0, 0, SIZE), SIZE)).toBe(url);
  });

  /**
   * Los dos validadores tienen dominios de largo distinto, y una rectificativa
   * lleva un número más largo que una factura ordinaria: los tres cambian la
   * versión del símbolo.
   */
  it('se lee en los dos entornos y con una rectificativa', () => {
    const casos = [
      urlDe('https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR', '2026/0005', '127.05'),
      urlDe('https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR', 'R2026/0001', '-36.30'),
      urlDe('https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR', '2026/9999', '12345.67')
    ];
    for (const url of casos) {
      expect(decode(qrRects(buildQrMatrix(url), 0, 0, SIZE), SIZE), url).toBe(url);
    }
  });

  /**
   * ⚠️ **El tamaño no se comprueba descifrando, se comprueba midiendo.**
   *
   * Un lector por software descifra el símbolo a 62 pt sin despeinarse —se
   * probó—, así que una prueba que dijera «al tamaño viejo no se lee» estaría
   * afirmando algo falso. Lo que el art. 21 fija es el tamaño **impreso**, y de
   * eso dependen la cámara de un móvil sobre un papel y la propia legalidad de
   * la factura, no lo que consiga un decodificador con un bitmap perfecto.
   */
  it('el tamaño está dentro de lo que fija el art. 21', () => {
    const mm = (SIZE / 72) * 25.4;
    expect(mm).toBeGreaterThanOrEqual(30);
    expect(mm).toBeLessThanOrEqual(40);
  });
});
