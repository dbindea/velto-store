import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { ThemeService } from '@core/theme/theme.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { LanguageSelectorComponent } from '@shared/components/language-selector/language-selector.component';
import { GlobalSearchComponent } from '@shared/components/global-search/global-search.component';
import { BrandLogoComponent } from '@shared/components/brand-logo/brand-logo.component';
import { Permission, ROUTE_PERMISSIONS, can } from '@shared/utils/permissions.util';
import { BUILD_INFO } from '@core/config/build-info';
import { BookingRequestService } from '@features/booking-requests/services/booking-request.service';

interface MenuItem {
  path: string;
  iconClass: string;
  labelKey: string;
  showInMobile: boolean;
  /** Permiso necesario para verlo. Sin él, lo ve cualquier usuario autorizado. */
  permission?: Permission;
  /**
   * Lleva un contador al lado.
   *
   * ⚠️ **Es lo que hace que una entrada de menú más no sea un problema**: se ve
   * que hay dos solicitudes sin contestar sin tener que entrar. Sin él, la
   * pantalla depende de que alguien se acuerde de abrirla — y una solicitud que
   * nadie ve en una hora es un alquiler perdido.
   */
  badge?: 'bookingRequests';
}

@Component({
  selector: 'app-private-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
    LanguageSelectorComponent,
    GlobalSearchComponent,
    BrandLogoComponent
  ],
  templateUrl: './private-layout.component.html',
  styleUrl: './private-layout.component.scss'
})
export class PrivateLayoutComponent {
  authService = inject(AuthService);
  themeService = inject(ThemeService);
  private router = inject(Router);
  private bookingRequests = inject(BookingRequestService);

  sidebarOpen = signal(false);

  /**
   * Al cambiar de pantalla no queda ningún menú abierto.
   *
   * ⚠️ **Es la garantía general, y hace falta porque los cierres uno a uno se
   * olvidan.** Cada enlace del menú lateral llevaba el suyo, pero la barra
   * inferior no cerraba el menú «Más»: se pulsaba «Reservas» con el panel
   * abierto, se navegaba, y el panel se quedaba flotando encima de la pantalla
   * nueva. Colgado de la navegación, da igual desde dónde se salga — un enlace,
   * el buscador global o un aviso que lleve a otro sitio.
   *
   * No sustituye a los `(click)` de cada opción: pulsar la pantalla en la que
   * ya estás **no genera navegación**, y ahí solo cierra el del propio enlace.
   */
  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.sidebarOpen.set(false);
        this.moreMenuOpen.set(false);
        this.searchOpen.set(false);
      });

    this.bookingRequests
      .watchRequests()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (r) => this.solicitudesNuevas.set(r.filter((x) => x.status === 'new').length),
        // Ver `solicitudesNuevas`: un contador que falta no puede tirar el menú.
        error: () => this.solicitudesNuevas.set(0)
      });
  }

  /**
   * El commit que se está ejecutando, para poder contestar «¿estoy viendo lo
   * último?» sin salir de la pantalla.
   *
   * ⚠️ **La pregunta es real y ya costó una tarde.** El 21 de septiembre de 2026
   * producción sirvió el JavaScript nuevo con las traducciones viejas por la
   * caché de Cloudflare, y desde la aplicación no había forma de notarlo: el pie
   * ponía `VELTO v1.0`, que es lo mismo en todos los despliegues desde el primer
   * día.
   *
   * Siete caracteres bastan para comparar con la rama de un vistazo; el
   * completo y la fecha van en el `title`, que es donde se miran cuando de
   * verdad hace falta.
   */
  readonly buildLabel = BUILD_INFO.commit === 'local' ? 'local' : BUILD_INFO.commit.slice(0, 7);

  /** El commit entero y cuándo se compiló, para el `title`. */
  readonly buildDetail = BUILD_INFO.commit === 'local'
    ? ''
    : `${BUILD_INFO.branch} · ${BUILD_INFO.commit}${BUILD_INFO.builtAt ? ' · ' + BUILD_INFO.builtAt : ''}`;

  /**
   * El menú completo. Lo que cada uno ve sale de `visibleMenuItems`.
   *
   * Los permisos de las tres restringidas se leen de `ROUTE_PERMISSIONS`, el
   * mismo sitio del que los leen los guards de ruta: si el menú y el guard
   * tuvieran cada uno su lista, el día que discrepen alguien vería una entrada
   * que al pulsarla le devuelve al dashboard.
   *
   * ⚠️ **El orden es el de Dorel, y va de lo que más se abre a lo que menos**
   * (23 de septiembre de 2026): reservas antes que calendario, y los informes
   * subidos por delante del dinero del día a día. Antes empezaba por calendario
   * y dejaba los coches y los clientes detrás de Pagos.
   *
   * ⚠️ **Y este array manda también sobre la barra inferior del móvil**, que
   * sale de filtrarlo por `showInMobile`. Es a propósito: dos listas serían dos
   * fuentes de verdad para la misma prioridad, y la del móvil se quedaría vieja
   * la primera vez que alguien reordenara solo la lateral.
   */
  private readonly allMenuItems: MenuItem[] = [
    { path: '/dashboard', iconClass: 'pi pi-home', labelKey: 'menu.dashboard', showInMobile: true },
    { path: '/reservations', iconClass: 'pi pi-book', labelKey: 'menu.reservations', showInMobile: true },
    /**
     * ⚠️ **Justo debajo de Reservas, y ese sitio es una decisión.** El orden va
     * de lo que más se abre a lo que menos (decisión de Dorel, 23 de septiembre
     * de 2026), y una solicitud sin contestar es de lo más urgente que hay: el
     * cliente está esperando una llamada y mientras tanto puede llamar a otro.
     */
    {
      path: '/booking-requests',
      iconClass: 'pi pi-inbox',
      labelKey: 'menu.bookingRequests',
      showInMobile: false,
      badge: 'bookingRequests'
    },
    { path: '/events', iconClass: 'pi pi-bell', labelKey: 'menu.events', showInMobile: true },
    { path: '/calendar', iconClass: 'pi pi-calendar', labelKey: 'menu.calendar', showInMobile: true },
    { path: '/vehicles', iconClass: 'pi pi-car', labelKey: 'menu.vehicles', showInMobile: false },
    { path: '/clients', iconClass: 'pi pi-users', labelKey: 'menu.clients', showInMobile: false },
    {
      path: '/reports',
      iconClass: 'pi pi-chart-line',
      labelKey: 'menu.reports',
      showInMobile: false,
      permission: ROUTE_PERMISSIONS['reports']
    },
    { path: '/payments', iconClass: 'pi pi-credit-card', labelKey: 'menu.payments', showInMobile: true },
    {
      path: '/expenses',
      iconClass: 'pi pi-wallet',
      labelKey: 'menu.expenses',
      showInMobile: false,
      permission: ROUTE_PERMISSIONS['expenses']
    },
    {
      path: '/invoices',
      iconClass: 'pi pi-receipt',
      labelKey: 'menu.invoices',
      showInMobile: false,
      permission: ROUTE_PERMISSIONS['invoices']
    },
    {
      path: '/collaborators',
      iconClass: 'pi pi-briefcase',
      labelKey: 'menu.collaborators',
      showInMobile: false,
      permission: ROUTE_PERMISSIONS['collaborators']
    },
    { path: '/contracts', iconClass: 'pi pi-file-pdf', labelKey: 'menu.contracts', showInMobile: false },
    { path: '/inspections', iconClass: 'pi pi-check-square', labelKey: 'menu.inspections', showInMobile: false },
    {
      path: '/settings',
      iconClass: 'pi pi-cog',
      labelKey: 'menu.settings',
      showInMobile: false,
      permission: ROUTE_PERMISSIONS['settings']
    }
  ];

  /**
   * Lo que ve quien está dentro.
   *
   * Es un `computed` sobre la señal del usuario autorizado, no una lista
   * calculada una vez: en el arranque el rol todavía no ha llegado —lo trae una
   * lectura de Firestore— y una lista fija se habría quedado con el menú
   * recortado de un usuario sin rol hasta recargar la página.
   */
  readonly visibleMenuItems = computed(() => {
    const role = this.authService.authorizedUser()?.role;
    return this.allMenuItems.filter((item) => !item.permission || can(role, item.permission));
  });

  readonly mobileMenuItems = computed(() =>
    this.visibleMenuItems().filter((item) => item.showInMobile)
  );

  /**
   * Cuántas solicitudes de la web están sin contestar.
   *
   * ⚠️ **Se ESCUCHA, no se lee al entrar.** Quien crea una solicitud es un
   * visitante desde fuera, en cualquier momento: con una lectura de una vez, el
   * contador se quedaría a cero toda la sesión y la entrada de menú no serviría
   * para lo único que existe. Es la misma razón por la que escuchan los pagos.
   *
   * ⚠️ **Y un fallo aquí no puede tirar el menú.** Si la consulta falla —un
   * despliegue de reglas propagándose— el contador se queda a cero y la
   * aplicación sigue: un número que falta es un problema pequeño, un menú que
   * no se pinta es uno grande.
   */
  private readonly solicitudesNuevas = signal(0);

  readonly badgeCounts = computed<Record<string, number>>(() => ({
    bookingRequests: this.solicitudesNuevas()
  }));

  readonly remainingMenuItems = computed(() =>
    this.visibleMenuItems().filter((item) => !item.showInMobile)
  );

  /**
   * ¿Hay algo con contador **escondido dentro de «Más»**?
   *
   * ⚠️ **Sin esto, en un móvil un aviso no existe.** Solicitudes no cabe en la
   * barra de abajo —son seis huecos y hay quince entradas—, así que su contador
   * vivía donde solo se ve abriendo el menú: o sea, se ve cuando ya has ido a
   * mirar. Justo lo contrario de para lo que está un contador.
   *
   * ⚠️ **Es un punto y no un número**, y la diferencia importa el día que haya
   * un segundo contador: sumar dos cosas distintas —solicitudes y lo que
   * venga— da una cifra que no significa nada. El punto dice «hay algo aquí
   * dentro», que es todo lo que un botón de menú puede decir con honradez; el
   * número está dentro, en su entrada.
   */
  readonly hayAvisoEnMas = computed(() => {
    const cuentas = this.badgeCounts();
    return this.remainingMenuItems().some((item) => !!item.badge && cuentas[item.badge] > 0);
  });

  moreMenuOpen = signal(false);
  searchOpen = signal(false);

  /**
   * The logo is the way home. `routerLink` handles the navigation; this
   * clears everything that could survive it — open sidebar, "more" menu,
   * search overlay — and scrolls back to the top, so the dashboard is reached
   * in the same state as when entering the app.
   */
  goHome() {
    this.sidebarOpen.set(false);
    this.moreMenuOpen.set(false);
    this.searchOpen.set(false);
    window.scrollTo({ top: 0 });
  }

  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }

  closeSidebar() {
    this.sidebarOpen.set(false);
  }

  toggleMoreMenu() {
    this.moreMenuOpen.update(v => !v);
  }

  toggleSearch() {
    this.searchOpen.update(v => !v);
  }

  closeSearch() {
    this.searchOpen.set(false);
  }

  /**
   * Ctrl+K / Cmd+K opens the global search from anywhere inside
   * the authenticated app — except when the user is already
   * typing into an input/textarea.
   */
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      if (!isEditable) {
        event.preventDefault();
        this.searchOpen.set(true);
      }
    } else if (event.key === 'Escape' && this.searchOpen()) {
      this.searchOpen.set(false);
    }
  }

  toggleDarkMode() {
    this.themeService.toggleTheme();
  }

  /** Un icono por tema: el botón rota entre los cuatro y tiene que decir cuál. */
  themeIcon(): string {
    return (
      {
        light: 'pi-sun',
        dark: 'pi-moon',
        forest: 'pi-cloud',
        ocean: 'pi-star'
      }[this.themeService.theme()] || 'pi-sun'
    );
  }

  async logout() {
    await this.authService.logout();
  }

}
