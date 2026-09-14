import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
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
import { StorageService } from '@core/firebase/storage.service';
import { PermissionsService } from '@core/auth/permissions.service';
import {
  Collaborator,
  CollaboratorInvoice,
  CollaboratorSale,
  CommissionKind,
  CommissionPaymentMethod
} from '@shared/models/collaborator.model';
import { Reservation } from '@shared/models/reservation.model';
import {
  amountProblem,
  commissionAmount,
  estadoSegunReserva,
  paidAtProblem,
  saleProblem,
  validateCollaborator,
  validateCollaboratorInvoice
} from '@shared/utils/collaborator.util';
import {
  OwnerShareAccrual,
  ownerShareAccruals,
  unsettledAccruals
} from '@shared/utils/owner-share.util';
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
  private storage = inject(StorageService);
  private permissions = inject(PermissionsService);

  private collaboratorsRef = collection(this.firestore, 'collaborators');
  private salesRef = collection(this.firestore, 'collaboratorSales');
  private invoicesRef = collection(this.firestore, 'collaboratorInvoices');

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
      /**
       * ⚠️ **Solo si viene.** `Number(undefined)` es `NaN`, y un `NaN` escrito
       * en Firestore es un reparto que después no se puede ni leer ni comparar.
       * Un colaborador que no cede coches no tiene este dato y no debe tenerlo
       * inventado.
       */
      ownerSharePercent:
        data.ownerSharePercent === null ||
        data.ownerSharePercent === undefined ||
        (data.ownerSharePercent as unknown) === ''
          ? undefined
          : Number(data.ownerSharePercent),
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

  /**
   * ¿Esta reserva ya tiene un apunte **de esta clase**?
   *
   * ⚠️ **El `kind` NO es opcional, y ahí está el fallo que evita.** Una misma
   * reserva puede tener legítimamente **dos** apuntes: la comisión por traer al
   * cliente y el reparto por ceder el coche. Preguntando «¿esta reserva ya está
   * asignada?» a secas, el reparto del propietario haría que la comisión de
   * captación de esa misma reserva se rechazara con «ya está asignada» — que es
   * exactamente lo que Dorel pidió que no pasara al separar los dos conceptos.
   *
   * Por eso el parámetro es obligatorio: quien pregunte tiene que decir por cuál
   * de los dos pregunta, y el compilador no le deja olvidarse.
   */
  async saleForReservation(
    reservationId: string,
    kind: CommissionKind
  ): Promise<CollaboratorSale | null> {
    const snap = await getDocs(
      query(
        this.salesRef,
        where('reservationId', '==', reservationId),
        where('kind', '==', kind)
      )
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

    /**
     * ⚠️ **Solo contra las de captación.** Si el coche de esta reserva es de un
     * colaborador, al cerrarla habrá también un apunte de reparto; mirándolos
     * todos, esa reserva quedaría marcada como «ya asignada» y no se podría
     * reconocer nunca la comisión de quien trajo al cliente.
     */
    const yaAsignada = await this.saleForReservation(reservation.id!, 'referral');
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
      /**
       * ⚠️ **Esta vía es siempre de captación**, y por eso va escrito y no
       * deducido. Asignar una reserva a un colaborador desde su ficha es decir
       * que él trajo al cliente; el reparto por ceder el coche no se asigna a
       * mano —sale del vehículo y se congela en la reserva— y se devenga al
       * cerrarla. Son dos apuntes distintos aunque acaben en la misma persona.
       */
      kind: 'referral',
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
   * Reconocer lo devengado por sus coches: convierte los repartos derivados en
   * apuntes con su importe **congelado**.
   *
   * ⚠️ **Liquidar NO es pagar.** Son dos cosas distintas y aquí solo pasa la
   * primera: se reconoce lo que se le debe, y el apunte nace `pending`. El
   * dinero se le entrega después, por el mismo camino que las comisiones de
   * captación — y se le puede pagar sin que haya llegado todavía su factura.
   *
   * ⚠️ **Aquí es donde el importe deja de derivarse.** Hasta este momento la
   * cifra sale de la reserva cada vez que se pinta; a partir de ahora es un
   * número escrito que ya no se mueve, igual que el precio de la reserva o el
   * porcentaje de una comisión. Es lo que permite explicar dentro de seis meses
   * por qué se le pagó eso.
   *
   * ⚠️ **En un `writeBatch`: entra todo o no entra nada.** Reconocer cuatro
   * repartos con cuatro escrituras sueltas y que falle la tercera deja media
   * liquidación hecha y a nadie sabiendo cuál mitad — el mismo motivo por el que
   * la reserva y sus pagos se escriben juntos.
   */
  async settleOwnerShares(accruals: OwnerShareAccrual[]): Promise<number> {
    const propios = (accruals || []).filter((a) => a.collaboratorId);
    if (!propios.length) return 0;

    const colaboradorId = propios[0].collaboratorId;
    if (propios.some((a) => a.collaboratorId !== colaboradorId)) {
      throw new Error('collaborators.problems.mixedCollaborators');
    }

    /**
     * ⚠️ **Se vuelve a mirar qué hay escrito, aunque quien llama ya lo filtre.**
     * Lo que llega es una derivación calculada antes: entre eso y esta escritura
     * caben otra pestaña, otro operador y —desde que se reconoce solo al cerrar
     * la reserva— el propio cierre. Sin esta comprobación, el mismo reparto se
     * reconocería dos veces y al propietario se le debería el doble, con las dos
     * filas igual de creíbles.
     */
    const existentes = await getDocs(
      query(
        this.salesRef,
        where('collaboratorId', '==', colaboradorId),
        where('kind', '==', 'vehicle_owner')
      )
    );
    const yaReconocidas = new Set(
      existentes.docs
        .map((d) => d.data() as CollaboratorSale)
        .filter((v) => v.status !== 'cancelled')
        .map((v) => v.reservationId)
    );

    const nuevas = propios.filter((a) => !yaReconocidas.has(a.reservationId));
    if (!nuevas.length) return 0;

    const batch = writeBatch(this.firestore);
    for (const a of nuevas) {
      const venta: Omit<CollaboratorSale, 'id'> = {
        collaboratorId: a.collaboratorId,
        /**
         * ⚠️ **Del devengo y no de la ficha del colaborador**, y eso es lo que
         * permite reconocer sin leer `collaborators`. Es además el nombre
         * congelado en la reserva: el que estaba pactado el día del alquiler.
         */
        collaboratorName: a.collaboratorName,
        kind: 'vehicle_owner',
        reservationId: a.reservationId,
        reservationSnapshot: {
          clientName: a.clientName,
          vehicle: a.vehicle,
          pickupDate: a.pickupDate ?? null
        },
        netAmount: a.netAmount,
        // El porcentaje que se congeló en la reserva, no el del coche de hoy.
        commissionPercent: a.sharePercent,
        commissionAmount: a.amount,
        calculatedAmount: a.amount,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: this.auth.authorizedUser()?.email || undefined
      };
      batch.set(doc(this.salesRef), cleanForFirestore(venta) as Record<string, unknown>);
    }

    await batch.commit();
    return nuevas.length;
  }

  /**
   * Reconocer el reparto de **una reserva recién cerrada**.
   *
   * ⚠️ **Se llama sola al cerrar, y por eso no puede tumbar el cierre.** Si
   * falla —permisos, red— la reserva se queda cerrada igual y el reparto sigue
   * derivándose de ella: lo recoge el siguiente administrador que abra la ficha
   * del colaborador, y mientras tanto los informes ya lo cuentan. Perder el
   * apunte es un retraso; perder el cierre que el operador acaba de hacer, un
   * problema mucho mayor. Es el mismo criterio que el sellado del contrato.
   *
   * ⚠️ **Solo escribe quien puede.** `collaboratorSales` es de administrador en
   * `firestore.rules` y **cerrar una reserva no pide ningún permiso**: el
   * empleado que termina la devolución en la calle recibiría un
   * `permission-denied` por algo que no ha pedido hacer. Devuelve `0` y sigue.
   */
  async accrueFromReservation(reservation: {
    id?: string;
    reservationStatus?: string;
    ownerShareSnapshot?: unknown;
    pricingSnapshot?: unknown;
    vehicleSnapshot?: unknown;
    clientSnapshot?: unknown;
    pickupDateTime?: unknown;
  }): Promise<number> {
    if (!this.permissions.can('viewCollaborators')) return 0;

    // La misma derivación que usa la ficha, sobre una sola reserva: si el coche
    // es de Velto o la reserva no está cerrada, no sale nada y no se escribe.
    const devengos = ownerShareAccruals([reservation as never]);
    if (!devengos.length) return 0;

    try {
      return await this.settleOwnerShares(devengos);
    } catch (error) {
      console.error('Error accruing the owner share:', error);
      return 0;
    }
  }

  /**
   * Reconocer todo lo que un colaborador tenga devengado y sin apuntar.
   *
   * Es la **red** del reconocimiento automático: recoge lo que quedó fuera
   * porque quien cerró la reserva era un empleado, o porque la escritura falló.
   */
  async accruePendingFor(
    collaboratorId: string,
    reservations: unknown[]
  ): Promise<number> {
    if (!this.permissions.can('viewCollaborators')) return 0;

    const ventas = await this.salesOf(collaboratorId);
    const yaReconocidas = ventas
      .filter((v) => v.kind === 'vehicle_owner' && v.status !== 'cancelled')
      .map((v) => v.reservationId);

    const pendientes = unsettledAccruals(
      ownerShareAccruals((reservations || []) as never[], collaboratorId),
      yaReconocidas
    );
    if (!pendientes.length) return 0;

    try {
      return await this.settleOwnerShares(pendientes);
    } catch (error) {
      console.error('Error accruing pending owner shares:', error);
      return 0;
    }
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
    note?: string,
    options?: {
      /**
       * Cuáles entran en este pago. Sin lista, **todas las pendientes**, que es
       * como se comportaba antes de que se pudiera elegir.
       */
      saleIds?: string[];
      /**
       * Cuándo salió el dinero de verdad.
       *
       * ⚠️ **No es lo mismo que cuándo se apunta.** A un colaborador se le paga
       * en efectivo el martes y se anota el jueves; sellando siempre el momento
       * de la escritura, el histórico de pagos —que `settlements()` agrupa por
       * día— contaría ese pago en un día en el que no se pagó nada, y no habría
       * forma de cuadrarlo con el extracto ni con lo que él recuerda.
       */
      paidAt?: Date;
    }
  ): Promise<number> {
    const pendientes = (await this.salesOf(collaboratorId)).filter((s) => s.status === 'pending');
    if (!pendientes.length) return 0;

    const elegidas = options?.saleIds?.length
      ? pendientes.filter((s) => options.saleIds!.includes(s.id!))
      : pendientes;
    if (!elegidas.length) return 0;

    /**
     * ⚠️ **La misma función que mira la pantalla**, no una segunda copia: dos
     * comprobaciones acabarían discrepando y entonces la pantalla dejaría pasar
     * algo que el servicio rechaza. Ver `paidAtProblem()`.
     */
    const problemaFecha = paidAtProblem(options?.paidAt);
    if (problemaFecha) throw new Error(problemaFecha);

    const batch = writeBatch(this.firestore);
    for (const venta of elegidas) {
      batch.update(
        doc(this.salesRef, venta.id!),
        cleanForFirestore({
          status: 'paid',
          // Firestore guarda un `Date` como Timestamp, así que la fecha elegida
          // viaja tal cual; sin ella, el sello del servidor de siempre.
          paidAt: options?.paidAt ?? serverTimestamp(),
          paidMethod: method,
          paidNote: note?.trim() || undefined,
          updatedAt: serverTimestamp()
        }) as Record<string, unknown>
      );
    }
    await batch.commit();
    return elegidas.length;
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

  // --- La factura que manda el propietario ---------------------------------

  /**
   * Las facturas recibidas de un colaborador, de la más reciente a la más
   * antigua **por la fecha del documento**, no por cuándo se registró: es la
   * fecha por la que él la busca y por la que se archiva.
   */
  async invoicesOf(collaboratorId: string): Promise<CollaboratorInvoice[]> {
    const snap = await getDocs(
      query(this.invoicesRef, where('collaboratorId', '==', collaboratorId))
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as CollaboratorInvoice) }))
      .sort((a, b) => this.millis(b.date) - this.millis(a.date));
  }

  /**
   * Registrar la factura del propietario y **vincularla a lo que cubre**.
   *
   * ⚠️ **La factura y sus apuntes se escriben juntos, en un `writeBatch`.** Es
   * lo mismo que hacen la reserva y sus pagos: guardar la factura y fallar al
   * vincular dejaría un documento registrado que no justifica nada, y los
   * repartos seguirían saliendo como pendientes de recibir factura — así que
   * alguien la volvería a pedir, y el propietario diría con razón que ya la
   * mandó.
   *
   * ⚠️ **El importe no tiene que cuadrar con lo que cubre.** Ver
   * `invoiceMismatch()`: una factura con IRPF retenido trae menos y es correcta.
   * La diferencia se enseña, no se rechaza.
   */
  async saveInvoice(
    collaborator: Collaborator,
    data: Partial<CollaboratorInvoice>,
    saleIds: string[],
    id?: string
  ): Promise<string> {
    if (!collaborator?.id) throw new Error('collaborators.problems.collaboratorRequired');

    const problems = validateCollaboratorInvoice(data);
    if (hasProblems(problems)) {
      throw new Error(Object.values(problems)[0] as string);
    }

    const ref = id ? doc(this.invoicesRef, id) : doc(this.invoicesRef);
    const batch = writeBatch(this.firestore);

    const payload = cleanForFirestore({
      ...data,
      collaboratorId: collaborator.id,
      collaboratorName: collaborator.name,
      number: data.number?.trim(),
      amount: Number(data.amount),
      updatedAt: serverTimestamp(),
      ...(id
        ? {}
        : { createdAt: serverTimestamp(), createdBy: this.auth.authorizedUser()?.email || null })
    }) as Record<string, unknown>;

    if (id) batch.update(ref, payload);
    else batch.set(ref, payload);

    /**
     * Al editar, **se sueltan primero los que ya no cubre**. Sin esto, quitar un
     * reparto de una factura lo dejaría apuntando a ella para siempre y nunca
     * volvería a salir como pendiente de justificar.
     */
    if (id) {
      const previas = await getDocs(
        query(this.salesRef, where('receivedInvoiceId', '==', id))
      );
      for (const d of previas.docs) {
        if (!saleIds.includes(d.id)) {
          batch.update(doc(this.salesRef, d.id), {
            receivedInvoiceId: deleteField(),
            updatedAt: serverTimestamp()
          });
        }
      }
    }

    for (const saleId of saleIds) {
      batch.update(doc(this.salesRef, saleId), {
        receivedInvoiceId: ref.id,
        updatedAt: serverTimestamp()
      });
    }

    await batch.commit();
    return ref.id;
  }

  /**
   * Subir el PDF o la foto de la factura del propietario.
   *
   * ⚠️ **La ruta lleva el id de la factura dentro**, para que borrarla se lleve
   * su fichero sin tener que adivinar dónde está — es lo que ya costó descubrir
   * con el mantenimiento, cuya ruta obliga a leer el documento antes de
   * borrarlo porque el vehículo viaja en el camino.
   */
  async uploadInvoiceFile(
    invoiceId: string,
    file: File
  ): Promise<{ fileUrl: string; filePath: string }> {
    const limpio = file.name.replace(/[^\w.\-]/g, '_');
    const filePath = `collaborator-invoices/${invoiceId}/${Date.now()}_${limpio}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.storage.uploadFile(filePath, bytes);
    const fileUrl = await this.storage.getDownloadURL(filePath);
    return { fileUrl, filePath };
  }

  /**
   * Borrar una factura recibida.
   *
   * ⚠️ **Esto se puede hacer, y no contradice nada.** Una factura emitida por
   * VELTO es inmutable porque acredita algo que la empresa ha declarado; esta
   * llega de fuera y solo registra un papel que está en un cajón. Si se teclea
   * mal se corrige, y si se registró por error se quita.
   *
   * ⚠️ **Los apuntes se sueltan**, o quedarían apuntando a una factura que ya no
   * existe y no volverían a pedir la suya nunca. Y **el fichero va antes que el
   * documento**: si Storage falla, la factura sigue ahí y se puede reintentar;
   * al revés se pierde el rastro de qué había que borrar.
   */
  async deleteInvoice(id: string): Promise<void> {
    const snap = await getDoc(doc(this.invoicesRef, id));
    const factura = snap.exists() ? (snap.data() as CollaboratorInvoice) : null;

    if (factura?.filePath) {
      try {
        await this.storage.deleteFile(factura.filePath);
      } catch (error) {
        // Un fichero que se resista no aborta el borrado, solo se registra:
        // dejar la factura a medio borrar es peor que quedarse un huérfano.
        console.error('Error deleting invoice file:', error);
      }
    }

    const vinculadas = await getDocs(
      query(this.salesRef, where('receivedInvoiceId', '==', id))
    );
    const batch = writeBatch(this.firestore);
    for (const d of vinculadas.docs) {
      batch.update(doc(this.salesRef, d.id), {
        receivedInvoiceId: deleteField(),
        updatedAt: serverTimestamp()
      });
    }
    batch.delete(doc(this.invoicesRef, id));
    await batch.commit();
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
