import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { InspectionService } from '@features/inspections/services/inspection.service';
import {
  Inspection,
  InspectionType,
  InspectionStatus,
  INSPECTION_TYPE_LABELS,
  INSPECTION_STATUS_LABELS,
  INSPECTION_STATUS_COLORS
} from '@shared/models/inspection.model';
import { toDate } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-inspection-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslatePipe],
  templateUrl: './inspection-list.component.html',
  styleUrl: './inspection-list.component.scss'
})
export class InspectionListComponent implements OnInit {
  private router = inject(Router);
  private inspectionService = inject(InspectionService);

  inspections: Inspection[] = [];
  filteredInspections: Inspection[] = [];
  loading = true;

  // Filters
  searchTerm = '';
  typeFilter: InspectionType | 'all' = 'all';
  statusFilter: InspectionStatus | 'all' = 'all';

  INSPECTION_TYPE_LABELS = INSPECTION_TYPE_LABELS;
  INSPECTION_STATUS_LABELS = INSPECTION_STATUS_LABELS;
  INSPECTION_STATUS_COLORS = INSPECTION_STATUS_COLORS;

  typeOptions: Array<{ value: InspectionType | 'all'; label: string }> = [
    { value: 'all', label: 'common.all' },
    { value: 'pickup', label: 'inspections.pickup' },
    { value: 'return', label: 'inspections.return' }
  ];

  statusOptions: Array<{ value: InspectionStatus | 'all'; label: string }> = [
    { value: 'all', label: 'common.all' },
    { value: 'completed', label: 'inspections.status.completed' },
    { value: 'draft', label: 'inspections.status.draft' },
    { value: 'cancelled', label: 'inspections.status.cancelled' }
  ];

  ngOnInit(): void {
    this.loadInspections();
  }

  loadInspections(): void {
    this.loading = true;
    this.inspectionService.getInspections().subscribe({
      next: (inspections) => {
        this.inspections = inspections;
        this.applyFilters();
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading inspections:', error);
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    let result = [...this.inspections];

    if (this.typeFilter !== 'all') {
      result = result.filter(i => i.type === this.typeFilter);
    }
    if (this.statusFilter !== 'all') {
      result = result.filter(i => i.status === this.statusFilter);
    }
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(i =>
        i.clientSnapshot?.fullName?.toLowerCase().includes(term) ||
        i.vehicleSnapshot?.plateNumber?.toLowerCase().includes(term) ||
        i.vehicleSnapshot?.brand?.toLowerCase().includes(term) ||
        i.vehicleSnapshot?.model?.toLowerCase().includes(term)
      );
    }

    this.filteredInspections = result;
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  viewDetail(inspection: Inspection): void {
    this.router.navigate(['/inspections', inspection.id]);
  }

  viewReservation(reservationId: string | undefined, event: Event): void {
    event.stopPropagation();
    if (reservationId) {
      this.router.navigate(['/reservations', reservationId]);
    }
  }

  getCreatedAt(inspection: Inspection): Date | null {
    return inspection.createdAt ? toDate(inspection.createdAt) : null;
  }

  getCompletedAt(inspection: Inspection): Date | null {
    return inspection.completedAt ? toDate(inspection.completedAt) : null;
  }
}
