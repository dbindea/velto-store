/**
 * Publicar una foto de un coche: de la galería interna al escaparate.
 *
 * ⚠️ **Recodifica SIEMPRE en el servidor. Nunca copia bytes.** Y esa es la razón
 * de que esta function exista en vez de un `copy()` de Storage, que sería una
 * línea:
 *
 * `isResizableImage()` en el frontend solo admite `jpeg|jpg|png|webp`, y deja
 * **HEIC fuera a propósito** —Safari lo decodifica y Chrome no—, así que
 * `resizeImage()` devuelve `null` y `vehicle.service.ts` sube **el fichero
 * original tal cual**. El comentario de allí dice «se sube tal cual y no se
 * rompe nada», y es verdad… mientras la carpeta sea privada. HEIC es el formato
 * por defecto de un iPhone, y un HEIC original conserva su **EXIF**: las
 * coordenadas GPS donde se hizo la foto y la fecha exacta. Copiar ese fichero a
 * una carpeta con `allow read: if true` publica dónde estaba el coche.
 *
 * Recodificar con `sharp` lo resuelve de raíz: se descartan todos los metadatos,
 * se aplica la orientación y sale un JPEG previsible. **Lo que no se pueda
 * procesar se rechaza**, no se pasa tal cual — el camino que pasa el original es
 * justo el que trae el problema.
 *
 * ⚠️ **Y el nombre del fichero se inventa aquí.** `vehiclePhotoName()`, la única
 * autoridad de nombres del proyecto, pone **la matrícula primero**
 * (`4466LKK_mfk3n1.jpg`) y está muy bien pensado para uso interno — el fichero
 * descargado dice de qué coche es. Reutilizarlo aquí publicaría la matrícula en
 * la URL, o sea el campo que la lista blanca excluye, por una vía que nadie
 * auditaría. El nombre público no lleva ningún dato del negocio.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
/**
 * ⚠️ **`require`, y NO `import sharp from 'sharp'`.** Esa línea compila sin una
 * queja y revienta en producción con `(0, sharp_1.default) is not a function`.
 *
 * El motivo es que **el compilador y Node miran ficheros distintos**. El
 * `package.json` de sharp declara `"types": "./dist/index.d.mts"` —la
 * declaración **ESM**, que exporta `export default sharp`— pero su `"main"` es
 * `./dist/index.cjs`, que es **CommonJS** y hace `export = sharp`, sin ningún
 * `default`. Este tsconfig usa la resolución clásica, que **ignora el campo
 * `exports`** donde sharp sí emparejaría bien cada formato: así que TypeScript
 * da por buena una exportación por defecto que en ejecución no existe.
 *
 * ⚠️ **Y la comprobación de siempre NO lo caza.** El
 * `node -e "require('./lib/index.js')"` que este proyecto usa para descartar el
 * código antes de desplegar **carga el bundle sin un error**: cargar un módulo
 * no es llamarlo. Tampoco lo ve `tsc --noEmit`, ni el build, ni los tests. Solo
 * se ve ejecutando la function contra el servidor — el patrón de fallo
 * dominante de esta casa, metido en una línea de `import`.
 *
 * Se deja el `require` en vez de tocar `moduleResolution` en el tsconfig:
 * cambiarlo afectaría a la resolución de **las veintiséis functions ya
 * desplegadas** para arreglar un import.
 *
 * ⚠️ **Y desde el 28 de septiembre de 2026 el `require` está MEMOIZADO, no
 * convertido en `await import()`.** Convertirlo reintroduciría el fallo de
 * arriba palabra por palabra. Esto mantiene la misma resolución de módulo; lo
 * único que cambia es **cuándo** ocurre.
 *
 * Y cambia bastante: `index.ts` reexporta las 34 functions y el contenedor las
 * evalúa todas al arrancar, así que el `libvips` de sharp —59 ms y varios
 * megas de memoria— se cargaba también cuando la petición era listar cuatro
 * coches en la web pública. Esta function la llama un administrador al publicar
 * una foto, y nadie más.
 */
let _sharp: typeof import('sharp').default | undefined;
function sharp(): typeof import('sharp').default {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (_sharp ??= require('sharp') as typeof import('sharp').default);
}
import { firestore, storageBucket } from '../admin-guard';
import { PUBLIC_PHOTOS_FOLDER } from './mapper';
import type { PublicVehiclePhoto } from './types';

/**
 * Los anchos que se generan de cada foto, y el formato.
 *
 * ⚠️ **Antes se generaba UNO solo, de 1600 px, y era el que se servía siempre.**
 * Medido el 28 de septiembre de 2026: las tarjetas de la flota pintan **349 px**
 * de ancho CSS y la ficha 350, así que se bajaban **328 KB para un hueco cuatro
 * veces más pequeño** — y eso pasa en *todas* las visitas, no solo en la
 * primera: ninguna optimización del arranque lo toca. Una sola foto tardaba
 * **1,9 s**.
 *
 * Tres anchos cubren lo que hay: 400 para una tarjeta en móvil, 800 para esa
 * misma tarjeta en una pantalla de densidad doble —que es el caso normal hoy— y
 * 1600 para quien abra la foto grande en un escritorio.
 *
 * ⚠️ **WebP, con JPEG de respaldo.** WebP pesa alrededor de la mitad que un JPEG
 * de calidad equivalente, y lo entiende todo lo que se usa hoy. Pero el respaldo
 * no sobra: se sirve por `<picture>`, así que un navegador que no lo entienda
 * recibe el JPEG sin que nadie se quede sin foto. Y el JPEG es además lo que
 * mantiene vivas las fotos publicadas **antes** de este cambio, que solo tienen
 * ese fichero.
 */
const ANCHOS = [400, 800, 1600] as const;

/** El lado largo del JPEG de respaldo: el intermedio, no el grande. */
const LADO_RESPALDO = 800;

const CALIDAD = 82;

/**
 * ⚠️ **72 y no 78, y `effort: 5`, porque el JPEG de esta casa es DURO de batir.**
 *
 * Medido el 28 de septiembre de 2026 sobre una foto real, a 800 px: el JPEG con
 * `mozjpeg` a calidad 82 salía en **79 KB** y el WebP a 78 en **81 KB** — o sea
 * que el formato «moderno» pesaba MÁS. `mozjpeg` es un compresor muy bueno, y
 * dar por hecho que WebP gana siempre es justo la clase de suposición que este
 * proyecto paga midiendo.
 *
 * Con 72 y más esfuerzo de compresión sí gana, y la diferencia visual a este
 * tamaño no se aprecia. `effort` va de 0 a 6 y solo cuesta tiempo **al
 * publicar**, que es una operación manual y rara: el visitante solo ve el
 * resultado.
 *
 * ⚠️ Y conviene no perder de vista de dónde viene el ahorro de verdad: no del
 * formato, sino del **tamaño**. Servir 400 px donde se pintan 350 son 19 KB
 * frente a los 328 de la foto de 1600 — diecisiete veces menos. El formato
 * aporta un 10 % encima de eso.
 */
const CALIDAD_WEBP = 72;
const ESFUERZO_WEBP = 5;

/** Cuántas fotos puede tener publicadas un coche. */
const MAX_FOTOS = 12;

/** El fichero de origen más grande que se acepta procesar. */
const MAX_BYTES_ORIGEN = 25 * 1024 * 1024;

interface Peticion {
  vehicleId?: string;
  /** Ruta del original dentro de `vehicles/{vehicleId}/…`. */
  sourcePath?: string;
}

/**
 * ⚠️ **El rol se lee de Firestore, no del token.** El claim viaja dentro de un
 * token que dura una hora, así que alguien degradado hace diez minutos seguiría
 * pareciendo administrador — es la misma razón por la que las devoluciones a
 * tarjeta leen la ficha viva. Y aquí importa: publicar una foto es sacarla a
 * internet para siempre, porque queda en cachés y en buscadores.
 */
async function exigeAdmin(request: CallableRequest): Promise<void> {
  const email = request.auth?.token?.email;
  if (!email) throw new HttpsError('unauthenticated', 'auth.errors.notSignedIn');
  const snap = await firestore().collection('authorizedUsers').doc(email.toLowerCase()).get();
  if (!snap.exists || snap.data()?.active !== true || snap.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'permissions.notAllowed');
  }
}

export const publishVehiclePhoto = onCall(
  { memory: '512MiB', timeoutSeconds: 120 },
  async (request: CallableRequest<Peticion>) => {
    await exigeAdmin(request);

    const vehicleId = request.data?.vehicleId;
    const sourcePath = request.data?.sourcePath;
    if (typeof vehicleId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(vehicleId)) {
      throw new HttpsError('invalid-argument', 'vehicles.errors.publishBadVehicle');
    }
    /**
     * ⚠️ **El origen tiene que estar dentro de la carpeta de ESTE coche.** Sin
     * comprobarlo, un `sourcePath` cualquiera convertiría esto en «copia lo que
     * yo diga a una carpeta pública» — el DNI de un cliente, por ejemplo.
     */
    const prefijoEsperado = `vehicles/${vehicleId}/`;
    if (
      typeof sourcePath !== 'string' ||
      !sourcePath.startsWith(prefijoEsperado) ||
      sourcePath.includes('..')
    ) {
      throw new HttpsError('invalid-argument', 'vehicles.errors.publishBadSource');
    }

    const bucket = storageBucket().bucket();
    const origen = bucket.file(sourcePath);
    const [existe] = await origen.exists();
    if (!existe) throw new HttpsError('not-found', 'vehicles.errors.publishSourceMissing');

    const [meta] = await origen.getMetadata();
    if (Number(meta.size ?? 0) > MAX_BYTES_ORIGEN) {
      throw new HttpsError('invalid-argument', 'vehicles.errors.publishTooLarge');
    }

    const docRef = firestore().collection('vehicles').doc(vehicleId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'vehicles.errors.notFound');
    const actuales = (snap.data()?.publicPhotos ?? []) as PublicVehiclePhoto[];
    if (actuales.length >= MAX_FOTOS) {
      throw new HttpsError('failed-precondition', 'vehicles.errors.publishTooMany');
    }

    let procesada: Buffer;
    let ancho: number | undefined;
    let alto: number | undefined;
    /** Los WebP generados: `{ ancho → bytes }`. */
    const webp = new Map<number, Buffer>();
    try {
      const [bytes] = await origen.download();

      /**
       * ⚠️ **Se rota UNA vez y se reutiliza el resultado.** `.rotate()` aplica
       * la orientación del EXIF antes de descartarlo —sin eso una foto de móvil
       * se publica girada— y decodificar el original cuatro veces para generar
       * cuatro salidas costaría cuatro veces lo mismo. Se decodifica una y de
       * ahí salen todas.
       */
      const base = sharp()(bytes).rotate();
      const normalizado = await base.toBuffer();

      // El JPEG de respaldo, y de paso el que da las medidas que se guardan.
      const salida = await sharp()(normalizado)
        .resize({ width: LADO_RESPALDO, height: LADO_RESPALDO, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: CALIDAD, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      procesada = salida.data;
      ancho = salida.info.width;
      alto = salida.info.height;

      for (const w of ANCHOS) {
        const v = await sharp()(normalizado)
          .resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: CALIDAD_WEBP, effort: ESFUERZO_WEBP })
          .toBuffer();
        webp.set(w, v);
      }
    } catch (error) {
      /**
       * ⚠️ **Se rechaza, NO se sube el original.** Pasar lo que sharp no sabe
       * leer es exactamente el camino por el que un HEIC intacto —con su GPS
       * dentro— acabaría publicado.
       */
      /**
       * ⚠️ **El `Error` se desarma a mano.** Pasarlo entero al logger lo
       * serializa como `{}` —sus propiedades no son enumerables— y el registro
       * queda diciendo que algo falló sin decir qué, que es peor que no
       * registrarlo: parece cubierto y no lo está. Pasó con este mismo `catch`.
       */
      const e = error as Error;
      logger.error('No se pudo recodificar la foto; no se publica', {
        vehicleId,
        sourcePath,
        motivo: e?.message ?? String(error),
      });
      throw new HttpsError('invalid-argument', 'vehicles.errors.publishUnreadable');
    }

    /**
     * El nombre: índice de orden y un sufijo único. **Ningún dato del negocio
     * dentro** — ni matrícula, ni marca, ni el nombre del fichero original, que
     * en un móvil puede ser cualquier cosa.
     *
     * El sufijo evita que republicar pise la anterior: en Storage subir dos
     * veces el mismo nombre **sobrescribe sin avisar**.
     */
    const sufijo = Math.random().toString(36).slice(2, 8);
    const raiz = `${actuales.length + 1}_${sufijo}`;
    const file = `${raiz}.jpg`;
    const carpeta = `${PUBLIC_PHOTOS_FOLDER}/${vehicleId}`;

    /**
     * ⚠️ **Un año de caché, y antes era un día.** El nombre lleva un sufijo
     * aleatorio y **nunca se reescribe**: republicar genera otro nombre, porque
     * en Storage subir dos veces el mismo pisa el anterior sin avisar. Con un
     * nombre que no puede cambiar de contenido, `max-age=86400` obligaba a
     * quien volviera al día siguiente a bajarse otra vez el mismo byte.
     */
    const CACHE = 'public, max-age=31536000, immutable';

    await bucket.file(`${carpeta}/${file}`).save(procesada, {
      contentType: 'image/jpeg',
      // Sin token de descarga: la carpeta es pública por regla, no por secreto.
      metadata: { cacheControl: CACHE },
    });

    const variantes: Array<{ w: number; file: string }> = [];
    for (const [w, datos] of webp) {
      const nombre = `${raiz}-${w}.webp`;
      await bucket.file(`${carpeta}/${nombre}`).save(datos, {
        contentType: 'image/webp',
        metadata: { cacheControl: CACHE },
      });
      variantes.push({ w, file: nombre });
    }

    /**
     * ⚠️ **`srcset` es ADITIVO: `file` sigue siendo el JPEG de siempre.** Las
     * fotos publicadas antes de este cambio solo tienen ese campo, y tienen que
     * seguir viéndose sin migrar nada — que es la regla de producción desde el
     * 17 de septiembre. El mapeador compone el `<picture>` solo cuando hay
     * variantes, y cuando no, sirve el JPEG como siempre.
     */
    const nueva: PublicVehiclePhoto = {
      file,
      ...(ancho ? { width: ancho } : {}),
      ...(alto ? { height: alto } : {}),
      ...(variantes.length ? { srcset: variantes } : {}),
    };
    await docRef.update({
      publicPhotos: [...actuales, nueva],
      updatedAt: { seconds: Date.now() / 1000 },
    });

    logger.info('Foto publicada', { vehicleId, file });
    return { photo: nueva };
  }
);

/** Retirar una foto del escaparate: se borra de Storage y del documento. */
export const unpublishVehiclePhoto = onCall(
  async (request: CallableRequest<{ vehicleId?: string; file?: string }>) => {
    await exigeAdmin(request);

    const vehicleId = request.data?.vehicleId;
    const file = request.data?.file;
    if (
      typeof vehicleId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(vehicleId) ||
      typeof file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(file)
    ) {
      throw new HttpsError('invalid-argument', 'vehicles.errors.publishBadSource');
    }

    const docRef = firestore().collection('vehicles').doc(vehicleId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'vehicles.errors.notFound');

    const actuales = (snap.data()?.publicPhotos ?? []) as PublicVehiclePhoto[];
    await docRef.update({
      publicPhotos: actuales.filter(p => p.file !== file),
      updatedAt: { seconds: Date.now() / 1000 },
    });

    // El fichero va DESPUÉS del documento, al revés que en un borrado normal:
    // aquí lo urgente es dejar de enseñarla. Un huérfano en la carpeta pública
    // es una foto de un coche, no el DNI de nadie.
    try {
      await storageBucket().bucket().file(`${PUBLIC_PHOTOS_FOLDER}/${vehicleId}/${file}`).delete();
    } catch (error) {
      logger.warn('La foto se retiró del coche pero no se pudo borrar de Storage', { vehicleId, file, error });
    }

    return { ok: true };
  }
);
