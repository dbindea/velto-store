import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { CHART_CATEGORICAL } from './chart-palette';

export interface BarRow {
  label: string;
  value: number;
  /** La segunda línea: «18 días alquilado». */
  detail?: string;
}

/**
 * Barras horizontales para comparar magnitudes con nombre.
 *
 * ⚠️ **Horizontales a propósito.** Los nombres son matrículas y modelos —textos
 * largos—, y en vertical habría que girarlos o recortarlos. En horizontal el
 * nombre se lee de corrido y la barra crece hacia donde se lee.
 *
 * ⚠️ **Un solo color para todas.** Colorear más oscuro lo más grande es pintar
 * dos veces el mismo dato: la longitud ya lo dice. Y el color pasaría a
 * significar magnitud en un gráfico donde identifica categorías.
 */
@Component({
  selector: 'app-bar-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure class="chart">
      <figcaption class="head">
        <span class="title">{{ title }}</span>
      </figcaption>

      @if (!rows.length) {
        <p class="chart-empty">{{ emptyLabel }}</p>
      } @else {
        <ul class="bars">
          @for (r of rows; track r.label) {
            <li class="bar-row">
              <span class="bar-label">
                {{ r.label }}
                @if (r.detail) { <span class="bar-detail">{{ r.detail }}</span> }
              </span>
              <span class="bar-track">
                <!-- Extremo redondeado de 4 px, anclado en el origen: la barra
                     empieza donde empieza la escala, siempre. -->
                <span class="bar-fill" [style.width.%]="pct(r.value)"
                  [style.background]="color"></span>
              </span>
              <span class="bar-value">{{ r.value | number: '1.0-0' }} €</span>
            </li>
          }
        </ul>
      }
    </figure>
  `,
  styleUrl: './charts.scss'
})
export class BarChartComponent {
  @Input() title = '';
  @Input() rows: BarRow[] = [];
  @Input() emptyLabel = '';

  /** El teal de marca. Una sola serie no necesita más de un tono. */
  readonly color = CHART_CATEGORICAL[0];

  pct(value: number): number {
    const max = Math.max(1, ...this.rows.map((r) => Number(r.value) || 0));
    return Math.max(1.5, ((Number(value) || 0) / max) * 100);
  }
}
