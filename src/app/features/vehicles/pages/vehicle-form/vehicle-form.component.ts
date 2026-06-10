import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  BODY_TYPE_LABELS,
  BodyType,
  FUEL_TYPE_LABELS,
  FuelType,
  TRANSMISSION_LABELS,
  TransmissionType,
  VEHICLE_CATEGORY_LABELS,
  VEHICLE_STATUS_LABELS,
  VehicleCategory,
  VehicleFormData,
  VehicleImage,
  VehiclePricingRule,
  VehicleStatus,
} from '@shared/models/vehicle.model';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { AcrissInput, generateAcrissCode } from '@shared/utils/acriss-code.util';
import { getDefaultPricingRules, validatePricingRules } from '@shared/utils/pricing.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { VehicleService } from '@features/vehicles/services/vehicle.service';

@Component({
  selector: 'app-vehicle-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './vehicle-form.component.html',
  styleUrl: './vehicle-form.component.scss',
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
  existingImages: VehicleImage[] = [];
  deletingImagePath: string | null = null;

  // Pricing validation errors
  pricingErrors: string[] = [];

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
          features: { ...vehicle.features },
          pricingRules: vehicle.pricingRules?.length
            ? vehicle.pricingRules
            : getDefaultPricingRules(),
          defaultDepositAmount: vehicle.defaultDepositAmount ?? APP_DEFAULTS.DEFAULT_DEPOSIT_AMOUNT,
          includedKmPerDay: vehicle.includedKmPerDay ?? APP_DEFAULTS.DEFAULT_INCLUDED_KM_PER_DAY,
          extraKmPrice: vehicle.extraKmPrice ?? APP_DEFAULTS.DEFAULT_EXTRA_KM_PRICE,
          minimumRentalDays: vehicle.minimumRentalDays ?? APP_DEFAULTS.DEFAULT_MINIMUM_RENTAL_DAYS,
          manualPriceAllowed: vehicle.manualPriceAllowed ?? true,
        };
        this.updateAcrissCode();
        this.pricingErrors = validatePricingRules(this.formData.pricingRules || []);
        this.existingImages = vehicle.images || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.router.navigate(['/vehicles']);
      },
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
        cruiseControl: false,
      },
      pricingRules: getDefaultPricingRules(),
      defaultDepositAmount: APP_DEFAULTS.DEFAULT_DEPOSIT_AMOUNT,
      includedKmPerDay: APP_DEFAULTS.DEFAULT_INCLUDED_KM_PER_DAY,
      extraKmPrice: APP_DEFAULTS.DEFAULT_EXTRA_KM_PRICE,
      minimumRentalDays: APP_DEFAULTS.DEFAULT_MINIMUM_RENTAL_DAYS,
      manualPriceAllowed: true,
    };
  }

  updateAcrissCode(): void {
    const input: AcrissInput = {
      category: this.formData.category,
      bodyType: this.formData.bodyType,
      transmission: this.formData.transmission,
      fuelType: this.formData.fuelType,
      features: this.formData.features,
    };
    this.acrissCode = generateAcrissCode(input);
  }

  onFieldChange(): void {
    this.updateAcrissCode();
  }

  /** Generic text input that capitalizes first letter of every word */
  onTextCapitalize(event: Event, field: 'version' | 'color'): void {
    const input = event.target as HTMLInputElement;
    const value = this.capitalizeWords(input.value);
    this.formData[field] = value;
    input.value = value;
  }

  /** Brand: capitalize first letter of every word (e.g. "renault" -> "Renault") */
  onBrandInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = this.capitalizeWords(input.value);
    this.formData.brand = value;
    input.value = value;
  }

  /** Model: capitalize first letter of every word (e.g. "megane" -> "Megane") */
  onModelInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = this.capitalizeWords(input.value);
    this.formData.model = value;
    input.value = value;
  }

  private capitalizeWords(value: string): string {
    if (!value) return value;
    return value
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
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

  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.vehicleId) return;

    const file = input.files[0];
    if (!this.validateImage(file)) return;

    this.saving = true;
    try {
      await this.vehicleService.uploadImage(this.vehicleId, file);
      // Refresh image list
      await this.refreshImages();
    } finally {
      this.saving = false;
      input.value = '';
    }
  }

  async deleteImage(image: VehicleImage): Promise<void> {
    if (!this.vehicleId) return;

    const confirmed = confirm('¿Eliminar esta foto definitivamente?');
    if (!confirmed) return;

    this.deletingImagePath = image.path;
    try {
      await this.vehicleService.deleteVehicleImage(this.vehicleId, image);
      this.existingImages = this.existingImages.filter(img => img.path !== image.path);
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('Error al eliminar la foto');
    } finally {
      this.deletingImagePath = null;
    }
  }

  private async refreshImages(): Promise<void> {
    if (!this.vehicleId) return;
    this.vehicleService.getVehicleById(this.vehicleId).subscribe(v => {
      this.existingImages = v.images || [];
    });
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

  // Pricing methods
  addPricingRule(): void {
    const rules = this.formData.pricingRules || [];
    const lastRule = rules[rules.length - 1];
    const newMinDays = lastRule ? (lastRule.maxDays || lastRule.minDays) + 1 : 1;

    rules.push({
      minDays: newMinDays,
      maxDays: newMinDays + 3,
      pricePerDay: 40,
    });

    this.formData.pricingRules = [...rules];
    this.pricingErrors = validatePricingRules(this.formData.pricingRules);
  }

  removePricingRule(index: number): void {
    if (this.formData.pricingRules && this.formData.pricingRules.length > 1) {
      this.formData.pricingRules = this.formData.pricingRules.filter((_, i) => i !== index);
      this.pricingErrors = validatePricingRules(this.formData.pricingRules);
    }
  }

  restoreDefaultPricing(): void {
    this.formData.pricingRules = getDefaultPricingRules();
    this.pricingErrors = validatePricingRules(this.formData.pricingRules);
  }

  updatePricingRule(index: number, field: keyof VehiclePricingRule, value: any): void {
    if (!this.formData.pricingRules) return;

    this.formData.pricingRules = this.formData.pricingRules.map((rule, i) => {
      if (i !== index) return rule;
      return { ...rule, [field]: value };
    });

    this.pricingErrors = validatePricingRules(this.formData.pricingRules);
  }
}
