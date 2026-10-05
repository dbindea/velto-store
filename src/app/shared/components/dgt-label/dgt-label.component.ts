import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ENVIRONMENTAL_LABEL_TEXT,
  type EnvironmentalLabel
} from '@shared/models/vehicle.model';

/**
 * El distintivo ambiental de la DGT.
 *
 * ⚠️ **Se dibuja, no se descarga.** Un SVG de cuatro formas pesa menos que
 * cualquier imagen, escala sin pixelarse y **no depende de Storage**: estos
 * distintivos salen en listas de coches, y una imagen por fila sería una
 * petición por fila para pintar una pegatina.
 *
 * ⚠️ **Es una representación, no la pegatina oficial.** Lleva el color y la
 * letra que identifican cada categoría, que es lo que hay que reconocer de un
 * vistazo; no reproduce el escudo de la DGT ni el texto registral. Para el
 * cliente la pregunta es «¿entra en Madrid?», y eso lo contesta el color.
 *
 * ⚠️ **El color NO puede ser lo único que lo distinga.** Un daltónico no separa
 * la B ámbar de la C verde, así que la letra va dentro del círculo y quien lo
 * usa pone el nombre al lado — no en un `title`, que no existe para quien va
 * con el dedo.
 */
@Component({
  selector: 'app-dgt-label',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 48 48"
      role="img"
      [attr.aria-label]="aria || texto"
    >
      @if (label === 'ECO') {
        <!-- La ECO es la única de dos colores: media azul y media verde. -->
        <defs>
          <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="1" y2="0">
            <stop offset="50%" stop-color="#0B63B5" />
            <stop offset="50%" stop-color="#1E9E4A" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="23" [attr.fill]="'url(#' + gradId + ')'" />
      } @else {
        <circle cx="24" cy="24" r="23" [attr.fill]="color" />
      }
      <text
        x="24"
        [attr.y]="label === 'ECO' ? 29 : 32"
        text-anchor="middle"
        fill="#ffffff"
        font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        font-weight="700"
        [attr.font-size]="label === 'ECO' ? 14 : 24"
      >{{ texto }}</text>
    </svg>
  `,
  styles: [`:host { display: inline-flex; vertical-align: middle; }`]
})
export class DgtLabelComponent {
  @Input({ required: true }) label!: EnvironmentalLabel;
  /** Lado del círculo en píxeles. */
  @Input() size = 28;
  /** Lo que lee un lector de pantalla. Quien llama lo traduce. */
  @Input() aria = '';

  /**
   * ⚠️ **El `id` del degradado tiene que ser único en la página.** Con uno fijo,
   * dos distintivos ECO en la misma lista comparten la definición: hoy se ven
   * igual, y el día que alguien cambie un color solo cambiaría la mitad.
   */
  private static contador = 0;
  protected readonly gradId = `dgt-eco-${++DgtLabelComponent.contador}`;

  protected get texto(): string {
    return ENVIRONMENTAL_LABEL_TEXT[this.label] ?? '';
  }

  protected get color(): string {
    switch (this.label) {
      case 'B':
        return '#E8A317';
      case 'ZERO':
        return '#0B63B5';
      default:
        return '#1E9E4A';
    }
  }
}
