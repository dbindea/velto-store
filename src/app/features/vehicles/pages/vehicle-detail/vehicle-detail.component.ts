import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { VehicleMaintenanceService } from '@features/vehicles/services/vehicle-maintenance.service';
import { ImageGalleryComponent, GalleryImage } from '@shared/components/image-gallery/image-gallery.component';
import { VehicleMaintenanceFormComponent } from '@features/vehicles/components/vehicle-maintenance-form/vehicle-maintenance-form.component';
import {
  Vehicle,
  VehicleStatus,
  VehiclePricingRule,
  BodyType,
  VEHICLE_STATUS_LABELS,
  VEHICLE_CATEGORY_LABELS,
  FUEL_TYPE_LABELS,
  TRANSMISSION_LABELS,
  BODY_TYPE_LABELS
} from '@shared/models/vehicle.model';
import {
  Reservation,
  RESERVATION_STATUS_LABELS,
  RESERVATION_PAYMENT_STATUS_LABELS
} from '@shared/models/reservation.model';
import { TranslateService } from '@core/i18n/translate.service';
import { toDate } from '@shared/utils/reservation-date.util';
import {
  MAINTENANCE_PRIORITY_COLORS,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_STATUS_COLORS,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_TYPE_ICONS,
  MAINTENANCE_TYPE_LABELS,
  MaintenanceStatus,
  VehicleMaintenance
} from '@shared/models/vehicle-maintenance.model';
import { PermissionsService } from '@core/auth/permissions.service';

@Component({
  selector: 'app-vehicle-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    ImageGalleryComponent,
    VehicleMaintenanceFormComponent
  ],
  templateUrl: './vehicle-detail.component.html',
  styleUrl: './vehicle-detail.component.scss'
})
export class VehicleDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);
  private reservationService = inject(ReservationService);
  private maintenanceService = inject(VehicleMaintenanceService);
  private translateService = inject(TranslateService);
  /** Público: las plantillas preguntan qué permite el rol. */
  permissions = inject(PermissionsService);

  vehicle: Vehicle | null = null;
  loading = true;
  activeTab: 'info' | 'features' | 'photos' | 'pricing' | 'reservations' | 'maintenance' = 'info';
  showStatusModal = false;
  showDeleteModal = false;
  showGallery = false;
  galleryIndex = 0;

  // Reservations
  vehicleReservations: Reservation[] = [];
  loadingReservations = false;

  // Maintenance
  maintenanceItems: VehicleMaintenance[] = [];
  loadingMaintenance = false;
  showMaintenanceForm = false;
  maintenanceEditing: VehicleMaintenance | null = null;
  maintenanceSaving = false;
  pendingInvoiceFile: File | null = null;
  pendingInvoiceUrl: string | null = null;
  pendingInvoicePath: string | null = null;

  statusOptions: VehicleStatus[] = ['available', 'rented', 'maintenance', 'out_of_service'];

  // All images from vehicle.images array
  galleryImages = computed<GalleryImage[]>(() => {
    if (!this.vehicle?.images) return [];
    return this.vehicle.images.map(img => ({
      url: img.url,
      path: img.path
    }));
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadVehicle(id);
      this.loadReservations(id);
      this.loadMaintenance(id);
      const tab = this.route.snapshot.queryParamMap.get('tab');
      if (
        tab === 'info' ||
        tab === 'features' ||
        tab === 'photos' ||
        tab === 'pricing' ||
        tab === 'reservations' ||
        tab === 'maintenance'
      ) {
        this.activeTab = tab;
      }
    }
  }

  loadVehicle(id: string): void {
    this.loading = true;
    this.vehicleService.getVehicleById(id).subscribe({
      next: (vehicle) => {
        this.vehicle = vehicle;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.router.navigate(['/vehicles']);
      }
    });
  }

  loadReservations(vehicleId: string): void {
    this.loadingReservations = true;
    this.reservationService.getReservationsByVehicle(vehicleId).subscribe({
      next: (reservations) => {
        this.vehicleReservations = reservations;
        this.loadingReservations = false;
      },
      error: () => {
        this.loadingReservations = false;
      }
    });
  }

  setTab(
    tab: 'info' | 'features' | 'photos' | 'pricing' | 'reservations' | 'maintenance'
  ): void {
    this.activeTab = tab;
  }

  // -----------------------------------------------------------------------
  // Maintenance
  // -----------------------------------------------------------------------

  loadMaintenance(vehicleId: string): void {
    this.loadingMaintenance = true;
    this.maintenanceService.getMaintenanceByVehicle(vehicleId).subscribe({
      next: (items) => {
        this.maintenanceItems = items;
        this.loadingMaintenance = false;
      },
      error: () => {
        this.loadingMaintenance = false;
      }
    });
  }

  getEffectiveStatus(m: VehicleMaintenance): MaintenanceStatus {
    return this.maintenanceService.computeEffectiveStatus(m, this.vehicle?.currentKm);
  }

  getMaintenanceTypeLabel(t: VehicleMaintenance['type']): string {
    return this.translateService.translate(MAINTENANCE_TYPE_LABELS[t]);
  }
  getMaintenanceTypeIcon(t: VehicleMaintenance['type']): string {
    return MAINTENANCE_TYPE_ICONS[t];
  }
  getMaintenanceStatusLabel(s: MaintenanceStatus): string {
    return this.translateService.translate(MAINTENANCE_STATUS_LABELS[s]);
  }
  getMaintenanceStatusClass(s: MaintenanceStatus): string {
    return MAINTENANCE_STATUS_COLORS[s];
  }
  getMaintenancePriorityLabel(p: VehicleMaintenance['priority']): string {
    return this.translateService.translate(MAINTENANCE_PRIORITY_LABELS[p]);
  }
  getMaintenancePriorityClass(p: VehicleMaintenance['priority']): string {
    return MAINTENANCE_PRIORITY_COLORS[p];
  }

  getMaintenanceBuckets() {
    const upcoming: VehicleMaintenance[] = [];
    const overdue: VehicleMaintenance[] = [];
    const completed: VehicleMaintenance[] = [];
    for (const m of this.maintenanceItems) {
      const s = this.getEffectiveStatus(m);
      if (s === 'overdue') overdue.push(m);
      else if (s === 'completed' || s === 'cancelled') completed.push(m);
      else upcoming.push(m);
    }
    return { upcoming, overdue, completed };
  }

  openCreateMaintenance(): void {
    this.maintenanceEditing = null;
    this.pendingInvoiceFile = null;
    this.pendingInvoiceUrl = null;
    this.pendingInvoicePath = null;
    this.showMaintenanceForm = true;
  }

  openEditMaintenance(m: VehicleMaintenance): void {
    this.maintenanceEditing = m;
    this.pendingInvoiceFile = null;
    this.pendingInvoiceUrl = m.invoiceUrl || null;
    this.pendingInvoicePath = m.invoicePath || null;
    this.showMaintenanceForm = true;
  }

  cancelMaintenanceForm(): void {
    this.showMaintenanceForm = false;
    this.maintenanceEditing = null;
    this.pendingInvoiceFile = null;
  }

  async onMaintenanceInvoiceSelected(file: File): Promise<void> {
    if (!this.vehicle?.id) return;
    this.maintenanceSaving = true;
    try {
      const id = this.maintenanceEditing?.id || 'pending';
      const { path, url } = await this.maintenanceService.uploadMaintenanceInvoice(
        this.vehicle.id,
        id,
        file
      );
      this.pendingInvoiceFile = file;
      this.pendingInvoiceUrl = url;
      this.pendingInvoicePath = path;
    } catch (err) {
      console.error('Failed to upload maintenance invoice', err);
    } finally {
      this.maintenanceSaving = false;
    }
  }

  async submitMaintenanceForm(form: {
    type: VehicleMaintenance['type'];
    status: VehicleMaintenance['status'];
    priority: VehicleMaintenance['priority'];
    title: string;
    description: string;
    performedAtKm: number | null;
    performedAtDate: string;
    nextDueKm: number | null;
    nextDueDate: string;
    cost: number | null;
    provider: string;
    notes: string;
    invoiceUrl: string;
    invoicePath: string;
  }): Promise<void> {
    if (!this.vehicle?.id) return;
    this.maintenanceSaving = true;
    try {
      const snapshot = {
        brand: this.vehicle.brand,
        model: this.vehicle.model,
        plateNumber: this.vehicle.plateNumber,
        mainImageUrl: this.vehicle.images?.[0]?.url
      };
      const data: Omit<VehicleMaintenance, 'id'> = {
        vehicleId: this.vehicle.id,
        vehicleSnapshot: snapshot,
        type: form.type,
        status: form.status,
        priority: form.priority,
        title: form.title,
        description: form.description || undefined,
        performedAtKm: form.performedAtKm ?? undefined,
        performedAtDate: form.performedAtDate || undefined,
        nextDueKm: form.nextDueKm ?? undefined,
        nextDueDate: form.nextDueDate || undefined,
        cost: form.cost ?? undefined,
        provider: form.provider || undefined,
        invoiceUrl: this.pendingInvoiceUrl || undefined,
        invoicePath: this.pendingInvoicePath || undefined,
        notes: form.notes || undefined
      };

      if (this.maintenanceEditing?.id) {
        await this.maintenanceService.updateMaintenance(this.maintenanceEditing.id, data);
      } else {
        await this.maintenanceService.createMaintenance(data);
      }
      this.loadMaintenance(this.vehicle.id);
      this.showMaintenanceForm = false;
      this.maintenanceEditing = null;
    } catch (err) {
      console.error('Failed to save maintenance', err);
    } finally {
      this.maintenanceSaving = false;
    }
  }

  async completeMaintenanceItem(m: VehicleMaintenance): Promise<void> {
    if (!m.id) return;
    await this.maintenanceService.completeMaintenance(m.id, {
      performedAtDate: new Date(),
      performedAtKm: m.nextDueKm // best-effort: assume current km = next due
    });
    if (this.vehicle?.id) this.loadMaintenance(this.vehicle.id);
  }

  async cancelMaintenanceItem(m: VehicleMaintenance): Promise<void> {
    if (!m.id) return;
    await this.maintenanceService.cancelMaintenance(m.id);
    if (this.vehicle?.id) this.loadMaintenance(this.vehicle.id);
  }

  async deleteMaintenanceItem(m: VehicleMaintenance): Promise<void> {
    if (!m.id) return;
    await this.maintenanceService.deleteMaintenance(m.id);
    if (this.vehicle?.id) this.loadMaintenance(this.vehicle.id);
  }

  // Reservation helpers. The *_LABELS maps hold i18n keys and the template
  // calls these getters without a `| translate`, so they resolve the key here.
  getReservationStatusLabel(status: string): string {
    return this.t(RESERVATION_STATUS_LABELS[status as keyof typeof RESERVATION_STATUS_LABELS], status);
  }

  getReservationPaymentLabel(status: string): string {
    return this.t(
      RESERVATION_PAYMENT_STATUS_LABELS[status as keyof typeof RESERVATION_PAYMENT_STATUS_LABELS],
      status
    );
  }

  /** Resolve an i18n key, falling back to the raw value for unknown states. */
  private t(key: string | undefined, fallback: string): string {
    return key ? this.translateService.translate(key) : fallback;
  }

  getReservationStatusClass(status: string): string {
    const map: Record<string, string> = {
      reserved: 'status-reserved',
      confirmed: 'status-confirmed',
      delivered: 'status-delivered',
      returned: 'status-returned',
      closed: 'status-closed',
      cancelled: 'status-cancelled'
    };
    return map[status] || '';
  }

  getReservationPaymentClass(status: string): string {
    const map: Record<string, string> = {
      pending: 'payment-pending',
      partial: 'payment-partial',
      paid: 'payment-paid',
      refunded: 'payment-refunded'
    };
    return map[status] || '';
  }

  getUpcomingVehicleReservations(): Reservation[] {
    const now = new Date();
    return this.vehicleReservations.filter(r => {
      // Reserved or confirmed but pickup is in the future: upcoming.
      const pickup = toDate(r.pickupDateTime);
      return (
        pickup > now &&
        !['cancelled', 'delivered', 'returned', 'closed'].includes(r.reservationStatus)
      );
    });
  }

  getInProgressVehicleReservations(): Reservation[] {
    const now = new Date();
    return this.vehicleReservations.filter(r => {
      const pickup = toDate(r.pickupDateTime);
      const ret = toDate(r.returnDateTime);
      // Vehicle physically handed over to the customer right now.
      return (
        r.reservationStatus === 'delivered' ||
        (pickup <= now && ret >= now && r.reservationStatus !== 'cancelled')
      );
    });
  }

  getPastVehicleReservations(): Reservation[] {
    const now = new Date();
    return this.vehicleReservations.filter(r => {
      const returnDate = toDate(r.returnDateTime);
      return (
        returnDate < now &&
        !['cancelled'].includes(r.reservationStatus)
      );
    });
  }

  getCancelledVehicleReservations(): Reservation[] {
    return this.vehicleReservations.filter(r => r.reservationStatus === 'cancelled');
  }

  getResPickupDate(r: Reservation): Date {
    return toDate(r.pickupDateTime);
  }

  getResReturnDate(r: Reservation): Date {
    return toDate(r.returnDateTime);
  }

  /** Used by the maintenance tab template to normalise Firestore
   *  Timestamps into JS Dates for the | date pipe. */
  toDate(value: any): Date {
    return toDate(value);
  }

  viewReservation(reservationId: string | undefined): void {
    if (reservationId) {
      this.router.navigate(['/reservations', reservationId]);
    }
  }

  openGallery(index = 0): void {
    this.galleryIndex = index;
    this.showGallery = true;
  }

  openGalleryByUrl(url: string): void {
    const images = this.galleryImages();
    const index = images.findIndex(img => img.url === url);
    this.openGallery(index >= 0 ? index : 0);
  }

  closeGallery(): void {
    this.showGallery = false;
  }

  getStatusLabel(status: VehicleStatus): string {
    return this.t(VEHICLE_STATUS_LABELS[status], status);
  }

  getCategoryLabel(category: string): string {
    return this.t(VEHICLE_CATEGORY_LABELS[category as keyof typeof VEHICLE_CATEGORY_LABELS], category);
  }

  getFuelLabel(fuel: string): string {
    return this.t(FUEL_TYPE_LABELS[fuel as keyof typeof FUEL_TYPE_LABELS], fuel);
  }

  getTransmissionLabel(trans: string): string {
    return this.t(TRANSMISSION_LABELS[trans as keyof typeof TRANSMISSION_LABELS], trans);
  }

  getBodyTypeLabel(body: BodyType): string {
    return this.t(BODY_TYPE_LABELS[body], body);
  }

  getPricingRuleLabel(rule: VehiclePricingRule): string {
    if (rule.label) return rule.label;
    if (rule.maxDays === null) return `+${rule.minDays} días`;
    if (rule.minDays === rule.maxDays) return `${rule.minDays} día`;
    return `${rule.minDays}-${rule.maxDays} días`;
  }

  getStatusClass(status: VehicleStatus): string {
    const map: Record<VehicleStatus, string> = {
      available: 'status-available',
      rented: 'status-rented',
      maintenance: 'status-maintenance',
      out_of_service: 'status-out'
    };
    return map[status] || '';
  }

  openStatusModal(): void {
    this.showStatusModal = true;
  }

  closeStatusModal(): void {
    this.showStatusModal = false;
  }

  changeStatus(status: VehicleStatus): void {
    if (this.vehicle?.id) {
      this.vehicleService.changeStatus(this.vehicle.id, status).then(() => {
        if (this.vehicle) this.vehicle.status = status;
        this.closeStatusModal();
      });
    }
  }

  openDeleteModal(): void {
    this.showDeleteModal = true;
  }

  closeDeleteModal(): void {
    this.showDeleteModal = false;
  }

  deleteVehicle(): void {
    if (this.vehicle?.id) {
      this.vehicleService.deleteVehicle(this.vehicle.id).then(() => {
        this.router.navigate(['/vehicles']);
      });
    }
  }

  goBack(): void {
    this.router.navigate(['/vehicles']);
  }

  editVehicle(): void {
    if (this.vehicle?.id) {
      this.router.navigate(['/vehicles', this.vehicle.id, 'edit']);
    }
  }

  trackByIndex(index: number): number {
    return index;
  }
}