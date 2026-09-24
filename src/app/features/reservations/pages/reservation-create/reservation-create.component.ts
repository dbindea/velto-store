import { DatePickerDirective } from '@shared/directives/date-picker.directive';
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { NotificationService } from '@core/notifications/notification.service';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Client, QuickClientData } from '@shared/models/client.model';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import {
  calculateCalendarDays,
  getDefaultPickupDateTime,
  getDefaultReturnDateTime,
  parseDateTimeInput,
  toDateString,
  toDateTimeInput,
} from '@shared/utils/reservation-date.util';
import {
  addVat,
  deliveryFeeBreakdown,
  DeliveryFeeBreakdown,
  resolveRentalPrice,
  RentalPriceBreakdown,
  VatBreakdown
} from '@shared/utils/pricing.util';
import { isDepositWaived, needsWaivedReason } from '@shared/utils/deposit.util';
import { SettingsService } from '@features/settings/services/settings.service';
import { FieldProblems, hasProblems } from '@shared/utils/form-problems.util';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
import { capitalizeWords, toReference, transformInput } from '@shared/utils/text-case.util';
import { roundMoney } from '@shared/utils/payment-summary.util';
import {
  canCreateReservationForClient,
  clientTrustWarning as trustWarningOf
} from '@shared/utils/reservation-workflow.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { ClientService } from '@features/clients/services/client.service';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import { ReservationService, VehicleAvailabilityResult } from '@features/reservations/services/reservation.service';
import { ReservationDocumentService } from '@features/reservations/services/reservation-document.service';
import { PermissionsService } from '@core/auth/permissions.service';
import { ClearInputDirective } from '@shared/directives/clear-input.directive';

type Step = 'dates' | 'vehicle' | 'client' | 'summary';

@Component({
  selector: 'app-reservation-create',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent, DatePickerDirective, ClearInputDirective],
  templateUrl: './reservation-create.component.html',
  styleUrl: './reservation-create.component.scss',
})
export class ReservationCreateComponent implements OnInit {
  private router = inject(Router);
  private notifications = inject(NotificationService);
  private reservationService = inject(ReservationService);
  private clientService = inject(ClientService);
  private vehicleService = inject(VehicleService);
  private documentService = inject(ReservationDocumentService);
  private settingsService = inject(SettingsService);
  /** Público: la plantilla pregunta si se puede tocar el precio. */
  permissions = inject(PermissionsService);

  // Current step
  currentStep: Step = 'dates';
  steps: Step[] = ['dates', 'vehicle', 'client', 'summary'];

  // Loading states
  loading = false;
  searching = false;
  saving = false;

  /**
   * Cuándo se recoge y cuándo se devuelve, **fecha y hora en un solo campo**.
   *
   * ⚠️ **Eran cuatro campos —dos fechas y dos horas— y ahora son dos.** Lo pidió
   * Dorel el 24 de septiembre de 2026 al ver que la edición de reserva ya usaba
   * un `datetime-local` y era mejor: una recogida es **un instante**, no una
   * fecha y aparte una hora, y partirla en dos controles obliga a abrir dos
   * selectores y a que alguien los cuadre. Era además el único sitio de la
   * aplicación con un `input[type=time]`; con esto ya no queda ninguno.
   *
   * ⚠️ **Lo que llega a Firestore no cambia nada.** Estos dos campos son lo que
   * se pinta —cadenas `yyyy-MM-ddTHH:mm`, que es lo que exige el control—; lo
   * que se guarda sigue saliendo de `pickupDateTime` y `returnDateTime`, que
   * siguen devolviendo un `Date` y pasando por `toTimestamp()`. Es el mismo
   * reparto que ya hay entre `netPriceInput` y `netPrice` en este fichero.
   */
  pickupDateTimeInput = toDateTimeInput(getDefaultPickupDateTime());
  returnDateTimeInput = toDateTimeInput(getDefaultReturnDateTime());

  /**
   * Dónde se entrega y dónde se devuelve.
   *
   * Nacen **escritos**: casi todas las reservas salen y vuelven a la oficina,
   * y el operador solo los toca cuando no es así —para eso tienen el aspa—.
   *
   * ⚠️ **Los dos con la MISMA cadena, y eso no es pereza.** En cuanto se
   * teclea la primera letra en la recogida, la devolución se sobrescribe con
   * lo tecleado mientras nadie la haya tocado (ver `onPickupLocationChange`).
   * Con dos textos por defecto distintos, el de la devolución duraría hasta la
   * primera pulsación y desaparecería sin que nadie lo hubiera decidido.
   *
   * ⚠️ **El defecto se pone UNA vez, aquí, y no al leer.** Resolverlo en un
   * getter —«si está vacío, devuelve el de por defecto»— haría que vaciar el
   * campo lo repusiera solo: exactamente el fallo que la fianza tenía tres
   * campos más abajo.
   */
  pickupLocation = APP_DEFAULTS.DEFAULT_RENTAL_LOCATION;
  returnLocation = APP_DEFAULTS.DEFAULT_RENTAL_LOCATION;

  // Availability results
  availabilityResults: VehicleAvailabilityResult[] = [];
  selectedVehicle: VehicleAvailabilityResult | null = null;

  // Client
  clientSearchTerm = '';
  searchResults: Client[] = [];
  recentClients: Client[] = [];
  loadingRecentClients = false;
  selectedClient: Client | null = null;
  showQuickClientForm = false;

  // Quick client form
  quickClient: QuickClientData = {
    fullName: '',
    phone: '',
    email: '',
    documentNumber: '',
  };

  /**
   * Price agreed with the customer, overriding the tariff calculation.
   * `null` means "use the calculation".
   */
  finalPriceOverride: number | null = null;

  /**
   * El operador ha vaciado el campo del precio.
   *
   * Solo gobierna lo que se **pinta**: el precio sigue siendo el de tarifa
   * mientras no se teclee otro. Ver `netPriceInput()`.
   */
  priceCleared = false;

  /**
   * Deposit agreed with the customer. `null` means "use the vehicle's
   * default". 0 is a real answer: regular customers are often not asked for a
   * deposit, and then `depositWaivedReason` becomes mandatory.
   */
  depositOverride: number | null = null;

  /**
   * El operador ha vaciado el campo de fianza.
   *
   * ⚠️ **No se puede decir con `depositOverride` solo.** Ahí `null` ya
   * significa «no lo ha tocado, manda el defecto del coche», y vaciar es lo
   * contrario: es tocarlo para decir que no se pide nada. Sin esta bandera las
   * dos cosas son el mismo valor, y el campo se repone solo al borrarlo. Ver
   * `onDepositChange()`.
   */
  depositCleared = false;
  depositWaivedReason = '';

  // Notes
  notes = '';

  // Validation
  dateError = '';

  // Quote (N-1). Nothing here is persisted: the URL points at a PDF in
  // Storage, and no reservation exists until "Crear reserva" is pressed.
  generatingQuote = false;
  quoteUrl = '';
  quoteStorageUrl = '';
  quoteError = '';
  quoteCopied = false;
  private quoteCopiedTimer: any;

  ngOnInit(): void {
    // Preloaded so the client step opens with something to click on: most
    // bookings are for someone who rented recently.
    this.loadRecentClients();
    // Los ajustes deciden la fianza propuesta y el tipo de IVA de la reserva
    // nueva. Se piden aquí, al abrir el asistente, para que ya estén cuando el
    // operador llegue al resumen. Si fallan, rigen los valores del código.
    void this.settingsService.load();
  }

  private loadRecentClients(): void {
    this.loadingRecentClients = true;
    this.clientService.getRecentClients(10).subscribe({
      next: (clients) => {
        this.recentClients = clients;
        this.loadingRecentClients = false;
      },
      error: (error) => {
        console.error('Error loading recent clients:', error);
        this.loadingRecentClients = false;
      }
    });
  }

  /**
   * What the client step lists: search results while the operator is typing,
   * the ten most recent clients otherwise.
   */
  get clientOptions(): Client[] {
    return this.isSearchingClients ? this.searchResults : this.recentClients;
  }

  /** True once the search term is long enough for `searchClients()` to run. */
  get isSearchingClients(): boolean {
    return this.clientSearchTerm.trim().length >= 2;
  }

  getStepIndex(step: Step): number {
    return this.steps.indexOf(step) + 1;
  }

  isStepComplete(step: Step): boolean {
    switch (step) {
      case 'dates':
        return this.availabilityResults.length > 0;
      case 'vehicle':
        return this.selectedVehicle !== null;
      case 'client':
        return this.selectedClient !== null;
      case 'summary':
        // Nunca «completo». Devolvía `true` siempre, así que el cuarto paso
        // nacía con el check verde desde que se abría el asistente, sin haber
        // creado nada. Lo que completa el resumen es crear la reserva, y en ese
        // momento se navega fuera: aquí el check no puede significar nada.
        return false;
      default:
        return false;
    }
  }

  goToStep(step: Step): void {
    // Can always go back, can only go forward if previous step is complete
    const currentIndex = this.steps.indexOf(this.currentStep);
    const targetIndex = this.steps.indexOf(step);

    if (targetIndex <= currentIndex) {
      this.currentStep = step;
    } else if (this.isStepComplete(this.steps[targetIndex - 1])) {
      this.currentStep = step;
    }
  }

  async searchAvailability(): Promise<void> {
    // Validate dates
    const pickupDateTime = this.pickupDateTime;
    const returnDateTime = this.returnDateTime;

    /**
     * ⚠️ **Una fecha VACÍA no la paraba nadie, y no se para sola.**
     * `parseDateTimeInput('')` devuelve `new Date(NaN)` a propósito, pero
     * **toda comparación con `NaN` es falsa**: el guard de abajo
     * —`returnDateTime <= pickupDateTime`— la dejaba pasar, y el del servicio
     * —`if (totalDays <= 0) throw`— también, porque `calculateCalendarDays()`
     * ya había devuelto `NaN`. El asistente seguía hasta el resumen, que se
     * quedaba a medio dibujar con «NaN días · 0,00 €», sin desglose y **sin
     * botón de crear**: un callejón sin salida que no explica nada.
     *
     * Era raro hasta el 24 de septiembre de 2026 —había que seleccionar y
     * borrar a mano—, y dejó de serlo el mismo día: el panel de fechas propio
     * pasó a mandar también en el móvil y trae un botón «Borrar», así que
     * vaciar una fecha es ahora un gesto de un toque.
     *
     * De propina, con la devolución en `NaN` el bloqueo por papeles se
     * **invierte**: en `blockingMaintenance()` la comparación
     * `startOfDay(dueDate) >= devolucion` también es falsa, así que toda ITV o
     * seguro con fecha abierta pasaría a bloquear el coche.
     */
    if (isNaN(pickupDateTime.getTime()) || isNaN(returnDateTime.getTime())) {
      this.dateError = 'reservations.messages.datesRequired';
      return;
    }

    if (returnDateTime <= pickupDateTime) {
      this.dateError = 'reservations.messages.invalidDates';
      return;
    }

    this.dateError = '';
    this.searching = true;
    this.selectedVehicle = null;
    this.selectedClient = null;
    // New dates mean a new calculation; an agreed price for the old one no
    // longer applies.
    this.resetFinalPrice();

    try {
      this.availabilityResults = await this.reservationService.searchAvailability(
        pickupDateTime,
        returnDateTime,
      );
      this.currentStep = 'vehicle';
    } catch {
      // ⚠️ Estaba en español duro, y la plantilla ya lo pasa por el pipe: un
      // operador rumano leía castellano justo cuando algo falla, y encima el
      // texto no se podía traducir aunque se quisiera.
      this.dateError = 'reservations.availability.searchFailed';
    } finally {
      this.searching = false;
    }
  }

  selectVehicle(result: VehicleAvailabilityResult): void {
    if (!result.available) return;
    if (this.selectedVehicle?.vehicleId !== result.vehicleId) {
      this.resetFinalPrice();
    }
    this.selectedVehicle = result;
    this.currentStep = 'client';
  }

  searchClients(): void {
    if (!this.isSearchingClients) {
      this.searchResults = [];
      return;
    }

    this.clientService.searchClients(this.clientSearchTerm).subscribe((clients) => {
      this.searchResults = clients;
    });
  }

  selectClient(client: Client): void {
    // A different client can carry a different loyalty discount, which moves
    // the calculated price. An agreed price measured against the previous
    // baseline no longer means what the operator intended.
    if (this.selectedClient?.id !== client.id) {
      this.resetFinalPrice();
    }
    this.selectedClient = client;
    this.searchResults = [];
    this.clientSearchTerm = '';
    this.currentStep = 'summary';
  }

  toggleQuickClientForm(): void {
    this.showQuickClientForm = !this.showQuickClientForm;
    if (this.showQuickClientForm) {
      this.searchResults = [];
    }
  }

  /** Si ya se ha intentado crear el cliente rápido. */
  quickClientSubmitted = false;

  /** Lo que impide crearlo: campo → clave de i18n. */
  get quickClientProblems(): FieldProblems {
    const problems: FieldProblems = {};
    if (!this.quickClient.fullName?.trim()) {
      problems['fullName'] = 'reservations.errors.clientNameRequired';
    }
    return problems;
  }

  async createQuickClient(): Promise<void> {
    // El botón ya no se deshabilita por el nombre vacío: se pulsa y es aquí
    // donde se marca el campo. Antes no pasaba nada y no había forma de saberlo.
    this.quickClientSubmitted = true;
    if (hasProblems(this.quickClientProblems)) return;

    this.saving = true;
    try {
      const clientId = await this.clientService.createQuickClient(this.quickClient);

      // Fetch the created client
      this.clientService.getClientById(clientId).subscribe((client) => {
        if (client) {
          // Same reasoning as selectClient(): a new baseline for the price.
          this.resetFinalPrice();
          this.selectedClient = client;
          this.showQuickClientForm = false;
          this.quickClient = { fullName: '', phone: '', email: '', documentNumber: '' };
          this.currentStep = 'summary';
          // Keep the recent list honest if the operator steps back.
          this.loadRecentClients();
        }
      });
    } catch (error) {
      console.error('Error creating client:', error);
    } finally {
      this.saving = false;
    }
  }

  async createReservation(): Promise<void> {
    if (!this.selectedVehicle || !this.selectedClient) return;
    // A waived deposit with no reason would create a reservation the workflow
    // can never close, so this is refused here as well as in the service.
    if (this.depositReasonMissing) return;

    this.saving = true;
    try {
      const pickupDateTime = this.pickupDateTime;
      const returnDateTime = this.returnDateTime;

      const reservationId = await this.reservationService.createReservationWithClient(
        this.selectedVehicle.vehicle,
        this.selectedClient,
        pickupDateTime,
        returnDateTime,
        this.initialPayment, // Initial payment required, capped at the agreed price
        this.deposit, // Agreed with the customer; 0 when waived
        this.notes || undefined,
        this.pickupLocation || undefined,
        this.returnLocation || undefined,
        // ⚠️ The agreed price travels NET, because that is what
        // `resolveRentalPrice()` measures against. Sending the gross made the
        // service read 121 € as a hand-agreed base over a 110 € tariff and
        // record a +11 € adjustment on a rental the operator had just
        // discounted by 10 €.
        this.priceOverridden ? this.netPrice : undefined,
        this.depositWaived ? this.depositWaivedReason.trim() : undefined,
        this.vatExempt,
        { pickupFee: Number(this.deliveryPickupFee) || 0, returnFee: Number(this.deliveryReturnFee) || 0 }
      );

      this.router.navigate(['/reservations', reservationId]);
    } catch (error: any) {
      console.error('Error creating reservation:', error);
      /**
       * El motivo real cuando lo hay, y sin reintentar si no sirve de nada.
       *
       * El servicio vuelve a comprobar la disponibilidad justo antes de
       * escribir, así que dos operadores que preparan la misma reserva a la vez
       * hacen que la segunda falle. Con el mensaje genérico, esa persona leía
       * «No se pudo crear la reserva. Inténtalo de nuevo» y un botón de
       * reintentar que **iba a fallar igual**: hay que cambiar de coche o de
       * fechas, no repetir.
       *
       * Los errores del servicio ya son claves i18n (`reservations.…`,
       * `workflow.…`); cualquier otra cosa —un fallo de red— sí se puede
       * reintentar.
       */
      const reason: string = error?.message || '';
      const isKnownReason = /^(reservations|workflow)\./.test(reason);
      this.notifications.error(
        isKnownReason ? reason : 'reservations.errors.create',
        isKnownReason ? undefined : { retry: () => void this.createReservation() }
      );
    } finally {
      this.saving = false;
    }
  }

  /**
   * Quote PDF for what the summary currently shows, without creating anything.
   *
   * This is the answer to "send the customer a price before they commit": no
   * reservation, no `quote` status, and the vehicle stays available to anyone
   * else — which is why the PDF says so in as many words.
   */
  async generateQuote(): Promise<void> {
    if (!this.selectedVehicle) return;

    this.generatingQuote = true;
    this.quoteError = '';
    try {
      const vehicle = this.selectedVehicle.vehicle;
      const breakdown = this.priceBreakdown;

      const response = await this.documentService.generateQuote({
        client: this.selectedClient
          ? {
              fullName: this.selectedClient.fullName,
              documentNumber: this.selectedClient.documentNumber,
              phone: this.selectedClient.phone,
              email: this.selectedClient.email
            }
          : undefined,
        vehicle: {
          brand: vehicle.brand,
          model: vehicle.model,
          version: vehicle.version,
          plateNumber: vehicle.plateNumber,
          year: vehicle.year,
          fuelType: vehicle.fuelType,
          transmission: vehicle.transmission
        },
        rental: {
          pickupDateTime: this.pickupDateTime.toISOString(),
          returnDateTime: this.returnDateTime.toISOString(),
          totalDays: this.totalDays,
          pickupLocation: this.pickupLocation || undefined,
          returnLocation: this.returnLocation || undefined
        },
        pricing: {
          finalPrice: this.finalPrice,
          depositAmount: this.deposit,
          tariffPrice: breakdown.tariffPrice,
          loyaltyDiscountPercent: breakdown.loyaltyDiscountPercent || undefined,
          loyaltyDiscount: breakdown.loyaltyDiscount || undefined,
          manualAdjustment: breakdown.priceOverridden ? breakdown.manualAdjustment : undefined,
          netPrice: breakdown.netPrice,
          vatRate: this.vatRate,
          // El presupuesto tiene que decir lo mismo que el contrato: si el
          // desplazamiento no sale aquí, el cliente acepta un precio y firma otro.
          deliveryPickupFee: Number(this.deliveryPickupFee) || undefined,
          deliveryReturnFee: Number(this.deliveryReturnFee) || undefined
        }
      });

      // The short link is what the customer gets; the Storage URL is the
      // operator's own shortcut to eyeball the PDF straight away.
      this.quoteUrl = response.pdfUrl;
      this.quoteStorageUrl = response.storageUrl;
      await this.copyQuoteLink();
    } catch (error) {
      console.error('Error generating quote:', error);
      this.quoteError = 'reservations.quote.error';
    } finally {
      this.generatingQuote = false;
    }
  }

  async copyQuoteLink(): Promise<void> {
    if (!this.quoteUrl) return;
    const copied = await this.documentService.copyToClipboard(this.quoteUrl);
    if (copied) {
      this.quoteCopied = true;
      if (this.quoteCopiedTimer) clearTimeout(this.quoteCopiedTimer);
      this.quoteCopiedTimer = setTimeout(() => (this.quoteCopied = false), 2200);
    }
  }

  goBack(): void {
    const currentIndex = this.steps.indexOf(this.currentStep);
    if (currentIndex > 0) {
      this.currentStep = this.steps[currentIndex - 1];
    } else {
      this.router.navigate(['/reservations']);
    }
  }

  // Format fullName - capitalize first letter of each word
  formatFullName(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.quickClient.fullName = transformInput(input, capitalizeWords);
  }

  /**
   * El documento del alta rápida, en mayúsculas y sin espacios.
   *
   * Es el mismo campo que en la ficha de cliente, donde sí se normalizaba: el
   * alta rápida se escribió aparte y se quedó sin ello. Un documento tecleado
   * «x1234567l» acaba impreso así en el contrato, y es el dato con el que se
   * busca a esa persona la próxima vez.
   */
  onQuickClientDocumentInput(event: Event): void {
    this.quickClient.documentNumber = transformInput(
      event.target as HTMLInputElement,
      toReference
    );
  }

  // Computed values for summary
  get pickupDateTime(): Date {
    return parseDateTimeInput(this.pickupDateTimeInput);
  }

  /**
   * El suelo del campo de recogida: hoy a las 00:00.
   *
   * ⚠️ **Un `datetime-local` exige el `min` con hora**, `yyyy-MM-ddTHH:mm`. Con
   * el `yyyy-MM-dd` de antes el navegador **ignora el atributo entero** —no
   * avisa, simplemente no limita— y se podría crear una reserva con fecha de
   * recogida pasada. A las 00:00 y no a la hora actual, porque una reserva que
   * se crea a las 19:00 para recoger a las 18:00 del mismo día es una
   * corrección normal de mostrador.
   */
  get minPickupDateTime(): string {
    return `${toDateString(new Date())}T00:00`;
  }

  /**
   * True once the operator edits the return location themselves. Until then it
   * mirrors the pickup location.
   */
  private returnLocationEdited = false;

  /**
   * Pickup location, mirrored into the return location while the operator has
   * not touched that field.
   *
   * The mirror used to be guarded by `if (!this.returnLocation)` — "only fill
   * it if it is still empty". Since this runs on every keystroke, typing
   * "Arganda" copied the "A" of the first keystroke and then stopped, because
   * from the second keystroke on the field was no longer empty. The return
   * location was left as a single letter.
   *
   * What the guard actually wants to know is whether the operator has typed in
   * the return field, not whether it currently holds text.
   */
  onPickupLocationChange(event: Event): void {
    const formatted = transformInput(event.target as HTMLInputElement, capitalizeWords);
    this.pickupLocation = formatted;
    if (!this.returnLocationEdited) {
      this.returnLocation = formatted;
    }
  }

  /**
   * Return location.
   *
   * Clearing the field resumes mirroring the pickup location, so an operator
   * who empties it by mistake is not left having to retype the whole thing.
   *
   * ⚠️ **Los dos lugares pasan por `transformInput()` y no por
   * `capitalizeWords()` a secas.** Colgados de `(ngModelChange)` nadie tocaba
   * `input.value`, así que el `writeValue` de `NgModel` reescribía el campo
   * con un valor distinto al del DOM y **el cursor saltaba al final en cada
   * pulsación**. Con el campo vacío casi no se notaba, porque se escribe de
   * izquierda a derecha; desde que nacen con un texto puesto, corregir en
   * medio es el caso normal. Es el mismo fallo que `transformInput()` vino a
   * resolver en las matrículas.
   */
  onReturnLocationInput(event: Event): void {
    const value = transformInput(event.target as HTMLInputElement, capitalizeWords);
    this.returnLocationEdited = !!value;
    this.returnLocation = value;
  }

  /**
   * Al mover la recogida, la devolución no puede quedarse antes.
   *
   * ⚠️ **Se comparan las CADENAS, y es correcto.** `yyyy-MM-ddTHH:mm` ordena
   * igual alfabéticamente que cronológicamente —por eso el formato es ese— así
   * que no hace falta convertir a `Date` para saber cuál va primero. Antes se
   * comparaban solo las fechas y la hora se quedaba fuera: recoger a las 18:00
   * y devolver el mismo día a las 12:00 pasaba el guard de aquí y lo paraba
   * después `searchAvailability()`. Ahora no llega a formarse.
   */
  onPickupDateTimeChange(value: string): void {
    this.pickupDateTimeInput = value;
    if (this.returnDateTimeInput < this.pickupDateTimeInput) {
      this.returnDateTimeInput = this.pickupDateTimeInput;
    }
    this.invalidateAvailability();
  }

  onReturnDateTimeChange(value: string): void {
    this.returnDateTimeInput = value;
    this.invalidateAvailability();
  }

  /**
   * Mover una fecha INVALIDA la búsqueda anterior.
   *
   * ⚠️ **Sin esto, la pantalla enseñaba un precio y la reserva se creaba con
   * otro.** `isStepComplete('dates')` contesta `availabilityResults.length > 0`,
   * o sea «hubo una búsqueda alguna vez», y nadie vaciaba ese resultado al
   * cambiar las fechas. Así que se podía volver al paso 1, poner otras fechas y
   * pulsar directamente «Resumen» en el stepper: `totalDays` ya era el nuevo
   * —se calcula en vivo de los campos— mientras el precio seguía saliendo del
   * `selectedVehicle.pricing` congelado en la búsqueda vieja.
   *
   * Reproducido con el Renault Clio, cuyas tarifas son 60 €/día a un día y
   * 50 €/día de cuatro a siete: buscando 1 día y cambiando después a 5, el
   * resumen decía «5 días», «5 x 60 € : 60 €» —aritmética imposible— y
   * «Precio total: 72,60 €», con «Crear reserva» activo. Lo que
   * `createReservationWithClient()` habría escrito son 5 × 50 = 250 € netos,
   * **302,50 €**: 229,90 € de diferencia entre lo que se confirma delante del
   * cliente y lo que se crea. Y el mismo estado alimenta «Generar presupuesto»,
   * así que el PDF que se manda por WhatsApp llevaba la cifra equivocada.
   *
   * ⚠️ **La disponibilidad sí estaba protegida y el precio no**, y ese contraste
   * es lo que lo hacía invisible: el servicio revuelve las fechas antes de
   * escribir y falla con un mensaje si el coche ya no está libre, pero el precio
   * lo **recalcula en silencio**. El caso ruidoso avisaba; el del dinero, no.
   *
   * Vaciar el resultado devuelve `isStepComplete('dates')` a `false`, así que el
   * stepper deja de dejar pasar y hay que volver a buscar — que es lo que el
   * asistente siempre quiso decir.
   */
  private invalidateAvailability(): void {
    if (!this.availabilityResults.length && !this.selectedVehicle) return;
    this.availabilityResults = [];
    this.selectedVehicle = null;
    // Un precio acordado lo era para unas fechas concretas; con otras, no.
    this.resetFinalPrice();
    if (this.currentStep !== 'dates') this.currentStep = 'dates';
  }

  get returnDateTime(): Date {
    return parseDateTimeInput(this.returnDateTimeInput);
  }

  get totalDays(): number {
    return calculateCalendarDays(this.pickupDateTime, this.returnDateTime);
  }

  /**
   * The whole price, resolved in one place: tariff → loyalty discount →
   * agreed price. Recomputed on read because it depends on the vehicle, the
   * client and the override, any of which the operator can still change.
   */
  private get priceBreakdown(): RentalPriceBreakdown {
    return resolveRentalPrice(
      this.selectedVehicle?.pricing?.finalPrice || 0,
      this.selectedClient?.loyaltyDiscountPercent,
      this.finalPriceOverride,
      // ⚠️ **El tipo se pasa.** Sin el cuarto argumento esto usaba el 21 % fijo
      // de `DEFAULT_VAT_RATE` mientras la fila del IVA de al lado usaba el de
      // Ajustes: con el general los dos coincidían de casualidad, y con «sin
      // IVA» el total habría seguido llevando el impuesto sumado dentro.
      this.vatRate
    );
  }

  /** What the tariff rules say, before any discount. */
  get tariffPrice(): number {
    return this.priceBreakdown.tariffPrice;
  }

  /** The client's frozen-at-creation loyalty percentage. 0 when there is none. */
  get loyaltyDiscountPercent(): number {
    return this.priceBreakdown.loyaltyDiscountPercent;
  }

  /** Money taken off by the loyalty discount. Negative, or 0. */
  get loyaltyDiscount(): number {
    return this.priceBreakdown.loyaltyDiscount;
  }

  /** The tariff after the loyalty discount: what the price input starts at. */
  get calculatedFinalPrice(): number {
    return this.priceBreakdown.discountedPrice;
  }

  /**
   * The editable figure, and it is the NET one.
   *
   * That is the number worth negotiating: it is round, and it is exactly what
   * a customer who does not want an invoice hands over. VAT is added below.
   */
  get netPrice(): number {
    return this.priceBreakdown.netPrice;
  }

  /**
   * Lo que se pinta en el campo del precio acordado.
   *
   * ⚠️ **Mismo caso que la fianza, y aquí se notaba menos porque el valor al
   * que volvía era creíble.** Al borrar el último dígito, `ngModel` reescribía
   * el precio de tarifa en el hueco y lo tecleado a continuación se pegaba
   * detrás: vaciar «540» para poner «200» dejaba 540200. Vacío se queda
   * vacío.
   *
   * ⚠️ **Y aquí vaciar significa otra cosa que en la fianza**: no es un precio
   * de 0 —eso sería regalar el alquiler—, es «no hay precio acordado», o sea
   * la tarifa con su descuento. Por eso `finalPriceOverride` se queda en `null`
   * y no en 0.
   */
  get netPriceInput(): number | null {
    return this.priceCleared ? null : this.netPrice;
  }

  /**
   * Se cobra desplazamiento y el lugar sigue diciendo «oficina».
   *
   * ⚠️ **Lo crea el valor por defecto, y por eso el aviso nace con él.** Cuando
   * el campo salía vacío, quien cobraba entrega a domicilio veía el hueco y
   * escribía la dirección; con «Oficinas Velto - Arganda» ya escrito, el
   * contrato puede salir cobrando 30 € por llevar el coche **y diciendo que se
   * entrega en la oficina**. Las dos líneas se imprimen, una al lado de la
   * otra, y es justo la clase de contradicción que un cliente discute con
   * razón.
   *
   * No se impide —hay quien paga el desplazamiento de vuelta y recoge en
   * oficina, y entonces el par es correcto—: se dice. Cada trayecto se mira
   * contra su propio lugar.
   */
  get lugarSinTocarConDomicilio(): boolean {
    const defecto = APP_DEFAULTS.DEFAULT_RENTAL_LOCATION;
    const entrega = Number(this.deliveryPickupFee) > 0 && this.pickupLocation === defecto;
    const recogida = Number(this.deliveryReturnFee) > 0 && this.returnLocation === defecto;
    return entrega || recogida;
  }

  /** What the customer actually pays: net plus VAT. */
  get finalPrice(): number {
    return this.priceBreakdown.finalPrice;
  }

  /** True when the operator agreed a price other than the calculated one. */
  get priceOverridden(): boolean {
    return this.priceBreakdown.priceOverridden;
  }

  /** Signed difference against the calculation. Negative is a discount. */
  get manualAdjustment(): number {
    return this.priceBreakdown.manualAdjustment;
  }

  /**
   * El tipo que se va a aplicar a esta reserva.
   *
   * Sale de Ajustes y **se congela en el snapshot** al crearla, así que una
   * subida futura del tipo general no mueve un contrato ya firmado. Ese
   * congelado es lo que hace que sea seguro tenerlo configurable.
   */
  get vatRate(): number {
    return this.vatExempt ? 0 : this.settingsService.settings().vatRate;
  }

  /**
   * Este alquiler se cobra **sin IVA**: el cliente paga el neto pactado y ni el
   * contrato ni el presupuesto mencionan el impuesto.
   *
   * ⚠️ **Es una decisión por reserva, no un ajuste global**, y por eso vive aquí
   * y no en Ajustes: el caso es el cliente que no va a pedir factura, y el de al
   * lado sí la pide. Lo que se guarda es el tipo congelado a 0 en el snapshot;
   * `chargesVat()` es quien decide con él qué imprime cada documento.
   */
  vatExempt = false;

  /**
   * Entrega y recogida a domicilio, en **neto**.
   *
   * Velto entrega gratis cerca de Arganda; fuera de ahí se pacta un suplemento,
   * y los dos trayectos son independientes. Se teclean a mano: no hay tarifa por
   * kilómetro (decisión de Dorel, 19 de septiembre de 2026), así que cada
   * reserva lleva la cifra que se dijo por teléfono.
   */
  deliveryPickupFee: number | null = null;
  deliveryReturnFee: number | null = null;

  /** Lo que el cliente paga por el servicio a domicilio, con su IVA. */
  get deliveryFeesBreakdown(): DeliveryFeeBreakdown {
    return deliveryFeeBreakdown(
      { pickupFee: this.deliveryPickupFee, returnFee: this.deliveryReturnFee },
      this.vatRate
    );
  }

  /**
   * Los días que el presupuesto se anuncia como válido.
   *
   * Lo lee de Ajustes, igual que la Cloud Function que compone el PDF. Antes era
   * un literal de traducción con un 7 dentro, así que el día que alguien cambió
   * la validez, la pantalla siguió prometiendo siete días y el papel decía otra
   * cosa.
   */
  get quoteValidityDays(): number {
    return this.settingsService.settings().quoteValidityDays;
  }

  /** VAT added on top of the net — the tariff is net now. */
  get vat(): VatBreakdown {
    return addVat(this.netPrice, this.vatRate);
  }

  /** The rate as a percentage, for the "IVA (21 %)" label. */
  get vatPercent(): number {
    return Math.round(this.vat.rate * 100);
  }

  /**
   * The operator can overwrite the calculated price on the summary — a deal
   * closed at 500 € net on a 540 € tariff.
   *
   * ⚠️ The figure typed here is the NET. That is the number that gets
   * negotiated, and VAT is added to it below; binding this to the gross while
   * the label said "sin IVA" made the two disagree by 21 %.
   */
  onNetPriceChange(value: unknown): void {
    if (value === null || value === undefined || value === '') {
      this.priceCleared = true;
      this.finalPriceOverride = null;
      return;
    }
    this.priceCleared = false;
    const parsed = typeof value === 'number' ? value : parseFloat(String(value));
    this.finalPriceOverride =
      !isFinite(parsed) || parsed < 0 ? null : Math.round(parsed * 100) / 100;
  }

  resetFinalPrice(): void {
    this.finalPriceOverride = null;
    this.priceCleared = false;
  }

  /**
   * The signal never exceeds the agreed price: a 50 € signal on a 30 € rental
   * would leave the reservation impossible to settle.
   */
  get initialPayment(): number {
    return roundMoney(Math.min(APP_DEFAULTS.DEFAULT_INITIAL_PAYMENT, this.finalPrice));
  }

  /**
   * ⚠️ Rounded, because this is money that gets written down.
   *
   * `108.9 - 50` is `58.900000000000006` in binary floating point, and the
   * summary printed exactly that — then seeded a payment row with it.
   */
  get remainingPayment(): number {
    return roundMoney(Math.max(0, this.finalPrice - this.initialPayment));
  }

  /**
   * What the vehicle asks for by default, before the operator decides.
   *
   * Manda la fianza del coche; si no la tiene, la de **Ajustes**; y si tampoco
   * —porque nadie ha guardado ajustes todavía— la constante del código. El orden
   * es de lo más concreto a lo más general, que es el mismo criterio que sigue
   * el precio: tarifa del vehículo antes que nada global.
   */
  get defaultDeposit(): number {
    return (
      this.selectedVehicle?.vehicle.defaultDepositAmount ??
      this.settingsService.settings().defaultDepositAmount ??
      APP_DEFAULTS.DEFAULT_DEPOSIT_AMOUNT
    );
  }

  /**
   * The deposit actually agreed. Editable, and legitimately 0: known customers
   * are not asked for one.
   *
   * Un campo **vaciado** vale 0, que es lo que dice la pantalla: no se pide
   * fianza. Y como cualquier otro 0, exige motivo para poder guardar.
   */
  get deposit(): number {
    if (this.depositCleared) return 0;
    return this.depositOverride ?? this.defaultDeposit;
  }

  /**
   * Lo que se pinta en el campo, que **no** es lo mismo que `deposit`.
   *
   * ⚠️ **Un campo vacío tiene que quedarse vacío**, y por eso hay dos getters
   * donde parecía bastar uno. Devolviendo aquí el 0 de `deposit`, `ngModel`
   * escribiría un «0» en el hueco en cuanto se borra el último dígito, y el
   * siguiente número se teclearía detrás: quien vacía «150» para escribir
   * «200» acabaría con 0200. Vacío es un estado del campo, no un importe.
   */
  get depositInput(): number | null {
    return this.depositCleared ? null : this.deposit;
  }

  /** True when this rental carries no deposit, which needs a recorded reason. */
  get depositWaived(): boolean {
    return isDepositWaived(this.deposit);
  }

  /** True while the operator has waived the deposit without saying why. */
  get depositReasonMissing(): boolean {
    return needsWaivedReason(this.deposit, this.depositWaivedReason);
  }

  /**
   * True when the selected customer is marked "do not rent". The button is
   * disabled and the service refuses it as well — the rule lives in the
   * workflow util, not here.
   */
  get clientBlocked(): boolean {
    return !canCreateReservationForClient(this.selectedClient?.trustLevel).ok;
  }

  /** i18n key of the notice about this customer, or '' when there is none. */
  get clientTrustWarning(): string {
    return trustWarningOf(this.selectedClient?.trustLevel);
  }

  /**
   * Bound to `(ngModelChange)`, which emits the value — not a DOM Event.
   *
   * ⚠️ **Vaciar el campo NO es escribir algo ilegible, y confundir las dos
   * cosas hacía la fianza imposible de bajar a 0.** Esto decía «lo que no se
   * pueda interpretar, vuelve al valor por defecto», y un campo numérico vacío
   * emite `null`: `parseFloat(String(null ?? ''))` es `NaN`, o sea ilegible, o
   * sea de vuelta a los 150 €. Consecuencia, contada por Dorel el 23 de
   * septiembre de 2026: borrando con retroceso, el importe se reponía solo en
   * cuanto desaparecía el último dígito, y para poner 0 había que seleccionar
   * el contenido y sobrescribirlo.
   *
   * Son tres estados y no dos, y por eso hace falta la bandera: **sin tocar**
   * (manda el defecto del coche), **con un importe puesto**, y **vacío**, que
   * es una decisión del operador —no pido fianza— y vale 0 con su motivo
   * obligatorio, como cualquier otro 0.
   *
   * Lo ilegible de verdad —un texto que el navegador no acepta como número, un
   * importe negativo— sí sigue cayendo al defecto.
   */
  onDepositChange(value: unknown): void {
    if (value === null || value === undefined || value === '') {
      this.depositCleared = true;
      this.depositOverride = null;
      return;
    }
    this.depositCleared = false;
    const parsed = typeof value === 'number' ? value : parseFloat(String(value));
    this.depositOverride = !isFinite(parsed) || parsed < 0 ? null : Math.round(parsed * 100) / 100;
  }

  resetDeposit(): void {
    this.depositOverride = null;
    this.depositCleared = false;
    this.depositWaivedReason = '';
  }
}
