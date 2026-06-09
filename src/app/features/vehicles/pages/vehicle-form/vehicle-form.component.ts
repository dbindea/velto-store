import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { VehicleService } from '../../services/vehicle.service';
import { generateAcrissCode, AcrissInput } from '@shared/utils/acriss-code.util';
import {
  VehicleFormData,
  VehicleStatus,
  VehicleCategory,
  BodyType,
  FuelType,
  TransmissionType,
  VEHICLE_STATUS_LABELS,
  VEHICLE_CATEGORY_LABELS,
  FUEL_TYPE_LABELS,
  TRANSMISSION_LABELS,
  BODY_TYPE_LABELS
} from '@shared/models/vehicle.model';

@Component({
  selector: 'app-vehicle-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './vehicle-form.component.html',
  styleUrl: './vehicle-form.component.scss'
})
export class VehicleFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);

  isEditMode = false;
  vehicleId: string | null = null;
  loading = false;
  saving = false;

  formData: VehicleFormData = this.getEmptyForm();
  acrissCode = '';

  statusOptions = Object.keys(VEHICLE_STATUS_LABELS) as VehicleStatus[];
  categoryOptions = Object.keys(VEHICLE_CATEGORY_LABELS) as VehicleCategory[];
  bodyTypeOptions = Object.keys(BODY_TYPE_LABELS) as BodyType[];
  fuelOptions = Object.keys(FUEL_TYPE_LABELS) as FuelType[];
  transmissionOptions = Object.keys(TRANSMISSION_LABELS) as TransmissionType[];

  currentYear = new Date().getFullYear();
  yearOptions: number[] = [];

  constructor() {
    for (let y = this.currentYear + 1; y >= this.currentYear - 30; y--) {
      this.yearOptions.push(y);
    }
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode = true;
      this.vehicleId = id;
      this.loadVehicle(id);
    } else {
      this.updateAcrissCode();
    }
  }

  loadVehicle(id: string): void {
    this.loading = true;
    this.vehicleService.getVehicleById(id).subscribe({
      next: (vehicle) => {
        this.formData = {
          brand: vehicle.brand,
          model: vehicle.model,
          version: vehicle.version || '',
          year: vehicle.year,
          plateNumber: vehicle.plateNumber,
          category: vehicle.category,
          bodyType: vehicle.bodyType,
          fuelType: vehicle.fuelType,
          transmission: vehicle.transmission,
          seats: vehicle.seats,
          luggageCapacity: vehicle.luggageCapacity || 2,
          status: vehicle.status,
          currentKm: vehicle.currentKm,
          color: vehicle.color || '',
          vin: vehicle.vin || '',
          description: vehicle.description || '',
          publicEnabled: vehicle.publicEnabled,
          features: { ...vehicle.features }
        };
        this.updateAcrissCode();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.router.navigate(['/vehicles']);
      }
    });
  }

  getEmptyForm(): VehicleFormData {
    return {
      brand: '',
      model: '',
      version: '',
      year: this.currentYear,
      plateNumber: '',
      category: 'economy',
      bodyType: '4_5_doors',
      fuelType: 'petrol',
      transmission: 'manual',
      seats: 5,
      luggageCapacity: 2,
      status: 'available',
      currentKm: undefined,
      color: '',
      vin: '',
      description: '',
      publicEnabled: false,
      features: {
        airConditioning: false,
        navigation: false,
        parkingSensors: false,
        rearCamera: false,
        cruiseControl: false
      }
    };
  }

  updateAcrissCode(): void {
    const input: AcrissInput = {
      category: this.formData.category,
      bodyType: this.formData.bodyType,
      transmission: this.formData.transmission,
      fuelType: this.formData.fuelType,
      features: this.formData.features
    };
    this.acrissCode = generateAcrissCode(input);
  }

  onFieldChange(): void {
    this.updateAcrissCode();
  }

  onPlateInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.toUpperCase().trim();
    this.formData.plateNumber = input.value;
    this.updateAcrissCode();
  }

  onVinInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.toUpperCase().replace(/\s/g, '');
    this.formData.vin = input.value;
    this.updateAcrissCode();
  }

  async onMainImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.vehicleId) return;

    const file = input.files[0];
    if (!this.validateImage(file)) return;

    this.saving = true;
    try {
      await this.vehicleService.uploadMainImage(this.vehicleId, file);
    } finally {
      this.saving = false;
      input.value = '';
    }
  }

  async onGalleryImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.vehicleId) return;

    const file = input.files[0];
    if (!this.validateImage(file)) return;

    this.saving = true;
    try {
      await this.vehicleService.uploadGalleryImage(this.vehicleId, file);
    } finally {
      this.saving = false;
      input.value = '';
    }
  }

  validateImage(file: File): boolean {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024;

    if (!validTypes.includes(file.type)) {
      alert('Solo se permiten imagenes JPG, PNG o WebP');
      return false;
    }

    if (file.size > maxSize) {
      alert('El tamano maximo es 5MB');
      return false;
    }

    return true;
  }

  async onSubmit(): Promise<void> {
    if (!this.acrissCode) {
      alert('El codigo ACRISS es requerido');
      return;
    }

    this.saving = true;
    try {
      if (this.isEditMode && this.vehicleId) {
        await this.vehicleService.updateVehicle(this.vehicleId, this.formData);
        this.router.navigate(['/vehicles', this.vehicleId]);
      } else {
        const id = await this.vehicleService.createVehicle(this.formData, this.acrissCode);
        this.router.navigate(['/vehicles', id]);
      }
    } catch (error) {
      console.error('Error saving vehicle:', error);
      this.saving = false;
    }
  }

  onCancel(): void {
    if (this.isEditMode && this.vehicleId) {
      this.router.navigate(['/vehicles', this.vehicleId]);
    } else {
      this.router.navigate(['/vehicles']);
    }
  }

  getStatusLabel(status: VehicleStatus): string {
    return VEHICLE_STATUS_LABELS[status];
  }

  getCategoryLabel(category: VehicleCategory): string {
    return VEHICLE_CATEGORY_LABELS[category];
  }

  getFuelLabel(fuel: FuelType): string {
    return FUEL_TYPE_LABELS[fuel];
  }

  getTransmissionLabel(trans: TransmissionType): string {
    return TRANSMISSION_LABELS[trans];
  }

  getBodyTypeLabel(body: BodyType): string {
    return BODY_TYPE_LABELS[body];
  }
}