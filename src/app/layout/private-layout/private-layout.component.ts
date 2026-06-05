import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { ThemeService } from '@core/theme/theme.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { LanguageSelectorComponent } from '@shared/components/language-selector/language-selector.component';

interface MenuItem {
  path: string;
  iconClass: string;
  labelKey: string;
  showInMobile: boolean;
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
    LanguageSelectorComponent
  ],
  templateUrl: './private-layout.component.html',
  styleUrl: './private-layout.component.scss'
})
export class PrivateLayoutComponent {
  authService = inject(AuthService);
  themeService = inject(ThemeService);

  sidebarOpen = signal(false);

  menuItems: MenuItem[] = [
    { path: '/dashboard', iconClass: 'pi pi-home', labelKey: 'menu.dashboard', showInMobile: true },
    { path: '/calendar', iconClass: 'pi pi-calendar', labelKey: 'menu.calendar', showInMobile: true },
    { path: '/reservations', iconClass: 'pi pi-book', labelKey: 'menu.reservations', showInMobile: true },
    { path: '/vehicles', iconClass: 'pi pi-car', labelKey: 'menu.vehicles', showInMobile: false },
    { path: '/clients', iconClass: 'pi pi-users', labelKey: 'menu.clients', showInMobile: false },
    { path: '/payments', iconClass: 'pi pi-credit-card', labelKey: 'menu.payments', showInMobile: true },
    { path: '/expenses', iconClass: 'pi pi-wallet', labelKey: 'menu.expenses', showInMobile: false },
    { path: '/contracts', iconClass: 'pi pi-file-pdf', labelKey: 'menu.contracts', showInMobile: false },
    { path: '/inspections', iconClass: 'pi pi-check-square', labelKey: 'menu.inspections', showInMobile: false },
    { path: '/reports', iconClass: 'pi pi-chart-line', labelKey: 'menu.reports', showInMobile: false },
    { path: '/settings', iconClass: 'pi pi-cog', labelKey: 'menu.settings', showInMobile: false }
  ];

  mobileMenuItems = this.menuItems.filter(item => item.showInMobile);

  get remainingMenuItems() {
    return this.menuItems.filter(item => !item.showInMobile);
  }

  moreMenuOpen = signal(false);

  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }

  closeSidebar() {
    this.sidebarOpen.set(false);
  }

  toggleMoreMenu() {
    this.moreMenuOpen.update(v => !v);
  }

  toggleDarkMode() {
    this.themeService.toggleTheme();
  }

  async logout() {
    await this.authService.logout();
  }
}
