import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { map, take } from 'rxjs/operators';
import { safeReturnUrl } from '@shared/utils/return-url.util';

/**
 * Keeps an already-authorized operator out of /login.
 *
 * Mirrors authGuard: it waits for `authorizedState$` so the decision is made
 * with the settled state, not with a half-restored session.
 */
export const publicGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authorizedState$.pipe(
    take(1),
    map((authorized) =>
      authorized
        ? /**
           * ⚠️ **Con sesión puesta, el destino manda igual.** Este es el camino
           * del enlace pulsado desde el correo **en la misma sesión**: el guard
           * de arriba ya no llega a rebotar, pero si alguien cae en `/login`
           * con `returnUrl` —una pestaña vieja, un enlace guardado— mandarlo al
           * panel volvería a perder el enlace, que es justo lo que se estaba
           * arreglando.
           */
          router.parseUrl(safeReturnUrl(route.queryParamMap.get('returnUrl')))
        : true
    )
  );
};
