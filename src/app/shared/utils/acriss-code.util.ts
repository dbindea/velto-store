import { VehicleCategory, BodyType, FuelType, TransmissionType, VehicleFeatures } from '../models/vehicle.model';

export interface AcrissInput {
  category: VehicleCategory;
  bodyType: BodyType;
  transmission: TransmissionType;
  fuelType: FuelType;
  features: VehicleFeatures;
}

export function generateAcrissCode(input: AcrissInput): string {
  const first = categoryToCode(input.category);
  const second = bodyTypeToCode(input.bodyType);
  const third = transmissionToCode(input.transmission);
  const fourth = fuelAirToCode(input.fuelType, input.features.airConditioning);

  return `${first}${second}${third}${fourth}`;
}

function categoryToCode(category: VehicleCategory): string {
  const map: Record<VehicleCategory, string> = {
    mini: 'M',
    economy: 'E',
    compact: 'C',
    intermediate: 'I',
    standard: 'S',
    fullsize: 'F',
    premium: 'P',
    suv: 'S',
    van: 'F'
  };
  return map[category] || 'S';
}

function bodyTypeToCode(bodyType: BodyType): string {
  const map: Record<BodyType, string> = {
    '3_doors': 'B',
    '5_doors': 'D',
    suv: 'F',
    monovolume: 'V',
    van: 'V'
  };
  return map[bodyType] || 'D';
}

function transmissionToCode(transmission: TransmissionType): string {
  return transmission === 'manual' ? 'M' : 'A';
}

function fuelAirToCode(fuelType: FuelType, airConditioning: boolean): string {
  if (!airConditioning) return 'N';

  const acrissAirMap: Record<FuelType, string> = {
    diesel: 'R',
    petrol: 'R',
    hybrid: 'H',
    electric: 'E'
  };
  return acrissAirMap[fuelType] || 'N';
}

export function getAcrissCodeHelp(): string {
  return 'Código generado automáticamente según categoría, carrocería, transmisión y aire acondicionado';
}
