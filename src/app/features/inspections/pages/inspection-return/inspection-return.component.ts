import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { InspectionService } from '@features/inspections/services/inspection.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import {
  Inspection,
  FuelLevel,
  VehicleCleanliness,
  InspectionChecklist,
  InspectionPhoto,
  InspectionExtraCharges,
  VehicleDamage,
  DamageArea,
  DamageSeverity,
  PhotoCategory,
  FUEL_LEVEL_LABELS,
  CLEANLINESS_LABELS,
  PHOTO_CATEGORY_LABELS,
  DAMAGE_AREA_LABELS,
  DAMAGE_SEVERITY_LABELS
} from '@shared/models/inspection.model';
import { Reservation } from '@shared/models/reservation.model';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { calculateCalendarDays } from '@shared/utils/reservation-date.util';
import { toDate } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-inspection-return',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe],
  templateUrl: './inspection-return.component.html',
  styleUrl: './inspection-return.component.scss'
})
export class InspectionReturnComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inspectionService = inject(InspectionService);
  private reservationService = inject(ReservationService);

  reservationId: string | null = null;
  reservation: Reservation | null = null;
  pickupInspection: Inspection | null = null;
  loading = true;
  saving = false;
  uploadingPhoto = false;
  showCloseConfirmModal = false;
  closeReservation = false;

  formData: Partial<Inspection> = {
    km: undefined,
    fuelLevel: undefined,
    cleanliness: undefined,
    checklist: this.getEmptyChecklist(),
    notes: '',
    photos: [],
    damages: [],
    extraCharges: this.getEmptyExtraCharges()
  };

  // New damage form
  showDamageForm = false;
  newDamage: VehicleDamage = {
    area: 'front',
    description: '',
    severity: 'minor',
    isNewDamage: true
  };

  fuelLevels: FuelLevel[] = ['empty', 'quarter', 'half', 'three_quarters', 'full'];
  cleanlinessLevels: VehicleCleanliness[] = ['clean', 'normal', 'dirty', 'very_dirty'];
  photoCategories: PhotoCategory[] = ['front', 'rear', 'left_side', 'right_side', 'interior', 'dashboard', 'fuel', 'damage', 'other'];
  damageAreas: DamageArea[] = ['front', 'rear', 'left_side', 'right_side', 'roof', 'interior', 'wheels', 'windows', 'other'];
  damageSeverities: DamageSeverity[] = ['minor', 'medium', 'serious'];

  FUEL_LEVEL_LABELS = FUEL_LEVEL_LABELS;
  CLEANLINESS_LABELS = CLEANLINESS_LABELS;
  PHOTO_CATEGORY_LABELS = PHOTO_CATEGORY_LABELS;
  DAMAGE_AREA_LABELS = DAMAGE_AREA_LABELS;
  DAMAGE_SEVERITY_LABELS = DAMAGE_SEVERITY_LABELS;

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
      this.pickupInspection = await this.inspectionService.getInspectionByReservationAndType(reservationId, 'pickup');

      const existing = await this.inspectionService.getInspectionByReservationAndType(reservationId, 'return');
      if (existing) {
        this.formData = { ...this.formData, ...existing };
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
      keysReturned: false,
      accessoriesChecked: false
    };
  }

  getEmptyExtraCharges(): InspectionExtraCharges {
    return {
      extraKmCharge: 0,
      fuelCharge: 0,
      refuelPenalty: 0,
      cleaningCharge: 0,
      damageCharge: 0,
      fineCharge: 0,
      otherCharge: 0,
      totalExtraCharges: 0,
      notes: ''
    };
  }

  // Computed values for deposit calc
  get totalExtraCharges(): number {
    const e = this.formData.extraCharges;
    if (!e) return 0;
    return (e.extraKmCharge || 0) + (e.fuelCharge || 0) + (e.refuelPenalty || 0) +
           (e.cleaningCharge || 0) + (e.damageCharge || 0) + (e.fineCharge || 0) + (e.otherCharge || 0);
  }

  get depositPaid(): number {
    return this.reservation?.deposit?.paidAmount || 0;
  }

  get depositRequired(): number {
    return this.reservation?.deposit?.requiredAmount || 0;
  }

  get toRetain(): number {
    return Math.min(this.depositPaid, this.totalExtraCharges);
  }

  get toRefund(): number {
    return Math.max(0, this.depositPaid - this.totalExtraCharges);
  }

  get pickupKm(): number | undefined {
    return this.pickupInspection?.km || this.reservation?.deliveryInfo?.pickupKm;
  }

  get totalDays(): number {
    if (!this.reservation) return 0;
    const pickup = toDate(this.reservation.pickupDateTime);
    const ret = toDate(this.reservation.returnDateTime);
    return calculateCalendarDays(pickup, ret);
  }

  recalculateTotal(): void {
    if (this.formData.extraCharges) {
      this.formData.extraCharges.totalExtraCharges = this.totalExtraCharges;
    }
  }

  addDamage(): void {
    if (!this.newDamage.description) {
      alert('La descripción del daño es obligatoria');
      return;
    }
    this.formData.damages = [...(this.formData.damages || []), { ...this.newDamage, id: Date.now().toString() }];
    this.newDamage = { area: 'front', description: '', severity: 'minor', isNewDamage: true };
    this.showDamageForm = false;
  }

  removeDamage(index: number): void {
    this.formData.damages = (this.formData.damages || []).filter((_, i) => i !== index);
  }

  async completeReturn(): Promise<void> {
    if (!this.reservationId) return;

    // Validation
    if (this.formData.km === undefined || this.formData.km === null) {
      alert('El kilometraje de entrada es obligatorio');
      return;
    }
    if (!this.formData.fuelLevel) {
      alert('El nivel de combustible de entrada es obligatorio');
      return;
    }
    if (this.pickupKm !== undefined && this.formData.km < this.pickupKm) {
      alert('El kilometraje de entrada no puede ser menor que el de salida');
      return;
    }
    if (!this.formData.checklist?.keysReturned) {
      const confirmed = confirm('No has marcado la devolución de llaves. ¿Continuar?');
      if (!confirmed) return;
    }

    this.recalculateTotal();
    this.saving = true;
    try {
      await this.inspectionService.completeReturnInspection(
        this.reservationId,
        this.formData,
        {
          closeReservation: this.closeReservation,
          retainDepositAmount: this.toRetain > 0 ? this.toRetain : undefined,
          refundDepositAmount: this.toRefund > 0 ? this.toRefund : undefined
        }
      );
      this.router.navigate(['/reservations', this.reservationId]);
    } catch (error) {
      console.error('Error completing return:', error);
      alert('Error al completar la devolución');
    } finally {
      this.saving = false;
    }
  }

  openCloseConfirmModal(): void {
    this.showCloseConfirmModal = true;
  }

  closeCloseConfirmModal(): void {
    this.showCloseConfirmModal = false;
  }

  async onPhotoSelected(event: Event, category: PhotoCategory): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.reservationId) return;
    const file = input.files[0];

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
      let inspectionId = (this.formData as Inspection).id;
      if (!inspectionId) {
        const created = await this.inspectionService.createInspection({
          ...this.formData,
          reservationId: this.reservationId,
          vehicleId: this.reservation!.vehicleId,
          clientId: this.reservation!.clientId,
          type: 'return',
          status: 'draft'
        } as Inspection);
        inspectionId = created;
        (this.formData as Inspection).id = created;
      }
      const photo = await this.inspectionService.uploadInspectionPhoto(
        this.reservationId, 'return', file, category
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

  async retainDeposit(): Promise<void> {
    if (!this.reservationId) return;
    const amount = this.toRetain;
    if (amount <= 0) {
      alert('No hay importe a retener');
      return;
    }
    const reason = prompt('Motivo de la retención:', 'Cargos entrega/devolución') || 'Cargos entrega/devolución';
    try {
      await this.inspectionService['paymentService'].retainDeposit(this.reservationId, amount, reason);
      this.recalculateTotal();
      alert(`Retenidos ${amount.toFixed(2)} € de la fianza`);
      this.router.navigate(['/reservations', this.reservationId]);
    } catch (error) {
      console.error('Error retaining deposit:', error);
    }
  }

  async refundDeposit(): Promise<void> {
    if (!this.reservationId) return;
    const amount = this.toRefund;
    if (amount <= 0) {
      alert('No hay importe a devolver');
      return;
    }
    try {
      await this.inspectionService['paymentService'].refundDeposit(this.reservationId, amount, 'cash', 'Devolución fianza');
      alert(`Devueltos ${amount.toFixed(2)} € de la fianza`);
      this.router.navigate(['/reservations', this.reservationId]);
    } catch (error) {
      console.error('Error refunding deposit:', error);
    }
  }

  getPickupDate(): Date {
    return this.reservation ? toDate(this.reservation.pickupDateTime) : new Date();
  }

  getReturnDate(): Date {
    return this.reservation ? toDate(this.reservation.returnDateTime) : new Date();
  }
}
