import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { InspectionService } from '@features/inspections/services/inspection.service';
import {
  Inspection,
  FUEL_LEVEL_LABELS,
  CLEANLINESS_LABELS,
  PHOTO_CATEGORY_LABELS,
  DAMAGE_AREA_LABELS,
  DAMAGE_SEVERITY_LABELS,
  INSPECTION_TYPE_LABELS,
  INSPECTION_STATUS_LABELS,
  INSPECTION_STATUS_COLORS
} from '@shared/models/inspection.model';
import { toDate } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-inspection-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslatePipe],
  templateUrl: './inspection-detail.component.html',
  styleUrl: './inspection-detail.component.scss'
})
export class InspectionDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inspectionService = inject(InspectionService);

  inspection: Inspection | null = null;
  loading = true;

  FUEL_LEVEL_LABELS = FUEL_LEVEL_LABELS;
  CLEANLINESS_LABELS = CLEANLINESS_LABELS;
  PHOTO_CATEGORY_LABELS = PHOTO_CATEGORY_LABELS;
  DAMAGE_AREA_LABELS = DAMAGE_AREA_LABELS;
  DAMAGE_SEVERITY_LABELS = DAMAGE_SEVERITY_LABELS;
  INSPECTION_TYPE_LABELS = INSPECTION_TYPE_LABELS;
  INSPECTION_STATUS_LABELS = INSPECTION_STATUS_LABELS;
  INSPECTION_STATUS_COLORS = INSPECTION_STATUS_COLORS;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadInspection(id);
    } else {
      this.router.navigate(['/inspections']);
    }
  }

  loadInspection(id: string): void {
    this.loading = true;
    this.inspectionService.getInspectionById(id).subscribe({
      next: (inspection) => {
        if (!inspection) {
          this.router.navigate(['/inspections']);
          return;
        }
        this.inspection = inspection;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading inspection:', error);
        this.loading = false;
      }
    });
  }

  goBack(): void {
    if (this.inspection?.reservationId) {
      this.router.navigate(['/reservations', this.inspection.reservationId]);
    } else {
      this.router.navigate(['/inspections']);
    }
  }

  viewReservation(): void {
    if (this.inspection?.reservationId) {
      this.router.navigate(['/reservations', this.inspection.reservationId]);
    }
  }

  getCreatedAt(): Date | null {
    return this.inspection?.createdAt ? toDate(this.inspection.createdAt) : null;
  }

  getCompletedAt(): Date | null {
    return this.inspection?.completedAt ? toDate(this.inspection.completedAt) : null;
  }
}
