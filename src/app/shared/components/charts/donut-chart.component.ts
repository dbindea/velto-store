import { CommonModule } from '@angular/common';
import { Component, Input, signal } from '@angular/core';
import { CHART_CATEGORICAL } from './chart-palette';

export interface DonutSlice {
  label: string;
  value: number;
  /** Lo que se pinta bajo el valor: «12 cobros». */
  detail?: string;
}

/**
 * El reparto de un total entre unas pocas categorías.
 *
 * ⚠️ **Con menos de tres porciones no se dibuja el donut**, se listan. Un anillo
 * partido en dos no dice nada que no diga «60 % y 40 %» escrito, y ocupa diez
 * veces más. Y por arriba se corta en cinco: más clases de color dejan de
 * distinguirse y el resto se agrupa en «Otros».
 *
 * ⚠️ **Cada porción lleva su nombre y su cifra al lado.** El color identifica,
 * no informa: quien no distinga dos tonos tiene que poder leer el dato igual.
 */
@Component({
  selector: 'app-donut-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure class="chart">
      <figcaption class="head">
        <span class="title">{{ title }}</span>
      </figcaption>

      @if (slices.length >= 3) {
        <div class="donut-layout">
          <svg viewBox="0 0 160 160" class="donut" role="img" [attr.aria-label]="title">
            @for (a of arcs(); track a.label) {
              <path
                [attr.d]="a.path"
                fill="none"
                [attr.stroke]="a.color"
                stroke-width="26"
                [attr.opacity]="hover() === null || hover() === a.label ? 1 : 0.45"
                (mouseenter)="hover.set(a.label)"
                (mouseleave)="hover.set(null)"
              />
            }
            <!-- El total en el hueco: es la cifra que da sentido a las partes. -->
            <text x="80" y="76" text-anchor="middle" fill="var(--text-primary)"
              font-size="19" font-weight="700">{{ total() | number: '1.0-0' }} €</text>
            <text x="80" y="93" text-anchor="middle" fill="var(--text-muted)"
              font-size="9">{{ totalLabel }}</text>
          </svg>

          <ul class="donut-legend">
            @for (a of arcs(); track a.label) {
              <li [class.dim]="hover() !== null && hover() !== a.label"
                (mouseenter)="hover.set(a.label)" (mouseleave)="hover.set(null)">
                <span class="swatch" [style.background]="a.color"></span>
                <span class="name">{{ a.label }}</span>
                <span class="val">{{ a.value | number: '1.0-0' }} €</span>
                <span class="pct">{{ a.pct | percent: '1.0-0' }}</span>
              </li>
            }
          </ul>
        </div>
      } @else if (slices.length) {
        <!-- Dos o menos: se leen mejor escritas. -->
        <ul class="donut-legend plain">
          @for (a of arcs(); track a.label) {
            <li>
              <span class="swatch" [style.background]="a.color"></span>
              <span class="name">{{ a.label }}</span>
              <span class="val">{{ a.value | number: '1.0-0' }} €</span>
              <span class="pct">{{ a.pct | percent: '1.0-0' }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="chart-empty">{{ emptyLabel }}</p>
      }
    </figure>
  `,
  styleUrl: './charts.scss'
})
export class DonutChartComponent {
  @Input() title = '';
  @Input() slices: DonutSlice[] = [];
  @Input() totalLabel = '';
  @Input() emptyLabel = '';

  readonly hover = signal<string | null>(null);

  total(): number {
    return this.slices.reduce((t, s) => t + (Number(s.value) || 0), 0);
  }

  arcs(): { label: string; value: number; pct: number; color: string; path: string }[] {
    const total = this.total();
    if (!total) return [];
    let angulo = -Math.PI / 2;
    return this.slices.map((s, i) => {
      const fraccion = (Number(s.value) || 0) / total;
      const barrido = fraccion * Math.PI * 2;
      /**
       * ⚠️ **Un hueco de 2 px entre porciones, no una línea de borde.** El borde
       * añade una tinta que no es dato; el hueco deja ver la superficie y separa
       * igual de bien.
       */
      const hueco = this.slices.length > 1 ? 0.035 : 0;
      const desde = angulo + hueco / 2;
      const hasta = angulo + barrido - hueco / 2;
      angulo += barrido;
      return {
        label: s.label,
        value: Number(s.value) || 0,
        pct: fraccion,
        color: CHART_CATEGORICAL[i % CHART_CATEGORICAL.length],
        path: this.arc(desde, Math.max(desde + 0.001, hasta))
      };
    });
  }

  private arc(desde: number, hasta: number): string {
    const r = 60;
    const cx = 80;
    const cy = 80;
    const x1 = cx + r * Math.cos(desde);
    const y1 = cy + r * Math.sin(desde);
    const x2 = cx + r * Math.cos(hasta);
    const y2 = cy + r * Math.sin(hasta);
    const grande = hasta - desde > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${grande} 1 ${x2} ${y2}`;
  }
}
