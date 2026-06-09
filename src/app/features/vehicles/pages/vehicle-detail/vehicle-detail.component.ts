import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { VehicleService } from '../../services/vehicle.service';
import { ImageGalleryComponent, GalleryImage } from '@shared/components/image-gallery/image-gallery.component';
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

@Component({
  selector: 'app-vehicle-detail',
  standalone: true,
  imports: [CommonModule, TranslatePipe, ImageGalleryComponent],
  templateUrl: './vehicle-detail.component.html',
  styleUrl: './vehicle-detail.component.scss'
})
export class VehicleDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);

  vehicle: Vehicle | null = null;
  loading = true;
  activeTab: 'info' | 'features' | 'photos' | 'pricing' | 'history' = 'info';
  showStatusModal = false;
  showDeleteModal = false;
  showGallery = false;
  galleryIndex = 0;

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

  setTab(tab: 'info' | 'features' | 'photos' | 'pricing' | 'history'): void {
    this.activeTab = tab;
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
    return VEHICLE_STATUS_LABELS[status];
  }

  getCategoryLabel(category: string): string {
    return VEHICLE_CATEGORY_LABELS[category as keyof typeof VEHICLE_CATEGORY_LABELS] || category;
  }

  getFuelLabel(fuel: string): string {
    return FUEL_TYPE_LABELS[fuel as keyof typeof FUEL_TYPE_LABELS] || fuel;
  }

  getTransmissionLabel(trans: string): string {
    return TRANSMISSION_LABELS[trans as keyof typeof TRANSMISSION_LABELS] || trans;
  }

  getBodyTypeLabel(body: BodyType): string {
    return BODY_TYPE_LABELS[body] || body;
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