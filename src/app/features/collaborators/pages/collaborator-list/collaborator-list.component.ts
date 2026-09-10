import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
import { NotificationService } from '@core/notifications/notification.service';
import { ConfirmService } from '@core/notifications/confirm.service';
import { CollaboratorService } from '@features/collaborators/services/collaborator.service';
import {
  Collaborator,
  CollaboratorBalance,
  CollaboratorSale
} from '@shared/models/collaborator.model';
import { balanceOf, validateCollaborator } from '@shared/utils/collaborator.util';
import { FieldProblems, hasProblems } from '@shared/utils/form-problems.util';

/**
 * Los colaboradores y lo que se les debe.
 *
 * ⚠️ **La cifra que manda es la deuda, no el nombre.** Esta pantalla se abre
 * para responder «¿a quién le debo dinero?», así que el pendiente va en grande y
 * los que no tienen nada pendiente no lo enseñan: un cero repetido veinte veces
 * esconde el único número que importaba.
 */
@Component({
  selector: 'app-collaborator-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent],
  templateUrl: './collaborator-list.component.html',
  styleUrl: './collaborator-list.component.scss'
})
export class CollaboratorListComponent implements OnInit {
  private service = inject(CollaboratorService);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  private confirm = inject(ConfirmService);

  readonly loading = signal(true);
  readonly collaborators = signal<Collaborator[]>([]);
  private sales: CollaboratorSale[] = [];

  // --- Formulario ----------------------------------------------------------
  readonly showForm = signal(false);
  readonly saving = signal(false);
  /**
   * Nada se marca en rojo hasta el primer intento: señalar un campo que aún no
   * se ha tenido ocasión de rellenar es regañar por no haber terminado.
   */
  readonly submitted = signal(false);
  editing: Collaborator | null = null;
  form: Partial<Collaborator> = this.emptyForm();
  problems: FieldProblems = {};

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [fichas, ventas] = await Promise.all([this.service.list(), this.service.allSales()]);
      this.collaborators.set(fichas);
      this.sales = ventas;
    } catch {
      this.notifications.error('collaborators.errors.loadFailed', {
        retry: () => void this.load()
      });
    } finally {
      this.loading.set(false);
    }
  }

  balance(id?: string): CollaboratorBalance {
    return balanceOf(this.sales.filter((s) => s.collaboratorId === id));
  }

  /** Lo que se debe en total, que es la pregunta con la que se abre esto. */
  get totalPending(): number {
    return balanceOf(this.sales).pending;
  }

  open(c: Collaborator): void {
    void this.router.navigate(['/collaborators', c.id]);
  }

  // --- Alta y edición ------------------------------------------------------

  private emptyForm(): Partial<Collaborator> {
    // 25 % es el ejemplo que usa Dorel y el valor con el que se trabaja: como
    // valor de partida ahorra teclear lo de siempre, y se cambia si toca.
    return { name: '', commissionPercent: 25, active: true };
  }

  newCollaborator(): void {
    this.editing = null;
    this.form = this.emptyForm();
    this.problems = {};
    this.submitted.set(false);
    this.showForm.set(true);
  }

  edit(c: Collaborator, event: Event): void {
    event.stopPropagation();
    this.editing = c;
    this.form = { ...c };
    this.problems = {};
    this.submitted.set(false);
    this.showForm.set(true);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editing = null;
  }

  /**
   * ⚠️ **El botón no se apaga por datos que falten**, solo mientras guarda. Al
   * pulsarlo con algo incompleto se marca el campo y se explica debajo: un botón
   * apagado sin explicación deja pulsando sin que pase nada.
   */
  async save(): Promise<void> {
    this.submitted.set(true);
    this.problems = validateCollaborator(this.form);
    if (hasProblems(this.problems)) return;

    this.saving.set(true);
    try {
      await this.service.save(this.form, this.editing?.id);
      this.notifications.success('collaborators.saved');
      this.showForm.set(false);
      this.editing = null;
      await this.load();
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(c: Collaborator, event: Event): Promise<void> {
    event.stopPropagation();
    const ok = await this.confirm.ask({
      title: 'collaborators.confirmDelete.title',
      message: 'collaborators.confirmDelete.message',
      danger: true
    });
    if (!ok) return;
    try {
      await this.service.delete(c.id!);
      this.notifications.success('collaborators.deleted');
      await this.load();
    } catch (err) {
      this.notifications.error(this.errorKeyOf(err));
    }
  }

  /**
   * Lo que rechaza el servicio viaja como **clave i18n**, nunca como frase.
   *
   * La lista es explícita: `TranslateService.translate()` devuelve la propia
   * clave cuando no la encuentra, así que una desconocida saldría en crudo en
   * pantalla. Con la lista, lo que no se reconoce cae en un mensaje que existe.
   */
  private errorKeyOf(err: unknown): string {
    const conocidas = [
      'collaborators.problems.nameRequired',
      'collaborators.problems.percentRequired',
      'collaborators.problems.percentTooHigh',
      'collaborators.problems.emailInvalid',
      'collaborators.problems.hasSales'
    ];
    const msg = typeof (err as { message?: unknown })?.message === 'string'
      ? (err as { message: string }).message
      : '';
    return conocidas.includes(msg) ? msg : 'collaborators.errors.saveFailed';
  }
}
