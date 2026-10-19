import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  deleteField,
  doc,
  docData,
  getDoc,
  query,
  serverTimestamp,
  updateDoc,
  where
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, of } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import type {
  BookingRequest,
  BookingRequestStatus
} from '@shared/models/booking-request.model';
import {
  canConvert,
  canDiscard,
  canMarkContacted
} from '@shared/utils/booking-request.util';
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
   * Qué solicitudes tienen ya su señal **cobrada**.
   *
   * ⚠️ **Hace falta desde que la señal se paga sola desde la web.** Hasta hoy
   * el cobro lo creaba el operador y le mandaba el enlace, así que sabía
   * perfectamente cuál estaba esperando dinero. Ahora entra solo, de madrugada,
   * sin que nadie lo haya tocado — y la fila de la lista se veía **idéntica** a
   * las seis que no han contestado nadie. El aviso de Telegram dice cuál es,
   * pero un aviso que se pierde deja dinero cobrado sin reserva detrás y nada
   * en la pantalla que lo cuente.
   *
   * ⚠️ **Se consulta `payments`, no se mira `signalPaymentId`.** Ese campo solo
   * dice que hay un cobro creado, no que haya entrado dinero: casi todos los
   * que se creen no se van a pagar. Quien dice si el dinero entró es el pago,
   * que es la única fuente de verdad — la misma regla que impide fiarse de
   * `reservation.paymentSummary`.
   *
   * ⚠️ **Y escucha, no lee una vez.** Quien paga es el cliente desde su móvil,
   * minutos después de que el operador abriera la pantalla; con `getDocs` la
   * lista se quedaría mintiendo hasta que alguien pulsara F5. Es exactamente el
   * caso que la nota de `watchRequests()` describe, un escalón más allá.
   *
   * ⚠️ **`in` admite 30 ids como mucho**, así que se parte en tandas. Con la
   * flota de hoy sobra de largo; el tope está para que el día que la lista
   * crezca no falle la consulta entera en silencio.
   */
  watchPaidSignals(ids: string[]): Observable<Set<string>> {
    const conCobro = [...new Set(ids.filter(Boolean))];
    if (!conCobro.length) return of(new Set<string>());

    const tandas: string[][] = [];
    for (let i = 0; i < conCobro.length; i += 30) tandas.push(conCobro.slice(i, i + 30));

    const consultas = tandas.map(
      (tanda) =>
        collectionData(
          query(
            collection(this.firestore, 'payments'),
            where('bookingRequestId', 'in', tanda),
            where('status', '==', 'paid')
          )
        ) as Observable<{ bookingRequestId?: string }[]>
    );

    return combineLatest(consultas).pipe(
      map((lotes) => {
        const pagadas = new Set<string>();
        for (const lote of lotes) {
          for (const p of lote) if (p.bookingRequestId) pagadas.add(p.bookingRequestId);
        }
        return pagadas;
      })
    );
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
    await this.marcarSiSePuede(id, 'contacted', canMarkContacted, { internalNote });
  }

  async discard(id: string, internalNote?: string): Promise<void> {
    await this.marcarSiSePuede(id, 'discarded', canDiscard, { internalNote });
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
    await this.marcarSiSePuede(id, 'converted', canConvert, { reservationId });
  }

  /**
   * Apunta en la solicitud qué cobro es su señal.
   *
   * ⚠️ **No toca el estado.** Mandar el enlace de pago no es haber hablado con
   * el cliente ni haber convertido nada: es exactamente lo mismo que guardar
   * la nota interna, que tampoco marca «contactada». Cambiar el estado aquí
   * sacaría la solicitud de la lista de trabajo pendiente con el cliente sin
   * atender, que es justo lo contrario de lo que pasa — a partir de ahora hay
   * que estar MÁS pendiente, porque hay dinero en camino.
   *
   * ⚠️ **Y no guarda el importe ni si está pagada.** Las dos cosas las dice el
   * cobro, que es la única fuente del dinero que entra.
   */
  async attachSignalPayment(id: string, paymentId: string): Promise<void> {
    await updateDoc(doc(this.firestore, COLECCION, id), { signalPaymentId: paymentId });
  }

  /**
   * La segunda capa: **el servicio pregunta al mismo guard que la pantalla.**
   *
   * ⚠️ **El docblock de abajo prometía esto y no lo hacía nadie.** Decía «se
   * comprueba aquí ADEMÁS de en la pantalla» y `marcar()` escribía sin mirar
   * nada: dos pestañas abiertas, o un doble clic mientras la lista se refresca,
   * convertían dos veces la misma solicitud. Lo encontró una revisión
   * adversaria el 29 de septiembre de 2026 — un comentario que describe una
   * comprobación inexistente es peor que no tenerlo, porque el siguiente que
   * lea el fichero da la capa por puesta.
   *
   * ⚠️ **Se relee el documento, no se usa el que tenga la pantalla.** El que
   * está en pantalla puede llevar segundos ahí; lo que decide es el estado de
   * Firestore en el momento de escribir.
   *
   * ⚠️ **Y lo que rechaza viaja como clave i18n**, no como frase: es la regla
   * de la casa para que la capa de avisos pueda decirlo en el idioma del
   * operador.
   */
  private async marcarSiSePuede(
    id: string,
    status: BookingRequestStatus,
    permite: (r: BookingRequest) => boolean,
    extra: Partial<BookingRequest>
  ): Promise<void> {
    const snap = await getDoc(doc(this.firestore, COLECCION, id));
    if (!snap.exists()) throw new Error('bookingRequests.errors.gone');
    if (!permite({ ...(snap.data() as BookingRequest), id: snap.id })) {
      throw new Error('bookingRequests.errors.alreadyHandled');
    }
    await this.marcar(id, status, extra);
  }

  /** La escritura, ya decidida. Quien decide es `marcarSiSePuede()`. */
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
