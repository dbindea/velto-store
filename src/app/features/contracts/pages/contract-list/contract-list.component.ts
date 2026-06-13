import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ContractService } from '@features/contracts/services/contract.service';
import {
  Contract,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_COLORS,
  ContractStatus
} from '@shared/models/contract.model';
import { toDate } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-contract-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe],
  templateUrl: './contract-list.component.html',
  styleUrl: './contract-list.component.scss'
})
export class ContractListComponent implements OnInit, OnDestroy {
  private contractService = inject(ContractService);
  private router = inject(Router);

  contracts: Contract[] = [];
  loading = true;
  searchTerm = '';
  statusFilter: ContractStatus | '' = '';
  private subscription?: { unsubscribe: () => void };

  CONTRACT_STATUS_LABELS = CONTRACT_STATUS_LABELS;
  CONTRACT_STATUS_COLORS = CONTRACT_STATUS_COLORS;

  statusOptions: { value: ContractStatus; label: string }[] = [
    { value: 'draft', label: 'contracts.status.draft' },
    { value: 'generated', label: 'contracts.status.generated' },
    { value: 'pending_signature', label: 'contracts.status.pendingSignature' },
    { value: 'signed', label: 'contracts.status.signed' },
    { value: 'cancelled', label: 'contracts.status.cancelled' },
    { value: 'expired', label: 'contracts.status.expired' }
  ];

  ngOnInit(): void {
    this.subscription = this.contractService.getContracts().subscribe({
      next: (items) => {
        this.contracts = items;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading contracts:', err);
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  get filteredContracts(): Contract[] {
    const term = this.searchTerm.toLowerCase().trim();
    return this.contracts.filter((c) => {
      if (this.statusFilter && c.status !== this.statusFilter) return false;
      if (!term) return true;
      const haystack = [
        c.contractNumber,
        c.clientSnapshot?.fullName,
        c.vehicleSnapshot?.plateNumber,
        c.vehicleSnapshot?.brand,
        c.vehicleSnapshot?.model
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }

  viewContract(contract: Contract): void {
    if (contract.id) this.router.navigate(['/contracts', contract.id]);
  }

  getCreatedAt(c: Contract): Date | null {
    return c.createdAt ? toDate(c.createdAt) : null;
  }

  getSignedAt(c: Contract): Date | null {
    return c.signedAt ? toDate(c.signedAt) : null;
  }
}
