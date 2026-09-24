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
import { Vehicle } from '@shared/models/vehicle.model';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import { suggestExtraKmCharge } from '@shared/utils/pricing.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { calculateCalendarDays } from '@shared/utils/reservation-date.util';
import { toDate } from '@shared/utils/reservation-date.util';
import {
  canStartReturn,
  canCloseReservation,
  reasonOf,
  WorkflowContext,
  WorkflowDecision
} from '@shared/utils/reservation-workflow.util';
import { calculateReservationPaymentSummary, roundMoney } from '@shared/utils/payment-summary.util';
import { PaymentService } from '@features/payments/services/payment.service';
import { ConfirmService } from '@core/notifications/confirm.service';
import { FormDraftService } from '@core/forms/form-draft.service';
import { ClearInputDirective } from '@shared/directives/clear-input.directive';

@Component({
  selector: 'app-inspection-return',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe, FormErrorComponent, ClearInputDirective],
  templateUrl: './inspection-return.component.html',
  styleUrl: './inspection-return.component.scss'
})
export class InspectionReturnComponent implements OnInit {
  private confirm = inject(ConfirmService);
  private drafts = inject(FormDraftService);
  private destroyRef = inject(DestroyRef);
  /** Borrador vivo del formulario; se limpia al completar la devolución. */
  private draft: { clear: () => void } | null = null;
  private notifications = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inspectionService = inject(InspectionService);
  private reservationService = inject(ReservationService);
  private vehicleService = inject(VehicleService);
  private paymentService = inject(PaymentService);

  /**
   * Si el resto del alquiler está cobrado, **derivado de `payments`**.
   *
   * Se resuelve al cargar la pantalla y no al vuelo: la decisión de si se puede
   * cerrar se consulta en cada ciclo de detección de cambios, y ahí no cabe una
   * consulta a Firestore. Lo que cambia mientras el operador rellena el parte
   * son los cargos y la fianza, no lo que ya estaba cobrado.
   */
  private remainingPaid = false;

  reservationId: string | null = null;
  reservation: Reservation | null = null;
  /** Solo por su tarifa de km extra, para el aviso del cargo sugerido. */
  vehicle: Vehicle | null = null;
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
      // `first()` closes the live onSnapshot stream once it has emitted;
      // subscribing without it would leave a Firestore listener open forever.
      this.reservation = await firstValueFrom(
        this.reservationService.getReservationById(reservationId).pipe(first())
      );
      if (!this.reservation) {
        this.router.navigate(['/inspections']);
        return;
      }
      this.pickupInspection = await this.inspectionService.getInspectionByReservationAndType(reservationId, 'pickup');

      /**
       * Si el resto del alquiler está cobrado, **derivado de la colección** y no
       * de la copia que lleva la reserva dentro. Esa copia se queda vieja y
       * **responde `0` en vez de fallar**, así que con ella la casilla de cerrar
       * diría que no se puede justo después de cobrar, o —peor— que sí cuando no.
       *
       * Si la lectura falla se queda en `false`, que es el lado seguro: la
       * casilla sale bloqueada y el operador cierra desde la ficha, donde el
       * dato se vuelve a mirar.
       */
      try {
        const pagos = await firstValueFrom(
          this.paymentService.getPaymentsByReservation(reservationId).pipe(first())
        );
        const resumen = calculateReservationPaymentSummary(pagos, this.reservation);
        this.remainingPaid = resumen.remainingPaymentPaid >= resumen.remainingPaymentRequired;
      } catch {
        this.remainingPaid = false;
      }

      // Solo para el aviso de kilómetros: la tarifa de km extra vive en la
      // ficha del vehículo y no viaja en `vehicleSnapshot`. Si la lectura
      // falla, no pasa nada — el aviso simplemente no sale.
      try {
        this.vehicle = await firstValueFrom(
          this.vehicleService.getVehicleById(this.reservation.vehicleId).pipe(first())
        );
      } catch {
        this.vehicle = null;
      }

      const existing = await this.inspectionService.getInspectionByReservationAndType(reservationId, 'return');

      // Workflow guard.
      const decision = canStartReturn({
        reservation: this.reservation,
        pickupInspection: this.pickupInspection || null,
        returnInspection: existing || null
      } as WorkflowContext);
      this.workflowBlockReason = decision.ok ? '' : decision.reason;

      if (existing) {
        this.formData = { ...this.formData, ...existing };
      }

      /**
       * El borrador va **después** de lo cargado y manda sobre ello: si el
       * móvil se llevó la pestaña por delante mientras se hacía la devolución
       * —abrir la cámara para una foto de un daño basta—, lo que el operador
       * llevaba escrito es más reciente que lo que hay en Firestore.
       */
      this.draft = this.drafts.attach<Partial<Inspection>>(
        `return:${reservationId}`,
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

  /**
   * ¿Se va a poder cerrar la reserva al terminar esta devolución?
   *
   * ⚠️ **Antes no se preguntaba y la casilla cerraba a pelo**, saltándose
   * `canCloseReservation()` entero: se podía dar por terminado un alquiler con
   * el resto sin cobrar o la fianza sin resolver, y nadie se enteraba. El botón
   * de la ficha sí lo comprueba; el atajo de aquí, no.
   *
   * ⚠️ **Se le pregunta al MISMO guard, con el estado PROYECTADO.** Copiar sus
   * condiciones aquí sería una segunda autoridad sobre cuándo se cierra un
   * alquiler, y el día que cambie una se quedaría la otra. Lo que se proyecta es
   * solo lo que este formulario está a punto de hacer: la reserva pasará a
   * `returned`, la inspección quedará `completed` y la fianza se habrá movido lo
   * que digan «A retener» y «A devolver».
   *
   * ⚠️ **Y `remainingPaid` viaja explícito, derivado de `payments`.** Sin él el
   * guard cae a la copia desnormalizada de la reserva, que se queda vieja y
   * **responde que no está pagado en vez de fallar** — o al revés. El dinero se
   * decide mirando la colección, como en el resto de la aplicación.
   */
  get closeDecision(): WorkflowDecision {
    if (!this.reservation) return { ok: false, reason: 'workflow.missingReservation' };
    const d = this.reservation.deposit;
    const proyectada = {
      ...this.reservation,
      reservationStatus: 'returned',
      deposit: d && {
        ...d,
        returnedAmount: roundMoney((d.returnedAmount || 0) + this.toRefund),
        retainedAmount: roundMoney((d.retainedAmount || 0) + this.toRetain)
      }
    } as Reservation;

    return canCloseReservation({
      reservation: proyectada,
      returnInspection: { status: 'completed' },
      remainingPaid: this.remainingPaid
    } as WorkflowContext);
  }

  /** Lo que impide cerrar, para decirlo al lado de la casilla. */
  closeBlockReason(): string {
    return reasonOf(this.closeDecision);
  }

  /**
   * Lo que el cliente queda a deber: los cargos que la fianza no llega a cubrir.
   *
   * ⚠️ **Sin esto la pantalla decía la verdad y engañaba igual.** Con 50 € de
   * cargos y una fianza de 0, «A retener» y «A devolver» valen los dos 0,00 € —
   * es correcto, no hay fianza que mover— y el operador cierra la devolución
   * viendo ceros, con 50 € sin cobrar. Lo cobrado y lo debido son dos cifras
   * distintas; es el mismo fallo que F-34.
   */
  get pendingFromClient(): number {
    return Math.max(0, this.totalExtraCharges - this.depositPaid);
  }

  get pickupKm(): number | undefined {
    return this.pickupInspection?.km || this.reservation?.deliveryInfo?.pickupKm;
  }

  /**
   * Cargo por kilómetros de más que **se sugiere**, sin escribirlo.
   *
   * Hoy no se cobra el kilometraje extra —decisión de Dorel: el primer año no,
   * para captar clientela— así que el campo se queda a 0. Y aunque se cobrara,
   * prerrellenarlo sería peor: un importe puesto por la aplicación se guarda de
   * un despiste y le cobra al cliente algo que no querías cobrarle. Un aviso
   * hay que leerlo y teclearlo.
   *
   * `null` cuando no hay exceso o falta algún dato, y entonces no se pinta nada.
   */
  get extraKmSuggestion(): { extraKm: number; amount: number; includedKm: number } | null {
    /**
     * ⚠️ **Del snapshot de la reserva, no de la ficha del vehículo.**
     *
     * Leyéndolo del coche, cambiarle los kilómetros incluidos o el precio del
     * extra movía el cargo de alquileres ya cerrados — y ese cargo es el que va
     * impreso en el contrato que el cliente firmó. Es la misma regla que hace
     * que el precio viva en el snapshot y no en la tarifa vigente.
     *
     * **Sin respaldo a la ficha del vehículo**: una reserva sin estos valores
     * congelados es una reserva en la que no se pactó kilometraje, y ahí no hay
     * nada que cobrar. Leerlos del coche sería cobrar por algo que el contrato
     * de ese alquiler no dice.
     */
    const snapshot = this.reservation?.pricingSnapshot;
    return suggestExtraKmCharge({
      pickupKm: this.pickupKm,
      returnKm: this.formData.km,
      totalDays: this.totalDays,
      includedKmPerDay: snapshot?.includedKmPerDay,
      extraKmPrice: snapshot?.extraKmPrice
    });
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

  /** Si ya se ha intentado añadir el daño. */
  damageSubmitted = false;

  /** Lo que impide añadir un daño. */
  get damageProblems(): FieldProblems {
    const problems: FieldProblems = {};
    if (!this.newDamage.description?.trim()) {
      problems['description'] = 'inspections.errors.damageDescriptionRequired';
    }
    return problems;
  }

  addDamage(): void {
    this.damageSubmitted = true;
    if (hasProblems(this.damageProblems)) return;

    this.formData.damages = [...(this.formData.damages || []), { ...this.newDamage, id: Date.now().toString() }];
    this.newDamage = { area: 'front', description: '', severity: 'minor', isNewDamage: true };
    this.showDamageForm = false;
    this.damageSubmitted = false;
  }

  removeDamage(index: number): void {
    this.formData.damages = (this.formData.damages || []).filter((_, i) => i !== index);
  }

  /** Si ya se ha intentado completar. Hasta entonces no se marca nada en rojo. */
  submitted = false;
  saveError = '';

  /**
   * Lo que impide completar la devolución.
   *
   * ⚠️ La tercera no es un campo vacío sino una **incoherencia**: el kilometraje
   * de entrada menor que el de salida es casi siempre un dedazo, y dejarlo pasar
   * arrastra al cálculo de kilómetros extra.
   */
  get problems(): FieldProblems {
    const problems: FieldProblems = {};
    if (this.formData.km === undefined || this.formData.km === null) {
      problems['km'] = 'inspections.errors.kmRequired';
    } else if (this.pickupKm !== undefined && this.formData.km < this.pickupKm) {
      problems['km'] = 'inspections.errors.kmLowerThanPickup';
    }
    if (!this.formData.fuelLevel) {
      problems['fuelLevel'] = 'inspections.errors.fuelRequired';
    }
    return problems;
  }

  get problemList(): string[] {
    return problemKeys(this.problems);
  }

  async completeReturn(): Promise<void> {
    if (!this.reservationId) return;

    this.submitted = true;
    this.saveError = '';
    if (hasProblems(this.problems)) return;

    if (!this.formData.checklist?.keysReturned) {
      const seguir = await this.confirm.ask({
        title: 'inspections.confirm.keysTitle',
        message: 'inspections.confirm.keysMessage',
        confirmLabel: 'common.continue'
      });
      if (!seguir) return;
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
      // Ya está en Firestore: el borrador dejaría de proteger y empezaría a
      // estorbar.
      this.draft?.clear();
      this.router.navigate(['/reservations', this.reservationId]);
    } catch (error) {
      console.error('Error completing return:', error);
      this.saveError = 'inspections.errors.returnFailed';
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
      // En serie y no en paralelo: son fotos de móvil redimensionadas en el
      // propio navegador, y lanzar ocho a la vez con mala cobertura las hace
      // competir por el ancho de banda y bloquea el hilo del canvas.
      for (const file of files) {
        // La matrícula viaja con la foto: es el nombre con el que se guarda,
        // y estas fotos hay que poder enseñarlas sueltas.
        const photo = await this.inspectionService.uploadInspectionPhoto(
          this.reservationId,
          'return',
          file,
          category,
          undefined,
          this.reservation?.vehicleSnapshot?.plateNumber
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

  /**
   * ⚠️ **Aquí vivían `retainDeposit()` y `refundDeposit()`, y se borraron el 24
   * de septiembre de 2026 sin sustituirlos por nada.** No las llamaba nadie —ni
   * esta plantilla, ni otra, ni un test— y tenían los tres defectos a la vez:
   *
   * - llegaban al servicio por `this.inspectionService['paymentService']`,
   *   saltándose el `private` con un índice de cadena, que es la forma de que un
   *   cambio de firma no dé error de compilación;
   * - una abría un `prompt()` del navegador, prohibido desde M-43 por lo mismo
   *   que los `alert()`: lo pinta el navegador, sale en el idioma del sistema y
   *   no se puede vestir;
   * - y devolvían la fianza **sin tope**, que es justo el fallo que
   *   `depositAvailable()` vino a cerrar ese mismo día.
   *
   * Los movimientos de fianza de la devolución los hace
   * `completeReturnInspection()` con los importes de «A retener» y «A devolver»,
   * dentro de la misma escritura que el parte. Ese es el único camino.
   */
  getPickupDate(): Date {
    return this.reservation ? toDate(this.reservation.pickupDateTime) : new Date();
  }

  getReturnDate(): Date {
    return this.reservation ? toDate(this.reservation.returnDateTime) : new Date();
  }
}
