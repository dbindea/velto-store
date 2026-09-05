import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, Notice } from '@core/notifications/notification.service';
import { TranslateService } from '@core/i18n/translate.service';

/**
 * La pila de avisos, abajo a la derecha.
 *
 * Va en el componente raíz, no en el layout privado: las pantallas públicas
 * —firma, pago, verificación— también son sitio donde algo puede fallar, y
 * duplicar la pila en dos sitios acabaría con dos comportamientos distintos.
 *
 * ⚠️ **`aria-live` importa aquí más que en casi ningún otro sitio.** Un aviso
 * que aparece en una esquina sin anunciarse no existe para quien usa lector de
 * pantalla, y este es el único canal por el que la aplicación cuenta que algo
 * ha fallado. Los errores van como `assertive`; el resto, `polite`.
 */
@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="notices" role="region" aria-label="Avisos">
      @for (notice of notifications.notices(); track notice.id) {
        <div
          class="notice"
          [class.error]="notice.kind === 'error'"
          [class.success]="notice.kind === 'success'"
          [class.info]="notice.kind === 'info'"
          [attr.role]="notice.kind === 'error' ? 'alert' : 'status'"
          [attr.aria-live]="notice.kind === 'error' ? 'assertive' : 'polite'"
        >
          <i class="pi" [ngClass]="iconOf(notice)" aria-hidden="true"></i>
          <span class="notice-text">{{ textOf(notice) }}</span>
          @if (notice.retry) {
            <button type="button" class="notice-retry" (click)="retry(notice)">
              {{ label('common.retry') }}
            </button>
          }
          <button
            type="button"
            class="notice-close"
            [attr.aria-label]="label('common.close')"
            (click)="notifications.dismiss(notice.id)"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .notices {
      position: fixed;
      /* Sobre el contenido, por debajo de un modal abierto. */
      z-index: 900;
      right: 1rem;
      bottom: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      /* No captura clics donde no hay aviso: es una capa que flota encima. */
      pointer-events: none;
      max-width: min(28rem, calc(100vw - 2rem));
    }

    .notice {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      padding: 0.75rem 0.85rem;
      border-radius: 0.5rem;
      border: 1px solid var(--border-color);
      background: var(--bg-card);
      color: var(--text-primary);
      box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
      font-size: 0.875rem;
      animation: notice-in 160ms ease-out;
    }

    .notice.error {
      border-color: var(--error-color);
      background: var(--error-bg);
      color: var(--error-color);
    }

    .notice.success {
      border-color: var(--success-color);
      background: var(--success-bg);
      color: var(--success-color);
    }

    .notice.info {
      border-color: var(--info-color);
      background: var(--info-bg);
      color: var(--info-color);
    }

    .notice > .pi {
      margin-top: 0.15rem;
      font-size: 0.9rem;
      flex-shrink: 0;
    }

    /* Sin esto, un mensaje largo estira la tarjeta en vez de partirse. */
    .notice-text {
      flex: 1;
      min-width: 0;
      overflow-wrap: break-word;
    }

    .notice-retry {
      flex-shrink: 0;
      background: none;
      border: 1px solid currentColor;
      border-radius: 0.35rem;
      color: inherit;
      cursor: pointer;
      font-size: 0.8rem;
      padding: 0.2rem 0.5rem;
    }

    .notice-close {
      flex-shrink: 0;
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      opacity: 0.7;
      padding: 0 0.15rem;
      font-size: 0.8rem;
    }

    .notice-close:hover {
      opacity: 1;
    }

    @keyframes notice-in {
      from { opacity: 0; transform: translateY(0.5rem); }
      to   { opacity: 1; transform: none; }
    }

    /* En móvil ocupa el ancho: una tarjeta estrecha en la esquina se lee peor
       que una banda, y aquí lo que importa es que se lea. */
    @media (max-width: 640px) {
      .notices {
        left: 0.75rem;
        right: 0.75rem;
        bottom: 0.75rem;
        max-width: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .notice { animation: none; }
    }
  `]
})
export class NotificationsComponent {
  readonly notifications = inject(NotificationService);
  private readonly translateService = inject(TranslateService);

  /**
   * El texto ya resuelto, con sus sustituciones.
   *
   * Se traduce aquí y no con el pipe porque la clave llega en un dato, no
   * escrita en la plantilla; y los parámetros —un importe, un nombre de
   * fichero— se sustituyen sobre el texto traducido, que es donde el traductor
   * decidió dónde van.
   */
  textOf(notice: Notice): string {
    const raw = this.translateService.translate(notice.key);
    if (!notice.params) return raw;
    return Object.entries(notice.params).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(value),
      raw
    );
  }

  label(key: string): string {
    return this.translateService.translate(key);
  }

  iconOf(notice: Notice): string {
    if (notice.kind === 'error') return 'pi-exclamation-triangle';
    if (notice.kind === 'success') return 'pi-check-circle';
    return 'pi-info-circle';
  }

  retry(notice: Notice): void {
    // Se cierra antes de reintentar: si la acción vuelve a fallar, el servicio
    // levanta un aviso nuevo y el operador ve que ha pasado algo. Dejándolo
    // abierto, un segundo fallo idéntico no cambiaría nada en pantalla y
    // parecería que el botón no hace nada.
    this.notifications.dismiss(notice.id);
    notice.retry?.();
  }
}
