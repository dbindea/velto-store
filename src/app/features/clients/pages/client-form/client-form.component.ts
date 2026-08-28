import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { ClientService } from '@features/clients/services/client.service';
import { TranslateService } from '@core/i18n/translate.service';
import {
  Client,
  ClientDocumentType,
  ClientTrustLevel,
  DrivingLicenseCountry,
  ClientDocumentFile,
  ClientDocumentType_File,
  LoyaltyDiscountChange,
  CLIENT_FILE_TYPE_LABELS,
  DRIVING_LICENSE_COUNTRY_LABELS
} from '@shared/models/client.model';
import {
  MAX_LOYALTY_DISCOUNT_PERCENT,
  normalizeLoyaltyDiscountPercent
} from '@shared/utils/pricing.util';
import { toDate } from '@shared/utils/reservation-date.util';
import { capitalizeWords, toReference, transformInput } from '@shared/utils/text-case.util';
import { PhotoUploadButtonsComponent } from '@shared/components/photo-upload-buttons/photo-upload-buttons.component';

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, PhotoUploadButtonsComponent],
  templateUrl: './client-form.component.html',
  styleUrl: './client-form.component.scss'
})
export class ClientFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private clientService = inject(ClientService);
  private translateService = inject(TranslateService);

  isEditMode = false;
  clientId: string | null = null;
  loading = false;
  saving = false;

  // Form data
  formData: Client = this.getEmptyForm();
  documents: ClientDocumentFile[] = [];
  selectedDocType: ClientDocumentType_File | null = null;

  // Upload state
  uploadingType: ClientDocumentType_File | null = null;
  uploadError = '';

  readonly maxLoyaltyDiscount = MAX_LOYALTY_DISCOUNT_PERCENT;
  /** Timestamps arrive in several shapes; the template needs a real Date. */
  readonly toDate = toDate;

  /** Blocking a client withdraws the discount, so the field stops being editable. */
  get isBlocked(): boolean {
    return this.formData.trustLevel === 'blocked';
  }

  /** Newest change first: what an operator wants to see is the last decision. */
  get loyaltyHistory(): LoyaltyDiscountChange[] {
    return [...(this.formData.loyaltyDiscountHistory ?? [])].reverse();
  }

  // Options
  documentTypeOptions: ClientDocumentType[] = ['dni', 'nie', 'passport', 'other'];
  trustLevelOptions: ClientTrustLevel[] = ['new', 'known', 'regular', 'risk', 'blocked'];
  countryOptions: DrivingLicenseCountry[] = ['ES', 'RO', 'EU', 'OTHER'];
  fileTypeOptions: ClientDocumentType_File[] = [
    'document_front', 
    'document_back', 
    'driving_license_front', 
    'driving_license_back', 
    'other'
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.isEditMode = true;
      this.clientId = id;
      this.loadClient(id);
    }
  }

  getEmptyForm(): Client {
    return {
      fullName: '',
      phone: '',
      email: '',
      documentType: 'dni',
      documentNumber: '',
      address: '',
      birthDate: null,
      drivingLicenseNumber: '',
      drivingLicenseIssueDate: null,
      drivingLicenseExpiryDate: null,
      drivingLicenseCountry: 'ES',
      trustLevel: 'new',
      loyaltyDiscountPercent: 0,
      notes: ''
    };
  }

  loadClient(id: string): void {
    this.loading = true;
    this.clientService.getClientById(id).subscribe({
      next: (client) => {
        if (!client) {
          this.router.navigate(['/clients']);
          return;
        }
        this.formData = {
          ...this.getEmptyForm(),
          ...client
        };
        this.documents = client.documents || [];
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading client:', error);
        this.loading = false;
        this.router.navigate(['/clients']);
      }
    });
  }

  // Formatters. All three rewrite the field as you type and go through
  // `transformInput()`, which keeps the caret where the operator left it —
  // assigning `input.value` sent it to the end on every keystroke.

  onFullNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Was a private copy that split on spaces only, so "josé-maría" and
    // "o'brien" came out half capitalised. Shared util now.
    this.formData.fullName = transformInput(input, capitalizeWords);
  }

  onDocumentNumberInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.documentNumber = transformInput(input, toReference);
  }

  /**
   * Bound to `(ngModelChange)`, which emits the value — not a DOM Event.
   *
   * Clamping here rather than only in the service means an operator who types
   * 50 sees it snap to the ceiling instead of saving and silently getting 30.
   */
  onLoyaltyDiscountChange(value: unknown): void {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    this.formData.loyaltyDiscountPercent = normalizeLoyaltyDiscountPercent(parsed);
  }

  onLicenseNumberInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.drivingLicenseNumber = transformInput(input, toReference);
  }

  async onSubmit(): Promise<void> {
    if (!this.formData.fullName.trim()) {
      alert('El nombre completo es obligatorio');
      return;
    }

    this.saving = true;
    try {
      if (this.isEditMode && this.clientId) {
        // Update basic data only - documents are managed separately
        const { documents, createdAt, updatedAt, id, ...dataToUpdate } = this.formData as any;
        await this.clientService.updateClient(this.clientId, dataToUpdate);
        this.router.navigate(['/clients', this.clientId]);
      } else {
        const id = await this.clientService.createClient({
          ...this.formData,
          documents: []
        });
        this.router.navigate(['/clients', id]);
      }
    } catch (error) {
      console.error('Error saving client:', error);
      this.saving = false;
    }
  }

  // Documents. The upload control resets its own input, so this only has to
  // decide what to do with the files.
  onDocumentsPicked(files: FileList | null, type: ClientDocumentType_File): void {
    if (!files?.length) return;
    this.onDocumentSelected(files, type);
  }

  async onDocumentSelected(files: FileList | null, type?: ClientDocumentType_File): Promise<void> {
    if (!files?.length) return;
    const file = files[0];

    if (!this.validateDocumentFile(file)) return;

    // Need a saved client before uploading documents
    if (!this.clientId) {
      this.uploadError = 'clients.documents.saveFirst';
      return;
    }

    const docType = type || this.fileTypeOptions[0];
    this.uploadingType = docType;
    this.uploadError = '';

    try {
      const doc = await this.clientService.uploadClientDocument(this.clientId, file, docType);
      this.documents = [...this.documents, doc];
    } catch (error) {
      console.error('Error uploading document:', error);
      this.uploadError = 'clients.documents.uploadError';
    } finally {
      this.uploadingType = null;
    }
  }

  validateDocumentFile(file: File): boolean {
    const validTypes: string[] = [...APP_DEFAULTS.ALLOWED_DOCUMENT_TYPES];
    const maxSize = APP_DEFAULTS.MAX_DOCUMENT_FILE_SIZE;

    if (!validTypes.includes(file.type)) {
      this.uploadError = 'clients.documents.invalidType';
      return false;
    }

    if (file.size > maxSize) {
      this.uploadError = 'clients.documents.maxSizeExceeded';
      return false;
    }

    return true;
  }

  async deleteDocument(doc: ClientDocumentFile): Promise<void> {
    if (!this.clientId) return;

    const confirmed = confirm(this.translateService.translate('clients.documents.confirmDelete'));
    if (!confirmed) return;

    this.uploadError = '';
    try {
      await this.clientService.deleteClientDocument(this.clientId, doc);
      this.documents = this.documents.filter(d => d.path !== doc.path);
    } catch (error) {
      console.error('Error deleting document:', error);
      // Failing silently left the row on screen as if nothing had happened.
      this.uploadError = 'clients.documents.deleteError';
    }
  }

  // Helpers
  isImage(contentType: string | undefined): boolean {
    return contentType?.startsWith('image/') || false;
  }

  formatFileSize(bytes: number | undefined): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Both maps hold i18n keys; the template renders these getters without a
  // `| translate`, so they resolve the key here.
  getFileTypeLabel(type: ClientDocumentType_File): string {
    return this.translateService.translate(CLIENT_FILE_TYPE_LABELS[type]);
  }

  getCountryLabel(country: DrivingLicenseCountry): string {
    return this.translateService.translate(DRIVING_LICENSE_COUNTRY_LABELS[country]);
  }

  goBack(): void {
    if (this.isEditMode && this.clientId) {
      this.router.navigate(['/clients', this.clientId]);
    } else {
      this.router.navigate(['/clients']);
    }
  }
}