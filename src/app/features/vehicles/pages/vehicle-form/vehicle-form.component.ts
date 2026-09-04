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
import { PhotoUploadButtonsComponent } from '@shared/components/photo-upload-buttons/photo-upload-buttons.component';
import { AcrissInput, generateAcrissCode } from '@shared/utils/acriss-code.util';
import { getDefaultPricingRules, validatePricingRules } from '@shared/utils/pricing.util';
import { capitalizeWords, toReference, transformInput } from '@shared/utils/text-case.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import { TranslateService } from '@core/i18n/translate.service';
import { SettingsService } from '@features/settings/services/settings.service';
import {
  FieldProblems,
  hasProblems,
  problemKeys
} from '@shared/utils/form-problems.util';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';

@Component({
  selector: 'app-vehicle-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    PhotoUploadButtonsComponent,
    FormErrorComponent
  ],
  templateUrl: './vehicle-form.component.html',
  styleUrl: './vehicle-form.component.scss',
})
export class VehicleFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);
  private translateService = inject(TranslateService);
  private settingsService = inject(SettingsService);

  isEditMode = false;
  vehicleId: string | null = null;
  loading = false;
  saving = false;

  formData: VehicleFormData = this.getEmptyForm();
  acrissCode = '';
  existingImages: VehicleImage[] = [];
  deletingImagePath: string | null = null;
  /** True while photos are being uploaded, so the slot can show a spinner. */
  uploadingImage = false;
  /** i18n key of the last upload/delete problem. Shown in the form, not in an alert. */
  uploadError = '';

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
      // Un coche nuevo nace con la fianza y los km incluidos que digan los
      // ajustes. Se recargan al abrir el formulario y luego se rehace el
      // borrador: pedirlos después de haberlo construido no serviría de nada.
      void this.settingsService.load().then(() => {
        this.formData = this.getEmptyForm();
        this.updateAcrissCode();
      });
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
      // De Ajustes; las constantes del código son el respaldo de mientras nadie
      // haya guardado ajustes todavía.
      defaultDepositAmount:
        this.settingsService.settings().defaultDepositAmount ?? APP_DEFAULTS.DEFAULT_DEPOSIT_AMOUNT,
      includedKmPerDay:
        this.settingsService.settings().defaultIncludedKmPerDay ??
        APP_DEFAULTS.DEFAULT_INCLUDED_KM_PER_DAY,
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

  // All five rewrite the field as you type, and all five go through
  // `transformInput()` so the caret stays where the operator put it. Assigning
  // `input.value` directly sent it to the end of the field on every keystroke.

  /** Generic text input that capitalizes first letter of every word */
  onTextCapitalize(event: Event, field: 'version' | 'color'): void {
    const input = event.target as HTMLInputElement;
    this.formData[field] = transformInput(input, capitalizeWords);
  }

  /** Brand: capitalize first letter of every word (e.g. "renault" -> "Renault") */
  onBrandInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.brand = transformInput(input, capitalizeWords);
  }

  /** Model: capitalize first letter of every word (e.g. "megane" -> "Megane") */
  onModelInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.model = transformInput(input, capitalizeWords);
  }

  onPlateInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.plateNumber = transformInput(input, toReference);
    this.updateAcrissCode();
  }

  onVinInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.vin = transformInput(input, toReference);
    this.updateAcrissCode();
  }

  /**
   * Upload every picked photo, one after the other.
   *
   * It used to take `files[0]` and drop the rest, so selecting eight photos of
   * a car uploaded one and silently discarded seven. Errors are shown in the
   * form now instead of in an `alert()`, which is what the client documents
   * already did.
   */
  async onImageSelected(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    if (!this.vehicleId) {
      this.uploadError = 'vehicles.photos.saveFirst';
      return;
    }

    this.uploadError = '';
    this.uploadingImage = true;
    try {
      for (const file of Array.from(files)) {
        if (!this.validateImage(file)) continue;
        await this.vehicleService.uploadImage(this.vehicleId, file);
      }
      await this.refreshImages();
    } catch (error) {
      console.error('Error uploading image:', error);
      this.uploadError = 'vehicles.photos.uploadError';
    } finally {
      this.uploadingImage = false;
    }
  }

  async deleteImage(image: VehicleImage): Promise<void> {
    if (!this.vehicleId) return;

    const confirmed = confirm(this.translateService.translate('vehicles.photos.confirmDelete'));
    if (!confirmed) return;

    this.deletingImagePath = image.path;
    this.uploadError = '';
    try {
      await this.vehicleService.deleteVehicleImage(this.vehicleId, image);
      this.existingImages = this.existingImages.filter(img => img.path !== image.path);
    } catch (error) {
      console.error('Error deleting image:', error);
      this.uploadError = 'vehicles.photos.deleteError';
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
      this.uploadError = 'common.photos.invalidType';
      return false;
    }

    if (file.size > maxSize) {
      this.uploadError = 'common.photos.tooLarge';
      return false;
    }

    return true;
  }

  /** Si ya se ha intentado guardar. Hasta entonces no se marca nada en rojo. */
  submitted = false;

  /**
   * Lo que impide guardar el vehículo: campo → clave de i18n.
   *
   * El orden es el de la pantalla, para que el resumen junto al botón se lea de
   * arriba abajo igual que el formulario. Aquí importa más que en ningún otro:
   * son 29 campos y el que falta puede quedar a dos pantallas de scroll.
   */
  get problems(): FieldProblems {
    const problems: FieldProblems = {};
    if (!this.formData.brand?.trim()) problems['brand'] = 'vehicles.errors.brandRequired';
    if (!this.formData.model?.trim()) problems['model'] = 'vehicles.errors.modelRequired';
    if (!this.formData.plateNumber?.trim()) {
      problems['plateNumber'] = 'vehicles.errors.plateRequired';
    }
    if (!this.formData.seats) problems['seats'] = 'vehicles.errors.seatsRequired';
    if (!this.formData.luggageCapacity) {
      problems['luggageCapacity'] = 'vehicles.errors.luggageRequired';
    }
    // El ACRISS se calcula solo a partir de categoría, carrocería, transmisión y
    // aire; si falta es que falta alguno de esos, no que haya que teclearlo.
    if (!this.acrissCode) problems['acriss'] = 'vehicles.errors.acrissRequired';
    return problems;
  }

  get problemList(): string[] {
    return problemKeys(this.problems);
  }

  async onSubmit(): Promise<void> {
    // Antes era `alert('El codigo ACRISS es requerido')` —español duro, sin
    // traducir— y solo comprobaba el ACRISS: con la marca vacía, el navegador
    // bloqueaba el envío por el `required` del HTML sin decir nada visible.
    this.submitted = true;
    if (hasProblems(this.problems)) return;

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

  // These maps hold i18n keys; the template renders the getters without a
  // `| translate`, so they resolve the key here.
  getStatusLabel(status: VehicleStatus): string {
    return this.translateService.translate(VEHICLE_STATUS_LABELS[status]);
  }

  getCategoryLabel(category: VehicleCategory): string {
    return this.translateService.translate(VEHICLE_CATEGORY_LABELS[category]);
  }

  getFuelLabel(fuel: FuelType): string {
    return this.translateService.translate(FUEL_TYPE_LABELS[fuel]);
  }

  getTransmissionLabel(trans: TransmissionType): string {
    return this.translateService.translate(TRANSMISSION_LABELS[trans]);
  }

  getBodyTypeLabel(body: BodyType): string {
    return this.translateService.translate(BODY_TYPE_LABELS[body]);
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
