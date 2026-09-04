import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { Permission, UserRole, can } from '@shared/utils/permissions.util';

/**
 * Lo que puede hacer **quien está dentro ahora mismo**.
 *
 * Es una capa fina sobre `permissions.util.ts`, que sigue siendo la única
 * autoridad: aquí no se decide nada, solo se le pasa el rol de la sesión. Existe
 * para que ningún componente tenga que escribir
 * `can(this.auth.authorizedUser()?.role, 'x')` — repetido ocho veces, la novena
 * se escribe distinta.
 *
 * ⚠️ **Esto es la interfaz, no la seguridad.** Un `false` aquí apaga un botón;
 * lo que impide de verdad escribir en Firestore son las reglas. Los servicios
 * comprueban además antes de escribir, que es la defensa en profundidad que ya
 * usa el workflow: bloquear en la UI **y** validar en el servicio.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private auth = inject(AuthService);

  /** El rol de la sesión, o `undefined` mientras la autorización se resuelve. */
  readonly role = computed<UserRole | undefined>(
    () => this.auth.authorizedUser()?.role as UserRole | undefined
  );

  /**
   * ¿Puede el usuario actual?
   *
   * Sin rol resuelto la respuesta es **no**: mientras no se sepa quién es
   * alguien, no se le abre nada. Dura milisegundos y termina concediendo el
   * permiso al usuario legítimo.
   */
  can(permission: Permission): boolean {
    return can(this.role(), permission);
  }

  /**
   * El motivo por el que algo está bloqueado, en clave de i18n, o `''` si no lo
   * está.
   *
   * Un botón que desaparece sin más hace que el compañero llame preguntando qué
   * le pasa a la aplicación. Es la misma idea que el «Falta contrato firmado»
   * del workflow: si no se puede, se dice por qué.
   */
  blockReason(permission: Permission): string {
    return this.can(permission) ? '' : 'permissions.notAllowed';
  }

  // Atajos para los permisos que se consultan desde las plantillas. Son
  // `computed` para que la plantilla no llame a un método en cada pintado.
  readonly canEditPricing = computed(() => can(this.role(), 'editPricing'));
  readonly canGrantDiscounts = computed(() => can(this.role(), 'grantDiscounts'));
  readonly canDelete = computed(() => can(this.role(), 'deleteRecords'));
  readonly canCancelReservations = computed(() => can(this.role(), 'cancelReservations'));
}
