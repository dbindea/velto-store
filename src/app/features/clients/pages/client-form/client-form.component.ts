import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { ClientService } from '@features/clients/services/client.service';
import { 
  Client, 
  ClientDocumentType, 
  ClientTrustLevel, 
  DrivingLicenseCountry,
  ClientDocumentFile,
  ClientDocumentType_File,
  CLIENT_FILE_TYPE_LABELS,
  DRIVING_LICENSE_COUNTRY_LABELS
} from '@shared/models/client.model';

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './client-form.component.html',
  styleUrl: './client-form.component.scss'
})
export class ClientFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private clientService = inject(ClientService);

  isEditMode = false;
  clientId: string | null = null;
  loading = false;
  saving = false;

  // Form data
  formData: Client = this.getEmptyForm();
  documents: ClientDocumentFile[] = [];

  // Upload state
  uploadingType: ClientDocumentType_File | null = null;
  uploadError = '';

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

  // Formatters
  onFullNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    // Capitalize each word, keep the rest lowercase
    const formatted = value.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
    this.formData.fullName = formatted;
    input.value = formatted;
  }

  onDocumentNumberInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.documentNumber = input.value.toUpperCase().trim();
    input.value = this.formData.documentNumber;
  }

  onLicenseNumberInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.drivingLicenseNumber = input.value.toUpperCase().trim();
    input.value = this.formData.drivingLicenseNumber;
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

  // Documents
  async onDocumentSelected(event: Event, type: ClientDocumentType_File): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    
    if (!this.validateDocumentFile(file)) {
      input.value = '';
      return;
    }

    // Need a saved client before uploading documents
    if (!this.clientId) {
      this.uploadError = 'Guarda primero el cliente';
      input.value = '';
      return;
    }

    this.uploadingType = type;
    this.uploadError = '';

    try {
      const doc = await this.clientService.uploadClientDocument(this.clientId, file, type);
      this.documents = [...this.documents, doc];
    } catch (error) {
      console.error('Error uploading document:', error);
      this.uploadError = 'Error al subir el documento';
    } finally {
      this.uploadingType = null;
      input.value = '';
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
    
    const confirmed = confirm('¿Eliminar este documento?');
    if (!confirmed) return;

    try {
      await this.clientService.deleteClientDocument(this.clientId, doc);
      this.documents = this.documents.filter(d => d.path !== doc.path);
    } catch (error) {
      console.error('Error deleting document:', error);
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

  getFileTypeLabel(type: ClientDocumentType_File): string {
    return CLIENT_FILE_TYPE_LABELS[type];
  }

  getCountryLabel(country: DrivingLicenseCountry): string {
    return DRIVING_LICENSE_COUNTRY_LABELS[country];
  }

  goBack(): void {
    if (this.isEditMode && this.clientId) {
      this.router.navigate(['/clients', this.clientId]);
    } else {
      this.router.navigate(['/clients']);
    }
  }
}