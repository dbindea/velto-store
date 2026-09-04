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
