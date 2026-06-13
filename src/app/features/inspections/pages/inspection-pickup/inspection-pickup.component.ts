import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { InspectionService } from '@features/inspections/services/inspection.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import {
  Inspection,
  InspectionType,
  FuelLevel,
  VehicleCleanliness,
  InspectionChecklist,
  InspectionPhoto,
  PhotoCategory,
  FUEL_LEVEL_LABELS,
  CLEANLINESS_LABELS,
  PHOTO_CATEGORY_LABELS
} from '@shared/models/inspection.model';
import { Reservation } from '@shared/models/reservation.model';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { toDate } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-inspection-pickup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe],
  templateUrl: './inspection-pickup.component.html',
  styleUrl: './inspection-pickup.component.scss'
})
export class InspectionPickupComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inspectionService = inject(InspectionService);
  private reservationService = inject(ReservationService);

  reservationId: string | null = null;
  reservation: Reservation | null = null;
  loading = true;
  saving = false;
  uploadingPhoto = false;

  formData: Partial<Inspection> = {
    km: undefined,
    fuelLevel: undefined,
    cleanliness: undefined,
    checklist: this.getEmptyChecklist(),
    notes: '',
    photos: [],
    damages: []
  };

  fuelLevels: FuelLevel[] = ['empty', 'quarter', 'half', 'three_quarters', 'full'];
  cleanlinessLevels: VehicleCleanliness[] = ['clean', 'normal', 'dirty', 'very_dirty'];
  photoCategories: PhotoCategory[] = ['front', 'rear', 'left_side', 'right_side', 'interior', 'dashboard', 'fuel', 'damage', 'other'];

  FUEL_LEVEL_LABELS = FUEL_LEVEL_LABELS;
  CLEANLINESS_LABELS = CLEANLINESS_LABELS;
  PHOTO_CATEGORY_LABELS = PHOTO_CATEGORY_LABELS;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('reservationId');
    if (id) {
      this.reservationId = id;
      this.loadData(id);
    } else {
      this.router.navigate(['/inspections']);
    }
  }

  async loadData(reservationId: string): Promise<void> {
    this.loading = true;
    try {
      this.reservation = await new Promise<Reservation | null>((resolve) => {
        this.reservationService.getReservationById(reservationId).subscribe(r => resolve(r));
      });
      if (!this.reservation) {
        this.router.navigate(['/inspections']);
        return;
      }

      const existing = await this.inspectionService.getInspectionByReservationAndType(reservationId, 'pickup');
      if (existing) {
        this.formData = { ...this.formData, ...existing };
        if (!this.formData.photos) this.formData.photos = existing.photos || [];
        if (!this.formData.damages) this.formData.damages = existing.damages || [];
      }
    } catch (error) {
      console.error('Error loading:', error);
    } finally {
      this.loading = false;
    }
  }

  getEmptyChecklist(): InspectionChecklist {
    return {
      clientIdentityChecked: false,
      drivingLicenseChecked: false,
      contractChecked: false,
      paymentChecked: false,
      depositChecked: false,
      keysDelivered: false,
      vehicleDocumentsDelivered: false,
      accessoriesChecked: false
    };
  }

  async completePickup(): Promise<void> {
    if (!this.reservationId) return;

    // Validation
    if (this.formData.km === undefined || this.formData.km === null) {
      alert('El kilometraje de salida es obligatorio');
      return;
    }
    if (!this.formData.fuelLevel) {
      alert('El nivel de combustible de salida es obligatorio');
      return;
    }
    if (!this.formData.cleanliness) {
      alert('El estado de limpieza es obligatorio');
      return;
    }
    const c = this.formData.checklist!;
    if (!c.clientIdentityChecked || !c.drivingLicenseChecked || !c.keysDelivered) {
      const confirmed = confirm('Hay items del checklist sin marcar. ¿Continuar de todos modos?');
      if (!confirmed) return;
    }

    this.saving = true;
    try {
      await this.inspectionService.completePickupInspection(this.reservationId, this.formData);
      this.router.navigate(['/reservations', this.reservationId]);
    } catch (error) {
      console.error('Error completing pickup:', error);
      alert('Error al completar la entrega');
    } finally {
      this.saving = false;
    }
  }

  async onPhotoSelected(event: Event, category: PhotoCategory): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.reservationId) return;
    const file = input.files[0];

    // Validate
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      alert('Solo se permiten imágenes JPG, PNG o WebP');
      input.value = '';
      return;
    }
    if (file.size > APP_DEFAULTS.MAX_DOCUMENT_FILE_SIZE) {
      alert('La imagen supera el tamaño máximo (5MB)');
      input.value = '';
      return;
    }

    this.uploadingPhoto = true;
    try {
      // We need an inspection ID to attach photo. If no inspection yet, create draft.
      let inspectionId = (this.formData as Inspection).id;
      if (!inspectionId) {
        const created = await this.inspectionService.createInspection({
          ...this.formData,
          reservationId: this.reservationId,
          vehicleId: this.reservation!.vehicleId,
          clientId: this.reservation!.clientId,
          type: 'pickup',
          status: 'draft'
        } as Inspection);
        inspectionId = created;
        (this.formData as Inspection).id = created;
      }
      const photo = await this.inspectionService.uploadInspectionPhoto(
        this.reservationId, 'pickup', file, category
      );
      this.formData.photos = [...(this.formData.photos || []), photo];
      await this.inspectionService.updatePhotos(inspectionId, this.formData.photos!);
      input.value = '';
    } catch (error) {
      console.error('Error uploading photo:', error);
      alert('Error al subir la foto');
    } finally {
      this.uploadingPhoto = false;
    }
  }

  async deletePhoto(photo: InspectionPhoto): Promise<void> {
    if (!(this.formData as Inspection).id) {
      // Just remove from local list
      this.formData.photos = (this.formData.photos || []).filter(p => p.path !== photo.path);
      return;
    }
    const confirmed = confirm('¿Eliminar esta foto?');
    if (!confirmed) return;
    try {
      await this.inspectionService.deleteInspectionPhoto((this.formData as Inspection).id!, photo);
      this.formData.photos = (this.formData.photos || []).filter(p => p.path !== photo.path);
    } catch (error) {
      console.error('Error deleting photo:', error);
    }
  }

  goBack(): void {
    if (this.reservationId) {
      this.router.navigate(['/reservations', this.reservationId]);
    } else {
      this.router.navigate(['/inspections']);
    }
  }

  viewReservation(): void {
    if (this.reservationId) {
      this.router.navigate(['/reservations', this.reservationId]);
    }
  }

  getPickupDate(): Date {
    return this.reservation ? toDate(this.reservation.pickupDateTime) : new Date();
  }

  getReturnDate(): Date {
    return this.reservation ? toDate(this.reservation.returnDateTime) : new Date();
  }
}
