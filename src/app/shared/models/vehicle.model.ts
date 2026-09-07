export type VehicleStatus = 'available' | 'rented' | 'maintenance' | 'out_of_service';

export type VehicleCategory = 'mini' | 'economy' | 'compact' | 'intermediate' | 'standard' | 'fullsize' | 'premium' | 'suv' | 'van';

export type BodyType = '2_4_doors' | '4_5_doors' | 'estate' | 'suv' | 'van' | 'cabrio' | 'mpv';

export type FuelType = 'diesel' | 'petrol' | 'hybrid' | 'electric';

export type TransmissionType = 'manual' | 'automatic';

export interface VehicleImage {
  url: string;
  path: string;
  /**
   * Miniatura para listados, ~400 px.
   *
   * Opcional porque generarla puede fallar —un HEIC que el navegador no
   * decodifica, por ejemplo— y **perder la miniatura no puede impedir guardar
   * la foto**. Quien la pinta cae a `url` si no está.
   */
  thumbnailUrl?: string;
  thumbnailPath?: string;
  uploadedAt?: any;
}

export interface VehiclePricingRule {
  id?: string;
  minDays: number;
  maxDays: number | null;
  pricePerDay: number;
  label?: string;
}

export interface Vehicle {
  id?: string;
  brand: string;
  model: string;
  version?: string;
  year: number;
  plateNumber: string;
  category: VehicleCategory;
  bodyType: BodyType;
  acrissCode: string;
  fuelType: FuelType;
  transmission: TransmissionType;
  seats: number;
  luggageCapacity: number;
  status: VehicleStatus;
  currentKm?: number;
  color?: string;
  vin?: string;
  description?: string;
  features: VehicleFeatures;
  images?: VehicleImage[];
  pricingRules?: VehiclePricingRule[];
  defaultDepositAmount?: number;
  includedKmPerDay?: number;
  extraKmPrice?: number;
  /**
   * Si el coche lleva localizador GPS.
   *
   * No es un dato de inventario: decide si el contrato imprime el aviso de
   * geolocalización. Informar de que el vehículo se localiza es obligatorio
   * cuando es cierto, y afirmarlo sin serlo es peor que callarlo.
   */
  hasGpsTracker?: boolean;
  /**
   * Seguro y asistencia en carretera, **por coche y no por empresa**.
   *
   * Empezaron siendo tres datos de `functions/src/company-config.ts`, y estaba
   * mal: cada vehículo tiene su póliza, no siempre con la misma compañía, y se
   * renuevan en fechas distintas. Un valor único de empresa habría impreso la
   * póliza equivocada en cuanto hubiera dos coches.
   *
   * ⚠️ Los tres los **promete la cláusula de accidentes**, que dice que constan
   * en la sección «Datos del vehículo» del contrato. Vacíos, el contrato remite
   * a un dato que no imprime; y el teléfono de asistencia es justo el que el
   * cliente necesita marcar cuando se queda tirado.
   *
   * ⚠️ **No se congelan en el snapshot de la reserva.** No son algo que se
   * pacte —como el precio o los kilómetros—, son el seguro que cubre el coche:
   * lo que hay que imprimir es lo vigente el día que se firma. El contrato los
   * lee de la ficha al generarse, así que una renovación entra sola en el
   * siguiente; los ya firmados no se mueven, porque el PDF sellado es
   * inmutable.
   */
  insurerName?: string;
  insurancePolicy?: string;
  roadsideAssistancePhone?: string;
  minimumRentalDays?: number;
  manualPriceAllowed?: boolean;
  publicEnabled: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface VehicleFeatures {
  airConditioning: boolean;
  navigation: boolean;
  parkingSensors: boolean;
  rearCamera: boolean;
  cruiseControl: boolean;
}

export interface VehicleFormData {
  brand: string;
  model: string;
  version: string;
  year: number;
  plateNumber: string;
  category: VehicleCategory;
  bodyType: BodyType;
  fuelType: FuelType;
  transmission: TransmissionType;
  seats: number;
  luggageCapacity: number;
  status: VehicleStatus;
  currentKm?: number;
  color?: string;
  vin?: string;
  description?: string;
  publicEnabled: boolean;
  features: VehicleFeatures;
  pricingRules?: VehiclePricingRule[];
  defaultDepositAmount?: number;
  includedKmPerDay?: number;
  extraKmPrice?: number;
  /**
   * Si el coche lleva localizador GPS.
   *
   * No es un dato de inventario: decide si el contrato imprime el aviso de
   * geolocalización. Informar de que el vehículo se localiza es obligatorio
   * cuando es cierto, y afirmarlo sin serlo es peor que callarlo.
   */
  hasGpsTracker?: boolean;
  /** Ver la nota en `Vehicle`: el seguro es del coche, no de la empresa. */
  insurerName?: string;
  insurancePolicy?: string;
  roadsideAssistancePhone?: string;
  minimumRentalDays?: number;
  manualPriceAllowed?: boolean;
}

// Every *_LABELS map holds i18n KEYS, never display text. A map that holds
// Spanish reaches the template unchanged, so `| translate` returns it as-is
// and Spanish leaks into the English and Romanian UIs.

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  available: 'vehicles.status.available',
  rented: 'vehicles.status.rented',
  maintenance: 'vehicles.status.maintenance',
  out_of_service: 'vehicles.status.outOfService'
};

export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  mini: 'vehicles.categories.mini',
  economy: 'vehicles.categories.economy',
  compact: 'vehicles.categories.compact',
  intermediate: 'vehicles.categories.intermediate',
  standard: 'vehicles.categories.standard',
  fullsize: 'vehicles.categories.fullsize',
  premium: 'vehicles.categories.premium',
  suv: 'vehicles.categories.suv',
  van: 'vehicles.categories.van'
};

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  diesel: 'vehicles.fuelTypes.diesel',
  petrol: 'vehicles.fuelTypes.petrol',
  hybrid: 'vehicles.fuelTypes.hybrid',
  electric: 'vehicles.fuelTypes.electric'
};

export const TRANSMISSION_LABELS: Record<TransmissionType, string> = {
  manual: 'vehicles.transmissions.manual',
  automatic: 'vehicles.transmissions.automatic'
};

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  '2_4_doors': 'vehicles.bodyTypes.2_4_doors',
  '4_5_doors': 'vehicles.bodyTypes.4_5_doors',
  'estate': 'vehicles.bodyTypes.estate',
  'suv': 'vehicles.bodyTypes.suv',
  'van': 'vehicles.bodyTypes.van',
  'cabrio': 'vehicles.bodyTypes.cabrio',
  'mpv': 'vehicles.bodyTypes.mpv'
};