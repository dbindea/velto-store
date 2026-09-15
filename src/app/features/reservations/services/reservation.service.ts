import { Injectable, inject } from '@angular/core';
import { Firestore, CollectionReference, arrayUnion, collection, doc, addDoc, updateDoc, getDoc, getDocs, onSnapshot, query, orderBy, where, writeBatch } from '@angular/fire/firestore';
import { Observable, from, firstValueFrom } from 'rxjs';
import { map, first } from 'rxjs/operators';
import { Vehicle } from '@shared/models/vehicle.model';
import { VehicleService } from '@features/vehicles/services/vehicle.service';
import {
  Reservation,
  ReservationStatus,
  BLOCKING_STATUSES,
  ReservationPricingSnapshot,
  ReservationNote,
  WorkflowException,
  AdditionalDriver
} from '@shared/models/reservation.model';
import { Client } from '@shared/models/client.model';
import { 
  calculateCalendarDays, 
  toTimestamp, 
  toDate,
  dateRangesOverlap 
} from '@shared/utils/reservation-date.util';
import {
  calculateBasePrice,
  findPricingRuleByDays,
  resolveRentalPrice
} from '@shared/utils/pricing.util';
import { buildDeposit } from '@shared/utils/deposit.util';
import { ownerShareSnapshotOf } from '@shared/utils/owner-share.util';
import { CollaboratorService } from '@features/collaborators/services/collaborator.service';
import { SettingsService } from '@features/settings/services/settings.service';
import { roundMoney } from '@shared/utils/payment-summary.util';
import { buildReservationNote } from '@shared/utils/reservation-note.util';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { PaymentService } from '@features/payments/services/payment.service';
import { InspectionService } from '@features/inspections/services/inspection.service';
import { AuthService } from '@core/auth/auth.service';
import {
  Workflow,
  WorkflowContext,
  canCloseReservation as assertCanClose,
  canCreateReservationForClient,
  buildWorkflowException,
  ExceptionableAction
} from '@shared/utils/reservation-workflow.util';
import { PermissionsService } from '@core/auth/permissions.service';
import { StorageService } from '@core/firebase/storage.service';
import { TranslateService } from '@core/i18n/translate.service';
import {
  canEditField,
  EditableField,
  initialPaymentProblem,
  redistributeInitialPayment,
  requiresNewContract
} from '@shared/utils/reservation-edit.util';
import { ContractService } from '@features/contracts/services/contract.service';

/**
 * Lo que se puede pedir cambiar de una reserva ya creada.
 *
 * ⚠️ **Es una lista cerrada y no un `Partial<Reservation>`.** Abierto —lo que
 * aceptaba el viejo `updateReservation()`— deja escribir `reservationStatus`,
 * `contractInfo` o `ownerShareSnapshot` desde cualquier llamada, saltándose el
 * workflow y las reglas de Firestore. Aquí solo entra lo que un operador
 * negocia con el cliente.
 */
export interface ReservationEdit {
  /** La ficha entera del cliente nuevo: el snapshot se rehace desde ella. */
  client?: Client;
  pickupDateTime?: Date;
  returnDateTime?: Date;
  /**
   * Precio acordado a mano, **NETO** como en la creación. `null` lo retira y
   * devuelve la reserva a la tarifa con su descuento de fidelidad.
   */
  agreedNetPrice?: number | null;
  depositRequired?: number;
  /** Obligatorio si la fianza queda en 0. Lo exige `buildDeposit`. */
  depositWaivedReason?: string;
  /** Puede ser 0: «no se pide señal». */
  initialPaymentRequired?: number;
  additionalDrivers?: AdditionalDriver[];
}

export interface ReservationEditResult {
  /** Qué cambió de verdad. Vacío si se guardó sin tocar nada. */
  changed: EditableField[];
  /**
   * El contrato firmado ya no dice la verdad y hay que rehacerlo.
   *
   * ⚠️ **Esto no lo hace el servicio solo**, y es deliberado: sustituir un
   * contrato firmado obliga a que el cliente vuelva a firmar, y eso es una
   * decisión del operador delante del cliente, no un efecto secundario de
   * guardar un formulario.
   */
  requiresNewContract: boolean;
}

/**
 * El precio acordado a mano que tiene HOY la reserva, o `null` si no hay
 * ninguno y manda la tarifa.
 *
 * ⚠️ **Exportada para que el formulario y el servicio pregunten lo mismo.** El
 * formulario la usa al precargarse y `changedFields()` al comparar; escrita dos
 * veces, la primera vez que discrepen una pantalla dirá que no se cambió nada y
 * la otra que sí.
 */
export function agreedNetPriceOf(r: Reservation): number | null {
  const snap = r.pricingSnapshot;
  if (!snap?.manualAdjustment) return null;
  return snap.netPrice === undefined ? null : roundMoney(snap.netPrice);
}

/** El snapshot del arrendatario, con los mismos campos que en la creación. */
function clientSnapshotOf(client: Client) {
  return {
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
    documentNumber: client.documentNumber
  };
}

/**
 * Qué campos cambian **de verdad**.
 *
 * ⚠️ Un campo que llega igual que estaba no es un cambio, y tratarlo como tal
 * tiene una consecuencia concreta: abrir el formulario de una reserva con la
 * fianza ya cobrada y guardarlo sin tocar nada fallaría con «la fianza ya está
 * cobrada», porque el importe viaja en la petición aunque nadie lo escribiera.
 */
function changedFields(actual: Reservation, edit: ReservationEdit): EditableField[] {
  const out: EditableField[] = [];
  if (edit.client && edit.client.id !== actual.clientId) out.push('client');
  if (edit.pickupDateTime && !sameInstant(edit.pickupDateTime, actual.pickupDateTime)) {
    out.push('pickupDateTime');
  }
  if (edit.returnDateTime && !sameInstant(edit.returnDateTime, actual.returnDateTime)) {
    out.push('returnDateTime');
  }
  if (edit.agreedNetPrice !== undefined) {
    /**
     * ⚠️ **«Sin precio acordado» no es lo mismo que «el neto de la tarifa».**
     * Comparando contra `netPrice` a secas, una reserva sin precio a mano daba
     * `null !== 250` y se contaba como cambio de precio **sin que nadie tocara
     * el campo**: recalculaba de más y, lo que importa, marcaba la reserva como
     * «hay que rehacer el contrato» por un cambio que no existió.
     *
     * Lo que hubo antes es un precio acordado **solo si hay
     * `manualAdjustment`**, que es lo mismo que mira el formulario al
     * precargarse. Las dos preguntas tienen que ser la misma o discrepan.
     */
    const anterior = agreedNetPriceOf(actual);
    const pedido = edit.agreedNetPrice === null ? null : roundMoney(edit.agreedNetPrice);
    if (pedido !== anterior) out.push('agreedPrice');
  }
  if (
    edit.depositRequired !== undefined &&
    roundMoney(edit.depositRequired) !== roundMoney(actual.deposit?.requiredAmount ?? 0)
  ) {
    out.push('depositAmount');
  }
  if (
    edit.initialPaymentRequired !== undefined &&
    roundMoney(edit.initialPaymentRequired) !==
      roundMoney(actual.initialPayment?.requiredAmount ?? 0)
  ) {
    out.push('initialPaymentAmount');
  }
  if (edit.additionalDrivers && !sameDrivers(edit.additionalDrivers, actual.additionalDrivers)) {
    out.push('additionalDrivers');
  }
  return out;
}

function sameInstant(a: Date, b: unknown): boolean {
  const otra = toDate(b);
  return a.getTime() === otra.getTime();
}

function sameDrivers(a: AdditionalDriver[], b?: AdditionalDriver[]): boolean {
  const norm = (list?: AdditionalDriver[]) =>
    JSON.stringify(
      (list || []).map((d) => [
        d.fullName || '',
        d.documentNumber || '',
        d.drivingLicenseNumber || ''
      ])
    );
  return norm(a) === norm(b);
}

/**
 * El texto de la nota interna: «Reserva modificada: precio, señal».
 *
 * ⚠️ **Se resuelve AQUÍ, no se guarda como clave.** Las notas internas son
 * texto libre —se pintan tal cual, sin pasar por el pipe— y son un histórico:
 * se escriben una vez y se leen dentro de meses. Guardada como clave salía
 * literalmente `reservations.edit.note: agreedPrice, initialPaymentAmount` en
 * la ficha, que no le dice nada a nadie.
 *
 * Queda en el idioma en que trabajaba quien la escribió, que es lo correcto
 * para un histórico: dice lo que esa persona vio.
 */
function describeEdit(changed: EditableField[], t: TranslateService): string {
  const nombres = changed.map((f) => t.translate(`reservations.edit.fields.${f}`));
  return `${t.translate('reservations.edit.note')}: ${nombres.join(', ')}`;
}

export interface VehicleAvailabilityResult {
  vehicleId: string;
  vehicle: Vehicle;
  available: boolean;
  totalDays: number;
  pricing: ReservationPricingSnapshot | null;
  conflictReservationId?: string;
  conflictMessage?: string;
  /**
   * Un aviso sobre el coche que **no impide alquilarlo**: hoy, la ITV o un
   * mantenimiento vencidos.
   *
   * ⚠️ **Avisa y no bloquea, a propósito.** Una ITV caducada de un día con cita
   * dada no es lo mismo que una de hace tres meses, y quien está en el mostrador
   * con el cliente delante tiene que poder decidir. Lo que no puede es **no
   * saberlo**: hasta el 11 de septiembre de 2026 el asistente ofrecía el coche
   * sin decir nada, mientras el correo de las 9:00 afirmaba que «el coche no se
   * puede alquilar». La frase y el hecho se deciden juntos.
   */
  warningMessage?: string;
}

@Injectable({ providedIn: 'root' })
export class ReservationService {
  private firestore = inject(Firestore);
  private permissions = inject(PermissionsService);
  private reservationsRef: CollectionReference;
  private vehicleService = inject(VehicleService);
  private paymentService = inject(PaymentService);
  // Solo para leer el contrato vigente al editar. `contract.service.ts` no
  // importa este servicio, así que no hay ciclo.
  private contractService = inject(ContractService);
  private translate = inject(TranslateService);
  private collaboratorService = inject(CollaboratorService);
  private inspectionService = inject(InspectionService);
  private authService = inject(AuthService);
  private settingsService = inject(SettingsService);
  private storageService = inject(StorageService);

  /**
   * El tipo de IVA con el que nace una reserva.
   *
   * Sale de Ajustes y **se congela en el snapshot**: una subida futura del tipo
   * general no puede mover un contrato ya firmado. El servicio lo lee por su
   * cuenta y no se fía del que traiga la pantalla, igual que recalcula el precio
   * en vez de fiarse de la cifra que enseñó la UI.
   */
  private currentVatRate(): number {
    return this.settingsService.settings().vatRate;
  }

  constructor() {
    this.reservationsRef = collection(this.firestore, 'reservations');
  }

  /**
   * Removes `undefined` before writing. Delegates to the shared cleaner, which
   * also strips `undefined` from inside arrays — the local version returned
   * arrays untouched — and leaves Firestore sentinels alone.
   *
   * Nulls are kept: this service writes them meaningfully.
   */
  private cleanData<T>(data: T): T {
    return cleanForFirestore(data);
  }

  /**
   * Get all reservations.
   */
  getReservations(): Observable<Reservation[]> {
    const q = query(this.reservationsRef, orderBy('pickupDateTime', 'asc'));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)))
    );
  }

  /**
   * Get all reservations for a specific client.
   * NOTE: Firestore may require a composite index for vehicleId + clientId + pickupDateTime.
   */
  getReservationsByClient(clientId: string): Observable<Reservation[]> {
    const q = query(
      this.reservationsRef,
      where('clientId', '==', clientId),
      orderBy('pickupDateTime', 'desc')
    );
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)))
    );
  }

  /**
   * Get all reservations for a specific vehicle.
   * NOTE: Firestore may require a composite index for vehicleId + pickupDateTime.
   */
  getReservationsByVehicle(vehicleId: string): Observable<Reservation[]> {
    const q = query(
      this.reservationsRef,
      where('vehicleId', '==', vehicleId),
      orderBy('pickupDateTime', 'desc')
    );
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)))
    );
  }

  /**
   * Get reservation by ID.
   */
  /**
   * Live subscription to a single reservation.
   *
   * The detail view changes underneath the operator while they work: signing a
   * contract updates `contractStatus`, completing an inspection moves
   * `reservationStatus`. With a one-shot `getDoc()` the screen kept showing
   * "Pendiente de firma" after the customer had already signed on their phone.
   */
  getReservationById(id: string): Observable<Reservation | null> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    return new Observable<Reservation | null>((subscriber) => {
      const unsubscribe = onSnapshot(
        docRef,
        (snap) => {
          subscriber.next(snap.exists() ? ({ id: snap.id, ...snap.data() } as Reservation) : null);
        },
        (error) => subscriber.error(error)
      );
      return () => unsubscribe();
    });
  }

  /**
   * Check if a vehicle is available for given dates.
   */
  async checkVehicleAvailability(
    vehicleId: string,
    pickupDateTime: Date,
    returnDateTime: Date,
    /**
     * La reserva que se está **editando**, para que no se encuentre a sí misma.
     *
     * ⚠️ Sin esto, cambiar las fechas de una reserva es imposible: la propia
     * reserva sigue en `reservations` con sus fechas viejas y un estado que
     * bloquea, así que se solapa consigo misma y la comprobación responde
     * «ya existe una reserva para estas fechas». Y el mensaje señalaría al
     * operador un conflicto con una reserva que es la que tiene delante.
     */
    excludeReservationId?: string
  ): Promise<{ available: boolean; conflictId?: string; conflictMessage?: string }> {
    // Get all reservations for this vehicle
    const q = query(
      this.reservationsRef, 
      where('vehicleId', '==', vehicleId)
    );
    const snapshot = await getDocs(q);
    
    const pickupTimestamp = toTimestamp(pickupDateTime);
    const returnTimestamp = toTimestamp(returnDateTime);
    
    for (const docSnap of snapshot.docs) {
      const reservation = docSnap.data() as Reservation;

      // La reserva que se está editando no compite consigo misma.
      if (excludeReservationId && docSnap.id === excludeReservationId) {
        continue;
      }

      // Skip non-blocking statuses
      if (!BLOCKING_STATUSES.includes(reservation.reservationStatus)) {
        continue;
      }
      
      // Check for overlap
      const existingPickup = toDate(reservation.pickupDateTime);
      const existingReturn = toDate(reservation.returnDateTime);
      
      if (dateRangesOverlap(existingPickup, existingReturn, pickupDateTime, returnDateTime)) {
        return {
          available: false,
          conflictId: docSnap.id,
          // Clave i18n, no una frase. Antes era español duro **y** metía el
          // valor crudo del enum entre paréntesis: al operador le salía
          // «Ya existe una reserva (reserved) para estas fechas». El estado en
          // inglés no le dice nada a quien atiende el mostrador, y la frase no
          // se traducía en los otros dos idiomas.
          conflictMessage: 'reservations.availability.conflict'
        };
      }
    }
    
    return { available: true };
  }

  /**
   * Search availability for all vehicles.
   */
  async searchAvailability(
    pickupDateTime: Date,
    returnDateTime: Date
  ): Promise<VehicleAvailabilityResult[]> {
    // Get total days
    const totalDays = calculateCalendarDays(pickupDateTime, returnDateTime);
    if (totalDays <= 0) {
      throw new Error('Invalid dates: return must be after pickup');
    }

    // Get all vehicles
    const vehicles = await new Promise<Vehicle[]>((resolve) => {
      this.vehicleService.getVehicles().subscribe(v => resolve(v));
    });

    // Get all reservations
    const q = query(this.reservationsRef);
    const reservationSnapshot = await getDocs(q);
    const reservations = reservationSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Reservation));

    /**
     * Los mantenimientos vencidos, para poder avisar.
     *
     * ⚠️ **Se filtra por fecha en memoria.** `nextDueDate` es opcional y un
     * `orderBy` sobre un campo opcional deja fuera, sin avisar, a los que no lo
     * llevan — es lo que hizo desaparecer una reparación de la ficha de un coche
     * (M-40). Aquí serían justo los que hay que enseñar.
     */
    const ahora = Date.now();
    const vencidosPorVehiculo = new Set<string>();
    try {
      const mantenimientos = await getDocs(
        query(
          collection(this.firestore, 'vehicleMaintenance'),
          where('status', 'in', ['pending', 'scheduled', 'overdue'])
        )
      );
      for (const d of mantenimientos.docs) {
        const m = d.data() as { vehicleId?: string; nextDueDate?: unknown };
        if (!m.vehicleId || !m.nextDueDate) continue;
        const cuando = toDate(m.nextDueDate);
        if (!isNaN(cuando.getTime()) && cuando.getTime() < ahora) {
          vencidosPorVehiculo.add(m.vehicleId);
        }
      }
    } catch {
      // Un aviso que no se puede calcular no puede impedir buscar un coche.
    }

    const pickupTimestamp = toTimestamp(pickupDateTime);
    const returnTimestamp = toTimestamp(returnDateTime);

    const results: VehicleAvailabilityResult[] = [];

    for (const vehicle of vehicles) {
      // Only consider available vehicles
      if (vehicle.status !== 'available') {
        results.push({
          vehicleId: vehicle.id!,
          vehicle,
          available: false,
          totalDays,
          pricing: null,
          // Estaba en español duro y además con la tilde corrupta:
          // 'VehÃ­culo no disponible en flota', que es lo que leía el operador.
          conflictMessage: 'reservations.availability.notInFleet'
        });
        continue;
      }

      // Check for conflicting reservations
      let conflictId: string | undefined;
      let conflictMessage: string | undefined;
      
      for (const reservation of reservations) {
        if (reservation.vehicleId !== vehicle.id) continue;
        
        // Skip non-blocking statuses
        if (!BLOCKING_STATUSES.includes(reservation.reservationStatus)) {
          continue;
        }
        
        const existingPickup = toDate(reservation.pickupDateTime);
        const existingReturn = toDate(reservation.returnDateTime);
        
        if (dateRangesOverlap(existingPickup, existingReturn, pickupDateTime, returnDateTime)) {
          conflictId = reservation.id;
          // Este es el que ve el operador en el paso 2 del asistente. Ponía
          // «Reservado (confirmed)»: el estado en inglés entre paréntesis no le
          // dice nada a quien atiende el mostrador, y la frase iba en español
          // duro para los tres idiomas.
          conflictMessage = 'reservations.availability.conflict';
          break;
        }
      }

      if (conflictId) {
        results.push({
          vehicleId: vehicle.id!,
          vehicle,
          available: false,
          totalDays,
          pricing: null,
          conflictReservationId: conflictId,
          conflictMessage
        });
        continue;
      }

      // Calculate pricing
      const pricingRules = vehicle.pricingRules || [];
      const basePriceResult = calculateBasePrice(pricingRules, totalDays);
      
      const pricing: ReservationPricingSnapshot = {
        totalDays,
        appliedRule: basePriceResult.appliedRule ? {
          minDays: basePriceResult.appliedRule.minDays,
          maxDays: basePriceResult.appliedRule.maxDays,
          pricePerDay: basePriceResult.appliedRule.pricePerDay,
          label: basePriceResult.appliedRule.label
        } : null,
        pricePerDay: basePriceResult.pricePerDay,
        basePrice: basePriceResult.basePrice,
        finalPrice: basePriceResult.basePrice
      };

      results.push({
        vehicleId: vehicle.id!,
        vehicle,
        available: true,
        totalDays,
        pricing,
        // Se ofrece igual, pero con el aviso delante. Ver `warningMessage`.
        warningMessage: vencidosPorVehiculo.has(vehicle.id!)
          ? 'reservations.availability.maintenanceOverdue'
          : undefined
      });
    }

    // Sort: available first, then by price
    results.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (!a.pricing || !b.pricing) return 0;
      return a.pricing.finalPrice - b.pricing.finalPrice;
    });

    return results;
  }

  /**
   * Create a new reservation.
   * Re-checks availability before saving.
   */
  async createReservation(
    vehicleId: string,
    clientId: string,
    pickupDateTime: Date,
    returnDateTime: Date,
    initialPaymentRequired: number,
    depositRequired: number,
    notes?: string,
    pickupLocation?: string,
    returnLocation?: string,
    /** Required when `depositRequired` is 0. See `buildDeposit`. */
    depositWaivedReason?: string
  ): Promise<string> {
    // Re-check availability
    const availability = await this.checkVehicleAvailability(vehicleId, pickupDateTime, returnDateTime);
    if (!availability.available) {
      // Clave i18n, no una frase en inglés: este mensaje llega a la pantalla y
      // se le enseña al operador. En inglés duro, la capa de avisos no podía
      // distinguirlo de un fallo cualquiera y ofrecía «Reintentar», que aquí no
      // sirve de nada: hay que cambiar de coche o de fechas.
      throw new Error(availability.conflictMessage || 'reservations.availability.conflict');
    }

    // Get vehicle data
    const vehicle = await new Promise<Vehicle | null>((resolve) => {
      this.vehicleService.getVehicleById(vehicleId).subscribe(v => resolve(v));
    });
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    // Calculate pricing
    const totalDays = calculateCalendarDays(pickupDateTime, returnDateTime);
    const pricingRules = vehicle.pricingRules || [];
    const basePriceResult = calculateBasePrice(pricingRules, totalDays);
    
    // Same authority as `createReservationWithClient`: the tariff is net and
    // VAT is added on top. Without this the two entry points would create
    // reservations priced differently.
    const pricing = resolveRentalPrice(basePriceResult.basePrice, 0);
    const finalPrice = pricing.finalPrice;
    const remainingPaymentRequired = Math.max(0, finalPrice - initialPaymentRequired);

    // TODO: Use Firestore transaction or Cloud Function for atomic operations
    // This is client-side validation only for MVP

    const reservation: Omit<Reservation, 'id'> = {
      vehicleId,
      vehicleSnapshot: {
        brand: vehicle.brand,
        model: vehicle.model,
        // La versión viaja al contrato para que identifique el coche igual que
        // la oferta que el cliente aceptó (D-2).
        version: vehicle.version,
        plateNumber: vehicle.plateNumber,
        year: vehicle.year,
        acrissCode: vehicle.acrissCode,
        fuelType: vehicle.fuelType,
        transmission: vehicle.transmission,
        seats: vehicle.seats,
        luggageCapacity: vehicle.luggageCapacity,
        currentKm: vehicle.currentKm,
        color: vehicle.color,
        hasGpsTracker: vehicle.hasGpsTracker
      },
      clientId,
      clientSnapshot: {
        fullName: '', // Will be filled after client lookup
        phone: undefined,
        email: undefined,
        documentNumber: undefined
      },
      pickupDateTime: toTimestamp(pickupDateTime),
      returnDateTime: toTimestamp(returnDateTime),
      pickupLocation,
      returnLocation,
      totalDays,
      pricingSnapshot: {
        totalDays,
        appliedRule: basePriceResult.appliedRule ? {
          minDays: basePriceResult.appliedRule.minDays,
          maxDays: basePriceResult.appliedRule.maxDays,
          pricePerDay: basePriceResult.appliedRule.pricePerDay,
          label: basePriceResult.appliedRule.label
        } : null,
        pricePerDay: basePriceResult.pricePerDay,
        basePrice: basePriceResult.basePrice,
        netPrice: pricing.netPrice,
        finalPrice,
        vatRate: this.currentVatRate(),
        // Se congelan con el precio: el cargo por kilómetros de la devolución
        // los lee de aquí, así que cambiar la ficha del coche no puede mover lo
        // que se pactó en un alquiler ya cerrado.
        includedKmPerDay: vehicle.includedKmPerDay,
        extraKmPrice: vehicle.extraKmPrice
      },
      initialPayment: {
        requiredAmount: initialPaymentRequired,
        paidAmount: 0,
        status: 'pending'
      },
      remainingPayment: {
        requiredAmount: remainingPaymentRequired,
        paidAmount: 0,
        dueDate: toTimestamp(new Date(pickupDateTime.getTime() - APP_DEFAULTS.REMAINING_PAYMENT_DUE_DAYS_BEFORE_PICKUP * 24 * 60 * 60 * 1000)), // days before pickup from APP_DEFAULTS
        status: 'pending'
      },
      // A deposit of 0 is a legitimate business decision — known customers
      // are not asked for one — but it is not the same thing as a deposit
      // nobody has collected yet. It is born `waived`, with its reason, so
      // the workflow never sits waiting for money no one intends to pay.
      deposit: buildDeposit(depositRequired, depositWaivedReason),
      paymentStatus: 'pending',
      contractStatus: 'pending',
      reservationStatus: 'reserved',
      notes,
      createdAt: { seconds: Date.now() / 1000 },
      updatedAt: { seconds: Date.now() / 1000 }
    };

    return this.commitReservationWithPayments(reservation, vehicle);
  }

  /**
   * Create reservation with full client snapshot.
   */
  async createReservationWithClient(
    vehicle: Vehicle,
    client: Client,
    pickupDateTime: Date,
    returnDateTime: Date,
    initialPaymentRequired: number,
    depositRequired: number,
    notes?: string,
    pickupLocation?: string,
    returnLocation?: string,
    /**
     * Price agreed with the customer, overriding the tariff calculation.
     * The snapshot keeps the calculated figures and records the difference in
     * `manualAdjustment`, so the discount stays auditable.
     *
     * ⚠️ **NET**, like everything else `resolveRentalPrice()` compares against.
     * Handing it the gross turns a discount into a surcharge of roughly the VAT
     * rate, because the tariff it is measured against is a taxable base.
     */
    agreedNetPrice?: number,
    /** Required when `depositRequired` is 0. See `buildDeposit`. */
    depositWaivedReason?: string
  ): Promise<string> {
    // Do not rent to a customer marked `blocked`. The wizard disables the
    // button; this is the half that a stale tab or a direct call cannot skip.
    // The way through is to change the customer's trust level, which leaves a
    // trail — not to bypass this.
    const trust = canCreateReservationForClient(client.trustLevel);
    if (!trust.ok) {
      throw new Error(trust.reason);
    }

    // Re-check availability
    const availability = await this.checkVehicleAvailability(vehicle.id!, pickupDateTime, returnDateTime);
    if (!availability.available) {
      // Clave i18n, no una frase en inglés: este mensaje llega a la pantalla y
      // se le enseña al operador. En inglés duro, la capa de avisos no podía
      // distinguirlo de un fallo cualquiera y ofrecía «Reintentar», que aquí no
      // sirve de nada: hay que cambiar de coche o de fechas.
      throw new Error(availability.conflictMessage || 'reservations.availability.conflict');
    }

    // Calculate pricing
    const totalDays = calculateCalendarDays(pickupDateTime, returnDateTime);
    const pricingRules = vehicle.pricingRules || [];
    const basePriceResult = calculateBasePrice(pricingRules, totalDays);

    // Tariff → loyalty discount → hand-agreed price. The service recomputes it
    // instead of trusting the figure the wizard showed: this is the value that
    // gets frozen into the contract.
    const pricing = resolveRentalPrice(
      basePriceResult.basePrice,
      client.loyaltyDiscountPercent,
      agreedNetPrice
    );

    /**
     * ⚠️ **El precio acordado a mano solo lo pone quien puede tocar precios.**
     *
     * Se comprueba **después** de resolver, sobre el resultado: es la única
     * forma de saber si el precio que llega difiere de la tarifa. Comprobar
     * antes que `agreedNetPrice` viene relleno daría un falso positivo cada vez
     * que el asistente manda el mismo número que ya calculaba.
     *
     * La pantalla ya deja el campo en solo lectura; esto es lo que impide que
     * un camino distinto —una llamada directa al servicio— se lo salte.
     */
    if (pricing.priceOverridden && !this.permissions.can('editPricing')) {
      throw new Error('permissions.notAllowed');
    }
    const finalPrice = pricing.finalPrice;

    // A signal larger than the whole rental would leave the reservation
    // impossible to settle, so it is capped at the agreed price.
    //
    // ⚠️ Rounded: `108.9 - 50` is `58.900000000000006` in binary floating
    // point, and this figure is written to Firestore and seeded as a payment
    // row that the operator then has to collect to the cent.
    const initialPayment = roundMoney(Math.min(initialPaymentRequired, finalPrice));
    const remainingPaymentRequired = roundMoney(Math.max(0, finalPrice - initialPayment));

    const reservation: Omit<Reservation, 'id'> = {
      vehicleId: vehicle.id!,
      vehicleSnapshot: {
        brand: vehicle.brand,
        model: vehicle.model,
        // La versión viaja al contrato para que identifique el coche igual que
        // la oferta que el cliente aceptó (D-2).
        version: vehicle.version,
        plateNumber: vehicle.plateNumber,
        year: vehicle.year,
        acrissCode: vehicle.acrissCode,
        fuelType: vehicle.fuelType,
        transmission: vehicle.transmission,
        seats: vehicle.seats,
        luggageCapacity: vehicle.luggageCapacity,
        currentKm: vehicle.currentKm,
        color: vehicle.color,
        hasGpsTracker: vehicle.hasGpsTracker
      },
      clientId: client.id!,
      clientSnapshot: {
        fullName: client.fullName,
        phone: client.phone,
        email: client.email,
        documentNumber: client.documentNumber
      },
      pickupDateTime: toTimestamp(pickupDateTime),
      returnDateTime: toTimestamp(returnDateTime),
      pickupLocation,
      returnLocation,
      totalDays,
      pricingSnapshot: {
        totalDays,
        appliedRule: basePriceResult.appliedRule ? {
          minDays: basePriceResult.appliedRule.minDays,
          maxDays: basePriceResult.appliedRule.maxDays,
          pricePerDay: basePriceResult.appliedRule.pricePerDay,
          label: basePriceResult.appliedRule.label
        } : null,
        pricePerDay: basePriceResult.pricePerDay,
        basePrice: basePriceResult.basePrice,
        // Both discounts are frozen separately. Withdrawing the client's
        // discount tomorrow must not move a contract signed today.
        loyaltyDiscountPercent: pricing.loyaltyDiscountPercent || undefined,
        loyaltyDiscount: pricing.loyaltyDiscount || undefined,
        manualAdjustment: pricing.priceOverridden ? pricing.manualAdjustment : undefined,
        netPrice: pricing.netPrice,
        finalPrice,
        // Frozen so a future change of the general rate never moves a contract
        // already signed.
        vatRate: this.currentVatRate(),
        // Se congelan con el precio: el cargo por kilómetros de la devolución
        // los lee de aquí, así que cambiar la ficha del coche no puede mover lo
        // que se pactó en un alquiler ya cerrado.
        includedKmPerDay: vehicle.includedKmPerDay,
        extraKmPrice: vehicle.extraKmPrice
      },
      initialPayment: {
        requiredAmount: initialPayment,
        paidAmount: 0,
        status: 'pending'
      },
      remainingPayment: {
        requiredAmount: remainingPaymentRequired,
        paidAmount: 0,
        dueDate: toTimestamp(new Date(pickupDateTime.getTime() - APP_DEFAULTS.REMAINING_PAYMENT_DUE_DAYS_BEFORE_PICKUP * 24 * 60 * 60 * 1000)),
        status: 'pending'
      },
      // A deposit of 0 is a legitimate business decision — known customers
      // are not asked for one — but it is not the same thing as a deposit
      // nobody has collected yet. It is born `waived`, with its reason, so
      // the workflow never sits waiting for money no one intends to pay.
      deposit: buildDeposit(depositRequired, depositWaivedReason),
      paymentStatus: 'pending',
      contractStatus: 'pending',
      reservationStatus: 'reserved',
      notes,
      createdAt: { seconds: Date.now() / 1000 },
      updatedAt: { seconds: Date.now() / 1000 }
    };

    return this.commitReservationWithPayments(reservation, vehicle);
  }

  /**
   * Cambia los datos de una reserva **ya creada**.
   *
   * Sustituye a un `updateReservation(id, data: Partial<Reservation>)` que
   * existía desde el principio, **que no llamaba nadie** y que no comprobaba
   * nada: aceptaba cualquier campo del documento, así que habría dejado mover
   * el `pricingSnapshot` de una reserva cerrada o cambiarle el
   * `reservationStatus` a mano, saltándose el workflow entero.
   *
   * Lo que hace este, y en este orden porque el orden importa:
   *
   * 1. Mira **qué ha cambiado de verdad**. Un campo que llega igual que estaba
   *    no es un cambio, y pedir permiso para él haría que abrir el formulario y
   *    guardarlo sin tocar nada fallara.
   * 2. Le pregunta a `canEditField()` por cada uno. Es la misma autoridad que
   *    usa la pantalla para apagar los campos — aquí es la defensa en
   *    profundidad, porque una pestaña vieja o una llamada directa no pasan por
   *    ella.
   * 3. **Recalcula** el precio en vez de fiarse del que venga. Es la regla de
   *    `pricing.util.ts` y vale igual al editar: cambiar las fechas cambia los
   *    días, y los días cambian la tarifa aunque nadie toque el importe.
   * 4. Reparte la señal sin mover el total, y **reescribe las filas de pago
   *    pendientes** para que el dinero por cobrar cuadre con el precio nuevo.
   * 5. Escribe todo en un `writeBatch`: entra la reserva con sus filas o no
   *    entra nada. Es lo mismo que hace la creación, y por el mismo motivo —
   *    una reserva con un precio nuevo y unas filas de pago viejas pide dinero
   *    que no corresponde.
   *
   * ⚠️ **Deja constancia en las notas internas.** Un cambio de precio o de
   * fechas sin rastro es indistinguible de un error de quien lo tecleó, y estas
   * notas son lo único que queda dentro de seis meses.
   */
  async editReservation(id: string, edit: ReservationEdit): Promise<ReservationEditResult> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('reservations.errors.notFound');
    const actual = { id: snap.id, ...snap.data() } as Reservation;

    // Los pagos son la fuente de verdad del dinero: sin ellos no se puede
    // afirmar que una fianza está sin cobrar. Se leen de una vez, no se escucha.
    const pagos = await firstValueFrom(this.paymentService.getPaymentsByReservation(id));
    const contrato = await firstValueFrom(
      this.contractService.getContractByReservation(id).pipe(first())
    );

    const cambiados = changedFields(actual, edit);
    if (!cambiados.length) return { changed: [], requiresNewContract: false };

    const ctx = {
      reservation: actual,
      contract: contrato,
      payments: pagos,
      canEditPricing: this.permissions.can('editPricing')
    };
    for (const campo of cambiados) {
      const decision = canEditField(campo, ctx);
      if (!decision.ok) throw new Error(decision.reason);
    }

    // Un cliente bloqueado no recibe una reserva, tampoco por la puerta de
    // atrás de cambiarle el cliente a una que ya existe.
    if (edit.client) {
      const trust = canCreateReservationForClient(edit.client.trustLevel);
      if (!trust.ok) throw new Error(trust.reason);
    }

    const pickup = edit.pickupDateTime ?? toDate(actual.pickupDateTime);
    const returnAt = edit.returnDateTime ?? toDate(actual.returnDateTime);
    if (pickup >= returnAt) throw new Error('reservations.edit.problems.datesOrder');

    if (cambiados.includes('pickupDateTime') || cambiados.includes('returnDateTime')) {
      const disponible = await this.checkVehicleAvailability(
        actual.vehicleId,
        pickup,
        returnAt,
        // Sin esto, la reserva se encontraría a sí misma y no se podría mover
        // ninguna fecha.
        id
      );
      if (!disponible.available) {
        throw new Error(disponible.conflictMessage || 'reservations.availability.conflict');
      }
    }

    const update: Record<string, unknown> = {
      updatedAt: { seconds: Date.now() / 1000 }
    };

    if (edit.client) {
      update['clientId'] = edit.client.id;
      update['clientSnapshot'] = clientSnapshotOf(edit.client);
    }
    if (cambiados.includes('pickupDateTime')) update['pickupDateTime'] = toTimestamp(pickup);
    if (cambiados.includes('returnDateTime')) update['returnDateTime'] = toTimestamp(returnAt);
    if (cambiados.includes('additionalDrivers')) {
      update['additionalDrivers'] = edit.additionalDrivers ?? [];
    }

    /**
     * El precio se recalcula siempre que cambien las fechas o el importe
     * acordado, **y el descuento de fidelidad sale del cliente que quede**: si
     * se cambia el arrendatario, el que manda es el suyo, no el del anterior.
     */
    const totalDays = calculateCalendarDays(pickup, returnAt);
    const recalcularPrecio =
      cambiados.includes('agreedPrice') ||
      cambiados.includes('pickupDateTime') ||
      cambiados.includes('returnDateTime') ||
      cambiados.includes('client');

    let pricing = actual.pricingSnapshot;
    if (recalcularPrecio) {
      // `first()` porque `getVehicleById` puede ser un stream vivo: sin él, un
      // `firstValueFrom` deja el oyente abierto y un `forkJoin` no emitiría.
      const vehicle = await firstValueFrom(
        this.vehicleService.getVehicleById(actual.vehicleId).pipe(first())
      );
      if (!vehicle) throw new Error('reservations.errors.vehicleNotFound');
      const base = calculateBasePrice(vehicle.pricingRules || [], totalDays);
      const fidelidad = edit.client
        ? edit.client.loyaltyDiscountPercent
        : actual.pricingSnapshot?.loyaltyDiscountPercent;
      const acordado =
        edit.agreedNetPrice !== undefined
          ? edit.agreedNetPrice
          : actual.pricingSnapshot?.manualAdjustment
            ? actual.pricingSnapshot?.netPrice
            : null;
      const resultado = resolveRentalPrice(
        base.basePrice,
        fidelidad,
        acordado,
        // ⚠️ El tipo de IVA **se conserva**, no se relee de Ajustes: está
        // congelado por reserva para que una subida futura no mueva un contrato
        // ya firmado, y editar una fecha no es motivo para descongelarlo.
        actual.pricingSnapshot?.vatRate
      );
      pricing = {
        ...actual.pricingSnapshot,
        basePrice: resultado.tariffPrice,
        loyaltyDiscountPercent: resultado.loyaltyDiscountPercent,
        loyaltyDiscount: resultado.loyaltyDiscount,
        manualAdjustment: resultado.manualAdjustment,
        netPrice: resultado.netPrice,
        finalPrice: resultado.finalPrice
      } as ReservationPricingSnapshot;
      update['pricingSnapshot'] = pricing;
      update['totalDays'] = totalDays;
    }

    if (cambiados.includes('depositAmount')) {
      update['deposit'] = buildDeposit(edit.depositRequired!, edit.depositWaivedReason);
    }

    /**
     * La señal y el resto se recalculan juntos, **siempre que se toque
     * cualquiera de los dos o el precio**: el total es el invariante.
     */
    const totalDue = roundMoney(pricing?.finalPrice ?? actual.pricingSnapshot?.finalPrice ?? 0);
    const señalActual = roundMoney(actual.initialPayment?.requiredAmount ?? 0);
    const señalPedida =
      edit.initialPaymentRequired !== undefined ? edit.initialPaymentRequired : señalActual;
    const problema = initialPaymentProblem(señalPedida, totalDue);
    if (problema) throw new Error(problema);
    const reparto = redistributeInitialPayment(totalDue, Number(señalPedida));

    update['initialPayment'] = {
      ...actual.initialPayment,
      requiredAmount: reparto.initial
    };
    update['remainingPayment'] = {
      ...(actual.remainingPayment ?? { paidAmount: 0, status: 'pending' }),
      requiredAmount: reparto.remaining
    };

    const batch = writeBatch(this.firestore);
    batch.update(docRef, this.cleanData(update));
    this.paymentService.queueRepricedRows(batch, pagos, {
      initialRequired: reparto.initial,
      remainingRequired: reparto.remaining,
      depositRequired: cambiados.includes('depositAmount')
        ? roundMoney(edit.depositRequired!)
        : undefined
    });
    await batch.commit();

    // La nota va después del commit y a propósito: si la escritura falla, no
    // queda anotado un cambio que no llegó a ocurrir.
    await this.addInternalNote(id, describeEdit(cambiados, this.translate));

    return {
      changed: cambiados,
      requiresNewContract:
        contrato?.status === 'signed' && requiresNewContract(cambiados)
    };
  }

  /**
   * Append a new internal note to the reservation's `internalNotes`
   * log.  Notes are append-only — never edited or deleted.
   *
   * @param id reservation id
   * @param text note body (trimmed; must be non-empty)
   * @param author optional author (display name + email of the
   *               operator).  Falls back to the AuthService user.
   */
  async addInternalNote(
    id: string,
    text: string,
    author?: { displayName?: string; email?: string }
  ): Promise<ReservationNote> {
    // Fall back to the signed-in operator if no author is passed.
    const fallbackAuthor = this.authService.authorizedUser?.();
    const note = buildReservationNote(text, {
      displayName: author?.displayName ?? fallbackAuthor?.displayName,
      email: author?.email ?? fallbackAuthor?.email
    });

    const docRef = doc(this.firestore, `reservations/${id}`);
    // ⚠️ The payload is NOT passed through `cleanData`.
    //
    // `arrayUnion()` is a sentinel with ordinary enumerable properties, so a
    // recursive clean rebuilds it as a plain map: the append turns into an
    // overwrite, and the `undefined` hiding in `_elements` surfaces as
    // "Unsupported field value: undefined". The note is built free of
    // `undefined` instead, which is where the problem actually belonged.
    await updateDoc(docRef, {
      internalNotes: arrayUnion(note),
      updatedAt: { seconds: Date.now() / 1000 }
    });

    return note;
  }

  /**
   * Registra una excepción de workflow: deja constancia de que se salta un paso
   * y por qué.
   *
   * `buildWorkflowException()` existía desde el principio, con sus tests, y
   * **nadie la llamaba**: no había forma de crear una excepción desde la
   * aplicación. La consecuencia era concreta — un cliente que firmaba en papel
   * dejaba la entrega bloqueada sin salida, y el único arreglo era entrar a
   * Firestore a mano.
   *
   * El motivo es obligatorio y lo valida el propio `buildWorkflowException`,
   * que lanza si no llega a tres caracteres. No se valida aquí para no tener
   * dos reglas del mismo asunto.
   *
   * Mismo cuidado que con las notas: el objeto se construye **sin `undefined`**
   * antes de entrar en el `arrayUnion()`, porque el centinela no se puede
   * limpiar después.
   */
  async addWorkflowException(
    id: string,
    action: ExceptionableAction,
    reason: string
  ): Promise<WorkflowException> {
    const operator = this.authService.authorizedUser?.();
    const exception = buildWorkflowException(
      action,
      reason,
      operator?.email || operator?.displayName || undefined
    );

    const docRef = doc(this.firestore, `reservations/${id}`);
    await updateDoc(docRef, {
      workflowExceptions: arrayUnion(exception),
      updatedAt: { seconds: Date.now() / 1000 }
    });

    return exception;
  }

  /**
   * Cancel reservation. Only valid from `reserved` or `confirmed`.
   * Throws if the reservation has already been delivered, returned or closed.
   */
  async cancelReservation(id: string): Promise<void> {
    // Defensa en profundidad: la UI esconde el botón y esto rechaza la
    // llamada igualmente. Cualquier camino que no pase por ese botón se
    // saltaría el permiso.
    if (!this.permissions.can('cancelReservations')) {
      throw new Error('permissions.notAllowed');
    }
    const docRef = doc(this.firestore, `reservations/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Reserva no encontrada');
    }
    const current = snap.data() as Reservation;
    const cancellable: ReservationStatus[] = ['reserved', 'confirmed'];
    if (!cancellable.includes(current.reservationStatus)) {
      throw new Error(`No se puede cancelar una reserva en estado ${current.reservationStatus}`);
    }
    await updateDoc(docRef, {
      reservationStatus: 'cancelled',
      updatedAt: { seconds: Date.now() / 1000 }
    });
    // A cancelled reservation must not keep advertising money to collect.
    await this.paymentService.cancelUncollectedPayments(id);
  }

  /**
   * Guarda los conductores autorizados además del arrendatario (cláusula 2).
   *
   * ⚠️ **Con el contrato firmado, no.** Los conductores van impresos en el PDF
   * y se le enseñan al arrendatario antes de firmar: su firma es el acuerdo
   * sobre quién puede conducir. Cambiarlos después dejaría el documento
   * firmado diciendo una cosa y la aplicación otra — y un PDF sellado no se
   * puede regenerar. Ahí la salida es un anexo en papel.
   *
   * Si el contrato está **generado pero sin firmar**, hay que volver a
   * generarlo para que salgan: esto no lo hace solo, y la pantalla lo avisa.
   */
  async updateAdditionalDrivers(
    reservationId: string,
    drivers: AdditionalDriver[]
  ): Promise<void> {
    const docRef = doc(this.firestore, `reservations/${reservationId}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('reservations.errors.notFound');
    }
    if ((snap.data() as Reservation).contractStatus === 'signed') {
      throw new Error('reservations.drivers.errors.contractSigned');
    }

    await updateDoc(docRef, this.cleanData({
      additionalDrivers: drivers,
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  /**
   * Borra una reserva **con todo lo que arrastra**: sus pagos, sus inspecciones
   * y las fotos que esas inspecciones subieron a Storage.
   *
   * Existe porque hasta ahora no había forma de limpiar desde la aplicación: ni
   * este método ni un botón. Una reserva creada por error o de prueba se
   * quedaba para siempre, y quitarla exigía entrar a la consola de Firebase a
   * borrar la reserva, cada uno de sus pagos y cada inspección a mano.
   *
   * ⚠️ **Una reserva con contrato firmado NO se borra.** Decisión de Dorel, y
   * la única coherente con la regla de Firestore que impide borrar un contrato
   * incluso siendo administrador: ese documento acredita un alquiler que
   * ocurrió de verdad, así que borrar la reserva lo dejaría apuntando al vacío.
   * Para esas está cancelar.
   *
   * Todo el borrado de Firestore va en un `writeBatch`: si algo falla no queda
   * una reserva sin sus pagos ni unos pagos sin su reserva. Las fotos se borran
   * antes, por el mismo motivo que en los clientes — si Storage falla, los
   * documentos siguen ahí y se puede reintentar.
   */
  async deleteReservation(id: string): Promise<void> {
    if (!this.permissions.can('deleteRecords')) {
      throw new Error('permissions.notAllowed');
    }

    const docRef = doc(this.firestore, `reservations/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('reservations.errors.notFound');
    }
    const reservation = snap.data() as Reservation;
    if (reservation.contractStatus === 'signed') {
      throw new Error('reservations.errors.deleteSignedContract');
    }

    // Las fotos de las dos inspecciones cuelgan de la misma carpeta.
    await this.storageService.deleteFolder(`inspections/${id}`);

    const batch = writeBatch(this.firestore);

    const payments = await getDocs(
      query(collection(this.firestore, 'payments'), where('reservationId', '==', id))
    );
    payments.forEach(p => batch.delete(p.ref));

    const inspections = await getDocs(
      query(collection(this.firestore, 'inspections'), where('reservationId', '==', id))
    );
    inspections.forEach(i => batch.delete(i.ref));

    batch.delete(docRef);
    await batch.commit();
  }

  /**
   * Close reservation. Only allowed from `returned` with the return
   * inspection completed and the deposit fully settled (refunded or
   * retained). Throws with a workflow i18n key otherwise.
   */
  async closeReservation(id: string): Promise<void> {
    const docRef = doc(this.firestore, `reservations/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Reserva no encontrada');
    const reservation = { id: snap.id, ...snap.data() } as Reservation;

    const pickup = await this.inspectionService
      .getInspectionByReservationAndType(id, 'pickup');
    const ret = await this.inspectionService
      .getInspectionByReservationAndType(id, 'return');

    const decision = assertCanClose({
      reservation,
      pickupInspection: pickup || null,
      returnInspection: ret || null
    } as WorkflowContext);
    if (!decision.ok) {
      throw new Error(decision.reason);
    }

    await updateDoc(docRef, {
      reservationStatus: 'closed',
      updatedAt: { seconds: Date.now() / 1000 }
    });
    // Anything still seeded and untouched is not going to be collected on a
    // closed rental — otherwise the payment list contradicts the status.
    await this.paymentService.cancelUncollectedPayments(id);

    /**
     * ⚠️ **El reparto del propietario se reconoce solo al cerrar** (decisión de
     * Dorel, 14 de septiembre de 2026): no hay que acordarse de pulsar nada, y
     * el importe se le asigna con el porcentaje congelado en la reserva. Se
     * puede cambiar después desde su ficha, que es justo lo que él pidió.
     *
     * ⚠️ **Y no puede tumbar el cierre.** Si quien cierra es un empleado no
     * tiene permiso para escribir en `collaboratorSales`, así que el método
     * devuelve `0` y no lanza; el apunte lo recoge el siguiente administrador
     * que abra la ficha, y mientras tanto los informes ya lo cuentan porque el
     * devengo se deriva de la reserva. Perder el apunte es un retraso; perder
     * el cierre que el operador acaba de hacer, un problema mayor.
     */
    await this.collaboratorService.accrueFromReservation({
      ...reservation,
      reservationStatus: 'closed'
    });
  }

  /**
   * Escribe la reserva **y sus filas de pago en una sola operación**.
   *
   * ⚠️ **Eran hasta cuatro escrituras sueltas**: la reserva y una fila por
   * concepto (señal, resto, fianza). Si fallaba cualquiera menos la primera
   * quedaba una reserva a medias —creada, pero sin nada que cobrar— mientras la
   * pantalla decía que no se había podido crear. El operador la creaba otra vez
   * y acababa con dos, la segunda encima bloqueando el coche.
   *
   * `writeBatch` es atómico: entra todo o no entra nada. El id se pide antes
   * con `doc(collection)` porque las filas de pago lo llevan dentro;
   * `addDoc` no sirve aquí, ya que solo devuelve el id después de escribir.
   *
   * ⚠️ **Esto NO impide que dos operadores reserven el mismo coche.** La
   * disponibilidad se comprueba con una consulta y se escribe después, y entre
   * las dos cosas cabe otra reserva. No es un descuido: el SDK web **no permite
   * consultas dentro de una transacción** —solo lecturas por id—, así que no
   * hay forma de leer «¿hay alguna reserva que solape?» y escribir de forma
   * atómica desde el cliente. Cerrarlo de verdad pide una Cloud Function, donde
   * el admin SDK sí admite `transaction.get(query)`.
   *
   * Lo que sí se hace es **volver a comprobarlo aquí**, a ras del commit: entre
   * la comprobación del asistente y este punto hay una lectura del vehículo y
   * el cálculo del precio, y esa ventana era de cerca de un segundo. Ahora son
   * milisegundos. Reduce el riesgo; no lo elimina.
   */
  private async commitReservationWithPayments(
    reservation: Omit<Reservation, 'id'>,
    /**
     * El coche, **para congelar el reparto con su dueño**.
     *
     * Viaja hasta aquí en vez de resolverse en cada uno de los dos creadores a
     * propósito: así ninguno de los dos puede olvidarse: es el mismo motivo por
     * el que la reserva y sus filas de pago se escriben en un solo sitio.
     */
    vehicle: Vehicle
  ): Promise<string> {
    const availability = await this.checkVehicleAvailability(
      reservation.vehicleId,
      toDate(reservation.pickupDateTime),
      toDate(reservation.returnDateTime)
    );
    if (!availability.available) {
      throw new Error(availability.conflictMessage || 'reservations.availability.conflict');
    }

    /**
     * ⚠️ **El reparto se congela aquí, como el precio.** `ownerShareSnapshotOf()`
     * devuelve `null` para un coche de Velto, que es la mayoría: entonces la
     * reserva no lleva el campo y no hay nada que liquidar.
     *
     * ⚠️ **El nombre sale del vehículo y NO de `collaborators`.** Esa colección
     * es de administrador en `firestore.rules`, y un empleado creando la reserva
     * de un coche cedido recibiría un error de permisos en mitad de la
     * operación. Lo escribe el administrador al asignar el coche; ver
     * `Vehicle.ownerCollaboratorName`.
     */
    const conReparto: Omit<Reservation, 'id'> = {
      ...reservation,
      ownerShareSnapshot:
        ownerShareSnapshotOf(vehicle, vehicle.ownerCollaboratorName) ?? undefined
    };

    const batch = writeBatch(this.firestore);

    const reservationRef = doc(this.reservationsRef);
    batch.set(reservationRef, this.cleanData(conReparto));

    const saved: Reservation = { id: reservationRef.id, ...conReparto };
    const paymentsRef = collection(this.firestore, 'payments');
    for (const row of this.paymentService.buildInitialPayments(reservationRef.id, saved)) {
      batch.set(doc(paymentsRef), row);
    }

    await batch.commit();
    return reservationRef.id;
  }

}
