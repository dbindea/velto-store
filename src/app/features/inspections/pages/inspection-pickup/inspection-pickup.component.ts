import { Component, OnInit, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { first } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { FieldProblems, hasProblems, problemKeys } from '@shared/utils/form-problems.util';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
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
import {
  Workflow,
  WorkflowContext,
  canStartPickup
} from '@shared/utils/reservation-workflow.util';
import { ContractService } from '@features/contracts/services/contract.service';

@Component({
  selector: 'app-inspection-pickup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe, FormErrorComponent],
  templateUrl: './inspection-pickup.component.html',
  styleUrl: './inspection-pickup.component.scss'
})
export class InspectionPickupComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inspectionService = inject(InspectionService);
  private reservationService = inject(ReservationService);
  private contractService = inject(ContractService);

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
      // `first()` matters: getReservationById and getContractByReservation are
      // live onSnapshot streams that never complete. Awaiting them without it
      // hangs forever — the form sat on "Cargando…" and never appeared.
      this.reservation = await firstValueFrom(
        this.reservationService.getReservationById(reservationId).pipe(first())
      );
      if (!this.reservation) {
        this.router.navigate(['/inspections']);
        return;
      }

      // Workflow guard: refuse to enter the pickup form if the workflow
      // doesn't allow it. We still load the form so the user can review
      // and recover, but we flag it for the UI.
      const existing = await this.inspectionService.getInspectionByReservationAndType(reservationId, 'pickup');
      const contract = await firstValueFrom(
        this.contractService.getContractByReservation(reservationId).pipe(first())
      );
      const decision = canStartPickup({
        reservation: this.reservation,
        pickupInspection: existing || null,
        returnInspection: null,
        contract
      } as WorkflowContext);
      this.workflowBlockReason = decision.ok ? '' : decision.reason;

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

  workflowBlockReason = '';

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

  /** Si ya se ha intentado completar. Hasta entonces no se marca nada en rojo. */
  submitted = false;
  /** Un fallo del guardado, distinto de un campo sin rellenar. */
  saveError = '';

  /**
   * Lo que impide completar la entrega: campo → clave de i18n.
   *
   * Antes eran tres `alert()` **en español duro**, uno detrás de otro: se
   * arreglaba el primero, se volvía a pulsar y aparecía el segundo. Y en una
   * aplicación que se usa en tres idiomas.
   */
  get problems(): FieldProblems {
    const problems: FieldProblems = {};
    if (this.formData.km === undefined || this.formData.km === null) {
      problems['km'] = 'inspections.errors.kmRequired';
    }
    if (!this.formData.fuelLevel) {
      problems['fuelLevel'] = 'inspections.errors.fuelRequired';
    }
    if (!this.formData.cleanliness) {
      problems['cleanliness'] = 'inspections.errors.cleanlinessRequired';
    }
    return problems;
  }

  get problemList(): string[] {
    return problemKeys(this.problems);
  }

  async completePickup(): Promise<void> {
    if (!this.reservationId) return;

    this.submitted = true;
    this.saveError = '';
    if (hasProblems(this.problems)) return;

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
      // En pantalla, no en un `alert()` que hay que cerrar para poder ver lo
      // que estaba escrito.
      this.saveError = 'inspections.errors.pickupFailed';
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
