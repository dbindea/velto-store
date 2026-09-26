import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Que una foto publicada NO lleve dentro dónde se hizo.
//
// ⚠️ **Este fichero existe por dos fallos distintos, y los dos pasaron.**
//
// El primero es el que motiva la recodificación: `isResizableImage()` en el
// frontend deja **HEIC fuera a propósito** —Safari lo decodifica y Chrome no—,
// así que un original de iPhone se sube **intacto, con su EXIF y sus
// coordenadas GPS dentro**. En la carpeta privada `vehicles/` eso no rompía
// nada; copiado tal cual a una carpeta con `allow read: if true`, publica dónde
// estaba el coche.
//
// El segundo es cómo se importa la biblioteca que lo arregla. `import sharp
// from 'sharp'` **compila sin una queja** y en producción da
// `(0, sharp_1.default) is not a function`: el `package.json` de sharp declara
// como tipos la variante **ESM** (`export default`) mientras `main` apunta a la
// **CommonJS** (`export =`), y la resolución clásica de este tsconfig ignora el
// campo `exports` que las emparejaría. O sea que el compilador da por buena una
// exportación que en ejecución no existe.
//
// ⚠️ **Y nada de lo que este proyecto ya hacía lo habría cazado**: ni
// `tsc --noEmit`, ni el build, ni los tests de entonces, ni siquiera el
// `node -e "require('./lib/index.js')"` con el que aquí se descarta el código
// antes de desplegar — porque **cargar un módulo no es llamarlo**. Hizo falta
// ejecutar la function contra el servidor y leer el log.
//
// Por eso este test no comprueba tipos: **llama**.
// ---------------------------------------------------------------------------

// La misma línea que usa `publishVehiclePhoto.ts`. Si alguien la "arregla" a un
// `import ... from`, este test se cae.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as typeof import('sharp').default;

/** Un JPEG con EXIF dentro, como el que sale de un móvil. */
async function fotoConExif(): Promise<Buffer> {
  return sharp({
    create: { width: 2400, height: 1600, channels: 3, background: { r: 40, g: 120, b: 110 } },
  })
    // El bloque GPS va con un `as`: los tipos de sharp solo declaran los IFD
    // numerados, y es justo el bloque que importa aquí.
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 15' },
      GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
    } as unknown as Parameters<ReturnType<typeof sharp>['withExif']>[0])
    .jpeg()
    .toBuffer();
}

describe('la recodificación que publica una foto', () => {
  /**
   * ⚠️ El test del import. Parece trivial y es el que faltaba: con
   * `import sharp from 'sharp'`, `sharp` vale `undefined` y esto falla — que es
   * justo lo que en producción salía como «no se pudo leer la imagen».
   */
  it('sharp es LLAMABLE, no solo importable', () => {
    expect(typeof sharp).toBe('function');
  });

  it('la foto de partida sí trae EXIF: si no, el test no probaría nada', async () => {
    const meta = await sharp(await fotoConExif()).metadata();
    expect(meta.exif).toBeTruthy();
  });

  /** El arreglo: recodificar descarta todos los metadatos. */
  it('la publicada NO trae EXIF', async () => {
    const publicada = await sharp(await fotoConExif())
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    const meta = await sharp(publicada).metadata();
    expect(meta.exif).toBeFalsy();
  });

  it('y se queda dentro del lado máximo, sin agrandar lo pequeño', async () => {
    const grande = await sharp(await fotoConExif())
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer({ resolveWithObject: true });
    expect(grande.info.width).toBe(1600);

    const pequena = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const salida = await sharp(pequena)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer({ resolveWithObject: true });
    expect(salida.info.width).toBe(300);
  });

  /**
   * ⚠️ Lo que NO se puede hacer es dejar pasar el original cuando falla la
   * recodificación: ese es exactamente el camino por el que un HEIC intacto
   * acabaría publicado con su GPS. La function lanza; aquí se fija que lo
   * ilegible efectivamente falla, y no devuelve algo a medias.
   */
  it('lo que no se puede leer FALLA, no pasa de largo', async () => {
    const basura = Buffer.from('esto no es una imagen');
    await expect(sharp(basura).jpeg().toBuffer()).rejects.toThrow();
  });
});
