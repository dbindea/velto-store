import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { SignaturePadComponent } from '@shared/components/signature-pad/signature-pad.component';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Contract } from '@shared/models/contract.model';

interface PublicContractView {
  contractNumber?: string;
  clientName: string;
  vehicleLabel: string;
  vehiclePlate: string;
  pickupDate?: string;
  returnDate?: string;
  totalDays?: number;
  finalPrice?: number;
  depositAmount?: number;
  pickupLocation?: string;
  returnLocation?: string;
  pdfUrl?: string;
  status: 'active' | 'expired' | 'used' | 'cancelled' | 'invalid';
  companyName?: string;
}

@Component({
  selector: 'app-sign-contract',
  standalone: true,
  imports: [CommonModule, FormsModule, SignaturePadComponent, TranslatePipe],
  templateUrl: './sign-contract.component.html',
  styleUrl: './sign-contract.component.scss'
})
export class SignContractComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private functions = inject(Functions);

  token = '';
  loading = true;
  signing = false;
  errored = false;
  finished = false;

  view: PublicContractView | null = null;
  signaturePng: string | null = null;
  signatureEmpty = true;
  accepted = false;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.loading = false;
      this.errored = true;
      return;
    }
    this.loadContract();
  }

  loadContract(): void {
    this.loading = true;
    this.errored = false;
    const fn = httpsCallable<{ token: string }, PublicContractView>(
      this.functions,
      'getContractForSigning'
    );
    fn({ token: this.token })
      .then((res) => {
        this.view = res.data;
        this.loading = false;
      })
      .catch((err) => {
        console.error('Error loading contract for signing:', err);
        this.view = {
          status: 'invalid',
          clientName: '',
          vehicleLabel: '',
          vehiclePlate: ''
        };
        this.errored = true;
        this.loading = false;
      });
  }

  onSignatureChange(png: string | null): void {
    this.signaturePng = png;
    this.signatureEmpty = !png;
  }

  canSubmit(): boolean {
    return !this.signatureEmpty && this.accepted && !!this.signaturePng;
  }

  async submit(): Promise<void> {
    if (!this.canSubmit() || this.signing) return;
    this.signing = true;
    try {
      const fn = httpsCallable<{ token: string; signatureDataUrl: string }, { ok: true }>(
        this.functions,
        'signContract'
      );
      await fn({ token: this.token, signatureDataUrl: this.signaturePng! });
      this.finished = true;
    } catch (err: any) {
      console.error('Error signing contract:', err);
      // Refresh status to show the latest token state
      this.loadContract();
    } finally {
      this.signing = false;
    }
  }

  viewOriginalPdf(): void {
    if (this.view?.pdfUrl) {
      window.open(this.view.pdfUrl, '_blank', 'noopener');
    }
  }
}
