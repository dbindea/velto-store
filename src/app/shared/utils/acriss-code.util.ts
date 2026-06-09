import {
  BodyType,
  FuelType,
  TransmissionType,
  VehicleCategory,
  VehicleFeatures,
} from '../models/vehicle.model';

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

/**
 * ACRISS/SIPP codes according to specification:
 * 1st letter = category/size: M(mini), E(economy), C(compact), I(intermediate),
 *              S(standard), F(fullsize), P(premium), L(luxury), X(special)
 * 2nd letter = body type: C(2/4 doors), D(4/5 doors), W(estate), F(SUV),
 *               V(van/passengers), T(cabriolet), M(mpv)
 * 3rd letter = transmission: M(manual), A(automatic)
 * 4th letter = fuel/A/C: R(no spec + A/C), D(diesel + A/C), V(gasoline + A/C),
 *               E(electric + A/C), H(hybrid + A/C), N(no A/C)
 */
function categoryToCode(category: VehicleCategory): string {
  const map: Record<VehicleCategory, string> = {
    mini: 'M',
    economy: 'E',
    compact: 'C',
    intermediate: 'I',
    standard: 'S',
    fullsize: 'F',
    premium: 'P',
    suv: 'X',
    van: 'V',
  };
  return map[category] || 'S';
}

function bodyTypeToCode(bodyType: BodyType): string {
  const map: Record<BodyType, string> = {
    '2_4_doors': 'C',
    '4_5_doors': 'D',
    estate: 'W',
    suv: 'F',
    van: 'V',
    cabrio: 'T',
    mpv: 'M',
  };
  return map[bodyType] || 'D';
}

function transmissionToCode(transmission: TransmissionType): string {
  return transmission === 'manual' ? 'M' : 'A';
}

function fuelAirToCode(fuelType: FuelType, airConditioning: boolean): string {
  if (!airConditioning) return 'N';

  const acrissAirMap: Record<FuelType, string> = {
    diesel: 'D',
    petrol: 'V',
    hybrid: 'H',
    electric: 'E',
  };
  return acrissAirMap[fuelType] || 'R';
}

export function getAcrissCodeHelp(): string {
  return 'Codigo generado según categoria, tipo, transmision y combustible';
}
