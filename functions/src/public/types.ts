/**
 * Lo que la web pública puede ver de un coche. **Nada más.**
 *
 * ⚠️ **Esto es una lista blanca, y por eso es un tipo y no un `omit`.** Un
 * `Omit<Vehicle, 'vin' | 'insurancePolicy' | …>` parece lo mismo y tiene el
 * fallo que importa: el día que alguien añada un campo al modelo del coche,
 * entra solo. Aquí un campo nuevo **no existe** hasta que alguien lo escriba a
 * mano, que es exactamente la decisión que hay que obligar a tomar.
 *
 * De los 37 campos de `Vehicle` salen 16. De los 21 que no, cinco se excluyen
 * aunque parezcan inocuos y conviene saber por qué:
 *
 * - **`plateNumber`** — no ayuda a elegir coche y sí a clonar la placa, a contar
 *   la flota día a día y, en un coche de colaborador, a señalar públicamente el
 *   vehículo de un particular. El cliente la recibe donde le sirve: el contrato.
 * - **`status`** — el estado es un hecho de hoy y la disponibilidad una pregunta
 *   sobre un rango: publicarlo repetiría el fallo de producción del 21 de
 *   septiembre, esta vez sin operador que lo corrija. Se usa para **filtrar**,
 *   no se devuelve.
 * - **`currentKm`** — lo escribe cada parte de devolución, así que raspado a
 *   diario da la rotación de la flota, y con ella una estimación de ingresos.
 * - **`hasGpsTracker`** — no se puede publicar ni siquiera con valor `true`:
 *   publicarlo con verdad para unos coches convierte su ausencia en el resto en
 *   la lista de la compra de un ladrón.
 * - **`images`** — sus URL apuntan a la carpeta **privada** `vehicles/`, llevan
 *   un token que se salta `storage.rules`, y el nombre del fichero **empieza por
 *   la matrícula** (`4466LKK_mfk3n1.jpg`). Publicarlas publicaría por la puerta
 *   de atrás el campo que se acaba de excluir. Lo que sale es `photos`, que vive
 *   en `public-vehicles/` y se llama de otra manera.
 *
 * Y los evidentes, dichos una vez: `vin`, `insurerName`, `insurancePolicy`,
 * `roadsideAssistancePhone`, `ownership`, `ownerCollaboratorId`,
 * `ownerCollaboratorName` y `ownerSharePercent` no salen nunca. Los cuatro
 * últimos son las condiciones económicas de un acuerdo privado entre dos
 * empresas, y el propietario **no aparece en ninguna parte de cara al cliente**.
 */

/**
 * ⚠️ Copia de `src/app/shared/models/vehicle.model.ts`. Si cambia allí, cambia
 * aquí — no se puede importar: tsconfigs separados.
 */
export interface VehiclePricingRule {
  minDays: number;
  maxDays: number | null;
  pricePerDay: number;
  label?: string;
}

export interface PublicVehicleFeatures {
  airConditioning: boolean;
  navigation: boolean;
  parkingSensors: boolean;
  rearCamera: boolean;
  cruiseControl: boolean;
}

/**
 * Un importe de cara al cliente, **con los dos lados del IVA**.
 *
 * ⚠️ La tarifa se guarda NETA y el impuesto se SUMA. Publicar solo el neto en
 * una web de consumo es anunciar un precio que el cliente no va a pagar;
 * publicar solo el bruto impide explicar el desglose. Van los dos, y el tipo con
 * el que se calcularon — que puede ser **0**, porque una reserva se puede pactar
 * sin IVA y el tipo vive en Ajustes.
 */
export interface PublicPrice {
  /** Base imponible: el número redondo que se negocia. */
  net: number;
  /** Lo que paga el cliente. */
  gross: number;
  /** FRACCIÓN, no porcentaje: `0.21`. Misma convención que `pricingSnapshot`. */
  vatRate: number;
  currency: 'EUR';
  /**
   * Desde cuántos días rige este precio, cuando es un «desde».
   *
   * ⚠️ **Sin esto, «desde 25 €/día» es un precio que casi nadie paga.** El
   * «desde» sale del tramo más barato y, con los tramos normales de la casa, el
   * precio por día baja según se alarga el alquiler: o sea que el más barato es
   * el del último tramo, el abierto. Quien lee «desde 25 €» y alquila tres días
   * se encuentra otra cifra al elegir fechas.
   *
   * ⚠️ **Solo lo lleva `priceFrom`.** El precio de un alquiler con fechas
   * elegidas es exacto y no necesita matiz. Opcional y aditivo, como manda la
   * casa para todo campo nuevo.
   */
  fromDays?: number;
}

/**
 * Una foto publicada.
 *
 * ⚠️ **Guarda el NOMBRE del fichero, nunca una URL**, y la function compone la
 * dirección al servir. Con una URL en el documento, escribir
 * `photos: vehicle.images` **compila sin un solo error** —TypeScript solo
 * comprueba propiedades de más en objetos literales— y publicaría la galería
 * privada entera. Es el mismo agujero de tipos que dejó la fianza sin poder
 * devolverse; con solo el nombre, esa asignación no compila.
 */
export interface PublicVehiclePhoto {
  /**
   * Nombre del fichero dentro de `public-vehicles/{vehicleId}/`. Sin barras.
   *
   * Es el **JPEG de respaldo**, y sigue siendo obligatorio: es lo único que
   * tienen las fotos publicadas antes de que existieran las variantes, y lo que
   * recibe un navegador que no entienda WebP.
   */
  file: string;
  /** Para reservar el hueco y que la página no salte al cargar. */
  width?: number;
  height?: number;
  /**
   * Las variantes en WebP, un fichero por ancho.
   *
   * ⚠️ **Opcional a propósito.** Las fotos publicadas antes del 28 de
   * septiembre de 2026 no lo tienen, y tienen que seguir viéndose sin migrar
   * nada — regla de producción desde que hay datos reales. Sin variantes, el
   * mapeador sirve el JPEG como toda la vida.
   */
  srcset?: Array<{ w: number; file: string }>;
}

/** Lo mismo, ya resuelto para el cliente. */
export interface PublicPhotoUrl {
  /** El JPEG: lo que se sirve si no hay variantes o el navegador no las entiende. */
  url: string;
  width?: number;
  height?: number;
  /** Las variantes en WebP con su ancho, para componer un `srcset`. */
  srcset?: Array<{ w: number; url: string }>;
}

/** Lo que pinta una tarjeta del listado, y nada más. */
export interface PublicVehicleSummary {
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
  /** La primera foto publicada, si hay alguna. */
  photo?: PublicPhotoUrl;
  /** «Desde X €/día», del tramo más barato de la tabla. */
  priceFrom?: PublicPrice;
  /**
   * La etiqueta ambiental de la DGT: `B`, `C`, `ECO` o `0`.
   *
   * ⚠️ **Va en el RESUMEN y no solo en la ficha**, porque es un criterio para
   * elegir: quien alquila para entrar en Madrid descarta coches desde la lista,
   * y obligarle a abrir uno por uno para saberlo es hacerle perder el tiempo.
   *
   * ⚠️ **Opcional, y su ausencia no significa «sin etiqueta»**: significa que
   * no consta. La web no afirma nada cuando falta — decir «sin etiqueta» de un
   * coche que sí la tiene es tan falso como lo contrario.
   */
  environmentalLabel?: 'B' | 'C' | 'ECO' | 'ZERO';
  /**
   * Una línea con lo que este coche tiene y los demás no.
   *
   * ⚠️ **Es el `publicHighlight` del coche, nunca su `description`.** Aquella
   * es la nota interna del operador. Esta se escribe para el cliente.
   */
  highlight?: string;
}

/** La ficha. Lo del listado, más lo que hace falta para decidir. */
export interface PublicVehicleDetail extends PublicVehicleSummary {
  acrissCode: string;
  features: PublicVehicleFeatures;
  photos: PublicPhotoUrl[];
  /**
   * ⚠️ **`publicDescription`, NO `description`.** La del modelo es una nota
   * interna que el operador escribe para sus compañeros —«el del golpe en la
   * aleta», «no prestar a menores de 25»— y nunca se pensó para que la leyera
   * un cliente. Campo nuevo, opcional y aditivo.
   */
  description?: string;
  depositAmount?: number;
  includedKmPerDay?: number;
  minimumRentalDays?: number;
  /**
   * Los días que este coche **no** se puede coger, en `yyyy-MM-dd` local.
   *
   * ⚠️ **Días y no rangos, a propósito.** Con los instantes exactos se podría
   * saber a qué hora devuelve el coche un cliente concreto; es la misma razón
   * por la que el buscador ensancha su ventana a días completos.
   *
   * ⚠️ **Y llevan dentro el día de preparación**: un coche devuelto ayer sale
   * ocupado hoy, porque hay que revisarlo, limpiarlo y repostarlo. Lo calcula
   * `disponibleDesde()` y lo comparten los tres sitios que cruzan reservas, o
   * la web ofrecería lo que después rechaza.
   */
  busyDays?: string[];
  /** El último día mirado. Más allá, el calendario no puede afirmar nada. */
  availableUntil?: string;
}

/** Un coche libre para las fechas pedidas, con su precio orientativo. */
export interface PublicAvailableVehicle extends PublicVehicleSummary {
  totalDays: number;
  /** El alquiler completo para esas fechas. Orientativo: cobra el backoffice. */
  price: PublicPrice;
}
