import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { ThemeService } from '@core/theme/theme.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { LanguageSelectorComponent } from '@shared/components/language-selector/language-selector.component';
import { GlobalSearchComponent } from '@shared/components/global-search/global-search.component';
import { BrandLogoComponent } from '@shared/components/brand-logo/brand-logo.component';
import { Permission, ROUTE_PERMISSIONS, can } from '@shared/utils/permissions.util';

interface MenuItem {
  path: string;
  iconClass: string;
  labelKey: string;
  showInMobile: boolean;
  /** Permiso necesario para verlo. Sin él, lo ve cualquier usuario autorizado. */
  permission?: Permission;
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

  sidebarOpen = signal(false);

  /**
   * El menú completo. Lo que cada uno ve sale de `visibleMenuItems`.
   *
   * Los permisos de las tres restringidas se leen de `ROUTE_PERMISSIONS`, el
   * mismo sitio del que los leen los guards de ruta: si el menú y el guard
   * tuvieran cada uno su lista, el día que discrepen alguien vería una entrada
   * que al pulsarla le devuelve al dashboard.
   */
  private readonly allMenuItems: MenuItem[] = [
    { path: '/dashboard', iconClass: 'pi pi-home', labelKey: 'menu.dashboard', showInMobile: true },
    { path: '/calendar', iconClass: 'pi pi-calendar', labelKey: 'menu.calendar', showInMobile: true },
    { path: '/reservations', iconClass: 'pi pi-book', labelKey: 'menu.reservations', showInMobile: true },
    { path: '/vehicles', iconClass: 'pi pi-car', labelKey: 'menu.vehicles', showInMobile: false },
    { path: '/clients', iconClass: 'pi pi-users', labelKey: 'menu.clients', showInMobile: false },
    { path: '/payments', iconClass: 'pi pi-credit-card', labelKey: 'menu.payments', showInMobile: true },
    {
      path: '/expenses',
      iconClass: 'pi pi-wallet',
      labelKey: 'menu.expenses',
      showInMobile: false,
      permission: ROUTE_PERMISSIONS['expenses']
    },
    { path: '/contracts', iconClass: 'pi pi-file-pdf', labelKey: 'menu.contracts', showInMobile: false },
    { path: '/inspections', iconClass: 'pi pi-check-square', labelKey: 'menu.inspections', showInMobile: false },
    {
      path: '/reports',
      iconClass: 'pi pi-chart-line',
      labelKey: 'menu.reports',
      showInMobile: false,
      permission: ROUTE_PERMISSIONS['reports']
    },
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

  readonly remainingMenuItems = computed(() =>
    this.visibleMenuItems().filter((item) => !item.showInMobile)
  );

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

  async logout() {
    await this.authService.logout();
  }

}
