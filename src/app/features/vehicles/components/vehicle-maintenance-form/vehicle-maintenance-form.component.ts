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
import { FieldProblems, hasProblems } from '@shared/utils/form-problems.util';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
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
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent],
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

  /** Si ya se ha intentado guardar. Hasta entonces no se marca nada en rojo. */
  submitted = false;

  /** Lo que impide guardar el mantenimiento: campo → clave de i18n. */
  get problems(): FieldProblems {
    const problems: FieldProblems = {};
    if (!this.form.title.trim()) {
      problems['title'] = 'maintenance.errors.titleRequired';
    }
    return problems;
  }

  onSubmit(): void {
    // Antes ponía `'Title required'` **en inglés y a pelo**, en una aplicación
    // que se usa en tres idiomas y donde ninguno es ese.
    this.submitted = true;
    if (hasProblems(this.problems)) return;
    this.error.set(null);
    this.submitForm.emit({
      ...this.form,
      // Los kilómetros iban a Firestore como **texto** (`"44200"`), mientras el
      // coste sí era número. Hoy solo se pintan, así que no se nota; pero como
      // texto `"9000"` es mayor que `"44200"`, y hay un índice por
      // `nextDueDate` esperando para ordenar mantenimientos.
      performedAtKm: this.toNumber(this.form.performedAtKm),
      nextDueKm: this.toNumber(this.form.nextDueKm),
      cost: this.toNumber(this.form.cost)
    });
  }

  /** `null` en vez de `NaN` o `''`: un km vacío es ausencia, no cero. */
  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
