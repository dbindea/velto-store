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
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authorizedState$.pipe(
    take(1),
    map((authorized) => (authorized ? true : router.createUrlTree(['/login'])))
  );
};
