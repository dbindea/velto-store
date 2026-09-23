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
import {
  CLIENT_DOCUMENT_TYPE_LABELS,
  ClientDocumentType
} from '@shared/models/client.model';
import { TranslateService } from '@core/i18n/translate.service';
import { NotificationService } from '@core/notifications/notification.service';
import {
  Workflow,
  WorkflowContext,
  WorkflowDecision,
  canGenerateSigningLink,
  reasonOf
} from '@shared/utils/reservation-workflow.util';
import { ConfirmService } from '@core/notifications/confirm.service';
import { ClearInputDirective } from '@shared/directives/clear-input.directive';

@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe, ClearInputDirective],
  templateUrl: './contract-detail.component.html',
  styleUrl: './contract-detail.component.scss'
})
export class ContractDetailComponent implements OnInit, OnDestroy {
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationService);
  private router = inject(Router);
  private contractService = inject(ContractService);
  private translateService = inject(TranslateService);
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
      /**
       * ⚠️ **Escucha el documento.** El cliente firma en su móvil, no aquí: con
       * una lectura única esta pantalla seguía diciendo «Pendiente de firma»
       * hasta que alguien pulsaba F5. Es el mismo motivo por el que la ficha de
       * la reserva escucha su contrato.
       *
       * ⚠️ El correo del destinatario **solo se rellena si está vacío**: se
       * reemite en cada cambio del contrato y, escribiéndolo siempre, pisaría
       * lo que el operador esté tecleando en el formulario de envío.
       */
      this.sub = this.contractService.watchContractById(id).subscribe({
        next: (c) => {
          if (!c) {
            this.router.navigate(['/contracts']);
            return;
          }
          this.contract = c;
          if (!this.emailRecipient) this.emailRecipient = c.clientSnapshot?.email || '';
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

  /** Marca que se copió, para cambiar el icono un momento. */
  codeCopied = false;

  /**
   * El CSV tal y como está impreso en el contrato: `VLT-7M63-EE55-THDK`.
   *
   * ⚠️ **El formato está duplicado a propósito**, igual que la aritmética del
   * IVA: la app y las functions compilan con tsconfigs separados y no pueden
   * compartir módulo. Si cambia el prefijo o el tamaño del grupo, se cambia en
   * `functions/src/contracts/verification.ts` y aquí.
   */
  get verificationCode(): string {
    const raw = this.contract?.verificationCode;
    if (!raw) return '';
    return 'VLT-' + (raw.match(/.{1,4}/g) || []).join('-');
  }

  async copyVerificationCode(): Promise<void> {
    if (!this.verificationCode) return;
    try {
      await navigator.clipboard.writeText(this.verificationCode);
      this.codeCopied = true;
      setTimeout(() => (this.codeCopied = false), 2000);
    } catch (err) {
      console.error('Error copying verification code:', err);
    }
  }

  async generatePdf(): Promise<void> {
    if (!this.contract?.reservationId) return;
    this.generating = true;
    try {
      // Sin refrescar a mano: es el mismo documento, y el stream vivo trae el
      // estado nuevo en cuanto la Cloud Function lo escribe.
      const res = await this.contractService.generateContractFromReservation(this.contract.reservationId);
      void res;
    } catch (err) {
      console.error('Error generating contract:', err);
      this.notifications.error('contracts.errors.generate', { retry: () => void this.generatePdf() });
    } finally {
      this.generating = false;
    }
  }

  async createLink(): Promise<void> {
    if (!this.contract?.id) return;
    this.creatingLink = true;
    try {
      await this.contractService.generateSigningLink(this.contract.id);
    } catch (err) {
      console.error('Error creating signing link:', err);
      this.notifications.error('contracts.errors.createSigningLink', { retry: () => void this.createLink() });
    } finally {
      this.creatingLink = false;
    }
  }

  async cancelLink(): Promise<void> {
    if (!this.contract?.id) return;
    const seguir = await this.confirm.ask({
      title: 'contracts.confirmCancelSigningLinkTitle',
      message: 'contracts.confirmCancelSigningLink',
      confirmLabel: 'contracts.cancelSigningLink',
      danger: true
    });
    if (!seguir) return;
    try {
      await this.contractService.cancelSigningLink(this.contract.id);
    } catch (err) {
      console.error('Error cancelling signing link:', err);
      this.notifications.error('contracts.errors.cancelSigningLink', { retry: () => void this.cancelLink() });
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
      // Sin reintentar: no ha fallado nada, el documento aún no existe.
      this.notifications.error('contracts.errors.pdfNotReady');
      return;
    }
    try {
      await this.contractService.triggerDownload(
        url,
        this.contractService.fileNameFor(this.contract, false)
      );
    } catch {
      // El PDF ya se ha abierto en otra pestaña, pero eso baja la ruta entera
      // de Storage —una carpeta— así que hay que decirlo en vez de callar.
      this.notifications.error('contracts.errors.downloadFallback');
    }
  }

  async downloadSigned(): Promise<void> {
    if (!this.contract) return;
    const url = await this.contractService.getSignedPdfUrl(this.contract);
    if (!url) {
      this.notifications.error('contracts.errors.signedPdfNotReady');
      return;
    }
    try {
      await this.contractService.triggerDownload(
        url,
        this.contractService.fileNameFor(this.contract, true)
      );
    } catch {
      // El PDF ya se ha abierto en otra pestaña, pero eso baja la ruta entera
      // de Storage —una carpeta— así que hay que decirlo en vez de callar.
      this.notifications.error('contracts.errors.downloadFallback');
    }
  }

  openEmailForm(): void {
    this.showEmailForm = true;
    this.emailError = '';
  }

  closeEmailForm(): void {
    this.showEmailForm = false;
    this.emailError = '';
  }

  /**
   * ⚠️ **`emailError` guarda una CLAVE i18n, no una frase.** Llevaba las dos
   * escritas en español duro —«Introduce un email válido», «Error al enviar el
   * email»— y se pintaban sin pasar por el pipe, así que un operador rumano
   * leía castellano justo cuando algo acababa de fallar.
   *
   * Y el mensaje del error **no se pinta tal cual**: lo que viene de un
   * callable es texto del backend, en inglés, y enseñárselo al operador es la
   * misma clase de fallo. Solo se respeta si ya es una clave de la aplicación.
   */
  async sendEmail(): Promise<void> {
    if (!this.contract?.id) return;
    const email = (this.emailRecipient || '').trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      this.emailError = 'contracts.errors.invalidEmail';
      return;
    }
    this.sending = true;
    this.emailError = '';
    try {
      await this.contractService.sendSignedContractByEmail(this.contract.id, email);
      this.showEmailForm = false;
    } catch (err: any) {
      console.error('Error sending email:', err);
      const clave = String(err?.message || '');
      this.emailError = clave.startsWith('contracts.') ? clave : 'contracts.errors.sendFailed';
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

  // CONTRACT_STATUS_LABELS holds i18n keys; resolve here because the template
  // renders this getter without a `| translate`.
  getStatusLabel(status: string): string {
    const key = CONTRACT_STATUS_LABELS[status as keyof typeof CONTRACT_STATUS_LABELS];
    return key ? this.translateService.translate(key) : status;
  }
  getStatusClass(status: string): string {
    return CONTRACT_STATUS_COLORS[status as keyof typeof CONTRACT_STATUS_COLORS] || '';
  }

  generateDecision(): WorkflowDecision {
    if (!this.contract) {
      return { ok: false, reason: 'workflow.missingContract' };
    }
    return Workflow.canGenerateContract({
      reservation: {} as any,
      contract: this.contract
    } as WorkflowContext);
  }
  canGenerate(): boolean {
    return this.generateDecision().ok;
  }
  generateBlockReason(): string {
    return reasonOf(this.generateDecision());
  }
  createLinkDecision(): WorkflowDecision {
    if (!this.contract) {
      return { ok: false, reason: 'workflow.missingContract' };
    }
    return canGenerateSigningLink({
      reservation: {} as any,
      contract: this.contract
    } as WorkflowContext);
  }
  canCreateLink(): boolean {
    return this.createLinkDecision().ok;
  }
  createLinkBlockReason(): string {
    return reasonOf(this.createLinkDecision());
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

  /**
   * La etiqueta del tipo de documento, en clave i18n.
   *
   * ⚠️ El snapshot guarda el **enum** —`dni`, `passport`…—, no un texto. Se
   * pintaba tal cual: salía «dni:» en minúscula entre etiquetas capitalizadas, y
   * con un pasaporte habría salido «passport:» en las tres versiones. Misma
   * regla que `fuelType` y `transmission` en los PDF.
   */
  documentTypeLabel(tipo: string | undefined): string {
    return CLIENT_DOCUMENT_TYPE_LABELS[tipo as ClientDocumentType] || 'clients.fields.documentNumber';
  }
}
