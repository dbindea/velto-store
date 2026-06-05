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
import { Observable } from 'rxjs';
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

  // Auth state signals
  private _isLoading = signal(false);
  private _authError = signal<string | null>(null);
  private _authorizedUser = signal<AuthorizedUser | null>(null);

  readonly isLoading = this._isLoading.asReadonly();
  readonly authError = this._authError.asReadonly();
  readonly authorizedUser = this._authorizedUser.asReadonly();

  // Computed states
  readonly isAuthenticated = computed(() => !!this.firebaseUser$);
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

  // Initialize auth state listener
  initAuthListener(): void {
    this.firebaseUser$.subscribe(async (fbUser) => {
      if (fbUser?.email) {
        const email = fbUser.email.toLowerCase();
        const authorized = await this.checkAuthorization(email);
        if (!authorized) {
          await this.forceLogout('Tu cuenta no está autorizada para acceder a esta aplicación.');
        }
      } else {
        this._authorizedUser.set(null);
      }
      this._isLoading.set(false);
    });
  }

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
