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
import { logger } from 'firebase-functions/v2';
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
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as typeof import('sharp').default;
import { firestore, storageBucket } from '../admin-guard';
import { PUBLIC_PHOTOS_FOLDER } from './mapper';
import { PublicVehiclePhoto } from './types';

/** El lado largo de una foto de escaparate. Más que esto no lo ve nadie. */
const LADO_MAXIMO = 1600;
const CALIDAD = 82;

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
    try {
      const [bytes] = await origen.download();
      const salida = await sharp(bytes)
        // Aplica la orientación del EXIF ANTES de descartarlo, o una foto de
        // móvil se publicaría girada.
        .rotate()
        .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: CALIDAD, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      procesada = salida.data;
      ancho = salida.info.width;
      alto = salida.info.height;
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
    const file = `${actuales.length + 1}_${sufijo}.jpg`;
    const destino = `${PUBLIC_PHOTOS_FOLDER}/${vehicleId}/${file}`;

    await bucket.file(destino).save(procesada, {
      contentType: 'image/jpeg',
      // Sin token de descarga: la carpeta es pública por regla, no por secreto.
      metadata: { cacheControl: 'public, max-age=86400' },
    });

    const nueva: PublicVehiclePhoto = { file, ...(ancho ? { width: ancho } : {}), ...(alto ? { height: alto } : {}) };
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
