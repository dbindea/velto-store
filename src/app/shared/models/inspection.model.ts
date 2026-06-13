/**
 * Inspection (Entrega y Devolución) model.
 *
 * Each reservation can have at most one pickup inspection and one return inspection.
 * Photos are stored in Firebase Storage; metadata in Firestore.
 */

export type InspectionType = 'pickup' | 'return';

export type FuelLevel = 'empty' | 'quarter' | 'half' | 'three_quarters' | 'full';

export type VehicleCleanliness = 'clean' | 'normal' | 'dirty' | 'very_dirty';

export type InspectionStatus = 'draft' | 'completed' | 'cancelled';

export type DamageArea =
  | 'front' | 'rear' | 'left_side' | 'right_side' | 'roof'
  | 'interior' | 'wheels' | 'windows' | 'other';

export type DamageSeverity = 'minor' | 'medium' | 'serious';

export type PhotoCategory =
  | 'front' | 'rear' | 'left_side' | 'right_side'
  | 'interior' | 'dashboard' | 'fuel' | 'damage' | 'other';

export interface InspectionPhoto {
  id?: string;
  url: string;
  path: string;
  label?: string;
  category?: PhotoCategory;
  uploadedAt?: any;
  fileName?: string;
  size?: number;
  contentType?: string;
}

export interface VehicleDamage {
  id?: string;
  area: DamageArea;
  description: string;
  severity?: DamageSeverity;
  photoUrls?: string[];
  isNewDamage?: boolean;
}

export interface InspectionChecklist {
  clientIdentityChecked: boolean;
  drivingLicenseChecked: boolean;
  contractChecked: boolean;
  paymentChecked: boolean;
  depositChecked: boolean;
  keysDelivered?: boolean;
  keysReturned?: boolean;
  vehicleDocumentsDelivered?: boolean;
  accessoriesChecked?: boolean;
}

export interface InspectionExtraCharges {
  extraKmCharge?: number;
  fuelCharge?: number;
  refuelPenalty?: number;
  cleaningCharge?: number;
  damageCharge?: number;
  fineCharge?: number;
  otherCharge?: number;
  totalExtraCharges: number;
  notes?: string;
}

export interface Inspection {
  id?: string;

  reservationId: string;
  vehicleId: string;
  clientId: string;

  type: InspectionType;
  status: InspectionStatus;

  reservationSnapshot?: {
    pickupDateTime?: any;
    returnDateTime?: any;
    totalDays?: number;
    finalPrice?: number;
  };

  vehicleSnapshot?: {
    brand: string;
    model: string;
    plateNumber: string;
    acrissCode?: string;
    mainImageUrl?: string;
  };

  clientSnapshot?: {
    fullName: string;
    phone?: string;
    email?: string;
    documentNumber?: string;
  };

  km?: number;
  fuelLevel?: FuelLevel;
  cleanliness?: VehicleCleanliness;

  checklist: InspectionChecklist;

  damages?: VehicleDamage[];
  photos?: InspectionPhoto[];

  extraCharges?: InspectionExtraCharges;

  notes?: string;

  completedAt?: any;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
}

// Labels
export const FUEL_LEVEL_LABELS: Record<FuelLevel, string> = {
  empty: 'inspections.fuel.empty',
  quarter: 'inspections.fuel.quarter',
  half: 'inspections.fuel.half',
  three_quarters: 'inspections.fuel.threeQuarters',
  full: 'inspections.fuel.full'
};

export const FUEL_LEVEL_ICONS: Record<FuelLevel, string> = {
  empty: 'pi pi-times-circle',
  quarter: 'pi pi-circle-fill',
  half: 'pi pi-circle-fill',
  three_quarters: 'pi pi-circle-fill',
  full: 'pi pi-circle-fill'
};

export const CLEANLINESS_LABELS: Record<VehicleCleanliness, string> = {
  clean: 'inspections.cleanliness.clean',
  normal: 'inspections.cleanliness.normal',
  dirty: 'inspections.cleanliness.dirty',
  very_dirty: 'inspections.cleanliness.veryDirty'
};

export const DAMAGE_AREA_LABELS: Record<DamageArea, string> = {
  front: 'inspections.damages.areaFront',
  rear: 'inspections.damages.areaRear',
  left_side: 'inspections.damages.areaLeftSide',
  right_side: 'inspections.damages.areaRightSide',
  roof: 'inspections.damages.areaRoof',
  interior: 'inspections.damages.areaInterior',
  wheels: 'inspections.damages.areaWheels',
  windows: 'inspections.damages.areaWindows',
  other: 'inspections.damages.areaOther'
};

export const DAMAGE_SEVERITY_LABELS: Record<DamageSeverity, string> = {
  minor: 'inspections.damages.minor',
  medium: 'inspections.damages.medium',
  serious: 'inspections.damages.serious'
};

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  front: 'inspections.photos.front',
  rear: 'inspections.photos.rear',
  left_side: 'inspections.photos.leftSide',
  right_side: 'inspections.photos.rightSide',
  interior: 'inspections.photos.interior',
  dashboard: 'inspections.photos.dashboard',
  fuel: 'inspections.photos.fuel',
  damage: 'inspections.photos.damage',
  other: 'inspections.photos.other'
};

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  draft: 'inspections.status.draft',
  completed: 'inspections.status.completed',
  cancelled: 'inspections.status.cancelled'
};

export const INSPECTION_STATUS_COLORS: Record<InspectionStatus, string> = {
  draft: 'status-draft',
  completed: 'status-completed',
  cancelled: 'status-cancelled'
};

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  pickup: 'inspections.pickup',
  return: 'inspections.return'
};
