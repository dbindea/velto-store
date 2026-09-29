import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { NotificationService } from '@core/notifications/notification.service';
import { ConfirmService } from '@core/notifications/confirm.service';
import { PermissionsService } from '@core/auth/permissions.service';
import { BRAND_CONFIG } from '@core/config/brand.config';
import { BookingRequestService } from './services/booking-request.service';
import {
  BOOKING_REQUEST_STATUS_COLORS,
  BOOKING_REQUEST_STATUS_LABELS,
  type BookingRequest,
  type BookingRequestStatus
} from '@shared/models/booking-request.model';
import {
  canConvert,
  canDiscard,
  canExtendGuarantee,
  extendedGuaranteeUntil,
  formatPhone,
  priceStillGuaranteed,
  requestPickupAt,
  requestReturnAt,
  sortRequests,
  telLink,
  whatsappLink
} from '@shared/utils/booking-request.util';
import { toDate } from '@shared/utils/reservation-date.util';

type Filtro = 'open' | 'all' | BookingRequestStatus;

/**
 * Las solicitudes de la web: «que me llamen».
 *
 * ⚠️ **Pantalla propia y no un estado de la reserva.** Una solicitud no tiene
 * contrato, ni pagos, ni fianza, ni inspecciones, y su ciclo no se parece al
 * del alquiler. Y metida como estado habría empezado a **bloquear el coche en
 * la web pública** el mismo día, porque `blocksAvailability()` es una lista
 * invertida donde todo lo que no se enumera bloquea — justo lo contrario de lo
 * que esto promete.
 */
@Component({
  selector: 'app-booking-requests',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './booking-requests.component.html',
  styleUrl: './booking-requests.component.scss'
})
export class BookingRequestsComponent {
  private service = inject(BookingRequestService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationService);
  private confirm = inject(ConfirmService);
  permissions = inject(PermissionsService);

  readonly loading = signal(true);
  readonly requests = signal<BookingRequest[]>([]);
  readonly filtro = signal<Filtro>('open');
  /** Cuál está abierta. Una ficha desplegable basta para cuatro acciones. */
  readonly abierta = signal<string | null>(null);
  readonly guardando = signal<string | null>(null);

  notaInterna = '';

  STATUS_LABELS = BOOKING_REQUEST_STATUS_LABELS;
  STATUS_COLORS = BOOKING_REQUEST_STATUS_COLORS;

  constructor() {
    /**
     * ⚠️ Se **escucha**: quien crea una solicitud es un visitante desde fuera,
     * minutos después de que se abriera esta pantalla. Con una lectura de una
     * vez, la lista mentiría hasta que alguien recargase.
     */
    this.service
      .watchRequests()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (r) => {
          this.requests.set(r);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notifications.error('bookingRequests.errors.loadFailed');
        }
      });

    /**
     * ⚠️ **El correo de aviso lleva a `/booking-requests/:id`**, y abrir ahí la
     * lista con el filtro de siempre no serviría de nada: la ficha que se venía
     * a ver puede no estar en él —una ya convertida, por ejemplo—, y el
     * operador vería una lista donde la suya no aparece.
     *
     * Por eso se pone «todas» **solo cuando se llega con id**. Sin él manda el
     * filtro normal, que es la pregunta del día.
     */
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.filtro.set('all');
      this.abierta.set(id);
    }
  }

  /**
   * ⚠️ **Se abre en «sin cerrar», no en «todas».** La pregunta del día es a
   * quién tengo que llamar; y a diferencia de la lista de reservas, aquí lo
   * recortado no se lee como «no hay más»: el filtro está a la vista con su
   * recuento al lado.
   */
  readonly visibles = computed(() => {
    const f = this.filtro();
    const todas = sortRequests(this.requests());
    if (f === 'all') return todas;
    if (f === 'open') return todas.filter((r) => r.status === 'new' || r.status === 'contacted');
    return todas.filter((r) => r.status === f);
  });

  readonly cuentaNuevas = computed(
    () => this.requests().filter((r) => r.status === 'new').length
  );

  cuentaDe(f: Filtro): number {
    if (f === 'all') return this.requests().length;
    if (f === 'open')
      return this.requests().filter((r) => r.status === 'new' || r.status === 'contacted').length;
    return this.requests().filter((r) => r.status === f).length;
  }

  readonly filtros: Filtro[] = ['open', 'new', 'contacted', 'converted', 'discarded', 'all'];

  /**
   * ⚠️ **La nota se CARGA al abrir, no se empieza en blanco.** Con un campo
   * vacío delante de una solicitud que ya tenía nota, lo que el operador
   * escribe no amplía lo anterior: lo sustituye sin que se vea qué había. El
   * campo enseña lo guardado y se edita encima, que es lo que un campo de texto
   * promete.
   */
  alternar(id?: string): void {
    if (!id) return;
    const abre = this.abierta() !== id;
    this.notaInterna = abre ? (this.requests().find((r) => r.id === id)?.internalNote ?? '') : '';
    this.abierta.set(abre ? id : null);
  }

  // --- Lo que la ficha pregunta -------------------------------------------

  precioEnPie(r: BookingRequest): boolean {
    return priceStillGuaranteed(r);
  }

  puedeConvertir(r: BookingRequest): boolean {
    return canConvert(r);
  }

  puedeDescartar(r: BookingRequest): boolean {
    return canDiscard(r);
  }

  telefono(r: BookingRequest): string {
    return telLink(r);
  }

  /** El mismo número que el enlace, pero separado para leerlo y dictarlo. */
  telefonoLegible(r: BookingRequest): string {
    return formatPhone(r.phone);
  }

  whatsapp(r: BookingRequest): string {
    return whatsappLink(r, BRAND_CONFIG.name);
  }

  fecha(valor: any): Date | null {
    if (!valor) return null;
    const d = toDate(valor);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * ⚠️ **La ficha enseña MEDIODÍA, no la ventana guardada.** Lo almacenado son
   * días completos —00:00 y 23:59:59— porque así se cruza con las reservas, y
   * esas no son horas a las que se entregue un coche. Ver `DEFAULT_REQUEST_HOUR`.
   */
  recogidaPropuesta(r: BookingRequest): Date | null {
    return requestPickupAt(r);
  }

  devolucionPropuesta(r: BookingRequest): Date | null {
    return requestReturnAt(r);
  }

  puedeAmpliar(r: BookingRequest): boolean {
    return canExtendGuarantee(r);
  }

  /** ¿La nota que hay en el campo es distinta de la guardada? */
  notaCambiada(r: BookingRequest): boolean {
    return this.notaInterna.trim() !== (r.internalNote ?? '').trim();
  }

  // --- Acciones ------------------------------------------------------------

  async contactada(r: BookingRequest): Promise<void> {
    if (!r.id) return;
    this.guardando.set(r.id);
    try {
      await this.service.markContacted(r.id, this.notaInterna.trim() || undefined);
      this.notaInterna = '';
    } catch {
      this.notifications.error('bookingRequests.errors.saveFailed');
    } finally {
      this.guardando.set(null);
    }
  }

  /**
   * Guardar la nota, y nada más.
   *
   * ⚠️ **Hasta hoy no había forma de guardarla sola.** Solo viajaba de rebote
   * con «Marcar contactada» y con «Descartar», así que una solicitud ya
   * contactada no admitía una segunda nota: se escribía, no había botón, y al
   * cerrar la ficha se perdía. Lo señaló Dorel el 29 de septiembre de 2026.
   */
  async guardarNota(r: BookingRequest): Promise<void> {
    if (!r.id || !this.notaCambiada(r)) return;
    this.guardando.set(r.id);
    try {
      await this.service.saveInternalNote(r.id, this.notaInterna);
      this.notifications.success('bookingRequests.noteSaved');
    } catch {
      this.notifications.error('bookingRequests.errors.saveFailed');
    } finally {
      this.guardando.set(null);
    }
  }

  /**
   * Ampliar 24 h el precio garantizado.
   *
   * ⚠️ **Un botón por cada 24 h, y no un desplegable de días.** El caso es «se
   * lo está pensando, dale un día más»: pulsarlo dos veces son dos días, que es
   * lo que Dorel pidió, y el plazo que queda se ve en la línea de encima —así
   * que ampliar de más se ve al momento en vez de decidirse a ciegas.
   */
  async ampliar(r: BookingRequest): Promise<void> {
    if (!r.id || !canExtendGuarantee(r)) return;
    const hasta = extendedGuaranteeUntil(this.fecha(r.priceGuaranteedUntil), 24);
    this.guardando.set(r.id);
    try {
      await this.service.extendPriceGuarantee(r.id, hasta);
      this.notifications.success('bookingRequests.extended');
    } catch {
      this.notifications.error('bookingRequests.errors.saveFailed');
    } finally {
      this.guardando.set(null);
    }
  }

  async descartar(r: BookingRequest): Promise<void> {
    if (!r.id || !canDiscard(r)) return;
    const ok = await this.confirm.ask({
      title: 'bookingRequests.discard.title',
      message: 'bookingRequests.discard.message'
    });
    if (!ok) return;
    this.guardando.set(r.id);
    try {
      await this.service.discard(r.id, this.notaInterna.trim() || undefined);
      this.notaInterna = '';
    } catch {
      this.notifications.error('bookingRequests.errors.saveFailed');
    } finally {
      this.guardando.set(null);
    }
  }

  /**
   * Convertir en reserva.
   *
   * ⚠️ **Lleva los datos al asistente por la URL; NO crea la reserva aquí.**
   * Crear una reserva es una sola escritura con sus filas de cobro, sus
   * comprobaciones de disponibilidad y su cliente — todo eso vive en el
   * asistente, y duplicarlo sería una segunda forma de crear alquileres. Lo que
   * esto hace es ahorrarle al operador teclear lo que el cliente ya eligió.
   */
  convertir(r: BookingRequest): void {
    if (!r.id || !canConvert(r)) return;
    /**
     * ⚠️ **Las horas son las PROPUESTAS, no las de la ventana guardada.** Aquí
     * se pasaba `pickupDate` y `returnDate` tal cual, o sea la recogida a las
     * 00:00 y la devolución a las 23:59:59, y el asistente nacía con ellas: una
     * entrega de madrugada que nadie había pactado. Ver `DEFAULT_REQUEST_HOUR`.
     */
    const desde = requestPickupAt(r);
    const hasta = requestReturnAt(r);
    const iso = (d: Date | null) => {
      if (!d) return '';
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    void this.router.navigate(['/reservations', 'new'], {
      queryParams: {
        fromRequest: r.id,
        vehicleId: r.vehicleId,
        pickup: iso(desde),
        return: iso(hasta),
        clientName: r.name,
        clientPhone: r.phone
      }
    });
  }

  abrirReserva(r: BookingRequest): void {
    if (r.reservationId) void this.router.navigate(['/reservations', r.reservationId]);
  }
}
