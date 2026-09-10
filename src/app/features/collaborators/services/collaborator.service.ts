import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from '@angular/fire/firestore';
import { AuthService } from '@core/auth/auth.service';
import {
  Collaborator,
  CollaboratorSale,
  CommissionPaymentMethod
} from '@shared/models/collaborator.model';
import { Reservation } from '@shared/models/reservation.model';
import {
  amountProblem,
  commissionAmount,
  estadoSegunReserva,
  saleProblem,
  validateCollaborator
} from '@shared/utils/collaborator.util';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';
import { hasProblems } from '@shared/utils/form-problems.util';
import { roundMoney } from '@shared/utils/payment-summary.util';

/**
 * Colaboradores y comisiones.
 *
 * ⚠️ **Esto no toca `payments`, `expenses` ni `invoices`.** Es un registro
 * interno: lo que se le debe a un comercial y si ya se le pagó. Mezclarlo con el
 * dinero del cliente rompería la regla que hace de `payments` la única fuente de
 * lo que entra — y una comisión no entra, sale.
 */
@Injectable({ providedIn: 'root' })
export class CollaboratorService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  private collaboratorsRef = collection(this.firestore, 'collaborators');
  private salesRef = collection(this.firestore, 'collaboratorSales');

  // --- Colaboradores -------------------------------------------------------

  /**
   * Todos, ordenados por nombre **en memoria**.
   *
   * ⚠️ Un `orderBy` deja fuera a los documentos que no tengan ese campo, sin
   * avisar (M-40). Aquí el nombre es obligatorio, pero son cuatro fichas: no
   * compensa un índice ni el riesgo de esconder una.
   */
  async list(): Promise<Collaborator[]> {
    const snap = await getDocs(this.collaboratorsRef);
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Collaborator) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async getById(id: string): Promise<Collaborator | null> {
    const snap = await getDoc(doc(this.collaboratorsRef, id));
    return snap.exists() ? { id: snap.id, ...(snap.data() as Collaborator) } : null;
  }

  /**
   * ⚠️ **Se valida aquí aunque la pantalla ya lo haya hecho.** Es la misma
   * función, no una segunda copia: dos validaciones acabarían discrepando y
   * entonces la pantalla dejaría guardar algo que el servicio rechaza.
   */
  async save(data: Partial<Collaborator>, id?: string): Promise<string> {
    const problems = validateCollaborator(data);
    if (hasProblems(problems)) {
      throw new Error(Object.values(problems)[0]);
    }

    const payload = cleanForFirestore({
      ...data,
      commissionPercent: Number(data.commissionPercent),
      active: data.active !== false,
      updatedAt: serverTimestamp()
    });

    if (id) {
      await updateDoc(doc(this.collaboratorsRef, id), payload as Record<string, unknown>);
      return id;
    }
    const ref = await addDoc(this.collaboratorsRef, {
      ...(payload as Record<string, unknown>),
      createdAt: serverTimestamp(),
      createdBy: this.auth.authorizedUser()?.email || null
    });
    return ref.id;
  }

  /**
   * Borrar un colaborador.
   *
   * ⚠️ **No se borra si tiene ventas.** Su nombre está dentro de cada comisión
   * y el histórico seguiría apuntando a una ficha que ya no se puede abrir — la
   * misma razón por la que no se borra un cliente con reservas. Para eso está
   * darlo de baja: deja de salir al asignar y todo lo suyo se conserva.
   */
  async delete(id: string): Promise<void> {
    const ventas = await getDocs(query(this.salesRef, where('collaboratorId', '==', id)));
    if (!ventas.empty) {
      throw new Error('collaborators.problems.hasSales');
    }
    await deleteDoc(doc(this.collaboratorsRef, id));
  }

  // --- Ventas y comisiones -------------------------------------------------

  async salesOf(collaboratorId: string): Promise<CollaboratorSale[]> {
    const snap = await getDocs(
      query(this.salesRef, where('collaboratorId', '==', collaboratorId))
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as CollaboratorSale) }))
      .sort((a, b) => this.millis(b.createdAt) - this.millis(a.createdAt));
  }

  /** Todas las ventas, para la vista general de lo que se debe. */
  async allSales(): Promise<CollaboratorSale[]> {
    const snap = await getDocs(this.salesRef);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as CollaboratorSale) }));
  }

  /** ¿Esta reserva ya está asignada a alguien? */
  async saleForReservation(reservationId: string): Promise<CollaboratorSale | null> {
    const snap = await getDocs(
      query(this.salesRef, where('reservationId', '==', reservationId))
    );
    const vivo = snap.docs.find((d) => (d.data() as CollaboratorSale).status !== 'cancelled');
    const elegido = vivo || snap.docs[0];
    return elegido ? { id: elegido.id, ...(elegido.data() as CollaboratorSale) } : null;
  }

  /**
   * Asignar una reserva a un colaborador.
   *
   * ⚠️ **El neto y el porcentaje se CONGELAN aquí**, como el precio en la
   * reserva. Guardar solo la referencia y recalcular al pintar haría que la
   * comisión de hace tres meses cambiara sola el día que se le suba el
   * porcentaje al colaborador — y él tendría razón al no reconocer el número.
   *
   * ⚠️ **Una reserva no se asigna dos veces.** Dos comisiones vivas por el mismo
   * alquiler es pagar dos veces por una venta, y no se nota hasta que alguien
   * suma.
   */
  async assignSale(
    collaborator: Collaborator,
    reservation: Reservation,
    /**
     * Lo que se le va a pagar de verdad, si no es lo que dio el porcentaje.
     *
     * ⚠️ **El calculado se guarda igual**, no se pisa: sin él, un importe
     * ajustado es un número que dentro de seis meses no cuadra con nada y no
     * hay forma de saber si fue un acuerdo o un error.
     */
    override?: { amount: number; reason?: string }
  ): Promise<string> {
    const problema = saleProblem(reservation, collaborator);
    if (problema) throw new Error(problema);

    const yaAsignada = await this.saleForReservation(reservation.id!);
    if (yaAsignada && yaAsignada.status !== 'cancelled') {
      throw new Error('collaborators.problems.alreadyAssigned');
    }

    const netAmount = Number(reservation.pricingSnapshot?.netPrice) || 0;
    const percent = Number(collaborator.commissionPercent) || 0;
    const calculado = commissionAmount(netAmount, percent);

    if (override) {
      const problemaImporte = amountProblem(override.amount);
      if (problemaImporte) throw new Error(problemaImporte);
    }

    const venta: Omit<CollaboratorSale, 'id'> = {
      collaboratorId: collaborator.id!,
      collaboratorName: collaborator.name,
      reservationId: reservation.id!,
      reservationSnapshot: {
        clientName: reservation.clientSnapshot?.fullName || '—',
        vehicle: [reservation.vehicleSnapshot?.brand, reservation.vehicleSnapshot?.model]
          .filter(Boolean)
          .join(' ')
          .concat(
            reservation.vehicleSnapshot?.plateNumber
              ? ` · ${reservation.vehicleSnapshot.plateNumber}`
              : ''
          ),
        pickupDate: reservation.pickupDateTime ?? null
      },
      netAmount,
      commissionPercent: percent,
      // Lo que se paga manda en todos los balances; lo calculado se conserva
      // para poder explicar la cifra.
      commissionAmount: override ? roundMoney(Number(override.amount)) : calculado,
      calculatedAmount: calculado,
      adjustmentReason: override?.reason?.trim() || undefined,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: this.auth.authorizedUser()?.email || undefined
    };

    const ref = await addDoc(this.salesRef, cleanForFirestore(venta) as Record<string, unknown>);
    return ref.id;
  }

  /**
   * Cambiar a mano lo que se le va a pagar por una venta.
   *
   * ⚠️ **Solo mientras esté PENDIENTE.** Una vez pagada, el dinero salió:
   * cambiar el importe después reescribiría lo que se le entregó y el balance
   * cuadraría con una cifra que nunca se pagó. Es la misma razón por la que una
   * comisión pagada no se «despaga».
   *
   * ⚠️ Y `calculatedAmount` **no se toca**: es lo que dio el porcentaje el día
   * que se creó la venta, y es lo que permite explicar por qué se paga otra
   * cosa. Pisarlo dejaría el ajuste invisible.
   */
  async updateAmount(saleId: string, amount: number, reason?: string): Promise<void> {
    const problema = amountProblem(amount);
    if (problema) throw new Error(problema);

    const snap = await getDoc(doc(this.salesRef, saleId));
    if (!snap.exists()) throw new Error('collaborators.problems.saleNotFound');
    const venta = snap.data() as CollaboratorSale;
    if (venta.status === 'paid') throw new Error('collaborators.problems.alreadyPaid');
    if (venta.status === 'cancelled') throw new Error('collaborators.problems.saleCancelled');

    await updateDoc(
      doc(this.salesRef, saleId),
      cleanForFirestore({
        commissionAmount: roundMoney(Number(amount)),
        /**
         * Si la venta es anterior a que el importe fuera editable no tiene
         * calculado guardado. Se rescata del porcentaje congelado —que sí está—
         * para que el ajuste se pueda explicar a partir de ahora.
         */
        calculatedAmount:
          typeof venta.calculatedAmount === 'number'
            ? venta.calculatedAmount
            : commissionAmount(venta.netAmount, venta.commissionPercent),
        adjustmentReason: reason?.trim() || undefined,
        updatedAt: serverTimestamp()
      }) as Record<string, unknown>
    );
  }

  /**
   * Pagar una comisión.
   *
   * ⚠️ **No se «despaga».** Una comisión pagada es dinero que salió; volverla a
   * pendiente haría cuadrar el balance mintiendo. Si hubo un error, se corrige
   * hablando con el colaborador y anotándolo, no cambiando el estado.
   */
  async pay(
    saleId: string,
    method: CommissionPaymentMethod,
    note?: string
  ): Promise<void> {
    const snap = await getDoc(doc(this.salesRef, saleId));
    if (!snap.exists()) throw new Error('collaborators.problems.saleNotFound');
    const venta = snap.data() as CollaboratorSale;
    if (venta.status === 'paid') throw new Error('collaborators.problems.alreadyPaid');
    if (venta.status === 'cancelled') throw new Error('collaborators.problems.saleCancelled');

    await updateDoc(
      doc(this.salesRef, saleId),
      cleanForFirestore({
        status: 'paid',
        paidAt: serverTimestamp(),
        paidMethod: method,
        paidNote: note?.trim() || undefined,
        updatedAt: serverTimestamp()
      }) as Record<string, unknown>
    );
  }

  /**
   * Pagar de una vez todo lo pendiente de un colaborador.
   *
   * En un `writeBatch`: entra todo o no entra nada. Pagar seis comisiones con
   * seis escrituras sueltas y que falle la cuarta deja media deuda saldada y a
   * nadie sabiendo cuál mitad.
   */
  async paySettlement(
    collaboratorId: string,
    method: CommissionPaymentMethod,
    note?: string
  ): Promise<number> {
    const pendientes = (await this.salesOf(collaboratorId)).filter((s) => s.status === 'pending');
    if (!pendientes.length) return 0;

    const batch = writeBatch(this.firestore);
    for (const venta of pendientes) {
      batch.update(
        doc(this.salesRef, venta.id!),
        cleanForFirestore({
          status: 'paid',
          paidAt: serverTimestamp(),
          paidMethod: method,
          paidNote: note?.trim() || undefined,
          updatedAt: serverTimestamp()
        }) as Record<string, unknown>
      );
    }
    await batch.commit();
    return pendientes.length;
  }

  /**
   * Poner al día el estado de una comisión según su reserva.
   *
   * ⚠️ **Se llama al abrir la ficha, no hay nada que lo haga solo.** Es
   * deliberado: un disparador que anulara comisiones por su cuenta al cancelar
   * una reserva sería una Cloud Function más y otro sitio donde mirar cuando el
   * número no cuadre. Aquí el estado se resuelve donde se mira.
   */
  async syncWithReservation(sale: CollaboratorSale, reservationStatus?: string): Promise<void> {
    const nuevo = estadoSegunReserva(sale.status, reservationStatus);
    if (nuevo === sale.status) return;
    await updateDoc(
      doc(this.salesRef, sale.id!),
      cleanForFirestore({
        status: nuevo,
        cancelledReason:
          nuevo === 'cancelled' ? 'collaborators.cancelledByReservation' : undefined,
        updatedAt: serverTimestamp()
      }) as Record<string, unknown>
    );
  }

  /** Milisegundos de una fecha de Firestore, venga como venga. */
  private millis(value: unknown): number {
    if (!value) return 0;
    const v = value as { toDate?: () => Date; seconds?: number };
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
  }
}
