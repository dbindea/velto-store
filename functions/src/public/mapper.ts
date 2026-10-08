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

import * as logger from 'firebase-functions/logger';
import {
  PublicPhotoUrl,
  PublicPrice,
  PublicVehicleDetail,
  PublicVehiclePhoto,
  PublicVehicleSummary,
  VehiclePricingRule,
} from './types';
import { publicPriceDesde, sueloPorDia } from './core';

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
    /**
     * ⚠️ **Las variantes pasan por el MISMO filtro de nombre que el fichero
     * principal.** Es el único sitio por el que algo sale a internet, y una
     * variante con una barra dentro apuntaría a otra carpeta del bucket. Da
     * igual que las escriba `publishVehiclePhoto` con un nombre que compone
     * ella: el día que alguien escriba ese campo a mano, esto es lo último que
     * puede pararlo.
     */
    const srcset = Array.isArray(p.srcset)
      ? p.srcset
          .filter(v => typeof v?.w === 'number' && v.w > 0 && NOMBRE_VALIDO.test(String(v?.file)))
          .map(v => ({ w: v.w, url: urlDeFoto(bucket, vehicleId, v.file) }))
      : [];

    salida.push({
      url: urlDeFoto(bucket, vehicleId, file),
      ...(typeof p.width === 'number' ? { width: p.width } : {}),
      ...(typeof p.height === 'number' ? { height: p.height } : {}),
      ...(srcset.length ? { srcset } : {}),
    });
  }
  return salida;
}

/**
 * El «desde X €/día», con los dos lados del impuesto.
 *
 * ⚠️ **Va por `publicPriceDesde()`, que redondea a `,95` HACIA ARRIBA.** Es la
 * única cifra de la web que sube, y la razón es que es la única que **promete
 * un mínimo**: con el redondeo normal —hacia abajo, decisión del 30 de
 * septiembre— la tarjeta del Kadjar decía «desde 32,95 €/día» y el alquiler más
 * barato de ese coche sale a **33,26**. Los cinco coches publicados anunciaban
 * por debajo de lo que cobran, medido el 8 de octubre de 2026.
 *
 * Lo importante es que el redondeo viva aquí y no en la web que lo pinta: la
 * misma cifra viaja también al `quoteSnapshot` de una solicitud, que es lo que
 * Dorel lee en el correo para cobrarlo a mano.
 *
 * ⚠️ **Y la cifra sale de la CURVA, no del número tecleado en el tramo.** Esto
 * publicaba `tramo.pricePerDay`, que desde que existe la curva es un dato
 * **informativo**: lo que se cobra es `tarifaPublica(base, días)`. Mientras la
 * tabla se rellenó sola los dos coincidían; en cuanto alguien teclea un tramo a
 * mano, dejan de coincidir y **la tarjeta promete un precio que el presupuesto
 * no respeta**. Medido en producción el 8 de octubre de 2026, con los cinco
 * coches publicados:
 *
 *     Dacia Duster   la tarjeta 29,95 €/día · el presupuesto 37,68  (+26 %)
 *     Renault Kadjar la tarjeta 35,95 €/día · el presupuesto 41,50  (+15 %)
 *     Ford Custom    la tarjeta 71,95 €/día · el presupuesto 54,45  (−24 %)
 *
 * Y la web promete «precio final desde el primer clic», así que las dos
 * direcciones son malas: una decepciona al elegir fechas y la otra regala
 * dinero. Desde aquí es imposible que discrepen, porque es la misma función que
 * calcula el presupuesto.
 *
 * ⚠️ **El suelo está en el día `LONG_STAY_FROM_DAYS`, no donde empieza el
 * último tramo.** Aquí ponía lo contrario —«el día que empieza el último tramo
 * es el más barato, siempre»— y es falso: la curva **sigue bajando** hasta el
 * día 31 y solo a partir de ahí es plana, así que el mínimo de verdad es
 * `base × LONG_STAY_RATE_FACTOR`. Un coche cuyo último tramo empiece antes
 * anunciaba un suelo que no es el suyo: medido contra desarrollo el 8 de
 * octubre de 2026, el Peugeot 3008 —último tramo en el día 16— decía «desde
 * 59,95 €/día en alquileres de 16 días o más» cuando ese coche baja a **47,80**.
 *
 * ⚠️ **No era un incumplimiento, y por eso casi no se ve.** Anunciaba de más, o
 * sea en la dirección segura: el cliente paga menos de lo prometido. Lo que
 * falla es la palabra «desde», que afirma un mínimo y estaba dando uno que no
 * lo era — y de paso el coche parecía un 25 % más caro de lo que es en el único
 * número con el que se compara una flota.
 *
 * ⚠️ **Y el tramo se sigue mirando, pero solo para saber si HAY tarifa.** Un
 * coche sin tabla no se publica con precio; `validatePricingRules()` exige
 * además que el último tramo sea abierto, así que el día 31 siempre se alcanza.
 */
function precioDesde(rules: VehiclePricingRule[] | undefined, vatRate: number): PublicPrice | undefined {
  const suelo = sueloPorDia(rules);
  if (!suelo) return undefined;
  const { porDia, dias } = suelo;

  return {
    ...publicPriceDesde(porDia, vatRate),
    currency: 'EUR',
    /*
     * ⚠️ **Siempre viaja, porque el suelo nunca está en el día 1.** Aquí había
     * un `dias > 1` que venía de cuando esto leía el tramo tecleado: el primer
     * tramo empieza en 1 y entonces «desde 1 día o más» no aportaba nada. Con
     * el suelo en `LONG_STAY_FROM_DAYS` ese caso no existe, y la condición
     * sobraba escondiendo que la cifra **necesita** su duración al lado: un
     * «desde 30 €/día» sin decir desde cuántos días es la clase de promesa que
     * un cliente da por incumplida en un alquiler de tres.
     */
    fromDays: dias,
  };
}

/**
 * La tarjeta del listado.
 *
 * `raw` es el documento tal cual sale de Firestore: sin tipar a propósito, para
 * que nadie pueda escribir `...raw` y que compile.
 */
/**
 * Las cuatro etiquetas de la DGT que se pueden publicar.
 *
 * ⚠️ **Escritas aquí y no importadas del modelo de la app**: las functions y la
 * app compilan con tsconfigs separados y no pueden compartir módulo, igual que
 * la aritmética del IVA. Si se añade una quinta categoría, se añade en los dos
 * sitios.
 */
const ETIQUETAS_VALIDAS = ['B', 'C', 'ECO', 'ZERO'] as const;

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
    /**
     * ⚠️ **La etiqueta se publica por LISTA BLANCA, no tal cual.** Lo que hay
     * en Firestore lo escribe un `<select>` de la ficha, pero este fichero es
     * el único sitio por el que algo sale a internet y no puede fiarse de lo
     * que le llegue: un valor raro —un documento sembrado a mano, un campo
     * renombrado a medias— se publicaría tal cual y la web pintaría un
     * distintivo que no existe. Si no es una de las cuatro, no sale.
     */
    ...(ETIQUETAS_VALIDAS.includes(String(raw['environmentalLabel']) as never)
      ? { environmentalLabel: String(raw['environmentalLabel']) as 'B' | 'C' | 'ECO' | 'ZERO' }
      : {}),
    /**
     * ⚠️ `publicHighlight`, **nunca `description`**: la misma regla que la
     * descripción pública de la ficha. Y recortado, porque es una línea
     * destacada: lo que no quepa no se corta solo en la web, se cuela y
     * descuadra la tarjeta.
     */
    ...(raw['publicHighlight']
      ? { highlight: String(raw['publicHighlight']).trim().slice(0, 120) }
      : {}),
    ...(fotos.length ? { photo: fotos[0] } : {}),
    ...(precioDesde(raw['pricingRules'] as VehiclePricingRule[], vatRate)
      ? { priceFrom: precioDesde(raw['pricingRules'] as VehiclePricingRule[], vatRate) }
      : {}),
  };
}

/**
 * Lo que el calendario de la ficha necesita saber, ya calculado.
 *
 * ⚠️ **Entra como parámetro y no se lee del documento del coche**, porque no
 * está ahí: sale de cruzar sus reservas. Se pasa entero y explícito para que
 * esta función siga siendo el único sitio por el que un dato sale a internet.
 */
export interface DisponibilidadPublica {
  /** Días `yyyy-MM-dd` que NO se pueden coger, con la preparación dentro. */
  busyDays: string[];
  /** El último día que se ha mirado. Más allá, el calendario no afirma nada. */
  availableUntil: string;
}

/** La ficha completa. */
export function toDetail(
  id: string,
  raw: Record<string, unknown>,
  bucket: string,
  vatRate: number,
  disponibilidad?: DisponibilidadPublica
): PublicVehicleDetail {
  const f = (raw['features'] ?? {}) as Record<string, unknown>;
  return {
    ...toSummary(id, raw, bucket, vatRate),
    ...(disponibilidad
      ? { busyDays: disponibilidad.busyDays, availableUntil: disponibilidad.availableUntil }
      : {}),
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
