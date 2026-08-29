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
import { switchMap } from 'rxjs/operators';
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
   * ⚠️ **Sin `shareReplay`, y es deliberado.** Lo tuvo, para no releer el
   * documento en cada navegación, y provocaba esto:
   *
   *   1. Al abrir `/login`, el `publicGuard` se suscribe. No hay sesión, así
   *      que emite `false` — y el buffer se lo queda.
   *   2. El operador entra con Google. `loginWithGoogle()` comprueba la
   *      autorización, sale bien y navega a `/dashboard`.
   *   3. El `authGuard` se suscribe y el buffer le sirve **el `false` viejo**
   *      antes de que la relectura termine. Con `take(1)` esa es la respuesta
   *      final: de vuelta a `/login`.
   *   4. Al refrescar, el buffer nace vacío y la sesión ya está restaurada, así
   *      que entra. De ahí el «hay que refrescar para poder acceder».
   *
   * Sin buffer, cada suscripción parte del usuario **actual**, que es lo único
   * correcto cuando el usuario acaba de cambiar. La lectura de Firestore se
   * cachea por email en `checkAuthorization()`, que da el mismo ahorro sin
   * poder responder por un usuario que ya no es el de ahora.
   */
  readonly authorizedState$: Observable<boolean> = this.firebaseUser$.pipe(
    switchMap((fbUser) => {
      if (!fbUser?.email) {
        this._authorizedUser.set(null);
        return of(false);
      }
      return from(this.checkAuthorization(fbUser.email.toLowerCase()));
    })
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

  /**
   * Lectura de `authorizedUsers/{email}`, cacheada **por email**.
   *
   * La caché es lo que hace que navegar entre pantallas no dispare una lectura
   * por ruta, que era lo que buscaba el `shareReplay` que se quitó arriba. La
   * diferencia importa: aquí la clave es el usuario, así que un usuario nuevo
   * nunca recibe la respuesta del anterior.
   *
   * Se guarda la promesa, no el resultado: dos guards que se resuelven a la vez
   * comparten una sola lectura en vez de lanzar dos.
   */
  private authorizationCache = new Map<string, Promise<boolean>>();

  private checkAuthorization(email: string): Promise<boolean> {
    const cached = this.authorizationCache.get(email);
    if (cached) return cached;

    const lookup = this.readAuthorization(email);
    this.authorizationCache.set(email, lookup);
    // Un fallo de red no se cachea: la siguiente navegación vuelve a intentarlo
    // en vez de dejar al operador fuera hasta que recargue.
    lookup.catch(() => this.authorizationCache.delete(email));
    return lookup;
  }

  private async readAuthorization(email: string): Promise<boolean> {
    try {
      const userDoc = await getDoc(doc(this.firestore, `authorizedUsers/${email}`));

      if (!userDoc.exists()) {
        this._authorizedUser.set(null);
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
    this.authorizationCache.clear();
    this._authorizedUser.set(null);
    this.router.navigate(['/login']);
  }

  private async forceLogout(message: string): Promise<void> {
    this._authError.set(message);
    this.authorizationCache.clear();
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