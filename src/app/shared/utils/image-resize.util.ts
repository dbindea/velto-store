/**
 * Reducción de imágenes **en el navegador, antes de subirlas**.
 *
 * El operador hace las fotos con el móvil, y una foto de móvil son 3-5 MB. Se
 * subían tal cual y luego se pintaban en una caja de 140 px: se pagaba el peso
 * dos veces, al subir con datos móviles y al mirar la lista de flota.
 *
 * Aquí se resuelven las dos mitades del problema de una vez. Se genera una
 * versión de uso (máx. 1600 px) y una miniatura (máx. 400 px), y se sube solo
 * eso. Una foto de 4 MB se queda en unos 300 KB, que sigue siendo de sobra para
 * documentar un arañazo o leer una matrícula.
 *
 * Se hace en el cliente y no en una Cloud Function a propósito: no añade
 * infraestructura, no cuesta ejecuciones, y **es lo único que mejora también la
 * subida** — que es donde el operador espera, en la calle y con cobertura mala.
 */

/** Lado mayor de la versión que se guarda para ver. */
export const MAX_IMAGE_SIZE = 1600;

/** Lado mayor de la miniatura de listados. */
export const MAX_THUMBNAIL_SIZE = 400;

/** Calidad JPEG. 0,85 no se distingue a simple vista y pesa la mitad que 1. */
export const IMAGE_QUALITY = 0.85;

/**
 * Las dimensiones de destino, respetando la proporción.
 *
 * Una imagen **más pequeña que el límite no se amplía**: reescalar hacia arriba
 * solo añade peso y desenfoque.
 */
export function calculateTargetSize(
  width: number,
  height: number,
  maxSize: number
): { width: number; height: number } {
  if (!width || !height || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }

  const longest = Math.max(width, height);
  if (longest <= maxSize) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const ratio = maxSize / longest;
  return {
    // Nunca menos de 1 px: una panorámica muy alargada redondearía el lado
    // corto a 0 y `drawImage` fallaría.
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

/** True si el fichero es una imagen que el navegador sabe redibujar. */
export function isResizableImage(file: File): boolean {
  // HEIC queda fuera a propósito: Safari lo decodifica y Chrome no, así que el
  // resultado dependería del teléfono. Se sube tal cual y no se rompe nada.
  return /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
}

/**
 * Reduce una imagen a `maxSize` en su lado mayor y la devuelve como JPEG.
 *
 * Devuelve `null` si no se puede — formato que el navegador no decodifica,
 * fichero corrupto — y entonces quien llama sube el original. **Perder la
 * miniatura no puede impedir guardar la foto.**
 */
export async function resizeImage(
  file: File,
  maxSize: number,
  quality: number = IMAGE_QUALITY
): Promise<Blob | null> {
  if (!isResizableImage(file)) return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = calculateTargetSize(bitmap.width, bitmap.height, maxSize);
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });
  } catch {
    return null;
  } finally {
    // `ImageBitmap` retiene la imagen descodificada en memoria hasta que se
    // cierra. Con varias fotos seguidas desde el móvil, no cerrarlas es la
    // diferencia entre que la pestaña aguante o se recargue sola.
    bitmap?.close();
  }
}

/** Nombre de fichero para la versión reducida, siempre `.jpg`. */
export function resizedFilename(original: string, suffix = ''): string {
  const base = original.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${base}${suffix}.jpg`;
}
