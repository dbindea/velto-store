import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { AuthService } from '@core/auth/auth.service';
import { ExpenseService } from '@features/expenses/services/expense.service';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import { ReservationService } from '@features/reservations/services/reservation.service';
import { Vehicle } from '@shared/models/vehicle.model';
import { Reservation } from '@shared/models/reservation.model';
import {
  EXPENSE_CATEGORIES_BY_SCOPE,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_PAYMENT_METHOD_LABELS,
  EXPENSE_SCOPE_LABELS,
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
  ExpenseScope
} from '@shared/models/expense.model';
import {
  EXPENSE_VAT_RATES,
  defaultVatRateFor,
  extractVatFromGross,
  toDate,
  validateExpense
} from '@shared/utils/expense.util';
import {
  FieldProblems,
  hasProblems,
  problemKeys
} from '@shared/utils/form-problems.util';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
import { PermissionsService } from '@core/auth/permissions.service';

/**
 * Alta y edición de un gasto.
 *
 * ⚠️ **Se teclea el TOTAL de la factura y la base se deduce.** Es al revés que
 * en el alquiler, donde lo que se escribe es el neto y el IVA se suma encima.
 * La razón es práctica: del ticket que tienes en la mano el número que se lee es
 * el total. El desglose se enseña debajo en vivo para que se pueda contrastar
 * con la factura antes de guardar.
 */
@Component({
  selector: 'app-expense-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent],
  templateUrl: './expense-form.component.html',
  styleUrl: './expense-form.component.scss'
})
export class ExpenseFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private expenseService = inject(ExpenseService);
  private vehicleService = inject(VehicleService);
  private reservationService = inject(ReservationService);
  private translate = inject(TranslateService);
  private auth = inject(AuthService);
  /** Público: las plantillas preguntan qué permite el rol. */
  permissions = inject(PermissionsService);

  readonly vatRates = EXPENSE_VAT_RATES;
  readonly scopeOptions: { value: ExpenseScope; label: string }[] = [
    { value: 'vehicle', label: EXPENSE_SCOPE_LABELS.vehicle },
    { value: 'reservation', label: EXPENSE_SCOPE_LABELS.reservation },
    { value: 'general', label: EXPENSE_SCOPE_LABELS.general }
  ];
  readonly methodOptions: { value: ExpensePaymentMethod; label: string }[] = [
    { value: 'card', label: EXPENSE_PAYMENT_METHOD_LABELS.card },
    { value: 'bank_transfer', label: EXPENSE_PAYMENT_METHOD_LABELS.bank_transfer },
    { value: 'direct_debit', label: EXPENSE_PAYMENT_METHOD_LABELS.direct_debit },
    { value: 'cash', label: EXPENSE_PAYMENT_METHOD_LABELS.cash },
    { value: 'other', label: EXPENSE_PAYMENT_METHOD_LABELS.other }
  ];

  expenseId: string | null = null;
  loading = true;
  saving = false;
  errorKey = '';

  /**
   * Si ya se ha intentado guardar. Hasta entonces nada se pinta en rojo: marcar
   * un campo que el operador todavía no ha tenido ocasión de rellenar es
   * regañarle por no haber terminado.
   */
  submitted = false;

  /**
   * Lo que impide guardar, campo a campo.
   *
   * Se recalcula en cada pintado, así que el rojo desaparece en cuanto se
   * corrige, sin volver a pulsar. Es la **misma** función que llama el servicio.
   */
  get problems(): FieldProblems {
    return validateExpense(this.currentPayload());
  }

  get problemList(): string[] {
    return problemKeys(this.problems);
  }

  vehicles: Vehicle[] = [];
  reservations: Reservation[] = [];

  scope: ExpenseScope = 'vehicle';
  vehicleId = '';
  reservationId = '';
  category: ExpenseCategory = 'repair';
  concept = '';
  /** El TOTAL de la factura, con IVA. */
  amount: number | null = null;
  vatRate = 0.21;
  date = new Date().toISOString().slice(0, 10);
  supplier = '';
  invoiceNumber = '';
  paymentMethod: ExpensePaymentMethod = 'card';
  notes = '';

  documentUrl = '';
  documentPath = '';
  uploading = false;
  pendingFile: File | null = null;

  async ngOnInit(): Promise<void> {
    this.expenseId = this.route.snapshot.paramMap.get('id');
    try {
      this.vehicles = await firstValueFrom(this.vehicleService.getVehicles());
      this.reservations = await firstValueFrom(this.reservationService.getReservations());
      if (this.expenseId) await this.loadExpense(this.expenseId);
    } catch {
      this.errorKey = 'expenses.errors.loadFailed';
    } finally {
      this.loading = false;
    }
  }

  private async loadExpense(id: string): Promise<void> {
    const expense = await this.expenseService.getExpenseById(id);
    if (!expense) {
      this.errorKey = 'expenses.errors.notFound';
      return;
    }
    this.scope = expense.scope;
    this.vehicleId = expense.vehicleId || '';
    this.reservationId = expense.reservationId || '';
    this.category = expense.category;
    this.concept = expense.concept;
    this.amount = expense.amount;
    this.vatRate = expense.vatRate;
    const d = toDate(expense.date);
    if (d) this.date = d.toISOString().slice(0, 10);
    this.supplier = expense.supplier || '';
    this.invoiceNumber = expense.invoiceNumber || '';
    this.paymentMethod = expense.paymentMethod || 'card';
    this.notes = expense.notes || '';
    this.documentUrl = expense.documentUrl || '';
    this.documentPath = expense.documentPath || '';
  }

  get categories(): ExpenseCategory[] {
    return EXPENSE_CATEGORIES_BY_SCOPE[this.scope];
  }

  categoryLabel(category: ExpenseCategory): string {
    return this.translate.translate(EXPENSE_CATEGORY_LABELS[category]);
  }

  /** El desglose que se enseña debajo del importe, en vivo. */
  get split() {
    return extractVatFromGross(this.amount || 0, this.vatRate);
  }

  onScopeChange(): void {
    // La lista de categorías cambia con el ámbito: si la elegida ya no está,
    // se cae a la primera de las nuevas en vez de quedarse en una que el
    // desplegable ya no ofrece.
    if (!this.categories.includes(this.category)) {
      this.category = this.categories[0];
    }
    if (this.scope !== 'vehicle') this.vehicleId = '';
    if (this.scope !== 'reservation') this.reservationId = '';
    this.onCategoryChange();
  }

  /**
   * Una multa no lleva IVA, así que al elegirla el tipo se pone a 0.
   *
   * Se propone, no se impone: el campo sigue siendo editable. Es la misma idea
   * que el aviso de kilómetros de M-34 — la aplicación sugiere, el operador
   * decide.
   */
  onCategoryChange(): void {
    this.vatRate = defaultVatRateFor(this.category);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pendingFile = input.files?.[0] || null;
  }

  reservationLabel(reservation: Reservation): string {
    const locator = `R-${(reservation.id || '').slice(0, 6).toUpperCase()}`;
    return `${locator} · ${reservation.vehicleSnapshot?.plateNumber || ''} · ${
      reservation.clientSnapshot?.fullName || ''
    }`;
  }

  /**
   * El gasto tal y como está el formulario ahora mismo.
   *
   * Se construye aquí y no dentro de `save()` para que la validación que pinta
   * la pantalla y la que corre al guardar miren **exactamente lo mismo**. Si
   * cada una montara su objeto, acabarían discrepando en algún campo y el rojo
   * dejaría de corresponderse con lo que rechaza el servicio.
   */
  private currentPayload(): Omit<Expense, 'id'> {
    const split = this.split;
    const vehicle = this.vehicles.find((v) => v.id === this.vehicleId);
    const reservation = this.reservations.find((r) => r.id === this.reservationId);

    return {
      scope: this.scope,
      category: this.category,
      concept: this.concept.trim(),
      amount: split.gross,
      netAmount: split.net,
      vatAmount: split.vat,
      vatRate: split.rate,
      date: new Date(`${this.date}T12:00:00`),
      supplier: this.supplier.trim() || undefined,
      invoiceNumber: this.invoiceNumber.trim() || undefined,
      paymentMethod: this.paymentMethod,
      notes: this.notes.trim() || undefined,
      documentUrl: this.documentUrl || undefined,
      documentPath: this.documentPath || undefined,
      createdBy: this.auth.authorizedUser()?.email || undefined,
      ...(this.scope === 'vehicle' && vehicle
        ? {
            vehicleId: vehicle.id,
            // Congelado: un gasto de 2026 no puede cambiar de matrícula porque
            // el coche se venda o se corrija su ficha.
            vehicleSnapshot: {
              brand: vehicle.brand,
              model: vehicle.model,
              plateNumber: vehicle.plateNumber
            }
          }
        : {}),
      ...(this.scope === 'reservation' && reservation
        ? {
            reservationId: reservation.id,
            reservationSnapshot: {
              locator: `R-${(reservation.id || '').slice(0, 6).toUpperCase()}`,
              plateNumber: reservation.vehicleSnapshot?.plateNumber,
              clientName: reservation.clientSnapshot?.fullName
            }
          }
        : {})
    };
  }

  async save(): Promise<void> {
    if (this.saving) return;
    this.errorKey = '';

    const payload = this.currentPayload();

    // El botón se pulsa siempre; aquí se decide enseñar lo que falta. La misma
    // función la vuelve a llamar el servicio antes de escribir.
    this.submitted = true;
    if (hasProblems(validateExpense(payload))) return;

    this.saving = true;
    try {
      const id = this.expenseId
        ? (await this.expenseService.updateExpense(this.expenseId, payload), this.expenseId)
        : await this.expenseService.createExpense(payload);

      // La factura se sube DESPUÉS de tener id: la ruta de Storage lo lleva
      // dentro, y sin él el fichero no tendría dónde colgar.
      if (this.pendingFile) {
        this.uploading = true;
        const uploaded = await this.expenseService.uploadDocument(id, this.pendingFile);
        await this.expenseService.updateExpense(id, {
          documentUrl: uploaded.url,
          documentPath: uploaded.path
        });
      }

      void this.router.navigate(['/expenses']);
    } catch (err) {
      this.errorKey = (err as Error).message || 'expenses.errors.saveFailed';
    } finally {
      this.saving = false;
      this.uploading = false;
    }
  }

  async remove(): Promise<void> {
    if (!this.expenseId) return;
    if (!confirm(this.translate.translate('expenses.confirmDelete'))) return;
    this.saving = true;
    try {
      await this.expenseService.deleteExpense(this.expenseId);
      void this.router.navigate(['/expenses']);
    } catch {
      this.errorKey = 'expenses.errors.deleteFailed';
    } finally {
      this.saving = false;
    }
  }

  cancel(): void {
    void this.router.navigate(['/expenses']);
  }
}
