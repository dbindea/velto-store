import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { map, take } from 'rxjs/operators';

/**
 * Keeps an already-authorized operator out of /login.
 *
 * Mirrors authGuard: it waits for `authorizedState$` so the decision is made
 * with the settled state, not with a half-restored session.
 */
export const publicGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authorizedState$.pipe(
    take(1),
    map((authorized) => (authorized ? router.createUrlTree(['/dashboard']) : true))
  );
};
