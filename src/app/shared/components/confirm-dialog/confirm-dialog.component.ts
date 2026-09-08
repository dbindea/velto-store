import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService } from '@core/notifications/confirm.service';
import { TranslateService } from '@core/i18n/translate.service';

/**
 * El diálogo de sí o no, con la cara de la aplicación.
 *
 * Va en el componente raíz por el mismo motivo que la pila de avisos: las
 * pantallas públicas —firma, pago— también preguntan cosas, y dos diálogos
 * distintos según por dónde se entre es exactamente cómo se pierde el aspecto
 * unificado.
 *
 * ⚠️ **Es bloqueante de verdad.** El fondo no deja pasar el clic, `Escape`
 * cancela y el foco entra en el botón que confirma: un `confirm()` del
 * navegador hacía las tres cosas, y al sustituirlo hay que hacerlas también o
 * el cambio es un retroceso con mejor tipografía.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (confirm.pending(); as request) {
      <div
        class="confirm-overlay"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="text(request.title)"
        (click)="confirm.answer(false)"
      >
        <div class="confirm-box" (click)="$event.stopPropagation()">
          <h3 class="confirm-title">{{ text(request.title) }}</h3>
          <p class="confirm-message">{{ text(request.message, request.params) }}</p>
          <div class="confirm-actions">
            <button type="button" class="confirm-cancel" (click)="confirm.answer(false)">
              {{ text(request.cancelLabel || 'common.cancel') }}
            </button>
            <!-- Enfocado al abrir: quien confirma con el teclado no tiene que
                 buscar el botón, y quien no quiere ya tiene Escape. -->
            <button
              type="button"
              class="confirm-ok"
              [class.danger]="request.danger"
              autofocus
              (click)="confirm.answer(true)"
            >
              {{ text(request.confirmLabel || 'common.accept') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .confirm-overlay {
        position: fixed;
        inset: 0;
        /* Por encima de los avisos (900) y de los modales de pantalla: es lo
           único que hay que responder antes de seguir. */
        z-index: 1100;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        background: rgba(0, 0, 0, 0.55);
      }

      .confirm-box {
        width: 100%;
        max-width: 420px;
        padding: 1.25rem;
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        box-shadow: 0 12px 32px rgb(0 0 0 / 45%);
      }

      .confirm-title {
        margin: 0 0 0.5rem;
        font-size: 1rem;
        color: var(--text-primary);
      }

      .confirm-message {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.5;
        color: var(--text-secondary);
      }

      .confirm-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        margin-top: 1.25rem;
      }

      button {
        padding: 0.625rem 1rem;
        border-radius: 8px;
        border: none;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
      }

      .confirm-cancel {
        background: var(--bg-input);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
      }

      .confirm-ok {
        background: var(--accent-color);
        color: #fff;

        /* Lo irreversible se pinta como lo que es. Borrar una foto y cancelar
           un cobro no pueden tener el mismo botón que «sí, sigue». */
        &.danger {
          background: var(--error-color);
        }
      }

      /* En un móvil los dos botones a lo ancho: son el objetivo de un pulgar. */
      @media (max-width: 480px) {
        .confirm-actions {
          flex-direction: column-reverse;
        }

        button {
          width: 100%;
          padding: 0.75rem 1rem;
        }
      }
    `
  ],
  host: {
    '(document:keydown.escape)': 'onEscape()'
  }
})
export class ConfirmDialogComponent {
  confirm = inject(ConfirmService);
  private translate = inject(TranslateService);

  /** Misma sustitución que la pila de avisos: `{nombre}`, no otra convención. */
  text(key: string, params?: Record<string, string>): string {
    const raw = this.translate.translate(key);
    if (!params) return raw;
    return Object.entries(params).reduce(
      (out, [name, value]) => out.split(`{${name}}`).join(value),
      raw
    );
  }

  /** Escape cancela, como en el diálogo del navegador que sustituye. */
  onEscape(): void {
    if (this.confirm.pending()) this.confirm.answer(false);
  }
}
