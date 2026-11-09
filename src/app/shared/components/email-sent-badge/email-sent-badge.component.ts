import { Component, Input, inject } from '@angular/core';
import { formatDate } from '@angular/common';
import { TranslateService } from '@core/i18n/translate.service';
import { interpolate } from '@shared/utils/i18n-params.util';
import type { EmailSent } from '@shared/utils/email-sent.util';

/**
 * El sobre que dice que este correo ya salió.
 *
 * Lo pidió Dorel el 9 de noviembre de 2026 **para no duplicar envíos**: hasta
 * ahora, desde la ficha de la reserva se podía mandar el contrato firmado dos
 * veces sin que nada en la pantalla dijera que ya se había mandado una.
 *
 * ⚠️ **No decide nada**, igual que `app-form-error`: quién contesta si el correo
 * salió es `emailSentOf()`, y cada pantalla le pasa los campos que de verdad ha
 * cargado. Si este componente fuera a buscar el dato por su cuenta habría dos
 * fuentes de verdad sobre el mismo envío.
 *
 * ⚠️ **Sin fecha también se pinta.** Es la regla de `emailSentOf()`: lo que
 * decide el sobre es que conste el envío, no que su fecha se pueda leer.
 * Entonces el rótulo dice «Enviado por correo» a secas, que es lo único cierto.
 */
@Component({
  selector: 'app-email-sent-badge',
  standalone: true,
  template: `
    @if (sent?.sent) {
      <i
        class="pi pi-envelope email-sent-mark"
        role="img"
        [title]="label()"
        [attr.aria-label]="label()"
      ></i>
    }
  `,
  styles: [
    `
      /*
       * ⚠️ El elemento del componente es el que entra en la fila, no el icono
       * de dentro. Un componente es "display: inline" por defecto, así que sin
       * esto el sobre se desalinea de la chapa de estado que tiene al lado — la
       * misma lección que charts.scss con el donut.
       */
      :host {
        display: inline-flex;
        align-items: center;
      }

      .email-sent-mark {
        color: var(--success-color, var(--text-muted));
        font-size: 0.875rem;
        /* Pulsarlo no hace nada, pero el rótulo sale al pasar por encima. */
        cursor: help;
      }
    `
  ]
})
export class EmailSentBadgeComponent {
  private i18n = inject(TranslateService);

  /** Lo que contestó `emailSentOf()`. Sin envío, no se pinta nada. */
  @Input() sent: EmailSent | null = null;

  /**
   * ⚠️ **Traducir primero y sustituir después**, que es la regla de
   * `interpolate()`: el hueco `{date}` no está en el mismo sitio de la frase en
   * español que en inglés o en rumano.
   */
  label(): string {
    const at = this.sent?.at;
    if (!at) return this.i18n.translate('common.emailSent');
    return interpolate(this.i18n.translate('common.emailSentOn'), {
      /*
       * Formato numérico a propósito: así el idioma del dato no depende de qué
       * locales tenga registrados el bundle, que es otra cosa que se olvida.
       */
      date: formatDate(at, 'dd/MM/yyyy HH:mm', 'en-US')
    });
  }
}
