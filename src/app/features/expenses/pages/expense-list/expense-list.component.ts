import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { ExpenseService } from '@features/expenses/services/expense.service';
import {
  EXPENSE_CATEGORY_ICONS,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_SCOPE_LABELS,
  ExpenseRow,
  ExpenseScope
} from '@shared/models/expense.model';
import { ExpenseTotals, totalsOf } from '@shared/utils/expense.util';

/**
 * Listado de gastos: lo que sale, frente al módulo de Pagos, que es lo que entra.
 *
 * ⚠️ **Las filas de mantenimiento no se editan aquí.** Vienen de
 * `vehicleMaintenance`, que es donde viven junto al aviso de la próxima
 * revisión, así que la fila lo dice y lleva a su ficha. Si algún día aparece un
 * botón de editar sobre ellas, se habrán creado dos sitios donde cambiar el
 * mismo importe.
 */
@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './expense-list.component.html',
  styleUrl: './expense-list.component.scss'
})
export class ExpenseListComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private translate = inject(TranslateService);
  private router = inject(Router);

  readonly EXPENSE_CATEGORY_ICONS = EXPENSE_CATEGORY_ICONS;

  rows: ExpenseRow[] = [];
  filteredRows: ExpenseRow[] = [];
  totals: ExpenseTotals = totalsOf([]);
  loading = true;
  errored = false;

  searchTerm = '';
  scopeFilter: ExpenseScope | 'all' = 'all';

  readonly scopeOptions: { value: ExpenseScope | 'all'; label: string }[] = [
    { value: 'all', label: 'expenses.filters.allScopes' },
    { value: 'vehicle', label: EXPENSE_SCOPE_LABELS.vehicle },
    { value: 'reservation', label: EXPENSE_SCOPE_LABELS.reservation },
    { value: 'general', label: EXPENSE_SCOPE_LABELS.general }
  ];

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errored = false;
    try {
      this.rows = await this.expenseService.listRows(
        this.scopeFilter === 'all' ? {} : { scope: this.scopeFilter }
      );
      this.applySearch();
    } catch {
      this.errored = true;
      this.rows = [];
      this.filteredRows = [];
      this.totals = totalsOf([]);
    } finally {
      this.loading = false;
    }
  }

  onScopeChange(): void {
    // El ámbito se filtra en la consulta —decide si el mantenimiento entra o
    // no—, así que hay que volver a pedir los datos, no solo filtrar en memoria.
    void this.load();
  }

  /**
   * La búsqueda sí es en memoria, y los totales se recalculan con ella.
   *
   * Es deliberado: si el operador busca «taller», el total que ve tiene que ser
   * el de lo que está mirando. Un total que no corresponde a las filas de la
   * pantalla es la clase de detalle que hace desconfiar de toda la cifra.
   */
  applySearch(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.filteredRows = !term
      ? [...this.rows]
      : this.rows.filter((row) =>
          [row.concept, row.supplier, row.vehiclePlate, this.categoryLabel(row)]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(term))
        );
    this.totals = totalsOf(this.filteredRows);
  }

  categoryLabel(row: ExpenseRow): string {
    return this.translate.translate(EXPENSE_CATEGORY_LABELS[row.category]);
  }

  scopeLabel(row: ExpenseRow): string {
    return this.translate.translate(EXPENSE_SCOPE_LABELS[row.scope]);
  }

  open(row: ExpenseRow): void {
    if (row.origin === 'maintenance') {
      // A su ficha, que es donde se edita. La pestaña de mantenimiento vive
      // dentro del vehículo.
      void this.router.navigate(['/vehicles', row.sourceVehicleId]);
      return;
    }
    void this.router.navigate(['/expenses', row.id, 'edit']);
  }
}
