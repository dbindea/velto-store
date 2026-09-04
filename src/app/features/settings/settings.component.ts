import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { AuthService } from '@core/auth/auth.service';
import { SettingsService } from '@features/settings/services/settings.service';
import { AuthorizedUserService } from '@features/settings/services/authorized-user.service';
import { AuthorizedUser } from '@shared/models/authorized-user.model';
import {
  DEFAULT_OPERATION_SETTINGS,
  OperationSettings
} from '@shared/models/settings.model';
import { validateSettings } from '@shared/utils/settings.util';
import {
  FieldProblems,
  hasProblems,
  problemKeys
} from '@shared/utils/form-problems.util';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
import {
  USER_ROLES,
  USER_ROLE_DESCRIPTIONS,
  USER_ROLE_LABELS,
  UserRole,
  permissionsOf
} from '@shared/utils/permissions.util';

type Tab = 'operation' | 'users';

/**
 * Ajustes: valores por defecto de la operación y quién puede entrar.
 *
 * Solo entra un administrador — lo comprueba el guard de ruta y lo vuelve a
 * comprobar `firestore.rules`, que es lo que de verdad lo impide.
 *
 * ⚠️ **Lo que se cambia aquí rige para lo que se cree a partir de ahora.** Ni el
 * IVA ni la fianza ni la caducidad de un enlace ya emitido se mueven. La
 * pantalla lo dice, porque es la duda razonable de cualquiera que toque un tipo
 * de IVA en una aplicación que ya ha firmado contratos.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  private settingsService = inject(SettingsService);
  private usersService = inject(AuthorizedUserService);
  private translate = inject(TranslateService);
  private auth = inject(AuthService);

  readonly roles = USER_ROLES;
  readonly USER_ROLE_LABELS = USER_ROLE_LABELS;
  readonly USER_ROLE_DESCRIPTIONS = USER_ROLE_DESCRIPTIONS;

  readonly tab = signal<Tab>('operation');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorKey = signal('');
  readonly savedMessage = signal('');

  /**
   * Si ya se ha intentado guardar.
   *
   * Nada se marca en rojo hasta que vale `true`: señalar un campo que el
   * operador todavía no ha tenido ocasión de rellenar es regañarle por no haber
   * terminado de escribir.
   */
  readonly submitted = signal(false);
  readonly userSubmitted = signal(false);

  /** Copia editable: no se toca la del servicio hasta que se guarda. */
  form: OperationSettings = { ...DEFAULT_OPERATION_SETTINGS };

  /** El IVA se edita en porcentaje y se guarda en fracción. */
  vatPercent = 21;

  users = signal<AuthorizedUser[]>([]);
  newEmail = '';
  newName = '';
  newRole: UserRole = 'employee';

  readonly currentEmail = computed(() =>
    (this.auth.authorizedUser()?.email || '').toLowerCase()
  );

  async ngOnInit(): Promise<void> {
    try {
      this.form = { ...(await this.settingsService.load(true)) };
      this.vatPercent = Math.round(this.form.vatRate * 10000) / 100;
      await this.loadUsers();
    } catch {
      this.errorKey.set('settings.errors.loadFailed');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadUsers(): Promise<void> {
    this.users.set(await this.usersService.getUsers());
  }

  select(tab: Tab): void {
    this.tab.set(tab);
    this.errorKey.set('');
    this.savedMessage.set('');
  }

  permissionsFor(role: UserRole | undefined): number {
    return permissionsOf(role).length;
  }

  // ---------------------------------------------------------------------------
  // Operación
  // ---------------------------------------------------------------------------

  /**
   * Lo que impide guardar los ajustes, campo a campo.
   *
   * Se recalcula en cada pintado en vez de guardarse: así el rojo desaparece en
   * cuanto el operador corrige, sin tener que volver a pulsar para enterarse de
   * que ya está bien.
   */
  get operationProblems(): FieldProblems {
    return validateSettings({
      ...this.form,
      vatRate: Math.round(this.vatPercent * 100) / 10000
    });
  }

  get operationProblemList(): string[] {
    return problemKeys(this.operationProblems);
  }

  async saveOperation(): Promise<void> {
    if (this.saving()) return;
    this.errorKey.set('');
    this.savedMessage.set('');

    // El porcentaje que se teclea vuelve a fracción aquí, en un solo sitio: es
    // la conversión que ya confundió a este proyecto una vez, con el descuento
    // de fidelidad (porcentaje) y el IVA (fracción) conviviendo.
    const settings: OperationSettings = {
      ...this.form,
      vatRate: Math.round(this.vatPercent * 100) / 10000
    };

    // ⚠️ El botón NO está deshabilitado por esto: se pulsa siempre y es aquí
    // donde se decide enseñar lo que falta. Un botón que no hace nada y no dice
    // por qué es el fallo que esto viene a arreglar.
    this.submitted.set(true);
    if (hasProblems(validateSettings(settings))) return;

    this.saving.set(true);
    try {
      await this.settingsService.save(settings, this.currentEmail());
      this.form = { ...settings };
      this.savedMessage.set('settings.saved');
    } catch (err) {
      this.errorKey.set((err as Error).message || 'settings.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Usuarios
  // ---------------------------------------------------------------------------

  /**
   * Lo que impide dar acceso a alguien.
   *
   * El correo es lo único obligatorio, pero también es lo único que no se puede
   * inventar: es el **id del documento**, así que un correo mal escrito da de
   * alta a una persona que después no puede entrar y nadie sabe por qué.
   */
  get userProblems(): FieldProblems {
    const problems: FieldProblems = {};
    const email = this.newEmail.trim();
    if (!email) {
      problems['email'] = 'settings.errors.emailRequired';
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      problems['email'] = 'settings.errors.emailInvalid';
    }
    return problems;
  }

  get userProblemList(): string[] {
    return problemKeys(this.userProblems);
  }

  async addUser(): Promise<void> {
    if (this.saving()) return;
    this.errorKey.set('');
    this.savedMessage.set('');

    // El botón se pulsa siempre; aquí es donde se enseña lo que falta.
    this.userSubmitted.set(true);
    if (hasProblems(this.userProblems)) return;

    this.saving.set(true);
    try {
      await this.usersService.upsertUser({
        email: this.newEmail,
        displayName: this.newName,
        role: this.newRole,
        active: true
      });
      this.newEmail = '';
      this.newName = '';
      this.newRole = 'employee';
      // El formulario vuelve a estar limpio, así que también su estado de error:
      // si no, el campo vacío recién guardado saldría en rojo.
      this.userSubmitted.set(false);
      await this.loadUsers();
      this.savedMessage.set('settings.users.added');
    } catch (err) {
      this.errorKey.set((err as Error).message || 'settings.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * ⚠️ **Nadie se puede desactivar ni degradar a sí mismo.**
   *
   * No es cortesía: si el único administrador se quita el acceso o se pone
   * «empleado», deja de poder entrar en esta pantalla y no hay forma de
   * revertirlo desde la aplicación. Habría que arreglarlo entrando a Firestore
   * por la consola de Firebase.
   */
  isSelf(user: AuthorizedUser): boolean {
    return (user.email || '').toLowerCase() === this.currentEmail();
  }

  async toggleActive(user: AuthorizedUser): Promise<void> {
    if (this.isSelf(user) || this.saving()) return;
    this.saving.set(true);
    try {
      await this.usersService.setActive(user.email, !user.active);
      await this.loadUsers();
    } catch {
      this.errorKey.set('settings.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  async changeRole(user: AuthorizedUser, role: string): Promise<void> {
    if (this.isSelf(user) || this.saving()) return;
    this.saving.set(true);
    try {
      await this.usersService.setRole(user.email, role as UserRole);
      await this.loadUsers();
    } catch {
      this.errorKey.set('settings.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  async removeUser(user: AuthorizedUser): Promise<void> {
    if (this.isSelf(user) || this.saving()) return;
    if (!confirm(this.translate.translate('settings.users.confirmDelete'))) return;
    this.saving.set(true);
    try {
      await this.usersService.deleteUser(user.email);
      await this.loadUsers();
    } catch {
      this.errorKey.set('settings.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }
}
