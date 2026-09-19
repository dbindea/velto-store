import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { FormErrorComponent } from '@shared/components/form-error/form-error.component';
import { NotificationService } from '@core/notifications/notification.service';
import { ConfirmService } from '@core/notifications/confirm.service';
import { PermissionsService } from '@core/auth/permissions.service';
import { TranslateService } from '@core/i18n/translate.service';
import {
  agreedNetPriceOf,
  ReservationService
} from '@features/reservations/services/reservation.service';
import { PaymentService } from '@features/payments/services/payment.service';
import { ContractService } from '@features/contracts/services/contract.service';
import { ClientService } from '@features/clients/services/client.service';
import { Reservation, AdditionalDriver } from '@shared/models/reservation.model';
import { Client } from '@shared/models/client.model';
import { Contract } from '@shared/models/contract.model';
import { Payment } from '@shared/models/payment.model';
import { FieldProblems, hasProblems, problemKeys } from '@shared/utils/form-problems.util';
import { toDate } from '@shared/utils/reservation-date.util';
import { roundMoney } from '@shared/utils/payment-summary.util';
import {
  chargesVat,
  deliveryFeeBreakdown,
  DeliveryFeeBreakdown,
  resolveVatRate
} from '@shared/utils/pricing.util';
import { SettingsService } from '@features/settings/services/settings.service';
import {
  canEditField,
  canResignContract,
  EditableField,
  EditContext,
  initialPaymentProblem,
  redistributeInitialPayment,
  requiresNewContract
} from '@shared/utils/reservation-edit.util';
import { firstValueFrom } from 'rxjs';
import { first } from 'rxjs/operators';

/**
 * Modificar una reserva ya creada.
 *
 * ⚠️ **Los campos que no se pueden tocar se APAGAN con su explicación al
 * lado**, nunca desaparecen. Es la misma regla que el resto de la aplicación:
 * un campo que no está no se puede preguntar, y el operador acaba llamando para
 * saber qué le pasa a la aplicación. Aquí importa el doble, porque los motivos
 * son de negocio y no obvios — «el coche ya se entregó» explica por qué la
 * fecha de recogida no se mueve y la de devolución sí.
 *
 * ⚠️ **Quien decide es `reservation-edit.util.ts`, no esta pantalla.** Aquí
 * solo se pinta lo que esa función contesta; el servicio le pregunta lo mismo
 * antes de escribir.
 */
@Component({
  selector: 'app-reservation-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, FormErrorComponent],
  templateUrl: './reservation-edit.component.html',
  styleUrl: './reservation-edit.component.scss'
})
export class ReservationEditComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private reservations = inject(ReservationService);
  private payments = inject(PaymentService);
  private contracts = inject(ContractService);
  private clients = inject(ClientService);
  private settings = inject(SettingsService);
  private notifications = inject(NotificationService);
  private confirm = inject(ConfirmService);
  private translate = inject(TranslateService);
  readonly permissions = inject(PermissionsService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly submitted = signal(false);

  reservation: Reservation | null = null;
  contract: Contract | null = null;
  paymentRows: Payment[] | null = null;
  clientList: Client[] = [];

  /** Los contratos ya sustituidos, para que se vean en vez de desaparecer. */
  superseded: Contract[] = [];

  form = {
    clientId: '',
    pickupDateTime: '',
    returnDateTime: '',
    agreedNetPrice: null as number | null,
    depositRequired: 0,
    depositWaivedReason: '',
    initialPaymentRequired: 0,
    /** Sin IVA: el cliente paga el neto y los documentos no lo mencionan. */
    vatExempt: false,
    /** Entrega y recogida a domicilio, en neto. Se teclean a mano. */
    deliveryPickupFee: null as number | null,
    deliveryReturnFee: null as number | null
  };

  drivers: AdditionalDriver[] = [];

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/reservations']);
      return;
    }
    try {
      // `first()` en los dos: son streams vivos y aquí solo hace falta el
      // estado de ahora. Sin él, `firstValueFrom` deja un oyente abierto.
      const [reserva, pagos, contrato, clientes] = await Promise.all([
        firstValueFrom(this.reservations.getReservationById(id).pipe(first())),
        firstValueFrom(this.payments.getPaymentsByReservation(id)),
        firstValueFrom(this.contracts.getContractByReservation(id).pipe(first())),
        firstValueFrom(this.clients.getClients().pipe(first()))
      ]);
      if (!reserva) {
        this.router.navigate(['/reservations']);
        return;
      }
      this.reservation = reserva;
      this.paymentRows = pagos;
      this.contract = contrato;
      this.clientList = clientes || [];
      this.superseded = await this.contracts.supersededContractsOf(id);
      this.fillForm(reserva);
    } catch {
      this.notifications.error('reservations.errors.loadFailed');
      this.router.navigate(['/reservations']);
      return;
    } finally {
      this.loading.set(false);
    }
  }

  private fillForm(r: Reservation): void {
    this.form = {
      clientId: r.clientId,
      pickupDateTime: toInput(r.pickupDateTime),
      returnDateTime: toInput(r.returnDateTime),
      // ⚠️ Solo se precarga si de verdad hubo un precio acordado a mano. Con el
      // neto de la tarifa metido aquí, guardar sin tocar nada congelaría ese
      // importe como «acordado» y el descuento de fidelidad dejaría de
      // aplicarse solo. La misma función la usa el servicio al comparar, para
      // que las dos contesten lo mismo.
      agreedNetPrice: agreedNetPriceOf(r),
      depositRequired: r.deposit?.requiredAmount ?? 0,
      depositWaivedReason: r.deposit?.waivedReason ?? '',
      initialPaymentRequired: r.initialPayment?.requiredAmount ?? 0,
      // Se precarga del hecho guardado —el tipo congelado—, no de una bandera
      // aparte: así abrir y guardar sin tocar nada no cuenta como cambio.
      vatExempt: !chargesVat(r.pricingSnapshot ?? {}),
      // `null` y no 0: un campo vacío se lee como «no se cobra», y un cero
      // escrito parece una cifra que alguien decidió.
      deliveryPickupFee: r.deliveryFees?.pickupFee || null,
      deliveryReturnFee: r.deliveryFees?.returnFee || null
    };
    this.drivers = (r.additionalDrivers || []).map((d) => ({ ...d }));
  }

  // -------------------------------------------------------------------------
  // Lo que se puede tocar. Una sola autoridad, preguntada desde la plantilla.
  // -------------------------------------------------------------------------

  private get ctx(): EditContext {
    return {
      reservation: this.reservation!,
      contract: this.contract,
      payments: this.paymentRows,
      canEditPricing: this.permissions.can('editPricing')
    };
  }

  /** `true` si el campo se puede tocar. La plantilla lo usa en `[disabled]`. */
  editable(field: EditableField): boolean {
    if (!this.reservation) return false;
    return canEditField(field, this.ctx).ok;
  }

  /**
   * El motivo, o '' si se puede. La plantilla lo pinta bajo el campo.
   *
   * ⚠️ **Devuelve '' cuando el motivo es el de toda la reserva**, que se dice
   * una sola vez arriba. Repetido bajo cada campo salían cinco «La reserva está
   * cerrada: su histórico ya no se toca» en una pantalla, y cinco veces la
   * misma frase es lo mismo que ninguna: se deja de leer, y con ella se deja de
   * leer la que sí era distinta.
   */
  lockReason(field: EditableField): string {
    if (!this.reservation) return '';
    const d = canEditField(field, this.ctx);
    if (d.ok) return '';
    return d.reason === this.wholeReservationLocked ? '' : d.reason;
  }

  /**
   * El motivo por el que **la reserva entera** está bloqueada, o ''.
   *
   * Solo lo están la cerrada y la cancelada: en las dos, cualquier campo
   * responde lo mismo. Todo lo demás —el coche entregado, la fianza cobrada—
   * bloquea unos campos y otros no, y ahí el motivo va donde se aplica.
   */
  get wholeReservationLocked(): string {
    const estado = this.reservation?.reservationStatus;
    if (estado === 'closed') return 'reservations.edit.denied.closed';
    if (estado === 'cancelled') return 'reservations.edit.denied.cancelled';
    return '';
  }

  // -------------------------------------------------------------------------
  // Dinero. Se enseña el reparto mientras se teclea, no después de guardar.
  // -------------------------------------------------------------------------

  /**
   * El total del alquiler con el precio que hay en el formulario **ahora**.
   *
   * ⚠️ Es un getter y no un `computed()`: lee `form.agreedNetPrice`, que es una
   * propiedad de `ngModel` y no una señal. Un `computed()` sobre algo que no es
   * señal se evalúa una vez y se queda con el primer valor — ya pasó con el
   * descuadre de la factura del colaborador.
   */
  get totalDue(): number {
    const snap = this.reservation?.pricingSnapshot;
    if (!snap) return 0;
    const tipo = this.previewVatRate;
    const acordado = this.form.agreedNetPrice;
    if (acordado === null || acordado === undefined || !isFinite(Number(acordado))) {
      // Sin precio a mano manda lo guardado, salvo que la casilla del IVA se
      // acabe de mover: entonces el total de antes ya no vale y hay que rehacerlo
      // sobre el neto, que es lo que no cambia.
      if (tipo === resolveVatRate(snap.vatRate)) return roundMoney(snap.finalPrice ?? 0);
      return roundMoney((snap.netPrice ?? snap.finalPrice ?? 0) * (1 + tipo));
    }
    return roundMoney(Number(acordado) * (1 + tipo));
  }

  /**
   * El tipo que se aplicaría al guardar **con la casilla como está ahora**.
   *
   * ⚠️ Es un getter y no un `computed()`, por lo mismo que `totalDue`: lee
   * `form.vatExempt`, que es una propiedad de `ngModel` y no una señal.
   */
  get previewVatRate(): number {
    if (this.form.vatExempt) return 0;
    const snap = this.reservation?.pricingSnapshot;
    // Volver a poner el IVA repone el tipo vigente: el congelado era 0 y no hay
    // otro al que regresar. Es lo mismo que hace el servicio al guardar.
    if (snap && chargesVat(snap)) return resolveVatRate(snap.vatRate);
    return this.settings.settings().vatRate;
  }

  /**
   * Descarga el PDF de un contrato ya sustituido.
   *
   * ⚠️ **Era un `<a href>` a la URL de Storage**, y eso baja una **carpeta**: la
   * cabecera de Storage lleva el nombre completo del objeto, barras incluidas, y
   * el navegador las trata como directorios. Por aquí el fichero cae suelto y
   * con un nombre que dice de qué contrato es.
   */
  async downloadSuperseded(c: Contract): Promise<void> {
    const url = await this.contracts.getSignedPdfUrl(c);
    if (!url) {
      this.notifications.error('contracts.errors.signedPdfNotReady');
      return;
    }
    try {
      await this.contracts.triggerDownload(url, this.contracts.fileNameFor(c, true));
    } catch {
      // `triggerDownload` ya ha abierto el PDF en otra pestaña; lo que no puede
      // es quedarse callado, porque lo que se abre no es lo que se pidió.
      this.notifications.error('contracts.errors.downloadFallback');
    }
  }

  /** Lo que el cliente pagaría de IVA con la casilla como está. */
  get previewVatAmount(): number {
    return roundMoney(this.totalDue - this.totalDue / (1 + this.previewVatRate));
  }

  /**
   * Lo que se cobra por el servicio a domicilio con los campos como están.
   *
   * ⚠️ Usa `previewVatRate` y no el tipo guardado: quitar el IVA baja también
   * estas dos filas, y el operador tiene que verlo en el mismo gesto.
   */
  get deliveryPreview(): DeliveryFeeBreakdown {
    return deliveryFeeBreakdown(
      { pickupFee: this.form.deliveryPickupFee, returnFee: this.form.deliveryReturnFee },
      this.previewVatRate
    );
  }

  /** Lo que quedaría de resto. Es lo que Dorel pidió ver: la señal baja, esto sube. */
  get remainingPreview(): number {
    return redistributeInitialPayment(this.totalDue, Number(this.form.initialPaymentRequired) || 0)
      .remaining;
  }

  // -------------------------------------------------------------------------
  // Validación
  // -------------------------------------------------------------------------

  get problems(): FieldProblems {
    const p: FieldProblems = {};
    const pickup = this.form.pickupDateTime ? new Date(this.form.pickupDateTime) : null;
    const devol = this.form.returnDateTime ? new Date(this.form.returnDateTime) : null;
    if (pickup && devol && pickup >= devol) {
      p['returnDateTime'] = 'reservations.edit.problems.datesOrder';
    }
    const señal = initialPaymentProblem(this.form.initialPaymentRequired, this.totalDue);
    if (señal) p['initialPaymentRequired'] = señal;
    // Una fianza a 0 exige motivo, igual que al crear: sin él la reserva no se
    // puede cerrar nunca porque `isDepositSettled()` no la da por resuelta.
    if (
      roundMoney(Number(this.form.depositRequired) || 0) === 0 &&
      !this.form.depositWaivedReason.trim()
    ) {
      p['depositWaivedReason'] = 'reservations.deposit.waivedHint';
    }
    return p;
  }

  get hasProblems(): boolean {
    return hasProblems(this.problems);
  }

  /**
   * Los mismos problemas, en lista, para el resumen junto al botón.
   *
   * ⚠️ `app-form-error` espera una clave o una lista de claves, **no el mapa**
   * campo → clave. Pasándole el mapa compila con `tsc` y **revienta al construir
   * con Angular**, que es el único que comprueba las plantillas: es la diferencia
   * entre `npx tsc --noEmit` y `npm run build`.
   */
  get problemList(): string[] {
    return problemKeys(this.problems);
  }

  // -------------------------------------------------------------------------
  // Guardar
  // -------------------------------------------------------------------------

  async save(): Promise<void> {
    this.submitted.set(true);
    if (this.hasProblems || !this.reservation?.id) return;

    this.saving.set(true);
    try {
      const elegido = this.clientList.find((c) => c.id === this.form.clientId);
      const resultado = await this.reservations.editReservation(this.reservation.id, {
        client: elegido && elegido.id !== this.reservation.clientId ? elegido : undefined,
        pickupDateTime: this.form.pickupDateTime
          ? new Date(this.form.pickupDateTime)
          : undefined,
        returnDateTime: this.form.returnDateTime
          ? new Date(this.form.returnDateTime)
          : undefined,
        agreedNetPrice: this.form.agreedNetPrice,
        depositRequired: Number(this.form.depositRequired) || 0,
        depositWaivedReason: this.form.depositWaivedReason.trim() || undefined,
        initialPaymentRequired: Number(this.form.initialPaymentRequired) || 0,
        vatExempt: this.form.vatExempt,
        deliveryFees: {
          pickupFee: Number(this.form.deliveryPickupFee) || 0,
          returnFee: Number(this.form.deliveryReturnFee) || 0
        },
        additionalDrivers: this.drivers
      });

      if (!resultado.changed.length) {
        this.notifications.success('reservations.edit.noChanges');
        this.router.navigate(['/reservations', this.reservation.id]);
        return;
      }

      this.notifications.success('reservations.edit.saved');

      /**
       * ⚠️ **Rehacer el contrato se pregunta, no se hace solo.** Obliga al
       * cliente a volver a firmar, así que es una decisión del operador que
       * tiene al cliente delante — no un efecto secundario de guardar un
       * formulario. Si dice que no, la reserva queda guardada igual y el aviso
       * de que el contrato no cuadra sigue en su ficha.
       */
      if (resultado.requiresNewContract) {
        await this.offerResign(this.reservation.id, resultado.changed);
      }
      this.router.navigate(['/reservations', this.reservation.id]);
    } catch (error: unknown) {
      const clave = String((error as Error)?.message || '');
      this.notifications.error(
        clave.startsWith('reservations.') || clave.startsWith('workflow.') ||
          clave.startsWith('permissions.') || clave.startsWith('contracts.')
          ? clave
          : 'reservations.errors.editFailed'
      );
    } finally {
      this.saving.set(false);
    }
  }

  private async offerResign(reservationId: string, cambiados: EditableField[]): Promise<void> {
    const campos = cambiados
      .map((f) => this.translate.translate(`reservations.edit.fields.${f}`))
      .join(', ');
    const seguir = await this.confirm.ask({
      title: 'reservations.edit.contractWarningTitle',
      message: 'reservations.edit.contractWarningBody',
      confirmLabel: 'reservations.edit.supersede',
      danger: true
    });
    if (!seguir) return;
    try {
      await this.contracts.supersedeSignedContract(
        reservationId,
        // El motivo lo arma la propia acción: lo que se cambió ya está anotado
        // en las notas internas, y pedir un texto aquí, después de confirmar,
        // sería un segundo diálogo para decir lo que ya se sabe.
        //
        // ⚠️ **Resuelto, no la clave.** Se guarda dentro del contrato archivado
        // y se lee dentro de meses: escrito `reservations.edit.note` a secas no
        // le dice nada a quien abra ese documento.
        `${this.translate.translate('reservations.edit.note')} (${campos})`
      );
      this.notifications.success('reservations.edit.supersedeDone');
    } catch (error: unknown) {
      const clave = String((error as Error)?.message || '');
      this.notifications.error(
        clave.startsWith('contracts.') ? clave : 'contracts.errors.generate'
      );
    }
  }

  cancel(): void {
    this.router.navigate(['/reservations', this.reservation?.id ?? '']);
  }

  // -------------------------------------------------------------------------
  // Conductores adicionales
  // -------------------------------------------------------------------------

  addDriver(): void {
    this.drivers = [...this.drivers, { fullName: '' }];
  }

  removeDriver(index: number): void {
    this.drivers = this.drivers.filter((_, i) => i !== index);
  }

  readonly canResign = computed(() => false);

  /** Solo para la plantilla: si hay contrato firmado y esto lo invalidaría. */
  get willInvalidateContract(): boolean {
    if (this.contract?.status !== 'signed') return false;
    return requiresNewContract([
      'client',
      'pickupDateTime',
      'returnDateTime',
      'agreedPrice',
      'depositAmount',
      'additionalDrivers'
    ]);
  }

  get resignReason(): string {
    if (!this.reservation) return '';
    const d = canResignContract(this.ctx);
    return d.ok ? '' : d.reason;
  }
}

/** `Timestamp` de Firestore → el valor que espera un `input[type=datetime-local]`. */
function toInput(value: unknown): string {
  const d = toDate(value);
  if (!d || isNaN(d.getTime())) return '';
  // Sin `toISOString()`: eso pasa a UTC y el operador vería otra hora.
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
