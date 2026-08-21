import { Injectable, inject, computed, signal } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  user,
  User
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc
} from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { Observable, from, of } from 'rxjs';
import { shareReplay, switchMap } from 'rxjs/operators';
import { AuthorizedUser } from '@shared/models/authorized-user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

  private googleProvider = new GoogleAuthProvider();

  // Firebase user observable
  readonly firebaseUser$: Observable<User | null> = user(this.auth);

  /**
   * Emits `true` only once BOTH steps have finished: Firebase has restored the
   * persisted session, and the Firestore `authorizedUsers` lookup for that user
   * has resolved.
   *
   * The guards must wait for this rather than reading `isAuthorized()` straight
   * after `firebaseUser$` emits. That signal is populated by an async Firestore
   * read, so on a page reload it is still `null` when the guard runs, and every
   * private route bounced to /login — refreshing the page or opening a deep
   * link logged the operator out.
   *
   * `shareReplay` keeps one buffered value so each navigation reuses the result
   * instead of re-reading the document.
   */
  readonly authorizedState$: Observable<boolean> = this.firebaseUser$.pipe(
    switchMap((fbUser) => {
      if (!fbUser?.email) {
        this._authorizedUser.set(null);
        return of(false);
      }
      return from(this.checkAuthorization(fbUser.email.toLowerCase()));
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  // Auth state signals
  private _isLoading = signal(false);
  private _authError = signal<string | null>(null);
  private _authorizedUser = signal<AuthorizedUser | null>(null);

  readonly isLoading = this._isLoading.asReadonly();
  readonly authError = this._authError.asReadonly();
  readonly authorizedUser = this._authorizedUser.asReadonly();

  // Computed states
  readonly isAuthorized = computed(() => !!this._authorizedUser() && this._authorizedUser()?.active === true);

  async loginWithGoogle(): Promise<void> {
    this._isLoading.set(true);
    this._authError.set(null);

    try {
      const result = await signInWithPopup(this.auth, this.googleProvider);
      const email = result.user.email?.toLowerCase();

      if (!email) {
        await this.forceLogout('No se encontró email en la cuenta Google');
        return;
      }

      // Check authorization in Firestore
      const authorized = await this.checkAuthorization(email);

      if (!authorized) {
        await this.forceLogout('Tu cuenta no está autorizada para acceder a esta aplicación.');
        return;
      }

      // Redirect to dashboard on success
      this.router.navigate(['/dashboard']);
    } catch (error: any) {
      console.error('Login error:', error);
      this._authError.set(this.getErrorMessage(error.code));
      await signOut(this.auth);
    } finally {
      this._isLoading.set(false);
    }
  }

  private async checkAuthorization(email: string): Promise<boolean> {
    try {
      const userDoc = await getDoc(doc(this.firestore, `authorizedUsers/${email}`));

      if (!userDoc.exists()) {
        return false;
      }

      const userData = userDoc.data() as AuthorizedUser;
      this._authorizedUser.set(userData);

      return userData.active === true;
    } catch (error) {
      console.error('Error checking authorization:', error);
      return false;
    }
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
    this._authorizedUser.set(null);
    this.router.navigate(['/login']);
  }

  private async forceLogout(message: string): Promise<void> {
    this._authError.set(message);
    this._authorizedUser.set(null);
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }

  // NOTE: an `initAuthListener()` used to live here to restore the
  // authorization state on load, but nothing ever called it — which is why the
  // state was only ever populated by loginWithGoogle(), and any page reload
  // left it null. `authorizedState$` above replaces it: the guards subscribe to
  // it, so the lookup happens exactly when it is needed and cannot be forgotten.

  private getErrorMessage(errorCode: string): string {
    switch (errorCode) {
      case 'auth/popup-closed-by-user':
        return 'Ventana de login cerrada.';
      case 'auth/network-request-failed':
        return 'Error de conexión. Verifica tu internet.';
      case 'auth/cancelled-popup-request':
        return 'Login cancelado.';
      default:
        return 'Error al iniciar sesión. Intenta de nuevo.';
    }
  }
}