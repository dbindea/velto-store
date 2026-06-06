import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { VehicleService } from '../../services/vehicle.service';
import {
  Vehicle,
  VehicleStatus,
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
  imports: [CommonModule, TranslatePipe],
  templateUrl: './vehicle-detail.component.html',
  styleUrl: './vehicle-detail.component.scss'
})
export class VehicleDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);

  vehicle: Vehicle | null = null;
  loading = true;
  activeTab: 'info' | 'features' | 'photos' | 'history' = 'info';
  showStatusModal = false;
  showDeleteModal = false;

  statusOptions: VehicleStatus[] = ['available', 'rented', 'maintenance', 'out_of_service'];

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

  setTab(tab: 'info' | 'features' | 'photos' | 'history'): void {
    this.activeTab = tab;
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
}