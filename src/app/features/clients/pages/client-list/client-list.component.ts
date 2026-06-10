import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ClientService } from '@features/clients/services/client.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { Client, ClientTrustLevel, CLIENT_TRUST_LEVEL_LABELS, CLIENT_TRUST_LEVEL_COLORS } from '@shared/models/client.model';

@Component({
  selector: 'app-client-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslatePipe],
  templateUrl: './client-list.component.html',
  styleUrl: './client-list.component.scss'
})
export class ClientListComponent implements OnInit {
  private router = inject(Router);
  private clientService = inject(ClientService);
  private reservationService = inject(ReservationService);

  clients: Client[] = [];
  filteredClients: Client[] = [];
  loading = true;

  // Filters
  searchTerm = '';
  trustFilter: ClientTrustLevel | 'all' = 'all';

  // Reservation counts per client
  reservationCounts = new Map<string, number>();

  // Trust level options
  trustOptions: Array<{ value: ClientTrustLevel | 'all'; label: string }> = [
    { value: 'all', label: 'common.all' },
    { value: 'new', label: 'clients.trustLevel.new' },
    { value: 'known', label: 'clients.trustLevel.known' },
    { value: 'regular', label: 'clients.trustLevel.regular' },
    { value: 'risk', label: 'clients.trustLevel.risk' },
    { value: 'blocked', label: 'clients.trustLevel.blocked' }
  ];

  ngOnInit(): void {
    this.loadClients();
  }

  loadClients(): void {
    this.loading = true;
    this.clientService.getClients().subscribe({
      next: (clients) => {
        this.clients = clients;
        this.applyFilters();
        this.loadReservationCounts();
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading clients:', error);
        this.loading = false;
      }
    });
  }

  loadReservationCounts(): void {
    this.reservationService.getReservations().subscribe(reservations => {
      this.reservationCounts.clear();
      reservations.forEach(r => {
        this.reservationCounts.set(r.clientId, (this.reservationCounts.get(r.clientId) || 0) + 1);
      });
    });
  }

  applyFilters(): void {
    let result = [...this.clients];

    // Trust level filter
    if (this.trustFilter !== 'all') {
      result = result.filter(c => (c.trustLevel || 'new') === this.trustFilter);
    }

    // Search term
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(c =>
        c.fullName?.toLowerCase().includes(term) ||
        (c.phone && c.phone.includes(term)) ||
        (c.email && c.email.toLowerCase().includes(term)) ||
        (c.documentNumber && c.documentNumber.toLowerCase().includes(term))
      );
    }

    this.filteredClients = result;
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  viewDetail(client: Client): void {
    this.router.navigate(['/clients', client.id]);
  }

  createNew(): void {
    this.router.navigate(['/clients', 'new']);
  }

  getTrustLabel(level: ClientTrustLevel | undefined): string {
    return CLIENT_TRUST_LEVEL_LABELS[level || 'new'];
  }

  getTrustClass(level: ClientTrustLevel | undefined): string {
    return CLIENT_TRUST_LEVEL_COLORS[level || 'new'];
  }

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  getReservationCount(clientId: string | undefined): number {
    if (!clientId) return 0;
    return this.reservationCounts.get(clientId) || 0;
  }
}