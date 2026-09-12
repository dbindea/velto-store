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
  VEHICLE_OWNERSHIP_LABELS,
  VEHICLE_STATUS_LABELS,
  VehicleCategory,
  VehicleFormData,
  VehicleImage,
  VehicleOwnership,
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
import { ConfirmService } from '@core/notifications/confirm.service';
import { NotificationService } from '@core/notifications/notification.service';
import { PermissionsService } from '@core/auth/permissions.service';
import { CollaboratorService } from '@features/collaborators/services/collaborator.service';
import { Collaborator } from '@shared/models/collaborator.model';
import {
  DEFAULT_OWNER_SHARE_PERCENT,
  vehicleOwnershipProblem,
  veltoSharePercent
} from '@shared/utils/owner-share.util';

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
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);
  private translateService = inject(TranslateService);
  private settingsService = inject(SettingsService);
  private collaboratorService = inject(CollaboratorService);
  private notifications = inject(NotificationService);
  /** Público: la plantilla decide con él si enseña la sección de propiedad. */
  permissions = inject(PermissionsService);

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

  // --- Propiedad del coche -------------------------------------------------

  ownershipOptions = Object.keys(VEHICLE_OWNERSHIP_LABELS) as VehicleOwnership[];
  /**
   * Los colaboradores que pueden ser propietarios.
   *
   * ⚠️ **Solo los activos**, misma regla que al asignar una comisión: uno dado
   * de baja no debe salir en una lista donde se le asigna trabajo nuevo. Si el
   * coche ya apunta a uno de baja, se le añade a mano más abajo — esconder al
   * propietario actual dejaría el desplegable en blanco y parecería que el dato
   * se ha perdido.
   */
  collaborators: Collaborator[] = [];
  loadingCollaborators = false;
  /** Fallo al traer la lista, en clave i18n. Sin lista no se puede elegir. */
  collaboratorsError = '';

  /** El alta rápida, abierta o cerrada. */
  creatingCollaborator = false;
  newCollaboratorName = '';
  newCollaboratorShare: number | null = DEFAULT_OWNER_SHARE_PERCENT;
  savingCollaborator = false;
  newCollaboratorError = '';

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
    /**
     * ⚠️ **Solo quien puede ver colaboradores los pide.** `firestore.rules`
     * deniega esa colección a un empleado, así que pedirla sin permiso no
     * devuelve una lista vacía: devuelve un error de permisos que no significa
     * nada para quien está dando de alta un coche.
     */
    if (this.permissions.can('viewCollaborators')) {
      void this.loadCollaborators();
    }

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
          /**
           * ⚠️ **Se cargan siempre, tenga permiso o no quien abre la ficha.**
           * La sección solo se pinta con `viewCollaborators`, pero los valores
           * tienen que estar en el formulario igualmente: `updateVehicle()`
           * escribe lo que hay en `formData`, así que si un empleado edita los
           * kilómetros de un coche cedido y estos campos vinieran vacíos, el
           * guardado borraría al propietario. Esconder no es lo mismo que
           * quitar.
           */
          ownership: vehicle.ownership ?? 'own',
          ownerCollaboratorId: vehicle.ownerCollaboratorId,
          ownerCollaboratorName: vehicle.ownerCollaboratorName,
          ownerSharePercent: vehicle.ownerSharePercent,
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
          hasGpsTracker: vehicle.hasGpsTracker ?? false,
          insurerName: vehicle.insurerName || '',
          insurancePolicy: vehicle.insurancePolicy || '',
          roadsideAssistancePhone: vehicle.roadsideAssistancePhone || '',
          extraKmPrice: vehicle.extraKmPrice ?? APP_DEFAULTS.DEFAULT_EXTRA_KM_PRICE,
          minimumRentalDays: vehicle.minimumRentalDays ?? APP_DEFAULTS.DEFAULT_MINIMUM_RENTAL_DAYS,
          manualPriceAllowed: vehicle.manualPriceAllowed ?? true,
        };
        this.updateAcrissCode();
        this.pricingErrors = validatePricingRules(this.formData.pricingRules || []);
        this.existingImages = vehicle.images || [];
        // La lista de colaboradores y el vehículo se piden a la vez y no hay
        // orden garantizado entre las dos: el que termine el último es quien
        // tiene que rescatar al propietario de baja.
        this.ensureCurrentOwnerIsListed();
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
      // Un coche nace de Velto: es la mayoría de la flota, y dar de alta uno
      // propio no puede exigir contestar a una pregunta más.
      ownership: 'own',
      ownerCollaboratorId: undefined,
      ownerCollaboratorName: undefined,
      ownerSharePercent: undefined,
      currentKm: undefined,
      color: '',
      vin: '',
      description: '',
      publicEnabled: false,
      features: {
        /**
         * Marcado de salida, al contrario que el resto del equipamiento (D-3).
         *
         * En una flota de 2026 lo raro es el coche que no lleva aire, y este no
         * es un extra cualquiera: alimenta la letra del código ACRISS, que
         * viaja a los documentos. Naciendo a `false`, un despiste al dar de
         * alta imprimía «N» —sin aire— en algo que ve el cliente. Se desmarca
         * en el coche que no lo tenga, que es el caso excepcional.
         */
        airConditioning: true,
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
      // Sin marcar: afirmar que un coche lleva GPS sin llevarlo es peor que no
      // decirlo, porque el contrato lo imprime como un hecho.
      hasGpsTracker: false,
      // Vacíos y no heredados de otro coche: cada póliza es la suya, y un valor
      // arrastrado por comodidad acabaría impreso en un contrato como si fuera
      // el seguro de este vehículo.
      insurerName: '',
      insurancePolicy: '',
      roadsideAssistancePhone: '',
      minimumRentalDays: APP_DEFAULTS.DEFAULT_MINIMUM_RENTAL_DAYS,
      manualPriceAllowed: true,
    };
  }

  // --- Propiedad del coche -------------------------------------------------

  private async loadCollaborators(): Promise<void> {
    this.loadingCollaborators = true;
    this.collaboratorsError = '';
    try {
      this.collaborators = (await this.collaboratorService.list()).filter((c) => c.active);
      this.ensureCurrentOwnerIsListed();
    } catch (error) {
      console.error('Error loading collaborators:', error);
      // Sin lista no se puede elegir propietario, y un desplegable vacío sin
      // explicación parece que no hay ninguno dado de alta.
      this.collaboratorsError = 'vehicles.owner.loadError';
    } finally {
      this.loadingCollaborators = false;
    }
  }

  /**
   * Mete en la lista al propietario actual aunque esté de baja.
   *
   * ⚠️ **Un coche ya asignado no puede perder a su dueño al abrir la ficha.**
   * Filtrando solo por activos, editar un coche de un colaborador dado de baja
   * dejaría el desplegable sin su valor: el `select` se pintaría en blanco y el
   * primer guardado lo borraría sin que nadie lo pidiera.
   */
  private ensureCurrentOwnerIsListed(): void {
    const id = this.formData.ownerCollaboratorId;
    if (!id || this.collaborators.some((c) => c.id === id)) return;
    this.collaborators = [
      ...this.collaborators,
      {
        id,
        name: this.formData.ownerCollaboratorName || '—',
        commissionPercent: 0,
        active: false
      }
    ];
  }

  /**
   * Al cambiar de «propio» a «de colaborador» y al revés.
   *
   * ⚠️ **Volver a «propio» limpia al propietario.** Dejar el colaborador y el
   * porcentaje escritos en el formulario haría que un cambio de idea a medias
   * —marcar propio, guardar, volver a marcar colaborador— reapareciera con el
   * dueño de antes ya puesto, que es justo el dato que nadie vuelve a mirar.
   */
  onOwnershipChange(): void {
    if (this.formData.ownership !== 'collaborator') {
      this.formData.ownerCollaboratorId = undefined;
      this.formData.ownerCollaboratorName = undefined;
      this.formData.ownerSharePercent = undefined;
      this.creatingCollaborator = false;
    }
  }

  /**
   * Al elegir propietario: se copia su nombre y se **propone** su reparto.
   *
   * ⚠️ **Propone, no impone** (decisión de Dorel, 12 de septiembre de 2026). El
   * porcentaje vive en el coche porque un mismo propietario puede ceder un
   * utilitario y una furgoneta con repartos distintos; el suyo es el punto de
   * partida. Por eso solo se rellena si el campo está vacío: reescribirlo al
   * cambiar de propietario pisaría un reparto ya pactado para este coche.
   */
  onOwnerChange(): void {
    const elegido = this.collaborators.find((c) => c.id === this.formData.ownerCollaboratorId);
    this.formData.ownerCollaboratorName = elegido?.name;
    if (!elegido) return;
    if (this.formData.ownerSharePercent === null || this.formData.ownerSharePercent === undefined) {
      this.formData.ownerSharePercent = elegido.ownerSharePercent ?? DEFAULT_OWNER_SHARE_PERCENT;
    }
  }

  /** Lo que se queda Velto, solo para enseñarlo al lado del reparto. */
  get veltoPercent(): number {
    return veltoSharePercent(this.formData.ownerSharePercent ?? 0);
  }

  openCollaboratorForm(): void {
    this.creatingCollaborator = true;
    this.newCollaboratorName = '';
    this.newCollaboratorShare = DEFAULT_OWNER_SHARE_PERCENT;
    this.newCollaboratorError = '';
  }

  cancelCollaboratorForm(): void {
    this.creatingCollaborator = false;
    this.newCollaboratorError = '';
  }

  /**
   * Dar de alta un colaborador sin salir de la ficha del coche.
   *
   * ⚠️ **Nace con un 0 % de comisión de captación**, que significa «no trae
   * clientes» (decisión de Dorel, 12 de septiembre de 2026). Es lo cierto de
   * alguien que se da de alta aquí: está cediendo un coche, no trayendo a
   * nadie. Poniéndole un 25 % por defecto se le habría inventado una comisión
   * que nadie pactó y que se aplicaría sola el día que se le asigne una venta.
   * Si además trae clientes, se le pone su porcentaje en su ficha.
   */
  async saveNewCollaborator(): Promise<void> {
    const nombre = this.newCollaboratorName.trim();
    if (!nombre) {
      this.newCollaboratorError = 'collaborators.problems.nameRequired';
      return;
    }

    this.savingCollaborator = true;
    this.newCollaboratorError = '';
    try {
      const id = await this.collaboratorService.save({
        name: nombre,
        commissionPercent: 0,
        ownerSharePercent:
          this.newCollaboratorShare === null ? undefined : Number(this.newCollaboratorShare),
        active: true
      });
      await this.loadCollaborators();
      this.formData.ownerCollaboratorId = id;
      // El reparto del coche lo pone el que se acaba de teclear, aunque el
      // campo ya tuviera algo: es un propietario nuevo, no un cambio de idea.
      this.formData.ownerSharePercent =
        this.newCollaboratorShare === null
          ? DEFAULT_OWNER_SHARE_PERCENT
          : Number(this.newCollaboratorShare);
      this.onOwnerChange();
      this.creatingCollaborator = false;
    } catch (error) {
      console.error('Error creating collaborator:', error);
      // El servicio lanza claves i18n; si llega otra cosa, un mensaje genérico
      // es mejor que enseñar el texto de un error de red en crudo.
      const clave = (error as Error)?.message || '';
      this.newCollaboratorError = clave.startsWith('collaborators.')
        ? clave
        : 'vehicles.owner.createError';
    } finally {
      this.savingCollaborator = false;
    }
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

    const confirmed = await this.confirm.ask({
      title: 'common.photos.deleteTitle',
      message: 'vehicles.photos.confirmDelete',
      confirmLabel: 'common.delete',
      danger: true
    });
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
    /**
     * La propiedad, con **la misma función que comprueba el servicio**: un
     * coche «de colaborador» sin colaborador o sin reparto es una reserva que
     * dice que hay que pagarle a alguien sin decir a quién ni cuánto, y eso no
     * se descubre hasta que se cierra el primer alquiler.
     */
    Object.assign(problems, vehicleOwnershipProblem(this.formData));
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
      /**
       * ⚠️ **Un `catch` que solo escribe en la consola es peor que un
       * `alert()`**: el operador pulsa Guardar, el coche no se guarda y la
       * pantalla no dice nada. El servicio lanza claves i18n —las de
       * `vehicleOwnershipProblem()`—, así que se enseña la suya cuando la hay.
       */
      const clave = (error as Error)?.message || '';
      this.notifications.error(
        clave.startsWith('vehicles.') ? clave : 'vehicles.errors.saveFailed'
      );
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

  getOwnershipLabel(ownership: VehicleOwnership): string {
    return this.translateService.translate(VEHICLE_OWNERSHIP_LABELS[ownership]);
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
