import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { PaymentConceptPipe } from '@shared/pipes/payment-concept.pipe';
import { PaymentService } from '@features/payments/services/payment.service';
import {
  Payment,
  PaymentMethod,
  PaymentType,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_METHOD_ICONS
} from '@shared/models/payment.model';
import { toDate } from '@shared/utils/reservation-date.util';
import { visiblePayments } from '@shared/utils/payment-scope.util';
import { PAGINA, hayMas, siguientePagina } from '@shared/utils/pagination.util';
import { PermissionsService } from '@core/auth/permissions.service';
import { NotificationService } from '@core/notifications/notification.service';
import { ClearInputDirective } from '@shared/directives/clear-input.directive';

type TabFilter = 'all' | 'pending' | 'paid' | 'failed';

/**
 * El libro de cobros.
 *
 * ⚠️ **Sin `viewPaymentHistory` solo se ven los cobros ABIERTOS.** La lista de
 * todo lo cobrado desde siempre es la facturación del negocio servida fila a
 * fila, y esa es información de dueño — la misma que protegen Informes y Gastos.
 * Lo que un empleado necesita para trabajar es lo contrario: lo que falta por
 * cobrar. Ver `payment-scope.util.ts`.
 *
 * El recorte se aplica **al cargar**, no en `applyFilters()`: puesto en el
 * filtro, cambiar de pestaña volvería a enseñarlo todo.
 */
@Component({
  selector: 'app-payment-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslatePipe, PaymentConceptPipe, ClearInputDirective],
  templateUrl: './payment-list.component.html',
  styleUrl: './payment-list.component.scss'
})
export class PaymentListComponent implements OnInit {
  private router = inject(Router);
  private paymentService = inject(PaymentService);
  private notifications = inject(NotificationService);
  private destroyRef = inject(DestroyRef);
  readonly permissions = inject(PermissionsService);

  payments: Payment[] = [];
  filteredPayments: Payment[] = [];
  loading = true;

  /**
   * Cuántos cobros se están trayendo. Sube al pulsar «cargar más antiguos».
   *
   * ⚠️ **Esto leía la colección ENTERA**, y además escuchándola: cada apertura
   * de Pagos traía todos los cobros desde el primer día y dejaba el oyente
   * abierto sobre todos ellos. Ver `pagination.util.ts`.
   */
  readonly tope = signal(PAGINA);
  /** Cuántos ha devuelto la última consulta, para saber si queda más detrás. */
  private recibidos = 0;
  private suscripcion?: Subscription;

  /**
   * ⚠️ **Solo si lo recibido llena el tope.** Si vienen menos, no hay más y el
   * botón no haría nada — y un botón que no hace nada es un fallo.
   *
   * Se mira lo **recibido**, no lo que queda después de filtrar: con un filtro
   * puesto la lista puede quedarse en dos filas y seguir habiendo miles detrás.
   */
  get puedeCargarMas(): boolean {
    return hayMas(this.recibidos, this.tope());
  }

  cargarMas(): void {
    this.tope.set(siguientePagina(this.tope()));
    this.loadPayments();
  }

  // Filters
  searchTerm = '';
  statusFilter: TabFilter = 'all';
  methodFilter: PaymentMethod | 'all' = 'all';
  typeFilter: PaymentType | 'all' = 'all';
  scopeFilter: 'all' | 'reservation' | 'free' = 'all';

  // Labels & helpers (exposed to template)
  PAYMENT_STATUS_LABELS = PAYMENT_STATUS_LABELS;
  PAYMENT_METHOD_LABELS = PAYMENT_METHOD_LABELS;
  PAYMENT_TYPE_LABELS = PAYMENT_TYPE_LABELS;
  PAYMENT_STATUS_COLORS = PAYMENT_STATUS_COLORS;
  PAYMENT_METHOD_ICONS = PAYMENT_METHOD_ICONS;

  /**
   * ⚠️ **La pestaña «Cobrados» no se ofrece sin el permiso.** Sin el histórico
   * saldría siempre vacía, y un botón que no hace nada es un fallo: el compañero
   * la pulsa, no pasa nada, y acaba llamando para preguntar qué le pasa a la
   * aplicación. Mejor que no esté, y que al lado se explique por qué.
   */
  get statusOptions(): Array<{ value: TabFilter; label: string }> {
    const todas: Array<{ value: TabFilter; label: string }> = [
      { value: 'all', label: 'common.all' },
      { value: 'pending', label: 'payments.status.pending' },
      { value: 'paid', label: 'payments.status.paid' },
      { value: 'failed', label: 'payments.status.failed' }
    ];
    if (this.permissions.canViewPaymentHistory()) return todas;
    return todas.filter((o) => o.value !== 'paid');
  }

  methodOptions: Array<{ value: PaymentMethod | 'all'; label: string }> = [
    // Ver la nota de inspecciones: dos desplegables con «Todos» no se distinguen.
    { value: 'all', label: 'payments.filters.allMethods' },
    { value: 'cash', label: 'payments.methods.cash' },
    { value: 'bank_transfer', label: 'payments.methods.bankTransfer' },
    { value: 'bizum', label: 'payments.methods.bizum' },
    { value: 'physical_pos', label: 'payments.methods.physicalPos' },
    { value: 'redsys', label: 'payments.methods.redsys' },
    { value: 'manual_card', label: 'payments.methods.manualCard' },
    { value: 'other', label: 'payments.methods.other' }
  ];

  scopeOptions: Array<{ value: 'all' | 'reservation' | 'free'; label: string }> = [
    { value: 'all', label: 'payments.filters.allScopes' },
    { value: 'reservation', label: 'payments.filters.reservationPayments' },
    { value: 'free', label: 'payments.filters.freePayments' }
  ];

  ngOnInit(): void {
    this.loadPayments();
  }

  /**
   * ⚠️ **Escucha, no lee una vez.** Quien da por cobrado un pago con tarjeta es
   * el webhook de Redsys, que escribe en Firestore minutos después de que el
   * operador abriera esta pantalla. Con `getPayments()` la fila se quedaba en
   * «Pendiente» hasta pulsar F5, y quien acaba de ver pagar al cliente delante
   * no entiende por qué la aplicación dice que no.
   *
   * ⚠️ **Se suscribe una sola vez por tope.** `takeUntilDestroyed` la corta al
   * salir de la pantalla; sin él la suscripción sobrevive y sigue escribiendo
   * en un componente que ya no existe. Y por eso el `retry` del aviso de error
   * vuelve a llamar aquí: un stream que falla queda terminado y hay que
   * rehacerlo.
   *
   * ⚠️ **Volver a llamar aquí SÍ es correcto cuando cambia el tope**, y es la
   * excepción a la regla de que un stream vivo no se refresca: no se está
   * refrescando lo mismo, se está pidiendo **otra consulta**. Por eso lo primero
   * que hace es cerrar la anterior — sin eso se apilarían dos oyentes sobre la
   * misma colección, que es el fallo que ya costó una tanda de arreglos.
   */
  loadPayments(): void {
    this.loading = true;
    this.suscripcion?.unsubscribe();
    this.suscripcion = this.paymentService
      .watchPayments(this.tope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (payments) => {
        this.recibidos = payments.length;
        // El recorte va aquí y no en `applyFilters()`: después, cualquier
        // pestaña volvería a enseñar lo que este permiso retira.
        this.payments = visiblePayments(payments, this.permissions.canViewPaymentHistory());
        this.applyFilters();
        this.loading = false;
      },
      error: () => {
        /**
         * ⚠️ Antes esto era un `console.error` y nada más: si fallaba, la lista
         * salía vacía y la pantalla decía «no hay pagos», que es mentira y se
         * actúa sobre ella. Si una acción puede fallar, tiene que contarlo.
         */
        this.notifications.error('payments.errors.loadFailed', {
          retry: () => this.loadPayments()
        });
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    let result = [...this.payments];

    if (this.statusFilter === 'pending') {
      result = result.filter(p => p.status === 'pending' || p.status === 'partial');
    } else if (this.statusFilter === 'paid') {
      result = result.filter(p => p.status === 'paid' || p.status === 'refunded');
    } else if (this.statusFilter === 'failed') {
      result = result.filter(p => p.status === 'failed' || p.status === 'cancelled');
    }

    if (this.methodFilter !== 'all') {
      result = result.filter(p => p.method === this.methodFilter);
    }

    if (this.typeFilter !== 'all') {
      result = result.filter(p => p.type === this.typeFilter);
    }

    if (this.scopeFilter === 'free') {
      result = result.filter(p => p.isFreePayment);
    } else if (this.scopeFilter === 'reservation') {
      result = result.filter(p => !p.isFreePayment && !!p.reservationId);
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(p =>
        p.concept?.toLowerCase().includes(term) ||
        p.clientSnapshot?.fullName?.toLowerCase().includes(term) ||
        p.vehicleSnapshot?.plateNumber?.toLowerCase().includes(term) ||
        p.internalReference?.toLowerCase().includes(term)
      );
    }

    this.filteredPayments = result;
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  viewDetail(payment: Payment): void {
    this.router.navigate(['/payments', payment.id]);
  }

  getDueDate(payment: Payment): Date | null {
    if (!payment.dueDate) return null;
    return toDate(payment.dueDate);
  }

  getPaidAt(payment: Payment): Date | null {
    if (!payment.paidAt) return null;
    return toDate(payment.paidAt);
  }
}