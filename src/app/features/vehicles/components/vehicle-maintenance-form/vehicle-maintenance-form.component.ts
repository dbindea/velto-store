import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Timestamp } from '@angular/fire/firestore';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import {
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_TYPE_ICONS,
  MAINTENANCE_TYPE_LABELS,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceType,
  VehicleMaintenance
} from '@shared/models/vehicle-maintenance.model';

interface MaintenanceFormData {
  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  title: string;
  description: string;
  performedAtKm: number | null;
  performedAtDate: string; // ISO yyyy-mm-dd
  nextDueKm: number | null;
  nextDueDate: string; // ISO yyyy-mm-dd
  cost: number | null;
  provider: string;
  notes: string;
  invoiceUrl: string;
  invoicePath: string;
}

/**
 * Reusable maintenance create/edit form.
 *
 * Standalone: emits the typed payload on submit; the parent
 * (vehicle-detail tab) decides what to do with it.  File upload is
 * handled by the parent too — this component only collects the
 * already-uploaded URL/path as plain inputs.
 */
@Component({
  selector: 'app-vehicle-maintenance-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './vehicle-maintenance-form.component.html',
  styleUrl: './vehicle-maintenance-form.component.scss'
})
export class VehicleMaintenanceFormComponent implements OnChanges {
  @Input() vehicleId!: string;
  @Input() vehicleSnapshot: VehicleMaintenance['vehicleSnapshot'];
  @Input() initial: VehicleMaintenance | null = null;
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() prefillCompleted = false; // when "complete" button is pressed
  @Input() saving = false;
  @Input() invoiceUrl: string | null = null;
  @Input() invoicePath: string | null = null;

  @Output() submitForm = new EventEmitter<MaintenanceFormData>();
  @Output() cancel = new EventEmitter<void>();
  @Output() invoiceSelected = new EventEmitter<File>();

  typeOptions: { value: MaintenanceType; label: string; icon: string }[] = (
    Object.keys(MAINTENANCE_TYPE_LABELS) as MaintenanceType[]
  ).map((t) => ({ value: t, label: MAINTENANCE_TYPE_LABELS[t], icon: MAINTENANCE_TYPE_ICONS[t] }));

  statusOptions: { value: MaintenanceStatus; label: string }[] = (
    Object.keys(MAINTENANCE_STATUS_LABELS) as MaintenanceStatus[]
  ).map((s) => ({ value: s, label: MAINTENANCE_STATUS_LABELS[s] }));

  priorityOptions: { value: MaintenancePriority; label: string }[] = (
    Object.keys(MAINTENANCE_PRIORITY_LABELS) as MaintenancePriority[]
  ).map((p) => ({ value: p, label: MAINTENANCE_PRIORITY_LABELS[p] }));

  form: MaintenanceFormData = this.empty();
  error = signal<string | null>(null);

  ngOnChanges(_: SimpleChanges): void {
    if (this.initial) {
      this.form = {
        type: this.initial.type,
        status: this.initial.status,
        priority: this.initial.priority,
        title: this.initial.title,
        description: this.initial.description || '',
        performedAtKm: this.initial.performedAtKm ?? null,
        performedAtDate: this.toDateInput(this.initial.performedAtDate),
        nextDueKm: this.initial.nextDueKm ?? null,
        nextDueDate: this.toDateInput(this.initial.nextDueDate),
        cost: this.initial.cost ?? null,
        provider: this.initial.provider || '',
        notes: this.initial.notes || '',
        invoiceUrl: this.invoiceUrl || this.initial.invoiceUrl || '',
        invoicePath: this.invoicePath || this.initial.invoicePath || ''
      };
    } else if (this.prefillCompleted) {
      this.form.status = 'completed';
      this.form.performedAtDate = this.toDateInput(new Date());
    }
  }

  private empty(): MaintenanceFormData {
    return {
      type: 'oil_change',
      status: 'scheduled',
      priority: 'medium',
      title: '',
      description: '',
      performedAtKm: null,
      performedAtDate: '',
      nextDueKm: null,
      nextDueDate: '',
      cost: null,
      provider: '',
      notes: '',
      invoiceUrl: '',
      invoicePath: ''
    };
  }

  private toDateInput(value: any): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (value instanceof Timestamp) return value.toDate().toISOString().slice(0, 10);
    if (typeof value === 'string') return value.slice(0, 10);
    return '';
  }

  onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.invoiceSelected.emit(input.files[0]);
    }
  }

  onSubmit(): void {
    if (!this.form.title.trim()) {
      this.error.set('Title required');
      return;
    }
    this.error.set(null);
    this.submitForm.emit(this.form);
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
