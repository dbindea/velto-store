import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  deleteField,
  doc,
  docData,
  serverTimestamp,
  updateDoc
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import type {
  BookingRequest,
  BookingRequestStatus
} from '@shared/models/booking-request.model';
import { canConvert, canDiscard } from '@shared/utils/booking-request.util';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';

const COLECCION = 'bookingRequests';

/**
 * Las solicitudes de la web.
 *
 * ⚠️ **Esta clase NO crea ninguna.** Las escribe la Cloud Function
 * `createBookingRequest`, y `firestore.rules` deniega `create` desde cliente a
 * propósito: si se pudiera, cualquiera con la clave del bundle —que viaja en la
 * web pública— se saltaría los topes de longitud, el campo trampa y el límite
 * por teléfono. Aquí solo se leen y se marcan.
 */
@Injectable({ providedIn: 'root' })
export class BookingRequestService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  /**
   * ⚠️ **Escucha, no lee una vez.** Quien crea una solicitud es un visitante
   * desde fuera, minutos después de que el operador abriera la pantalla: con
   * `getDocs` la lista se quedaría mintiendo hasta que alguien pulsara F5. Es
   * la misma razón por la que escuchan los pagos y la firma del contrato.
   */
  watchRequests(): Observable<BookingRequest[]> {
    return collectionData(collection(this.firestore, COLECCION), {
      idField: 'id'
    }) as Observable<BookingRequest[]>;
  }

  watchRequest(id: string): Observable<BookingRequest | undefined> {
    return docData(doc(this.firestore, COLECCION, id), { idField: 'id' }) as Observable<
      BookingRequest | undefined
    >;
  }

  /**
   * Marcar que ya se habló con el cliente.
   *
   * ⚠️ **`handledAt` es lo que arranca el plazo de borrado**, no `createdAt`.
   * Así el reloj empieza cuando el operador la atiende, no cuando entró: una
   * solicitud que tarda dos días en contestarse conserva sus 24 horas completas
   * desde la llamada.
   */
  async markContacted(id: string, internalNote?: string): Promise<void> {
    await this.marcar(id, 'contacted', { internalNote });
  }

  async discard(id: string, internalNote?: string): Promise<void> {
    await this.marcar(id, 'discarded', { internalNote });
  }

  /**
   * Guardar la nota interna, y nada más.
   *
   * ⚠️ **NO toca el estado.** Apuntar lo que se habló no es haber llamado: una
   * solicitud en la que se anota «intentado, no coge» sigue **sin contestar**, y
   * pasarla a `contacted` la sacaría de la lista de trabajo pendiente con el
   * cliente todavía sin hablar. Por eso no pasa por `marcar()`.
   *
   * ⚠️ **Y vaciarla tiene que BORRAR de verdad.** `cleanForFirestore()` quita la
   * clave de un valor vacío, y un `updateDoc` sin la clave **deja intacto** lo
   * que hubiera: el operador borraría la nota, guardaría, y al recargar volvería.
   * Es el mismo fallo de los diez campos del mantenimiento. `deleteField()` es
   * lo único que Firestore entiende como «quita esto», y se añade **después** de
   * limpiar: es un centinela, y un limpiador que lo recorriera lo dejaría en un
   * mapa vacío.
   */
  async saveInternalNote(id: string, internalNote: string): Promise<void> {
    const limpia = internalNote.trim();
    await updateDoc(doc(this.firestore, COLECCION, id), {
      internalNote: limpia ? limpia : deleteField()
    });
  }

  /**
   * Ampliar el precio garantizado.
   *
   * ⚠️ **La fecha se calcula fuera** (`extendedGuaranteeUntil`), con sus tests:
   * lo caducado se amplía desde ahora y lo vigente desde lo prometido, y esa
   * distinción es la que hace que el botón sirva para el caso normal — que es
   * justo el de un plazo ya vencido.
   *
   * ⚠️ **Se guarda una `Date`, no un centinela.** `serverTimestamp()` pondría la
   * hora del servidor, que es el momento de escribir y no el de caducar.
   */
  async extendPriceGuarantee(id: string, until: Date): Promise<void> {
    await updateDoc(doc(this.firestore, COLECCION, id), {
      priceGuaranteedUntil: until,
      priceExtendedBy: this.auth.authorizedUser()?.email || '',
      priceExtendedAt: serverTimestamp()
    });
  }

  /**
   * La solicitud ya es una reserva.
   *
   * ⚠️ **Guarda el id de la reserva**, y no es contabilidad: es lo que permite
   * abrirla desde aquí y lo que impide convertirla dos veces. La referencia
   * viaja en el otro sentido —de la reserva a la solicitud— para que dentro de
   * un mes se sepa que ese alquiler vino de la web.
   */
  async markConverted(id: string, reservationId: string): Promise<void> {
    await this.marcar(id, 'converted', { reservationId });
  }

  /**
   * ⚠️ **Se comprueba aquí ADEMÁS de en la pantalla.** La pantalla apaga el
   * botón; esto rechaza la llamada venga por donde venga. Son las dos primeras
   * de las tres capas que el proyecto usa para todo — la tercera es
   * `firestore.rules`.
   */
  private async marcar(
    id: string,
    status: BookingRequestStatus,
    extra: Partial<BookingRequest>
  ): Promise<void> {
    const cambios = cleanForFirestore({
      status,
      handledBy: this.auth.authorizedUser()?.email || '',
      ...extra
    });
    // El centinela va DESPUÉS de limpiar: un limpiador que lo recorriera lo
    // dejaría en un mapa vacío y Firestore escribiría `{}`.
    await updateDoc(doc(this.firestore, COLECCION, id), {
      ...cambios,
      handledAt: serverTimestamp()
    });
  }

  /** Borrar es de administrador; lo impone además `firestore.rules`. */
  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, COLECCION, id));
  }

  /** Las mismas reglas que usa la pantalla, para no tener dos autoridades. */
  canConvert = canConvert;
  canDiscard = canDiscard;
}
