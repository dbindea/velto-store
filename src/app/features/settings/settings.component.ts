import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { TranslateService } from '@core/i18n/translate.service';
import { AuthService } from '@core/auth/auth.service';
import { ThemeService, Theme } from '@core/theme/theme.service';
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
import { ConfirmService } from '@core/notifications/confirm.service';
import {
  ComplianceDeclaration,
  ComplianceService,
  ComplianceStatus
} from '@features/settings/services/compliance.service';
import {
  EstadoVerifactu,
  ResumenEnvio,
  VerifactuService
} from '@features/settings/services/verifactu.service';
import { ClearInputDirective } from '@shared/directives/clear-input.directive';
import { capitalizeWords, transformInput } from '@shared/utils/text-case.util';

type Tab = 'operation' | 'users' | 'appearance' | 'compliance';

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
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent, ClearInputDirective],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  private confirm = inject(ConfirmService);
  private settingsService = inject(SettingsService);
  private usersService = inject(AuthorizedUserService);
  private translate = inject(TranslateService);
  private auth = inject(AuthService);

  readonly roles = USER_ROLES;
  readonly USER_ROLE_LABELS = USER_ROLE_LABELS;
  readonly USER_ROLE_DESCRIPTIONS = USER_ROLE_DESCRIPTIONS;

  readonly tab = signal<Tab>('operation');
  /**
   * El tema es preferencia personal, no un ajuste del negocio: no se guarda en
   * Firestore ni afecta a nadie más. Vive aquí porque es donde se buscan las
   * preferencias, pero el conmutador de la barra superior sigue estando para
   * todos los roles — esta pantalla es de administrador.
   */
  readonly themeService = inject(ThemeService);
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

  /**
   * El nombre del usuario que se autoriza, capitalizado según se escribe.
   *
   * Es el nombre de una persona como cualquier otro de la aplicación, y se
   * queda guardado en `authorizedUsers` — sale en esta misma lista y en la
   * cabecera de quien entra. El correo **no** pasa por aquí: se guarda en
   * minúsculas porque es el id del documento.
   */
  onNewNameInput(event: Event): void {
    this.newName = transformInput(event.target as HTMLInputElement, capitalizeWords);
  }

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

  /** El tema se aplica al instante: no hay nada que guardar ni confirmar. */
  setTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  select(tab: Tab): void {
    this.tab.set(tab);
    this.errorKey.set('');
    this.savedMessage.set('');
    // Las declaraciones se leen al abrir su pestaña: son un documento legal que
    // se consulta de vez en cuando, no algo que haga falta en cada carga.
    // `loadDeclarations()` encadena la consulta de la remisión si procede: hace
    // falta saber antes si este entorno factura siquiera.
    if (tab === 'compliance' && !this.declarationsLoaded) void this.loadDeclarations();
  }

  // ---------------------------------------------------------------------------
  // Declaración responsable (art. 15 de la Orden HAC/1177/2024)
  //
  // ⚠️ Le toca a Velto porque la aplicación es desarrollo propio: no hay
  // fabricante externo que pueda declarar por ella. Y hace falta una por CADA
  // versión del sistema, así que la pantalla distingue la vigente de las
  // anteriores en vez de enseñar solo la última.
  // ---------------------------------------------------------------------------

  private compliance = inject(ComplianceService);
  private declarationsLoaded = false;

  readonly declarations = signal<ComplianceDeclaration[]>([]);
  readonly issuingDeclaration = signal(false);
  /** Lo que declara el sistema. Lo sirve la function; aquí no se duplica nada. */
  readonly complianceStatus = signal<ComplianceStatus | null>(null);

  get complianceSystemName(): string {
    return this.complianceStatus()?.systemName ?? '—';
  }
  get complianceVersion(): string {
    return this.complianceStatus()?.version ?? '—';
  }
  get complianceProducer(): string {
    return this.complianceStatus()?.producerName ?? '—';
  }

  /** La de la versión que está corriendo, si existe. */
  readonly declaration = computed(() => {
    const version = this.complianceStatus()?.version;
    return version ? this.declarations().find((d) => d.systemVersion === version) : undefined;
  });

  /** Las de versiones anteriores. No se borran: cada una acreditó su periodo. */
  readonly previousDeclarations = computed(() => {
    const version = this.complianceStatus()?.version;
    return this.declarations().filter((d) => d.systemVersion !== version);
  });

  /**
   * ¿Se factura en este entorno?
   *
   * ⚠️ Lo dice la function, no el bundle: la aplicación se compila **igual**
   * para desarrollo y producción, así que una constante aquí diría lo que traía
   * escrito y no lo que pasa. Mismo motivo que el correo de la pantalla de
   * firma (F-33).
   */
  get invoicingEnabled(): boolean {
    return this.complianceStatus()?.invoicingEnabled === true;
  }

  /**
   * ¿Se **remite** a la AEAT en este entorno? Que no es lo mismo que facturar.
   *
   * ⚠️ **Se compara contra `true`, no se convierte a booleano.** La function
   * que lo sirve puede ser anterior a este campo y devolver `undefined`; así
   * ese caso cae en «no se remite», que es el lado que no pregunta por una
   * function que quizá no esté desplegada.
   */
  get verifactuEnabled(): boolean {
    return this.complianceStatus()?.verifactuEnabled === true;
  }

  /**
   * Aquí se factura pero **no se remite todavía**: el caso de producción entre
   * el 17 de septiembre de 2026 y el 1 de enero de 2027.
   *
   * Merece tarjeta propia y no silencio. Los registros **sí** se están
   * guardando con cada factura, y quien mira esta pantalla lo que quiere saber
   * es si hay algo pendiente con la Agencia: no enseñar nada se lee como que no
   * hay nada que remitir, cuando lo que pasa es que se remitirá todo junto más
   * adelante.
   */
  get verifactuApagado(): boolean {
    return this.invoicingEnabled && !this.verifactuEnabled;
  }

  private async loadDeclarations(): Promise<void> {
    try {
      // El estado primero: sin saber qué versión corre no se puede decir si
      // falta su declaración, que es lo único que esta pantalla tiene que
      // responder.
      this.complianceStatus.set(await this.compliance.status());
      this.declarations.set(await this.compliance.list());
      this.declarationsLoaded = true;

      /**
       * ⚠️ **La remisión solo se consulta si aquí se REMITE.** No si se
       * factura: en un entorno que emite facturas pero todavía no las manda a
       * la Agencia no hay estado que consultar, y preguntarlo da un error
       * —«no se pudo consultar el estado»— que hace pensar que algo está roto
       * cuando lo que pasa es que aún no toca.
       *
       * ⚠️ **Esta condición estuvo atada a `invoicingEnabled` y funcionaba de
       * casualidad**, porque las dos banderas estuvieron apagadas a la vez
       * hasta el 17 de septiembre de 2026. El día que producción empezó a
       * facturar sin remitir, la pantalla llamó a `getVerifactuStatus` —que
       * allí ni siquiera está desplegada, y no lo estará hasta enero— y soltó
       * el error justo después de emitir la declaración responsable, que es el
       * peor momento para dudar de si algo ha ido mal.
       */
      if (this.verifactuEnabled) await this.loadVerifactu();
    } catch {
      this.errorKey.set('settings.compliance.loadError');
    }
  }

  async issueDeclaration(): Promise<void> {
    if (this.issuingDeclaration()) return;
    this.issuingDeclaration.set(true);
    this.errorKey.set('');
    try {
      await this.compliance.issue();
      await this.loadDeclarations();
      this.savedMessage.set('settings.compliance.issued');
    } catch (err) {
      /**
       * ⚠️ **«Aquí todavía no se factura» no es un fallo de emisión.** El botón
       * no debería llegar a verse en ese caso, pero la function lo comprueba
       * igual —una declaración emitida no se puede borrar—, y si contesta eso
       * hay que decirlo tal cual en vez de traducirlo a «no se pudo emitir»,
       * que manda a buscar una avería que no existe.
       */
      const msg = typeof (err as { message?: unknown })?.message === 'string'
        ? (err as { message: string }).message
        : '';
      this.errorKey.set(
        msg === 'invoices.errors.invoicingDisabled' ? msg : 'settings.compliance.issueError'
      );
    } finally {
      this.issuingDeclaration.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Remisión a la AEAT
  //
  // ⚠️ Esta pantalla existe para responder a UNA pregunta: ¿está todo lo
  // emitido remitido? Una factura que no llegó no se nota por ningún otro sitio
  // —el PDF sale igual, el cliente la cobra igual—, así que si no se enseña
  // aquí no se entera nadie.
  // ---------------------------------------------------------------------------

  private verifactu = inject(VerifactuService);

  readonly verifactuStatus = signal<EstadoVerifactu | null>(null);
  readonly sendingVerifactu = signal(false);
  /** El resultado del último envío manual, para poder contarlo. */
  readonly lastSend = signal<ResumenEnvio | null>(null);

  /**
   * ⚠️ **Preproducción se dice, no se calla.** Un registro aceptado contra
   * `test` no está presentado ante nadie: sin decirlo, la pantalla enseñaría
   * «12 aceptadas» y daría por cumplida una obligación que sigue pendiente.
   */
  get verifactuEsPruebas(): boolean {
    return this.verifactuStatus()?.entorno !== 'live';
  }

  private async loadVerifactu(): Promise<void> {
    try {
      this.verifactuStatus.set(await this.verifactu.status());
    } catch {
      this.errorKey.set('settings.verifactu.loadError');
    }
  }

  async sendVerifactu(): Promise<void> {
    if (this.sendingVerifactu()) return;
    this.sendingVerifactu.set(true);
    this.errorKey.set('');
    this.lastSend.set(null);
    try {
      this.lastSend.set(await this.verifactu.send());
      await this.loadVerifactu();
    } catch (err) {
      this.errorKey.set(this.sendErrorKeyOf(err));
      // El estado puede haber cambiado aunque el envío fallara: un rechazo
      // marca facturas y hay que verlo sin recargar la pantalla.
      await this.loadVerifactu();
    } finally {
      this.sendingVerifactu.set(false);
    }
  }

  /**
   * ⚠️ **Los tres motivos por los que esto falla NO son el mismo aviso.**
   *
   * - Que no se pudiera llegar a la Agencia no significa que las facturas no
   *   hayan entrado: pudo registrarlas y perderse la respuesta, así que el
   *   mensaje dice «no se pudo completar» y no «no se enviaron».
   * - Que una huella no cuadre es lo más grave y no se reintenta solo.
   * - Y una factura sin registro es un incidente que hay que resolver antes de
   *   emitir más.
   *
   * Un único «no se pudo enviar» los taparía los tres. La lista es explícita
   * porque `TranslateService.translate()` devuelve **la propia clave** cuando no
   * la encuentra: una clave desconocida saldría en crudo en pantalla.
   */
  private sendErrorKeyOf(err: unknown): string {
    const conocidas = [
      'invoices.errors.verifactuUnreachable',
      'invoices.errors.verifactuHashMismatch',
      'invoices.errors.verifactuRecordMissing',
      'invoices.errors.unauthenticated'
    ];
    const msg = typeof (err as { message?: unknown })?.message === 'string'
      ? (err as { message: string }).message
      : '';
    return conocidas.includes(msg) ? msg : 'settings.verifactu.sendError';
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
    const seguir = await this.confirm.ask({
      title: 'settings.users.confirmDeleteTitle',
      message: 'settings.users.confirmDelete',
      confirmLabel: 'common.delete',
      danger: true
    });
    if (!seguir) return;
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
