/**
 * Vehicle maintenance model.
 *
 * Each record represents a maintenance task for a specific vehicle.
 * Tasks can be:
 *  - Completed (oil change done at 85,000 km, ITV passed, etc.)
 *  - Scheduled (next oil change at 100,000 km, ITV renewal, etc.)
 *  - Pending (something flagged but not yet scheduled)
 *  - Overdue (computed by the service: due date < today and not completed)
 *  - Cancelled
 *
 * Records live in a top-level `vehicleMaintenance` collection
 * (NOT a subcollection) so the dashboard can build global alerts
 * (ITV due, insurance due, broken items) without traversing every
 * vehicle.
 *
 * Invoice / supporting documents are stored in Firebase Storage at
 * `vehicle-maintenance/{vehicleId}/{maintenanceId}/{ts}-{filename}`.
 */

export type MaintenanceType =
  | 'oil_change'
  | 'tires'
  | 'itv'
  | 'insurance'
  | 'general_revision'
  | 'brakes'
  | 'battery'
  | 'breakdown'
  | 'cleaning'
  | 'other';

export type MaintenanceStatus =
  | 'pending'
  | 'scheduled'
  | 'completed'
  | 'overdue'
  | 'cancelled';

export type MaintenancePriority = 'low' | 'medium' | 'high' | 'critical';

export interface VehicleMaintenance {
  id?: string;

  vehicleId: string;

  vehicleSnapshot?: {
    brand: string;
    model: string;
    plateNumber: string;
    mainImageUrl?: string;
  };

  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;

  title: string;
  description?: string;

  /** Km reading at the moment the maintenance happened (if completed). */
  performedAtKm?: number;
  /** Timestamp the maintenance happened (if completed). */
  performedAtDate?: any;

  /** Next due km — alert if vehicle.currentKm >= this and not completed. */
  nextDueKm?: number;
  /** Next due date — alert if today > this and not completed. */
  nextDueDate?: any;

  cost?: number;
  provider?: string;
  invoiceUrl?: string;
  invoicePath?: string;

  notes?: string;

  createdAt?: any;
  updatedAt?: any;
  completedAt?: any;
  createdBy?: string;
}

// Labels for translation (one per value).
export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  oil_change: 'maintenance.type.oilChange',
  tires: 'maintenance.type.tires',
  itv: 'maintenance.type.itv',
  insurance: 'maintenance.type.insurance',
  general_revision: 'maintenance.type.generalRevision',
  brakes: 'maintenance.type.brakes',
  battery: 'maintenance.type.battery',
  breakdown: 'maintenance.type.breakdown',
  cleaning: 'maintenance.type.cleaning',
  other: 'maintenance.type.other'
};

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  pending: 'maintenance.status.pending',
  scheduled: 'maintenance.status.scheduled',
  completed: 'maintenance.status.completed',
  overdue: 'maintenance.status.overdue',
  cancelled: 'maintenance.status.cancelled'
};

export const MAINTENANCE_PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  low: 'maintenance.priority.low',
  medium: 'maintenance.priority.medium',
  high: 'maintenance.priority.high',
  critical: 'maintenance.priority.critical'
};

export const MAINTENANCE_STATUS_COLORS: Record<MaintenanceStatus, string> = {
  pending: 'status-pending',
  scheduled: 'status-scheduled',
  completed: 'status-completed',
  overdue: 'status-overdue',
  cancelled: 'status-cancelled'
};

export const MAINTENANCE_PRIORITY_COLORS: Record<MaintenancePriority, string> = {
  low: 'priority-low',
  medium: 'priority-medium',
  high: 'priority-high',
  critical: 'priority-critical'
};

export const MAINTENANCE_TYPE_ICONS: Record<MaintenanceType, string> = {
  oil_change: 'pi pi-cog',
  tires: 'pi pi-circle',
  itv: 'pi pi-verified',
  insurance: 'pi pi-shield',
  general_revision: 'pi pi-wrench',
  brakes: 'pi pi-stop-circle',
  battery: 'pi pi-bolt',
  breakdown: 'pi pi-exclamation-triangle',
  cleaning: 'pi pi-sparkles',
  other: 'pi pi-file'
};

/** UI alert thresholds.  Anything with less than these thresholds
 *  is considered "due soon" so the dashboard / per-vehicle tab can
 *  warn the operator before something becomes overdue. */
export const MAINTENANCE_DUE_SOON_DAYS = 30;
export const MAINTENANCE_DUE_SOON_KM = 1000;
