export type VehicleStatus = 'available' | 'rented' | 'maintenance' | 'out_of_service';

export type VehicleCategory = 'mini' | 'economy' | 'compact' | 'intermediate' | 'standard' | 'fullsize' | 'premium' | 'suv' | 'van';

export type FuelType = 'diesel' | 'petrol' | 'hybrid' | 'electric';

export type TransmissionType = 'manual' | 'automatic';

export type BodyType = '3_doors' | '5_doors' | 'suv' | 'monovolume' | 'van';

export interface VehicleImage {
  url: string;
  path: string;
  isMain: boolean;
  uploadedAt?: any;
}

export interface Vehicle {
  id?: string;
  brand: string;
  model: string;
  version?: string;
  year: number;
  plateNumber: string;
  category: VehicleCategory;
  acrissCode: string;
  fuelType: FuelType;
  transmission: TransmissionType;
  bodyType: BodyType;
  seats: number;
  doors?: number;
  trunkCapacityLiters?: number;
  status: VehicleStatus;
  currentKm?: number;
  color?: string;
  vin?: string;
  description?: string;
  features: VehicleFeatures;
  mainImageUrl?: string;
  images?: VehicleImage[];
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
  fuelType: FuelType;
  transmission: TransmissionType;
  bodyType: BodyType;
  seats: number;
  doors?: number;
  trunkCapacityLiters?: number;
  status: VehicleStatus;
  currentKm?: number;
  color?: string;
  vin?: string;
  description?: string;
  publicEnabled: boolean;
  features: VehicleFeatures;
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
  '3_doors': '3 puertas',
  '5_doors': '5 puertas',
  suv: 'SUV',
  monovolume: 'Monovolumen',
  van: 'Furgoneta'
};
