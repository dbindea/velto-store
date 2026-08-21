import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BRAND_CONFIG } from '@core/config/brand.config';
import { ThemeService } from '@core/theme/theme.service';

/**
 * Renders the Velto brand artwork with the right ink for the active theme.
 *
 * Why a component instead of an `<img src="...">` per screen: the artwork is
 * loaded as an `<img>`, and CSS cannot reach inside an external SVG, so the
 * ink colour cannot be themed with a CSS variable. The file itself has to be
 * swapped. Centralising that here keeps the sidebar, the login card and the
 * public signing page from each reimplementing the choice — which is how the
 * previous version ended up rendering the white-ink isologo on a white card.
 *
 * The favicon deliberately does NOT go through here: browser chrome follows
 * the OS colour scheme, so that file adapts internally instead.
 */
@Component({
  selector: 'app-brand-logo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <img
      class="brand-logo"
      [class.isologo]="variant === 'isologo'"
      [src]="src"
      [alt]="alt"
      (error)="onError($event)"
    />
  `,
  styles: [
    `
      .brand-logo {
        display: block;
        height: 100%;
        width: auto;
        max-width: 100%;
        object-fit: contain;
      }
    `
  ]
})
export class BrandLogoComponent {
  /** `wordmark` = isologo + VELTO lockup. `isologo` = the V on its own. */
  @Input() variant: 'wordmark' | 'isologo' = 'wordmark';

  /**
   * Which surface the logo sits on.
   *
   * `auto` follows the active theme and suits anything on `--bg-card` or
   * `--bg-main`. Pass an explicit value for surfaces that do NOT follow the
   * theme — the sidebar is the case in point: `--sidebar-bg` is dark slate
   * in BOTH themes, so it always needs `dark`.
   */
  @Input() on: 'auto' | 'light' | 'dark' = 'auto';

  // Explicitly typed: BRAND_CONFIG is `as const`, so the initialiser alone
  // would narrow this input to the literal type 'Velto'.
  @Input() alt: string = BRAND_CONFIG.name;

  private readonly theme = inject(ThemeService);

  get src(): string {
    const pair = this.variant === 'isologo' ? BRAND_CONFIG.isologo : BRAND_CONFIG.logo;
    return this.isOnDark ? pair.onDark : pair.onLight;
  }

  private get isOnDark(): boolean {
    if (this.on === 'dark') return true;
    if (this.on === 'light') return false;
    return this.theme.isDark();
  }

  /**
   * If the artwork cannot be loaded, fall back to the isologo for the active
   * theme rather than showing a broken image. Guarded so a missing fallback
   * cannot loop.
   */
  onError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (!img || img.dataset['fallback'] === '1') {
      return;
    }
    img.dataset['fallback'] = '1';
    img.src = this.isOnDark ? BRAND_CONFIG.isologo.onDark : BRAND_CONFIG.isologo.onLight;
  }
}
