import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ContractService } from '@features/contracts/services/contract.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import {
  Contract,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_COLORS
} from '@shared/models/contract.model';
import { toDate } from '@shared/utils/reservation-date.util';

@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe],
  templateUrl: './contract-detail.component.html',
  styleUrl: './contract-detail.component.scss'
})
export class ContractDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private contractService = inject(ContractService);
  private reservationService = inject(ReservationService);

  contract: Contract | null = null;
  loading = true;
  generating = false;
  creatingLink = false;
  sending = false;
  copyToast = false;
  copyToastTimer: any;

  // Email form
  showEmailForm = false;
  emailRecipient = '';
  emailError = '';

  CONTRACT_STATUS_LABELS = CONTRACT_STATUS_LABELS;
  CONTRACT_STATUS_COLORS = CONTRACT_STATUS_COLORS;

  private sub?: Subscription;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.sub = this.contractService.getContractById(id).subscribe({
        next: (c) => {
          if (!c) {
            this.router.navigate(['/contracts']);
            return;
          }
          this.contract = c;
          this.emailRecipient = c.clientSnapshot?.email || '';
          this.loading = false;
        },
        error: (err) => {
          console.error('Error loading contract:', err);
          this.loading = false;
        }
      });
    } else {
      this.router.navigate(['/contracts']);
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.copyToastTimer) clearTimeout(this.copyToastTimer);
  }

  // ============================================================
  // Actions
  // ============================================================

  async generatePdf(): Promise<void> {
    if (!this.contract?.reservationId) return;
    this.generating = true;
    try {
      const res = await this.contractService.generateContractFromReservation(this.contract.reservationId);
      // Refresh from server to pick up new contractId, status, etc.
      this.refresh();
      void res;
    } catch (err) {
      console.error('Error generating contract:', err);
      alert('Error al generar el contrato');
    } finally {
      this.generating = false;
    }
  }

  async createLink(): Promise<void> {
    if (!this.contract?.id) return;
    this.creatingLink = true;
    try {
      await this.contractService.generateSigningLink(this.contract.id);
      this.refresh();
    } catch (err) {
      console.error('Error creating signing link:', err);
      alert('Error al crear el link de firma');
    } finally {
      this.creatingLink = false;
    }
  }

  async cancelLink(): Promise<void> {
    if (!this.contract?.id) return;
    if (!confirm('¿Cancelar el link de firma activo?')) return;
    try {
      await this.contractService.cancelSigningLink(this.contract.id);
      this.refresh();
    } catch (err) {
      console.error('Error cancelling signing link:', err);
      alert('Error al cancelar el link');
    }
  }

  async copyLink(): Promise<void> {
    if (!this.contract?.signingLinkPath) return;
    const abs = this.contractService.buildAbsoluteSigningUrl(this.contract.signingLinkPath);
    try {
      await navigator.clipboard.writeText(abs);
      this.showCopyToast();
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = abs;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); this.showCopyToast(); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
  }

  private showCopyToast(): void {
    this.copyToast = true;
    if (this.copyToastTimer) clearTimeout(this.copyToastTimer);
    this.copyToastTimer = setTimeout(() => (this.copyToast = false), 2200);
  }

  async downloadOriginal(): Promise<void> {
    if (!this.contract) return;
    const url = await this.contractService.getOriginalPdfUrl(this.contract);
    if (!url) {
      alert('PDF no disponible todavía');
      return;
    }
    const filename = `contrato-${this.contract.contractNumber || this.contract.id}.pdf`;
    await this.contractService.triggerDownload(url, filename);
  }

  async downloadSigned(): Promise<void> {
    if (!this.contract) return;
    const url = await this.contractService.getSignedPdfUrl(this.contract);
    if (!url) {
      alert('Contrato firmado no disponible todavía');
      return;
    }
    const filename = `contrato-firmado-${this.contract.contractNumber || this.contract.id}.pdf`;
    await this.contractService.triggerDownload(url, filename);
  }

  openEmailForm(): void {
    this.showEmailForm = true;
    this.emailError = '';
  }

  closeEmailForm(): void {
    this.showEmailForm = false;
    this.emailError = '';
  }

  async sendEmail(): Promise<void> {
    if (!this.contract?.id) return;
    const email = (this.emailRecipient || '').trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      this.emailError = 'Introduce un email válido';
      return;
    }
    this.sending = true;
    this.emailError = '';
    try {
      await this.contractService.sendSignedContractByEmail(this.contract.id, email);
      this.showEmailForm = false;
      this.refresh();
    } catch (err: any) {
      console.error('Error sending email:', err);
      this.emailError = err?.message || 'Error al enviar el email';
    } finally {
      this.sending = false;
    }
  }

  goBack(): void {
    if (this.contract?.reservationId) {
      this.router.navigate(['/reservations', this.contract.reservationId]);
    } else {
      this.router.navigate(['/contracts']);
    }
  }

  viewReservation(): void {
    if (this.contract?.reservationId) {
      this.router.navigate(['/reservations', this.contract.reservationId]);
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private refresh(): void {
    if (!this.contract?.id) return;
    this.sub?.unsubscribe();
    this.sub = this.contractService.getContractById(this.contract.id).subscribe({
      next: (c) => {
        if (c) {
          this.contract = c;
          if (!this.emailRecipient) this.emailRecipient = c.clientSnapshot?.email || '';
        }
      }
    });
  }

  getCreatedAt(c: Contract): Date | null {
    return c.createdAt ? toDate(c.createdAt) : null;
  }
  getGeneratedAt(c: Contract): Date | null {
    return c.generatedAt ? toDate(c.generatedAt) : null;
  }
  getSignedAt(c: Contract): Date | null {
    return c.signedAt ? toDate(c.signedAt) : null;
  }
  getEmailedAt(c: Contract): Date | null {
    return c.emailedAt ? toDate(c.emailedAt) : null;
  }

  getStatusLabel(status: string): string {
    return CONTRACT_STATUS_LABELS[status as keyof typeof CONTRACT_STATUS_LABELS] || status;
  }
  getStatusClass(status: string): string {
    return CONTRACT_STATUS_COLORS[status as keyof typeof CONTRACT_STATUS_COLORS] || '';
  }

  canGenerate(): boolean {
    if (!this.contract) return false;
    return ['draft', 'cancelled', 'expired'].includes(this.contract.status);
  }
  canCreateLink(): boolean {
    if (!this.contract) return false;
    return ['generated', 'draft', 'cancelled', 'expired'].includes(this.contract.status);
  }
  hasActiveLink(): boolean {
    return this.contract?.status === 'pending_signature';
  }
  canDownloadOriginal(): boolean {
    return !!this.contract?.pdfPath;
  }
  canDownloadSigned(): boolean {
    return !!this.contract?.signedPdfPath;
  }
  canSendEmail(): boolean {
    return this.contract?.status === 'signed';
  }

  getAbsoluteSigningUrl(): string {
    if (!this.contract?.signingLinkPath) return '';
    return this.contractService.buildAbsoluteSigningUrl(this.contract.signingLinkPath);
  }
}
