import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_SIZE,
  MAX_THUMBNAIL_SIZE,
  calculateTargetSize,
  resizedFilename
} from './image-resize.util';

/**
 * Solo la aritmética y el nombre del fichero.
 *
 * El redimensionado en sí usa `createImageBitmap` y `<canvas>`, que jsdom no
 * implementa: comprobarlo aquí sería comprobar un doble, no el navegador. Esa
 * parte se verifica subiendo una foto de verdad.
 */
describe('calculateTargetSize', () => {
  it('reduce por el lado mayor y mantiene la proporción', () => {
    // Foto de móvil típica, apaisada.
    expect(calculateTargetSize(4032, 3024, MAX_IMAGE_SIZE)).toEqual({
      width: 1600,
      height: 1200
    });
  });

  it('funciona igual en vertical', () => {
    expect(calculateTargetSize(3024, 4032, MAX_IMAGE_SIZE)).toEqual({
      width: 1200,
      height: 1600
    });
  });

  it('NO amplía una imagen más pequeña que el límite', () => {
    // Ampliar solo añade peso y desenfoque.
    expect(calculateTargetSize(800, 600, MAX_IMAGE_SIZE)).toEqual({
      width: 800,
      height: 600
    });
  });

  it('deja pasar la que mide justo el límite', () => {
    expect(calculateTargetSize(1600, 900, MAX_IMAGE_SIZE)).toEqual({
      width: 1600,
      height: 900
    });
  });

  it('nunca devuelve un lado de 0 px', () => {
    // Una panorámica muy alargada redondearía el lado corto a cero, y
    // `drawImage` con altura 0 lanza.
    const r = calculateTargetSize(10000, 12, MAX_THUMBNAIL_SIZE);
    expect(r.width).toBe(400);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it('devuelve ceros ante medidas imposibles en vez de romper', () => {
    expect(calculateTargetSize(0, 0, MAX_IMAGE_SIZE)).toEqual({ width: 0, height: 0 });
    expect(calculateTargetSize(-5, 100, MAX_IMAGE_SIZE)).toEqual({ width: 0, height: 0 });
    expect(calculateTargetSize(Number.NaN, 100, MAX_IMAGE_SIZE)).toEqual({ width: 0, height: 0 });
  });

  it('la miniatura es bastante más pequeña que la versión de uso', () => {
    const grande = calculateTargetSize(4032, 3024, MAX_IMAGE_SIZE);
    const mini = calculateTargetSize(4032, 3024, MAX_THUMBNAIL_SIZE);
    expect(mini.width).toBeLessThan(grande.width);
    expect(mini.width).toBe(400);
  });
});

describe('resizedFilename', () => {
  it('cambia la extensión a jpg', () => {
    expect(resizedFilename('IMG_1234.HEIC')).toBe('IMG_1234.jpg');
    expect(resizedFilename('foto.png')).toBe('foto.png'.replace('.png', '.jpg'));
  });

  it('añade el sufijo antes de la extensión', () => {
    expect(resizedFilename('foto.jpg', '-thumb')).toBe('foto-thumb.jpg');
  });

  it('limpia lo que no vale en una ruta de Storage', () => {
    // Los nombres que llegan del móvil traen espacios y acentos.
    expect(resizedFilename('foto del coche (1).jpg')).toBe('foto_del_coche__1_.jpg');
  });

  it('sobrevive a un nombre sin extensión', () => {
    expect(resizedFilename('captura')).toBe('captura.jpg');
  });
});
