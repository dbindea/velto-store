import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { map, take } from 'rxjs/operators';

export const publicGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.firebaseUser$.pipe(
    take(1),
    map(user => {
      if (user && authService.isAuthorized()) {
        router.navigate(['/dashboard']);
        return false;
      }
      return true;
    })
  );
};