import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { NotificationService } from '@core/notifications/notification.service';
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
import { ConfirmService } from '@core/notifications/confirm.service';
import { FormDraftService } from '@core/forms/form-draft.service';

@Component({
  selector: 'app-inspection-pickup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe, FormErrorComponent],
  templateUrl: './inspection-pickup.component.html',
  styleUrl: './inspection-pickup.component.scss'
})
export class InspectionPickupComponent implements OnInit {
  private confirm = inject(ConfirmService);
  private drafts = inject(FormDraftService);
  private destroyRef = inject(DestroyRef);
  /** Borrador vivo del formulario; se limpia al completar o al salir. */
  private draft: { clear: () => void } | null = null;
  private notifications = inject(NotificationService);
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

      /**
       * El borrador se conecta **después** de cargar lo que hay guardado, y por
       * eso manda sobre ello: si el operador estaba rellenando la entrega
       * cuando el móvil se llevó la pestaña por delante —abrir la cámara basta—,
       * lo suyo es más reciente que lo de Firestore.
       */
      this.draft = this.drafts.attach<Partial<Inspection>>(
        `pickup:${reservationId}`,
        () => this.formData,
        (guardado) => {
          this.formData = { ...this.formData, ...guardado };
        },
        this.destroyRef
      );
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
      const seguir = await this.confirm.ask({
        title: 'inspections.confirm.checklistTitle',
        message: 'inspections.confirm.checklistMessage',
        confirmLabel: 'common.continue'
      });
      if (!seguir) return;
    }

    this.saving = true;
    try {
      await this.inspectionService.completePickupInspection(this.reservationId, this.formData);
      // Guardado en Firestore: el borrador ya no protege nada y restaurarlo la
      // próxima vez sería resucitar datos que ya están donde tienen que estar.
      this.draft?.clear();
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

    // Desde la galería se pueden elegir varias de una vez (M-5): la inspección
    // pide ocho fotos y abrir el selector ocho veces, con el cliente delante,
    // es la diferencia entre hacerlas y no hacerlas. La cámara sigue de una en
    // una porque así funciona hacer una foto.
    const picked = Array.from(input.files);
    // Se vacía ya: si algo falla a mitad, el input no se queda con una
    // selección que el operador cree subida.
    input.value = '';

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const files = picked.filter(f => {
      if (!validTypes.includes(f.type)) {
        this.notifications.error('inspections.errors.photoType');
        return false;
      }
      if (f.size > APP_DEFAULTS.MAX_DOCUMENT_FILE_SIZE) {
        this.notifications.error('inspections.errors.photoTooLarge');
        return false;
      }
      return true;
    });
    // Una foto que no vale no cancela las demás: se avisa de ella y suben las
    // buenas. Rechazar el lote entero obligaría a repetir la selección.
    if (!files.length) return;

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
      // En serie y no en paralelo: son fotos de móvil redimensionadas en el
      // propio navegador, y lanzar ocho a la vez con mala cobertura las hace
      // competir por el ancho de banda y bloquea el hilo del canvas.
      for (const file of files) {
        const photo = await this.inspectionService.uploadInspectionPhoto(
          this.reservationId, 'pickup', file, category
        );
        this.formData.photos = [...(this.formData.photos || []), photo];
      }
      await this.inspectionService.updatePhotos(inspectionId, this.formData.photos!);
    } catch (error) {
      console.error('Error uploading photo:', error);
      this.notifications.error('inspections.errors.photoUpload');
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
    const confirmed = await this.confirm.ask({
      title: 'common.photos.deleteTitle',
      message: 'common.photos.deleteMessage',
      confirmLabel: 'common.delete',
      danger: true
    });
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
