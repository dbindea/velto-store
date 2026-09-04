import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { Permission, can } from '@shared/utils/permissions.util';

/**
 * Cierra una ruta a quien no tenga el permiso.
 *
 * Va **después** de `authGuard` en la misma rama de rutas, y espera a
 * `authorizedState$` por la misma razón que él: el rol llega de una lectura de
 * Firestore, así que leer la señal justo después de que emita el usuario es una
 * carrera. Al refrescar la página, esa carrera se pierde siempre — el rol aún es
 * `null`— y un administrador acabaría expulsado de su propia pantalla de
 * ajustes.
 *
 * ⚠️ **Esto no es la seguridad, es la interfaz.** Quien de verdad impide leer o
 * escribir es `firestore.rules`. Un guard evita que alguien llegue a una
 * pantalla que no le toca; no evita que llame a Firestore por su cuenta.
 *
 * A quien no pasa se le manda al **dashboard**, no al login: está autorizado y
 * con la sesión abierta, solo que esa sección no es suya. Mandarlo a login diría
 * que su sesión ha caducado, que no es verdad, y le haría volver a entrar para
 * encontrarse lo mismo.
 */
export function permissionGuard(permission: Permission): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return authService.authorizedState$.pipe(
      take(1),
      map(() =>
        can(authService.authorizedUser()?.role, permission)
          ? true
          : router.createUrlTree(['/dashboard'])
      )
    );
  };
}
