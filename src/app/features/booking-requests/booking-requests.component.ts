import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
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
  whatsappLink,
  whatsappMessage
} from '@shared/utils/booking-request.util';
import { toDate } from '@shared/utils/reservation-date.util';
import { copyToClipboard } from '@shared/utils/clipboard.util';

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
  /** Cuál acaba de copiarse, para enseñar el tic un momento. */
  readonly copiado = signal<string | null>(null);
  readonly mensajeCopiado = signal<string | null>(null);

  /**
   * El mensaje que se le va a mandar al cliente.
   *
   * ⚠️ **Se redacta al abrir la ficha y el operador lo reescribe si quiere**:
   * fue la decisión de Dorel —«redactado y editable antes de enviar»— y hasta
   * hoy no estaba hecha, el texto viajaba fijo dentro del enlace sin que se
   * pudiera ver ni tocar.
   *
   * ⚠️ **Y NO se guarda en Firestore.** Es lo que se le dice a una persona en
   * una conversación, no un dato de la solicitud: guardarlo obligaría a decidir
   * qué pasa cuando el coche o el precio cambian y el texto ya no cuadra. Lo
   * que sí se guarda es la **nota interna**, que es otra cosa.
   */
  mensajeWhatsapp = '';

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

    /**
     * ⚠️ **Y los campos de la ficha se rellenan AQUÍ, no al pulsarla.** Por el
     * enlace del correo nadie pulsa nada y la lista aún no ha llegado; este
     * efecto reacciona a las dos cosas —qué ficha está abierta y cuándo llegan
     * los datos— y por eso funciona por los dos caminos.
     */
    effect(() => this.cargarCamposDeLaFichaAbierta());
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
   * Abrir y cerrar la ficha. **Los campos NO se rellenan aquí** — ver
   * `cargarCamposDeLaFichaAbierta()`.
   */
  alternar(id?: string): void {
    if (!id) return;
    this.abierta.set(this.abierta() === id ? null : id);
  }

  /**
   * Rellenar la nota y el borrador del mensaje cuando la ficha abierta ESTÁ.
   *
   * ⚠️ **Esto vivía dentro de `alternar()`, y por eso el enlace del correo
   * llevaba a una ficha ROTA.** Entrando por `/booking-requests/:id` nadie
   * pulsa nada: el constructor hace `abierta.set(id)` directamente, y encima lo
   * hace **antes de que la suscripción haya emitido**, así que la solicitud
   * todavía no existe en `requests()`. Resultado: el mensaje de WhatsApp salía
   * **vacío** y la nota interna sin cargar — y entonces «Guardar nota» se
   * encendía y **borraba** la que había, con un «Nota guardada» delante.
   *
   * Lo encontró una revisión adversaria el 29 de septiembre de 2026, sobre
   * código que yo mismo había probado el día anterior: recorrí la ruta y
   * comprobé que abría la ficha correcta, pero no miré los campos de dentro.
   *
   * ⚠️ **Y solo carga al CAMBIAR de ficha, no cada vez que llegan datos.** La
   * lista escucha en vivo: sin `cargadaEn`, cualquier cambio en cualquier
   * solicitud reemitiría y pisaría lo que el operador está escribiendo en ese
   * momento.
   */
  private cargadaEn: string | null = null;

  private cargarCamposDeLaFichaAbierta(): void {
    const id = this.abierta();
    if (!id) {
      this.cargadaEn = null;
      this.notaInterna = '';
      this.mensajeWhatsapp = '';
      return;
    }
    if (this.cargadaEn === id) return;
    const r = this.requests().find((x) => x.id === id);
    // Todavía no ha llegado la lista: se vuelve a intentar en la próxima
    // emisión, que es justo lo que el enlace del correo necesita.
    if (!r) return;

    this.cargadaEn = id;
    this.notaInterna = r.internalNote ?? '';
    /**
     * ⚠️ **`brandName`, no `name`.** Aquel es «Velto Mobility», que es como la
     * empresa se presenta a un cliente; `name` es el nombre corto de la barra
     * lateral y decir «te contacto de Velto» suena a apodo interno.
     */
    this.mensajeWhatsapp = whatsappMessage(r, BRAND_CONFIG.brandName);
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

  /**
   * El enlace lleva **lo que hay en el campo**, no el borrador.
   *
   * ⚠️ Componerlo aquí otra vez haría que el operador reescribiera el mensaje y
   * saliera el de siempre, y no se enteraría hasta verlo en el chat del
   * cliente. Ver `whatsappMessage()`.
   */
  whatsapp(r: BookingRequest): string {
    return whatsappLink(r, this.mensajeWhatsapp);
  }

  /**
   * Copiar el mensaje, que es la vía de ESCRITORIO.
   *
   * ⚠️ **El enlace `wa.me` solo sirve de verdad en el móvil**, que es donde
   * abre la aplicación con el chat puesto. En el ordenador Dorel no enlaza
   * —escribe desde WhatsApp Web—, así que sin un botón de copiar tendría que
   * seleccionar el texto a mano de un campo de varias líneas. Lo pidió el 29 de
   * septiembre de 2026.
   */
  async copiarMensaje(r: BookingRequest): Promise<void> {
    if (!r.id) return;
    const ok = await copyToClipboard(this.mensajeWhatsapp);
    if (!ok) {
      this.notifications.error('common.copyFailed');
      return;
    }
    this.mensajeCopiado.set(r.id);
    setTimeout(() => {
      if (this.mensajeCopiado() === r.id) this.mensajeCopiado.set(null);
    }, 1500);
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

  /**
   * Copiar el teléfono.
   *
   * ⚠️ **Se copia el número CRUDO, no el separado.** Lo formateado es para
   * leerlo y dictarlo; lo que se pega en una agenda o en un WhatsApp tiene que
   * marcar, y `+34 699 887 766` con espacios no siempre lo hace. Es el mismo
   * reparto que entre `telLink()` y `formatPhone()`.
   */
  async copiarTelefono(r: BookingRequest): Promise<void> {
    if (!r.id) return;
    const ok = await copyToClipboard(`+${r.phone}`);
    if (!ok) {
      this.notifications.error('common.copyFailed');
      return;
    }
    // El aspa se convierte en un tic un momento: copiar no deja rastro en la
    // pantalla, y sin esto no hay forma de saber si el botón hizo algo.
    this.copiado.set(r.id);
    setTimeout(() => {
      if (this.copiado() === r.id) this.copiado.set(null);
    }, 1500);
  }

  /** ¿La nota que hay en el campo es distinta de la guardada? */
  notaCambiada(r: BookingRequest): boolean {
    return this.notaInterna.trim() !== (r.internalNote ?? '').trim();
  }

  /**
   * Qué se le enseña al operador cuando el servicio rechaza.
   *
   * ⚠️ **El servicio rechaza con una CLAVE i18n**, no con una frase, y por eso
   * se puede pintar tal cual. Sin esto, «esa solicitud ya está atendida» —el
   * caso de dos pestañas abiertas— saldría como un «No se pudo guardar el
   * cambio» genérico, que no dice qué hacer.
   */
  private avisarDe(error: unknown): void {
    const m = (error as { message?: unknown })?.message;
    const clave =
      typeof m === 'string' && m.startsWith('bookingRequests.')
        ? m
        : 'bookingRequests.errors.saveFailed';
    this.notifications.error(clave);
  }

  // --- Acciones ------------------------------------------------------------

  async contactada(r: BookingRequest): Promise<void> {
    if (!r.id) return;
    this.guardando.set(r.id);
    try {
      /**
       * ⚠️ **El campo NO se vacía después.** Aquí ponía `notaInterna = ''` y
       * eso armaba una trampa: la ficha sigue abierta —`contacted` cae en la
       * misma rama de la plantilla—, así que el operador veía el textarea en
       * blanco con su nota ya guardada en Firestore, daba por hecho que se
       * había perdido, pulsaba «Guardar nota»… y la **borraba**, porque el
       * campo vacío viaja como `deleteField()`. Con un «Nota guardada» de
       * confirmación delante.
       */
      await this.service.markContacted(r.id, this.notaInterna.trim() || undefined);
    } catch (error) {
      this.avisarDe(error);
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
    } catch (error) {
      this.avisarDe(error);
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
    } catch (error) {
      this.avisarDe(error);
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
      // El campo no se vacía, por lo mismo que en `contactada()`.
      await this.service.discard(r.id, this.notaInterna.trim() || undefined);
    } catch (error) {
      this.avisarDe(error);
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
        /** La referencia, para que el asistente pueda decir de dónde viene. */
        requestRef: r.reference,
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
