export type VehicleStatus = 'available' | 'rented' | 'maintenance' | 'out_of_service';

export type VehicleCategory = 'mini' | 'economy' | 'compact' | 'intermediate' | 'standard' | 'fullsize' | 'premium' | 'suv' | 'van';

export type BodyType = '2_4_doors' | '4_5_doors' | 'estate' | 'suv' | 'van' | 'cabrio' | 'mpv';

export type FuelType = 'diesel' | 'petrol' | 'hybrid' | 'electric';

export type TransmissionType = 'manual' | 'automatic';

export interface VehicleImage {
  url: string;
  path: string;
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
  minimumRentalDays?: number;
  manualPriceAllowed?: boolean;
}

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  available: 'Disponible',
  rented: 'En alquiler',
  maintenance: 'Mantenimiento',
  out_of_service: 'Fuera de servicio'
};

export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  mini: 'Mini',
  economy: 'Económico',
  compact: 'Compacto',
  intermediate: 'Intermedio',
  standard: 'Estándar',
  fullsize: 'Tamaño completo',
  premium: 'Premium',
  suv: 'SUV',
  van: 'Furgoneta'
};

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  diesel: 'Diésel',
  petrol: 'Gasolina',
  hybrid: 'Híbrido',
  electric: 'Eléctrico'
};

export const TRANSMISSION_LABELS: Record<TransmissionType, string> = {
  manual: 'Manual',
  automatic: 'Automático'
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