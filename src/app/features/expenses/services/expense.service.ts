import { Injectable, inject } from '@angular/core';
import {
  CollectionReference,
  Firestore,
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from '@angular/fire/firestore';
import { Storage, deleteObject, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';
import { Expense, ExpenseRow, ExpenseScope } from '@shared/models/expense.model';
import { VehicleMaintenance } from '@shared/models/vehicle-maintenance.model';
import { buildExpenseRows, validateExpense } from '@shared/utils/expense.util';
import { firstProblem } from '@shared/utils/form-problems.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { PermissionsService } from '@core/auth/permissions.service';

export interface ExpenseFilters {
  scope?: ExpenseScope;
  vehicleId?: string;
  reservationId?: string;
  /** Ambas inclusive; se aplican en memoria, ver la nota de `listRows()`. */
  from?: Date;
  to?: Date;
}

/**
 * CRUD de `expenses` y la lectura del coste de mantenimiento.
 *
 * ⚠️ **Este servicio no escribe nunca en `vehicleMaintenance`.** Lo lee para
 * sumarlo. Una reparación se registra en su ficha, que es donde además vive el
 * aviso de la próxima revisión; duplicarla aquí daría dos fuentes de verdad para
 * el mismo euro. Es la misma regla que sostiene que `payments` sea la única
 * fuente del dinero que entra.
 */
@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private firestore = inject(Firestore);
  private permissions = inject(PermissionsService);
  private storage = inject(Storage);
  private expensesRef: CollectionReference;
  private maintenanceRef: CollectionReference;

  constructor() {
    this.expensesRef = collection(this.firestore, 'expenses');
    this.maintenanceRef = collection(this.firestore, 'vehicleMaintenance');
  }

  /** `cleanForFirestore` deja intactos los centinelas; ver CLAUDE.md. */
  private clean<T extends object>(data: T): Partial<T> {
    return cleanForFirestore(data, { stripNulls: true });
  }

  async getExpenses(filters: ExpenseFilters = {}): Promise<Expense[]> {
    const clauses = [];
    if (filters.scope) clauses.push(where('scope', '==', filters.scope));
    if (filters.vehicleId) clauses.push(where('vehicleId', '==', filters.vehicleId));
    if (filters.reservationId) clauses.push(where('reservationId', '==', filters.reservationId));

    const q = query(this.expensesRef, ...clauses, orderBy('date', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Expense);
  }

  async getExpenseById(id: string): Promise<Expense | null> {
    const snap = await getDoc(doc(this.firestore, `expenses/${id}`));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Expense) : null;
  }

  /**
   * El mantenimiento **ya realizado**, que es el único que ha costado dinero.
   *
   * No se ordena en la consulta a propósito: `status == 'completed'` con un
   * `orderBy` de otro campo exigiría un índice compuesto más, y estas listas se
   * cuentan por decenas. El orden lo pone `buildExpenseRows`, que además tiene
   * que mezclar las dos fuentes.
   */
  async getCompletedMaintenance(vehicleId?: string): Promise<VehicleMaintenance[]> {
    const clauses = [where('status', '==', 'completed')];
    if (vehicleId) clauses.push(where('vehicleId', '==', vehicleId));
    const snap = await getDocs(query(this.maintenanceRef, ...clauses));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VehicleMaintenance);
  }

  /**
   * La lista que ve el operador: gastos propios y costes de mantenimiento.
   *
   * El filtro por fechas se aplica **en memoria** y no en la consulta. Añadirlo
   * a Firestore obligaría a un rango sobre `date` combinado con las igualdades
   * de arriba —otro índice compuesto por cada combinación— y dejaría fuera al
   * mantenimiento, cuya fecha vive en otro campo. Con este volumen no compensa;
   * el día que compense, el sitio para cambiarlo es este.
   */
  async listRows(filters: ExpenseFilters = {}): Promise<ExpenseRow[]> {
    const expenses = await this.getExpenses(filters);

    // El mantenimiento solo cuenta cuando la vista incluye gastos de vehículo:
    // filtrando por reserva o por gastos generales, una reparación no pinta
    // nada y sumarla haría que el total no cuadrase con lo que se está mirando.
    const includeMaintenance =
      !filters.reservationId && (!filters.scope || filters.scope === 'vehicle');
    const maintenance = includeMaintenance
      ? await this.getCompletedMaintenance(filters.vehicleId)
      : [];

    const rows = buildExpenseRows(expenses, maintenance);
    return rows.filter((row) => this.withinRange(row, filters));
  }

  private withinRange(row: ExpenseRow, filters: ExpenseFilters): boolean {
    if (!filters.from && !filters.to) return true;
    // Sin fecha no se puede afirmar que caiga dentro del rango, así que queda
    // fuera: es preferible echar de menos una fila a inflar un total.
    if (!row.date) return false;
    if (filters.from && row.date < filters.from) return false;
    if (filters.to && row.date > filters.to) return false;
    return true;
  }

  /**
   * Crea el gasto.
   *
   * Valida aquí además de en la pantalla: la UI deshabilita el botón y el
   * servicio rechaza igualmente. Es la misma defensa en profundidad que aplica
   * el workflow a las reservas.
   */
  async createExpense(data: Omit<Expense, 'id'>): Promise<string> {
    const problem = firstProblem(validateExpense(data));
    if (problem) throw new Error(problem);

    const payload = this.clean({
      ...data,
      date: this.toTimestamp(data.date),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    const created = await addDoc(this.expensesRef, payload);
    return created.id;
  }

  async updateExpense(id: string, data: Partial<Expense>): Promise<void> {
    const payload = this.clean({
      ...data,
      ...(data.date ? { date: this.toTimestamp(data.date) } : {}),
      updatedAt: serverTimestamp()
    });
    await updateDoc(doc(this.firestore, `expenses/${id}`), payload);
  }

  /** Borra el gasto **y su factura**: un fichero huérfano en Storage no se ve. */
  async deleteExpense(id: string): Promise<void> {
    // Defensa en profundidad: la UI esconde el botón y esto rechaza la
    // llamada igualmente. Cualquier camino que no pase por ese botón se
    // saltaría el permiso.
    if (!this.permissions.can('deleteRecords')) {
      throw new Error('permissions.notAllowed');
    }
    const expense = await this.getExpenseById(id);
    if (expense?.documentPath) {
      try {
        await deleteObject(ref(this.storage, expense.documentPath));
      } catch {
        // Ya no estaba: no es motivo para dejar el gasto sin borrar.
      }
    }
    await deleteDoc(doc(this.firestore, `expenses/${id}`));
  }

  /** La factura o el ticket, en `expenses/{expenseId}/{ts}-{fichero}`. */
  async uploadDocument(expenseId: string, file: File): Promise<{ path: string; url: string }> {
    if (file.size > APP_DEFAULTS.MAX_DOCUMENT_FILE_SIZE) {
      throw new Error('expenses.errors.fileTooLarge');
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `expenses/${expenseId}/${Date.now()}-${safeName}`;
    const fileRef = ref(this.storage, path);
    await uploadBytes(fileRef, file, { contentType: file.type || 'application/octet-stream' });
    return { path, url: await getDownloadURL(fileRef) };
  }

  private toTimestamp(value: any): Timestamp | any {
    if (!value) return value;
    if (value instanceof Timestamp) return value;
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? value : Timestamp.fromDate(date);
  }
}
