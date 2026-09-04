/**
 * El QR del contrato, como matriz de módulos.
 *
 * Se dibuja **vectorial** —un rectángulo por módulo negro— en vez de incrustar
 * un PNG: el símbolo sale nítido a cualquier tamaño de impresión, que es
 * precisamente el caso de uso (un contrato en papel), y no añade un megabyte de
 * imagen a un PDF que ya pesa.
 */

import qrcode = require('qrcode-generator');

export interface QrMatrix {
  /** Módulos por lado, sin contar la zona de silencio. */
  count: number;
  /** `true` si el módulo (fila, columna) es negro. */
  isDark(row: number, col: number): boolean;
}

/**
 * Corrección de errores **M** (~15 %).
 *
 * Es el punto medio habitual, y aquí importa más de lo normal: el símbolo va
 * impreso en un contrato que se dobla, se guarda en una guantera y se fotocopia.
 * Subir a `Q` engordaría la matriz y con ella el módulo mínimo legible.
 */
const ERROR_CORRECTION = 'M' as const;

/** Un rectángulo negro del símbolo, en coordenadas de PDF (origen abajo). */
export interface QrRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Los rectángulos que hay que pintar para un símbolo, dentro del cuadrado
 * `(x, y, size)` — con `x`,`y` en la esquina **inferior izquierda**, como en
 * pdf-lib, y `size` incluyendo la zona de silencio.
 *
 * ⚠️ **La zona de silencio no es decoración.** Sin los 4 módulos en blanco de
 * alrededor muchos lectores ni encuentran el símbolo, y este se escanea con un
 * móvil cualquiera, de pie y a la primera.
 *
 * Los módulos de una misma fila se funden en un solo rectángulo: además de
 * dibujar menos, evita la costura clara que el antialiasing deja entre dos
 * rectángulos negros que se tocan justo en el borde.
 *
 * Vive aparte del dibujo para poder comprobarlo: un índice de fila invertido
 * produce un símbolo con la pinta de siempre que **no se lee**, y eso no se ve
 * mirando el PDF.
 */
export function qrRects(qr: QrMatrix, x: number, y: number, size: number): QrRect[] {
  const QUIET = 4;
  const cell = size / (qr.count + QUIET * 2);
  const left = x + cell * QUIET;
  const top = y + size - cell * QUIET;
  const rects: QrRect[] = [];

  for (let row = 0; row < qr.count; row++) {
    let runStart = -1;
    for (let col = 0; col <= qr.count; col++) {
      const dark = col < qr.count && qr.isDark(row, col);
      if (dark && runStart < 0) runStart = col;
      if (!dark && runStart >= 0) {
        rects.push({
          x: left + runStart * cell,
          // La fila 0 de la matriz es la de ARRIBA; en PDF la `y` crece hacia
          // arriba. Sin esta resta el símbolo sale reflejado en vertical.
          y: top - (row + 1) * cell,
          width: (col - runStart) * cell,
          height: cell
        });
        runStart = -1;
      }
    }
  }
  return rects;
}

export function buildQrMatrix(text: string): QrMatrix {
  // Tipo 0 = la versión más pequeña en la que quepa el texto. La URL de
  // verificación cambia de largo con el dominio de cada entorno, así que fijar
  // una versión sería fijar un límite que un dominio más largo rompería.
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(text);
  qr.make();
  return {
    count: qr.getModuleCount(),
    isDark: (row, col) => qr.isDark(row, col)
  };
}
