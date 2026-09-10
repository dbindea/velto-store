import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc
} from '@angular/fire/firestore';
import { AuthService } from '@core/auth/auth.service';
import { Reminder } from '@shared/models/reminder.model';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';

/**
 * Los recordatorios manuales.
 *
 * ⚠️ **Es lo ÚNICO que se guarda de la pantalla de Eventos.** Las entregas, las
 * ITV y los plazos de factura se derivan de sus propios datos al pintar: copiar
 * un evento derivado a una colección propia crearía una segunda fuente de verdad
 * que se quedaría vieja en cuanto alguien moviera una fecha de recogida.
 */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  private ref = collection(this.firestore, 'reminders');

  /**
   * Todos, ordenados en memoria.
   *
   * ⚠️ Sin `orderBy` en la consulta: Firestore excluye del resultado los
   * documentos que no tengan el campo por el que se ordena, y esconder un
   * recordatorio es justo lo contrario de lo que hace esta pantalla (M-40).
   */
  async list(): Promise<Reminder[]> {
    const snap = await getDocs(this.ref);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Reminder) }));
  }

  /**
   * ⚠️ **`dueDate` entra como `Date`, nunca como texto.** Guardado como la
   * cadena del `<input type="date">`, ninguna comparación con una fecha casa y
   * el recordatorio se vuelve invisible sin dar un error — es exactamente lo que
   * pasó con la ITV programada. El tipo obliga a convertir antes de llamar.
   */
  async save(data: Omit<Reminder, 'id' | 'dueDate'> & { dueDate: Date }, id?: string): Promise<string> {
    const payload = cleanForFirestore({
      ...data,
      done: data.done === true,
      updatedAt: serverTimestamp()
    }) as Record<string, unknown>;

    if (id) {
      await updateDoc(doc(this.ref, id), payload);
      return id;
    }
    const created = await addDoc(this.ref, {
      ...payload,
      createdAt: serverTimestamp(),
      createdBy: this.auth.authorizedUser()?.email || null
    });
    return created.id;
  }

  /**
   * Marcar hecho, o deshacerlo.
   *
   * ⚠️ **Esto SÍ se puede deshacer**, al revés que una comisión pagada: aquí no
   * se ha movido dinero, y marcar por error «limpiar coches» como hecho no puede
   * costar tener que crear el recordatorio de nuevo.
   */
  async setDone(id: string, done: boolean): Promise<void> {
    await updateDoc(
      doc(this.ref, id),
      cleanForFirestore({
        done,
        doneAt: done ? serverTimestamp() : null,
        doneBy: done ? this.auth.authorizedUser()?.email || null : null,
        updatedAt: serverTimestamp()
      }) as Record<string, unknown>
    );
  }

  async delete(id: string): Promise<void> {
    await deleteDoc(doc(this.ref, id));
  }
}
