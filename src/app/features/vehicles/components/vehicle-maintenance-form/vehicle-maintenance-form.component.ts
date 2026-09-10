import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  inject,
  signal
} from '@angular/core';
import { FormDraftService } from '@core/forms/form-draft.service';
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
 * Lo que SALE del formulario, que no es lo mismo que lo que hay dentro.
 *
 * ⚠️ **Dentro las fechas son texto porque lo exige `<input type="date">`; fuera
 * tienen que ser fechas.** Mientras el tipo de salida fue el mismo que el de
 * dentro, la cadena `"2026-09-11"` llegaba tal cual a Firestore y la ITV
 * programada no aparecía en ningún sitio: el panel la descartaba y la consulta
 * de próximos vencimientos, que compara contra un `Timestamp`, no casaba nunca.
 *
 * Separar los dos tipos es lo que impide que vuelva a pasar en silencio: ahora
 * el compilador exige la conversión.
 */
export type MaintenanceSubmitData = Omit<
  MaintenanceFormData,
  'performedAtDate' | 'nextDueDate'
> & {
  performedAtDate: Date | null;
  nextDueDate: Date | null;
};

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
export class VehicleMaintenanceFormComponent implements OnChanges, OnInit {
  @Input() vehicleId!: string;
  @Input() vehicleSnapshot: VehicleMaintenance['vehicleSnapshot'];
  @Input() initial: VehicleMaintenance | null = null;
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() prefillCompleted = false; // when "complete" button is pressed
  @Input() saving = false;
  @Input() invoiceUrl: string | null = null;
  @Input() invoicePath: string | null = null;

  @Output() submitForm = new EventEmitter<MaintenanceSubmitData>();
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

  private drafts = inject(FormDraftService);
  private destroyRef = inject(DestroyRef);
  /** Borrador vivo; se limpia al guardar. */
  private draft: { clear: () => void } | null = null;

  /**
   * ⚠️ En `ngOnInit`, que corre **después** del primer `ngOnChanges`.
   *
   * Así el borrador manda sobre lo que traen los `@Input`: si el móvil se llevó
   * la pestaña al abrir la cámara para fotografiar la factura del taller, lo
   * que el operador llevaba tecleado es más reciente que lo guardado.
   */
  ngOnInit(): void {
    this.draft = this.drafts.attach<MaintenanceFormData>(
      `maintenance:${this.vehicleId}:${this.initial?.id ?? 'new'}`,
      () => this.form,
      (guardado) => {
        this.form = { ...this.form, ...guardado };
      },
      this.destroyRef
    );
  }

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
      cost: this.toNumber(this.form.cost),
      /**
       * ⚠️ **Y las fechas, igual: un `<input type="date">` da TEXTO.**
       *
       * Es el mismo fallo que los kilómetros de arriba, pero este sí se notaba:
       * `nextDueDate` llegaba a Firestore como `"2026-09-11"` y **la ITV
       * programada no aparecía en ninguna parte**. El panel la descartaba
       * —su conversor devuelve `null` ante una cadena— y
       * `getUpcomingMaintenance()` la comparaba contra un `Timestamp`, cosa que
       * en Firestore **nunca casa**: los tipos distintos no se comparan, se
       * ordenan por tipo. La consulta devolvía vacío siempre.
       *
       * Era exactamente la queja de Dorel del 8 de septiembre de 2026 —«se
       * puede programar ITV en 7 días y no hay ningún sitio donde eso
       * aparezca»—, y no era que faltara la pantalla: era el tipo del dato.
       */
      nextDueDate: this.toFecha(this.form.nextDueDate),
      performedAtDate: this.toFecha(this.form.performedAtDate)
    });
    // Entregado al padre, que lo guarda: el borrador ya no protege nada, y
    // restaurarlo la próxima vez sería resucitar un formulario ya archivado.
    this.draft?.clear();
  }

  /**
   * `yyyy-mm-dd` del formulario → `Date`, o `null` si está vacío.
   *
   * ⚠️ **Se construye a mediodía UTC a propósito.** `new Date('2026-09-11')` es
   * medianoche UTC, que en Madrid ya es el día 11 pero en cuanto el huso vaya al
   * otro lado del meridiano sería el 10: una ITV del día 11 guardada como «día
   * 10 a las 23:00». A mediodía no hay huso que cambie la fecha.
   *
   * ⚠️ Y `null`, no `undefined`: un mantenimiento sin próxima revisión es lo más
   * normal que hay —un cambio de aceite que se paga y se olvida—, y `undefined`
   * está prohibido en Firestore.
   */
  private toFecha(value: string): Date | null {
    if (!value) return null;
    const d = new Date(`${value}T12:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
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
