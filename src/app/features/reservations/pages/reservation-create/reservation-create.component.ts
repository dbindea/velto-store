import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Client, QuickClientData } from '@shared/models/client.model';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import {
  calculateCalendarDays,
  combineDateAndTime,
  getDefaultPickupDateTime,
  getDefaultReturnDateTime,
  toDateString,
  toTimeString,
} from '@shared/utils/reservation-date.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { ClientService } from '@features/clients/services/client.service';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import { ReservationService, VehicleAvailabilityResult } from '@features/reservations/services/reservation.service';

type Step = 'dates' | 'vehicle' | 'client' | 'summary';

@Component({
  selector: 'app-reservation-create',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './reservation-create.component.html',
  styleUrl: './reservation-create.component.scss',
})
export class ReservationCreateComponent implements OnInit {
  private router = inject(Router);
  private reservationService = inject(ReservationService);
  private clientService = inject(ClientService);
  private vehicleService = inject(VehicleService);

  // Current step
  currentStep: Step = 'dates';
  steps: Step[] = ['dates', 'vehicle', 'client', 'summary'];

  // Loading states
  loading = false;
  searching = false;
  saving = false;

  // Date fields
  pickupDate = toDateString(getDefaultPickupDateTime());
  pickupTime = toTimeString(getDefaultPickupDateTime());
  returnDate = toDateString(getDefaultReturnDateTime());
  returnTime = toTimeString(getDefaultReturnDateTime());

  // Location fields
  pickupLocation = '';
  returnLocation = '';

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

  // Notes
  notes = '';

  // Validation
  dateError = '';

  ngOnInit(): void {
    // Preloaded so the client step opens with something to click on: most
    // bookings are for someone who rented recently.
    this.loadRecentClients();
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
        return true;
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
    const pickupDateTime = combineDateAndTime(this.pickupDate, this.pickupTime);
    const returnDateTime = combineDateAndTime(this.returnDate, this.returnTime);

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
    this.finalPriceOverride = null;

    try {
      this.availabilityResults = await this.reservationService.searchAvailability(
        pickupDateTime,
        returnDateTime,
      );
      this.currentStep = 'vehicle';
    } catch (error) {
      console.error('Error searching availability:', error);
      this.dateError = 'Error al buscar disponibilidad';
    } finally {
      this.searching = false;
    }
  }

  selectVehicle(result: VehicleAvailabilityResult): void {
    if (!result.available) return;
    if (this.selectedVehicle?.vehicleId !== result.vehicleId) {
      this.finalPriceOverride = null;
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

  async createQuickClient(): Promise<void> {
    if (!this.quickClient.fullName) return;

    this.saving = true;
    try {
      const clientId = await this.clientService.createQuickClient(this.quickClient);

      // Fetch the created client
      this.clientService.getClientById(clientId).subscribe((client) => {
        if (client) {
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

    this.saving = true;
    try {
      const pickupDateTime = combineDateAndTime(this.pickupDate, this.pickupTime);
      const returnDateTime = combineDateAndTime(this.returnDate, this.returnTime);

      const reservationId = await this.reservationService.createReservationWithClient(
        this.selectedVehicle.vehicle,
        this.selectedClient,
        pickupDateTime,
        returnDateTime,
        this.initialPayment, // Initial payment required, capped at the agreed price
        this.selectedVehicle.vehicle.defaultDepositAmount || APP_DEFAULTS.DEFAULT_DEPOSIT_AMOUNT,
        this.notes || undefined,
        this.pickupLocation || undefined,
        this.returnLocation || undefined,
        this.priceOverridden ? this.finalPrice : undefined,
      );

      this.router.navigate(['/reservations', reservationId]);
    } catch (error) {
      console.error('Error creating reservation:', error);
      alert('Error al crear la reserva. Por favor, inténtalo de nuevo.');
    } finally {
      this.saving = false;
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
    const words = input.value.toLowerCase().split(' ');
    const formatted = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    this.quickClient.fullName = formatted;
    input.value = formatted;
  }

  // Computed values for summary
  get pickupDateTime(): Date {
    return combineDateAndTime(this.pickupDate, this.pickupTime);
  }

  // Today's date as YYYY-MM-DD for HTML5 date min attribute
  get todayString(): string {
    return toDateString(new Date());
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
  onPickupLocationChange(value: string): void {
    const formatted = this.capitalizeWords(value);
    this.pickupLocation = formatted;
    if (!this.returnLocationEdited) {
      this.returnLocation = formatted;
    }
  }

  /**
   * Return location. Bound to `(ngModelChange)`, which emits the new value —
   * not a DOM Event.
   *
   * Clearing the field resumes mirroring the pickup location, so an operator
   * who empties it by mistake is not left having to retype the whole thing.
   */
  onReturnLocationInput(value: string): void {
    this.returnLocationEdited = !!value;
    this.returnLocation = this.capitalizeWords(value);
  }

  private capitalizeWords(value: string): string {
    if (!value) return value;
    return value
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * When pickup date changes, ensure return date is not before pickup.
   */
  onPickupDateChange(value: string): void {
    this.pickupDate = value;
    // If return date is now invalid, push it to pickup date
    if (this.returnDate < this.pickupDate) {
      this.returnDate = this.pickupDate;
    }
  }

  get returnDateTime(): Date {
    return combineDateAndTime(this.returnDate, this.returnTime);
  }

  get totalDays(): number {
    return calculateCalendarDays(this.pickupDateTime, this.returnDateTime);
  }

  /** What the tariff rules say the rental costs. */
  get calculatedFinalPrice(): number {
    return this.selectedVehicle?.pricing?.finalPrice || 0;
  }

  /** The price that will actually be charged: the agreed one, or the calculated one. */
  get finalPrice(): number {
    return this.finalPriceOverride ?? this.calculatedFinalPrice;
  }

  /** True when the operator agreed a price other than the calculated one. */
  get priceOverridden(): boolean {
    return this.finalPriceOverride !== null &&
      this.finalPriceOverride !== this.calculatedFinalPrice;
  }

  /** Signed difference against the calculation. Negative is a discount. */
  get manualAdjustment(): number {
    return Math.round((this.finalPrice - this.calculatedFinalPrice) * 100) / 100;
  }

  /**
   * The operator can overwrite the calculated price on the summary — a deal
   * closed at 515 € on a 600 € tariff. Anything unparseable or negative falls
   * back to the calculation instead of writing a nonsense price.
   */
  onFinalPriceChange(value: unknown): void {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    this.finalPriceOverride =
      !isFinite(parsed) || parsed < 0 ? null : Math.round(parsed * 100) / 100;
  }

  resetFinalPrice(): void {
    this.finalPriceOverride = null;
  }

  /**
   * The signal never exceeds the agreed price: a 50 € signal on a 30 € rental
   * would leave the reservation impossible to settle.
   */
  get initialPayment(): number {
    return Math.min(APP_DEFAULTS.DEFAULT_INITIAL_PAYMENT, this.finalPrice);
  }

  get remainingPayment(): number {
    return Math.max(0, this.finalPrice - this.initialPayment);
  }

  get deposit(): number {
    return this.selectedVehicle?.vehicle.defaultDepositAmount || APP_DEFAULTS.DEFAULT_DEPOSIT_AMOUNT;
  }
}
