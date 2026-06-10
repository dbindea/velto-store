import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import {
  Vehicle,
  VehicleStatus,
  VehicleCategory,
  VehiclePricingRule,
  VEHICLE_STATUS_LABELS,
  VEHICLE_CATEGORY_LABELS
} from '@shared/models/vehicle.model';
import { getLowestPricePerDay } from '@shared/utils/pricing.util';

@Component({
  selector: 'app-vehicle-list',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, TranslatePipe],
  templateUrl: './vehicle-list.component.html',
  styleUrl: './vehicle-list.component.scss'
})
export class VehicleListComponent implements OnInit {
  private vehicleService = inject(VehicleService);
  private router = inject(Router);

  vehicles: Vehicle[] = [];
  filteredVehicles: Vehicle[] = [];
  loading = true;

  searchText = '';
  filterStatus: VehicleStatus | '' = '';
  filterCategory: VehicleCategory | '' = '';

  statusOptions = Object.keys(VEHICLE_STATUS_LABELS) as VehicleStatus[];
  categoryOptions = Object.keys(VEHICLE_CATEGORY_LABELS) as VehicleCategory[];

  ngOnInit(): void {
    this.loadVehicles();
  }

  loadVehicles(): void {
    this.loading = true;
    this.vehicleService.getVehicles().subscribe({
      next: (vehicles) => {
        this.vehicles = vehicles;
        this.applyFilters();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    let result = [...this.vehicles];

    if (this.searchText.trim()) {
      const search = this.searchText.toLowerCase();
      result = result.filter(v =>
        v.brand.toLowerCase().includes(search) ||
        v.model.toLowerCase().includes(search) ||
        v.plateNumber.toLowerCase().includes(search) ||
        v.acrissCode.toLowerCase().includes(search)
      );
    }

    if (this.filterStatus) {
      result = result.filter(v => v.status === this.filterStatus);
    }

    if (this.filterCategory) {
      result = result.filter(v => v.category === this.filterCategory);
    }

    this.filteredVehicles = result;
  }

  onSearch(): void {
    this.applyFilters();
  }

  onStatusFilter(): void {
    this.applyFilters();
  }

  onCategoryFilter(): void {
    this.applyFilters();
  }

  viewDetail(vehicle: Vehicle): void {
    this.router.navigate(['/vehicles', vehicle.id]);
  }

  getStatusLabel(status: VehicleStatus): string {
    return VEHICLE_STATUS_LABELS[status];
  }

  getCategoryLabel(category: VehicleCategory): string {
    return VEHICLE_CATEGORY_LABELS[category];
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

  getLowestPrice(rules: VehiclePricingRule[]): number {
    return getLowestPricePerDay(rules) || 0;
  }
}