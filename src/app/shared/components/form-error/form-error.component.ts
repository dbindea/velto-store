import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

/**
 * Lo que falta para poder guardar.
 *
 * Sirve para las dos posiciones de la pantalla, que es por lo que es un solo
 * componente y no dos:
 *
 * - **Bajo un campo**, con un problema, explicando ese campo.
 * - **Junto al botón** (`summary`), con todos, porque en un formulario de 29
 *   campos el que está mal puede quedar a tres pantallas de scroll y lo único
 *   que se ve es que pulsar no hace nada.
 *
 * ⚠️ **No decide nada.** Solo pinta lo que le dan: qué falta lo dice el `validate*`
 * del módulo —`validateExpense`, `validateSettings`…—, que es también quien lo
 * comprueba antes de escribir. Si esta pieza decidiera por su cuenta habría dos
 * fuentes de verdad sobre lo mismo, y la del servicio es la que manda.
 */
@Component({
  selector: 'app-form-error',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    @if (visible.length) {
      @if (summary) {
        <div class="form-blockers" role="alert">
          <span class="form-blockers-title">{{ 'common.missingFields' | translate }}</span>
          @for (key of visible; track key) {
            <span class="field-error">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              {{ key | translate }}
            </span>
          }
        </div>
      } @else {
        @for (key of visible; track key) {
          <span class="field-error">
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
            {{ key | translate }}
          </span>
        }
      }
    }
  `,
  styles: []
})
export class FormErrorComponent {
  /** Una clave, varias, o nada. */
  @Input() problems: string | string[] | null | undefined = null;

  /**
   * Si se enseña ya.
   *
   * Los formularios lo ponen a `true` al primer intento de guardar: marcar en
   * rojo un campo que el operador todavía no ha tenido ocasión de rellenar es
   * regañarle por no haber terminado.
   */
  @Input() show = true;

  /** Modo resumen, con marco y título, para ponerlo junto al botón. */
  @Input() summary = false;

  get visible(): string[] {
    if (!this.show || !this.problems) return [];
    return Array.isArray(this.problems) ? this.problems : [this.problems];
  }
}
