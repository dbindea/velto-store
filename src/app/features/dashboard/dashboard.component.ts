import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  stats = [
    { labelKey: 'dashboard.vehicles', value: 3, iconClass: 'pi pi-car', color: 'blue' },
    { labelKey: 'dashboard.activeReservations', value: 0, iconClass: 'pi pi-book', color: 'green' },
    { labelKey: 'dashboard.clients', value: 0, iconClass: 'pi pi-users', color: 'purple' },
    { labelKey: 'dashboard.pendingInspections', value: 0, iconClass: 'pi pi-check-square', color: 'amber' }
  ];
}
