/**
 * De un documento de `vehicles` a lo que ve el mundo.
 *
 * ⚠️ **Este fichero es el único sitio por el que un campo puede salir a
 * internet, y está escrito para que salir cueste trabajo.** Nada de
 * `{ ...vehicle }`, nada de `delete`, nada de `Omit`: cada campo se nombra uno a
 * uno. Es más verboso y esa es toda la intención — un campo nuevo en el modelo
 * del coche **no aparece aquí solo**, y publicarlo obliga a venir a escribirlo.
 *
 * El fallo que esto evita no da ningún error: publicar la póliza del seguro, el
 * bastidor o el porcentaje que se lleva el dueño de un coche cedido compila,
 * despliega y funciona. Solo se ve leyendo lo que devuelve la API, que es
 * justamente lo que nadie hace una vez que funciona.
 */

import { logger } from 'firebase-functions/v2';
import {
  PublicPhotoUrl,
  PublicPrice,
  PublicVehicleDetail,
  PublicVehiclePhoto,
  PublicVehicleSummary,
  VehiclePricingRule,
} from './types';
import { addVat, lowestPricePerDay } from './core';

/** La carpeta pública. Un solo sitio, para que nadie escriba la ruta a mano. */
export const PUBLIC_PHOTOS_FOLDER = 'public-vehicles';

/**
 * El nombre de un fichero público: **sin barras y sin nada del negocio dentro**.
 *
 * ⚠️ Lo comprueba el mapeador además de componerlo quien sube, y no es
 * redundante: si algún día se escribe un `file` con `../` o con la matrícula
 * dentro, esto es lo último que puede pararlo antes de que salga por la API.
 */
const NOMBRE_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/**
 * La URL pública de una foto, **compuesta aquí y no leída del documento**.
 *
 * ⚠️ **Sin token de descarga, y eso es lo correcto por una vez.** La carpeta
 * `public-vehicles/` es `allow read: if true` en `storage.rules`, así que el
 * `?alt=media` basta y dentro de la dirección no viaja ningún secreto. En
 * cualquier otra carpeta esto sería un agujero; aquí es el punto.
 */
function urlDeFoto(bucket: string, vehicleId: string, file: string): string {
  const ruta = `${PUBLIC_PHOTOS_FOLDER}/${vehicleId}/${file}`;
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(ruta)}?alt=media`;
}

/**
 * Las fotos publicadas de un coche, descartando lo que no encaje.
 *
 * ⚠️ **Descarta en silencio hacia el cliente y RUIDOSAMENTE en los logs.** Una
 * foto que no cumple no se enseña —no vamos a publicar una ruta dudosa por no
 * dejar un hueco— pero tampoco desaparece sin rastro: si alguien escribe mal el
 * campo, la web sale sin esa imagen y el log dice cuál y por qué.
 */
export function photoUrls(
  bucket: string,
  vehicleId: string,
  photos: unknown
): PublicPhotoUrl[] {
  if (!Array.isArray(photos)) return [];
  const salida: PublicPhotoUrl[] = [];
  for (const p of photos as PublicVehiclePhoto[]) {
    const file = typeof p?.file === 'string' ? p.file : '';
    if (!NOMBRE_VALIDO.test(file)) {
      logger.warn('Foto pública descartada: nombre no válido', { vehicleId, file });
      continue;
    }
    salida.push({
      url: urlDeFoto(bucket, vehicleId, file),
      ...(typeof p.width === 'number' ? { width: p.width } : {}),
      ...(typeof p.height === 'number' ? { height: p.height } : {}),
    });
  }
  return salida;
}

/** El «desde X €/día», con los dos lados del impuesto. */
function precioDesde(rules: VehiclePricingRule[] | undefined, vatRate: number): PublicPrice | undefined {
  const min = lowestPricePerDay(rules);
  if (min === null) return undefined;
  return { ...addVat(min, vatRate), currency: 'EUR' };
}

/**
 * La tarjeta del listado.
 *
 * `raw` es el documento tal cual sale de Firestore: sin tipar a propósito, para
 * que nadie pueda escribir `...raw` y que compile.
 */
export function toSummary(
  id: string,
  raw: Record<string, unknown>,
  bucket: string,
  vatRate: number
): PublicVehicleSummary {
  const fotos = photoUrls(bucket, id, raw['publicPhotos']);
  return {
    id,
    brand: String(raw['brand'] ?? ''),
    model: String(raw['model'] ?? ''),
    ...(raw['version'] ? { version: String(raw['version']) } : {}),
    year: Number(raw['year'] ?? 0),
    category: String(raw['category'] ?? ''),
    bodyType: String(raw['bodyType'] ?? ''),
    fuelType: String(raw['fuelType'] ?? ''),
    transmission: String(raw['transmission'] ?? ''),
    seats: Number(raw['seats'] ?? 0),
    luggageCapacity: Number(raw['luggageCapacity'] ?? 0),
    ...(raw['color'] ? { color: String(raw['color']) } : {}),
    ...(fotos.length ? { photo: fotos[0] } : {}),
    ...(precioDesde(raw['pricingRules'] as VehiclePricingRule[], vatRate)
      ? { priceFrom: precioDesde(raw['pricingRules'] as VehiclePricingRule[], vatRate) }
      : {}),
  };
}

/** La ficha completa. */
export function toDetail(
  id: string,
  raw: Record<string, unknown>,
  bucket: string,
  vatRate: number
): PublicVehicleDetail {
  const f = (raw['features'] ?? {}) as Record<string, unknown>;
  return {
    ...toSummary(id, raw, bucket, vatRate),
    acrissCode: String(raw['acrissCode'] ?? ''),
    features: {
      airConditioning: f['airConditioning'] === true,
      navigation: f['navigation'] === true,
      parkingSensors: f['parkingSensors'] === true,
      rearCamera: f['rearCamera'] === true,
      cruiseControl: f['cruiseControl'] === true,
    },
    photos: photoUrls(bucket, id, raw['publicPhotos']),
    /**
     * ⚠️ `publicDescription`, **nunca `description`**: aquella es la nota
     * interna del operador para sus compañeros y no se escribió para que la
     * leyera un cliente.
     */
    ...(raw['publicDescription'] ? { description: String(raw['publicDescription']) } : {}),
    ...(typeof raw['defaultDepositAmount'] === 'number'
      ? { depositAmount: raw['defaultDepositAmount'] }
      : {}),
    ...(typeof raw['includedKmPerDay'] === 'number'
      ? { includedKmPerDay: raw['includedKmPerDay'] }
      : {}),
    ...(typeof raw['minimumRentalDays'] === 'number'
      ? { minimumRentalDays: raw['minimumRentalDays'] }
      : {}),
  };
}
