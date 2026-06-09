import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ReservationService, VehicleAvailabilityResult } from '../../services/reservation.service';
import { ClientService } from '../../../clients/services/client.service';
import { VehicleService } from '../../../vehicles/services/vehicle.service';
import { Vehicle } from '@shared/models/vehicle.model';
import { Client, QuickClientData } from '@shared/models/client.model';
import { 
  getDefaultPickupDateTime, 
  getDefaultReturnDateTime,
  toDateString,
  toTimeString,
  combineDateAndTime,
  toDate,
  formatDate,
  formatTime
} from '@shared/utils/reservation-date.util';
import { calculateCalendarDays } from '@shared/utils/reservation-date.util';

type Step = 'dates' | 'vehicle' | 'client' | 'summary';

@Component({
  selector: 'app-reservation-create',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './reservation-create.component.html',
  styleUrl: './reservation-create.component.scss'
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
  selectedClient: Client | null = null;
  showQuickClientForm = false;
  
  // Quick client form
  quickClient: QuickClientData = {
    fullName: '',
    phone: '',
    email: '',
    documentNumber: ''
  };

  // Notes
  notes = '';

  // Validation
  dateError = '';

  ngOnInit(): void {
    // Reset state on init
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
    
    try {
      this.availabilityResults = await this.reservationService.searchAvailability(
        pickupDateTime,
        returnDateTime
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
    this.selectedVehicle = result;
    this.currentStep = 'client';
  }

  searchClients(): void {
    if (this.clientSearchTerm.length < 2) {
      this.searchResults = [];
      return;
    }
    
    this.clientService.searchClients(this.clientSearchTerm).subscribe(clients => {
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
      this.clientService.getClientById(clientId).subscribe(client => {
        if (client) {
          this.selectedClient = client;
          this.showQuickClientForm = false;
          this.quickClient = { fullName: '', phone: '', email: '', documentNumber: '' };
          this.currentStep = 'summary';
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
        50, // Initial payment required
        this.selectedVehicle.vehicle.defaultDepositAmount || 300,
        this.notes || undefined,
        this.pickupLocation || undefined,
        this.returnLocation || undefined
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

  // Computed values for summary
  get pickupDateTime(): Date {
    return combineDateAndTime(this.pickupDate, this.pickupTime);
  }

  get returnDateTime(): Date {
    return combineDateAndTime(this.returnDate, this.returnTime);
  }

  get totalDays(): number {
    return calculateCalendarDays(this.pickupDateTime, this.returnDateTime);
  }

  get finalPrice(): number {
    return this.selectedVehicle?.pricing?.finalPrice || 0;
  }

  get initialPayment(): number {
    return 50;
  }

  get remainingPayment(): number {
    return Math.max(0, this.finalPrice - this.initialPayment);
  }

  get deposit(): number {
    return this.selectedVehicle?.vehicle.defaultDepositAmount || 300;
  }
}