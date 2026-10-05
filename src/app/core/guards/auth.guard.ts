import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { map, take } from 'rxjs/operators';

/**
 * Protects every private route.
 *
 * Waits for `authorizedState$`, which only emits once the persisted Firebase
 * session AND the Firestore authorization lookup have both resolved. Reading
 * `isAuthorized()` right after the user observable emits is a race: on a page
 * reload the lookup has not finished, so the guard saw `false` and redirected.
 * That made refreshing the page or opening a deep link log the operator out.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authorizedState$.pipe(
    take(1),
    map((authorized) =>
      authorized
        ? true
        : /**
           * ⚠️ **Se guarda a dónde iba, y antes no.** Mandaba a `/login` a
           * secas y el login navegaba siempre a `/dashboard`, así que abrir un
           * enlace del backoffice sin sesión —el del correo de una solicitud,
           * el de un pago— dejaba al operador en el panel sin decirle por qué.
           * Se pierde el enlace justo cuando más se necesita: cuando llega de
           * fuera y alguien lo acaba de pulsar.
           *
           * Va en la URL a propósito, y no en un servicio: así la intención
           * sobrevive a la recarga que hace el `signInWithPopup`, y además se
           * ve. Quien la lea tiene que pasarla por `safeReturnUrl()` — ver el
           * agujero que eso cierra.
           */
          router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } })
    )
  );
};
