/**
 * Lo que la web le pide al backend.
 *
 * ⚠️ **Siempre por `/api/*`, nunca a `cloudfunctions.net`.** Las rutas viven en
 * el propio dominio gracias a un rewrite de Hosting, y eso vale por tres cosas:
 * no hay CORS que negociar, la URL que ve el cliente es la de la empresa, y el
 * día que una function cambie de nombre o de región **no hay que tocar la web**.
 * El rewrite está en `firebase.json`, y si falta, la petición cae en el
 * catch-all de la SPA y devuelve HTML donde se esperaba JSON.
 *
 * ⚠️ **Todo esto corre en el NAVEGADOR, no en el build.** Es lo que hace que
 * publicar un coche desde el backoffice se vea al momento: la página es
 * estática y los datos llegan al abrirla.
 */

export interface PrecioPublico {
  net: number;
  gross: number;
  vatRate: number;
  currency: 'EUR';
}

export interface FotoPublica {
  url: string;
  width?: number;
  height?: number;
}

export interface CocheResumen {
  id: string;
  brand: string;
  model: string;
  version?: string;
  year: number;
  category: string;
  bodyType: string;
  fuelType: string;
  transmission: string;
  seats: number;
  luggageCapacity: number;
  color?: string;
  photo?: FotoPublica;
  priceFrom?: PrecioPublico;
}

export interface CocheFicha extends CocheResumen {
  acrissCode: string;
  features: {
    airConditioning: boolean;
    navigation: boolean;
    parkingSensors: boolean;
    rearCamera: boolean;
    cruiseControl: boolean;
  };
  photos: FotoPublica[];
  description?: string;
  depositAmount?: number;
  includedKmPerDay?: number;
  minimumRentalDays?: number;
}

export interface CocheDisponible extends CocheResumen {
  totalDays: number;
  price: PrecioPublico;
}

/**
 * ⚠️ **Un fallo de red se distingue de «no hay coches», y no es lo mismo.**
 * Enseñar «no hay vehículos disponibles» cuando lo que ha pasado es que la
 * petición falló manda al visitante a otra web. Por eso cada llamada puede
 * lanzar y la página distingue los tres estados: cargando, vacío y roto.
 */
async function pedir<T>(ruta: string): Promise<T> {
  const r = await fetch(ruta, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    let clave = 'error';
    try {
      clave = ((await r.json()) as { error?: string }).error ?? 'error';
    } catch {
      /* El backend no contestó JSON: se queda el genérico. */
    }
    throw new Error(clave);
  }
  return (await r.json()) as T;
}

export function flota(): Promise<{ vehicles: CocheResumen[] }> {
  return pedir('/api/fleet');
}

export function ficha(id: string): Promise<{ vehicle: CocheFicha }> {
  return pedir(`/api/vehicle?id=${encodeURIComponent(id)}`);
}

export function disponibilidad(
  desde: string,
  hasta: string
): Promise<{ from: string; to: string; totalDays: number; vehicles: CocheDisponible[] }> {
  return pedir(
    `/api/availability?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`
  );
}

/**
 * El precio, tal y como lo lee un particular: **el total con IVA**.
 *
 * ⚠️ En el backoffice se negocia el NETO —el número redondo— y el impuesto se
 * suma; aquí manda lo contrario, porque quien mira una web de alquiler compara
 * lo que va a pagar. El neto viaja igual en la respuesta por si hace falta
 * explicarlo, pero **el número grande es el bruto**.
 */
export function euros(valor: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(valor);
}

/** Los enumerados llegan en crudo de Firestore: `petrol`, `manual`… */
const COMBUSTIBLE: Record<string, string> = {
  petrol: 'Gasolina',
  diesel: 'Diésel',
  hybrid: 'Híbrido',
  electric: 'Eléctrico',
};

const CAMBIO: Record<string, string> = {
  manual: 'Manual',
  automatic: 'Automático',
};

const CATEGORIA: Record<string, string> = {
  mini: 'Mini',
  economy: 'Económico',
  compact: 'Compacto',
  intermediate: 'Intermedio',
  standard: 'Estándar',
  fullsize: 'Grande',
  premium: 'Premium',
  suv: 'SUV',
  van: 'Furgoneta',
};

/**
 * ⚠️ **Un enumerado que no esté en la tabla se enseña EN CRUDO, no se esconde.**
 * Devolver cadena vacía dejaría un hueco que nadie relaciona con nada; con el
 * código a la vista, quien lo vea sabe que falta traducirlo. Es la misma regla
 * que el `translate()` del backoffice, que devuelve la clave si no la encuentra.
 */
export const combustible = (v: string): string => COMBUSTIBLE[v] ?? v;
export const cambio = (v: string): string => CAMBIO[v] ?? v;
export const categoria = (v: string): string => CATEGORIA[v] ?? v;

/** «Renault Clio Journey TCe 130», sin dobles espacios si no hay versión. */
export function nombreCoche(c: CocheResumen): string {
  return [c.brand, c.model, c.version].filter(Boolean).join(' ');
}
