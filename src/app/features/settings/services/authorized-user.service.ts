import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc
} from '@angular/fire/firestore';
import { AuthorizedUser } from '@shared/models/authorized-user.model';
import { UserRole } from '@shared/utils/permissions.util';

/**
 * Quién puede entrar en la aplicación.
 *
 * ⚠️ **El id del documento ES el email en minúsculas.** No es un detalle de
 * estilo: `AuthService` busca `authorizedUsers/{email}` directamente, sin
 * consulta, y un documento guardado con mayúsculas no lo encuentra nadie. La
 * persona quedaría dada de alta y sin poder entrar.
 *
 * ⚠️ **Esta colección es la llave de la casa.** Vaciarla deja a todo el mundo
 * fuera, y no hay forma de arreglarlo desde la propia aplicación: habría que
 * entrar a Firestore por la consola. Por eso `deactivate()` existe y se usa en
 * lugar de borrar, y por eso la pantalla no deja que alguien se quite a sí mismo.
 */
@Injectable({ providedIn: 'root' })
export class AuthorizedUserService {
  private firestore = inject(Firestore);

  private get usersRef() {
    return collection(this.firestore, 'authorizedUsers');
  }

  /**
   * Todos los usuarios.
   *
   * ⚠️ Requiere que las reglas dejen **listar** la colección a un administrador.
   * Hasta el 4 de septiembre de 2026 solo permitían leer el documento propio, así
   * que esta consulta habría fallado con permisos denegados por muy admin que
   * fuera quien la lanzase.
   */
  async getUsers(): Promise<AuthorizedUser[]> {
    const snap = await getDocs(this.usersRef);
    return snap.docs
      .map((d) => ({ ...(d.data() as AuthorizedUser), email: d.id }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  /**
   * Da de alta o actualiza. El email se normaliza siempre a minúsculas, aquí y
   * no en la pantalla, para que no dependa de por dónde se llame.
   */
  async upsertUser(user: {
    email: string;
    displayName?: string;
    role: UserRole;
    active: boolean;
  }): Promise<void> {
    const email = user.email.trim().toLowerCase();
    if (!email) throw new Error('settings.errors.emailRequired');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('settings.errors.emailInvalid');

    await setDoc(
      doc(this.firestore, `authorizedUsers/${email}`),
      {
        email,
        displayName: user.displayName?.trim() || '',
        role: user.role,
        active: user.active,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      },
      // `merge` para que reactivar a alguien no le borre su fecha de alta.
      { merge: true }
    );
  }

  /**
   * Quita el acceso sin borrar el registro.
   *
   * Se prefiere a borrar porque deja constancia de que esa persona tuvo acceso,
   * y porque volver a darle de alta es marcar una casilla.
   */
  async setActive(email: string, active: boolean): Promise<void> {
    await updateDoc(doc(this.firestore, `authorizedUsers/${email.toLowerCase()}`), {
      active,
      updatedAt: serverTimestamp()
    });
  }

  async setRole(email: string, role: UserRole): Promise<void> {
    await updateDoc(doc(this.firestore, `authorizedUsers/${email.toLowerCase()}`), {
      role,
      updatedAt: serverTimestamp()
    });
  }

  /** Borrado de verdad. La pantalla solo lo ofrece sobre usuarios ya inactivos. */
  async deleteUser(email: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `authorizedUsers/${email.toLowerCase()}`));
  }
}
