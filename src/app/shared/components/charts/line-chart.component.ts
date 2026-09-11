import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  inject,
  signal
} from '@angular/core';
import { CHART_INK, CHART_REFERENCE, CHART_CATEGORICAL } from './chart-palette';

export interface LineSeries {
  label: string;
  /** Un valor por punto. Todas las series tienen que traer la misma longitud. */
  values: number[];
  /** `true` en la serie de referencia: se pinta gris y más fina. */
  reference?: boolean;
}

/**
 * Una línea por serie sobre un eje común.
 *
 * ⚠️ **Un solo eje, siempre.** Dos escalas en un mismo dibujo es el error de
 * gráfico más repetido que hay: la relación entre las dos líneas la decide dónde
 * se pusieron los ceros, así que se puede hacer que dos cosas parezcan
 * correlacionadas moviendo un eje. Si dos medidas no comparten escala, son dos
 * gráficos.
 *
 * ⚠️ **Y hay tabla.** Un valor que solo se puede leer pasando el ratón por
 * encima no existe para quien navega con teclado, imprime la pantalla o la mira
 * en un móvil. El botón la enseña con los mismos números.
 */
@Component({
  selector: 'app-line-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure class="chart">
      <figcaption class="head">
        <span class="title">{{ title }}</span>
        <!-- Leyenda siempre con dos o más series: la identidad no puede
             depender solo del color. -->
        @if (series.length > 1) {
          <span class="legend">
            @for (s of series; track s.label) {
              <span class="item">
                <span class="swatch" [style.background]="colorOf($index, s)"></span>
                {{ s.label }}
              </span>
            }
          </span>
        }
        @if (tableLabel) {
          <button type="button" class="table-toggle" (click)="showTable.set(!showTable())">
            {{ showTable() ? tableHideLabel : tableLabel }}
          </button>
        }
      </figcaption>

      @if (!showTable()) {
        <svg
          [attr.viewBox]="'0 0 ' + W() + ' ' + H"
          class="plot"
          role="img"
          [attr.aria-label]="title"
          (mousemove)="onMove($event)"
          (mouseleave)="hover.set(null)"
        >
          <!-- Rejilla continua y recesiva: una línea de puntos añade ruido y se
               lee como si el dato fuera estimado. -->
          @for (g of gridLines(); track g.y) {
            <line [attr.x1]="PAD_L" [attr.x2]="W() - PAD_R" [attr.y1]="g.y" [attr.y2]="g.y"
              [attr.stroke]="ink.grid" stroke-width="1" />
            <text [attr.x]="PAD_L - 8" [attr.y]="g.y + 4" text-anchor="end"
              [attr.fill]="ink.axis" font-size="10">{{ g.label }}</text>
          }

          @for (label of xLabels(); track label.x) {
            <text [attr.x]="label.x" [attr.y]="H - 8" text-anchor="middle"
              [attr.fill]="ink.axis" font-size="10">{{ label.text }}</text>
          }

          @for (s of series; track s.label) {
            <polyline
              [attr.points]="pointsOf(s)"
              fill="none"
              [attr.stroke]="colorOf($index, s)"
              [attr.stroke-width]="s.reference ? 2 : 2.5"
              [attr.stroke-dasharray]="null"
              stroke-linejoin="round"
              stroke-linecap="round"
              [attr.opacity]="s.reference ? 0.75 : 1"
            />
          }

          <!-- Cruz y burbuja al pasar por encima. El punto se dibuja con un aro
               del color de la superficie en vez de un borde: un borde alrededor
               de la marca ensucia el dibujo. -->
          @if (hover() !== null) {
            <line [attr.x1]="xAt(hover()!)" [attr.x2]="xAt(hover()!)" [attr.y1]="PAD_T"
              [attr.y2]="H - PAD_B" [attr.stroke]="ink.grid" stroke-width="1" />
            @for (s of series; track s.label) {
              <circle [attr.cx]="xAt(hover()!)" [attr.cy]="yAt(s.values[hover()!])" r="5"
                [attr.fill]="colorOf($index, s)" stroke="var(--bg-card)" stroke-width="2" />
            }
          }
        </svg>

        @if (hover() !== null) {
          <div class="tooltip">
            <span class="when">{{ labels[hover()!] }}</span>
            @for (s of series; track s.label) {
              <span class="row">
                <span class="swatch" [style.background]="colorOf($index, s)"></span>
                <span class="name">{{ s.label }}</span>
                <span class="val">{{ s.values[hover()!] | number: '1.0-0' }} €</span>
              </span>
            }
          </div>
        }
      } @else {
        <table class="data-table">
          <thead>
            <tr>
              <th></th>
              @for (s of series; track s.label) { <th class="num">{{ s.label }}</th> }
            </tr>
          </thead>
          <tbody>
            @for (l of labels; track l; let i = $index) {
              <tr>
                <td>{{ l }}</td>
                @for (s of series; track s.label) {
                  <td class="num">{{ s.values[i] | number: '1.0-0' }} €</td>
                }
              </tr>
            }
          </tbody>
        </table>
      }
    </figure>
  `,
  styleUrl: './charts.scss'
})
export class LineChartComponent implements AfterViewInit {
  private host = inject(ElementRef<HTMLElement>);
  private destroyRef = inject(DestroyRef);

  @Input() title = '';
  @Input() labels: string[] = [];
  @Input() series: LineSeries[] = [];
  /**
   * ⚠️ **Sin texto por defecto, y el botón no sale si no se lo dan.** Un
   * literal en español dentro de un componente compartido atraviesa el pipe sin
   * cambios y se cuela en la pantalla inglesa y en la rumana — es la misma regla
   * que los mapas `*_LABELS`, que llevan claves y nunca texto.
   */
  @Input() tableLabel = '';
  @Input() tableHideLabel = '';

  readonly ink = CHART_INK;
  readonly showTable = signal(false);
  readonly hover = signal<number | null>(null);

  /**
   * ⚠️ **El `viewBox` sigue al ancho real, no es fijo.**
   *
   * Con 720 unidades metidas en los 358 px de un móvil, todo se reduce a la
   * mitad — **el texto también**: las etiquetas de los meses y las del eje salían
   * a 5 px, ilegibles, y el gráfico aplastado a la mitad de alto. Igualando las
   * unidades a los píxeles, un `font-size="10"` mide 10 px en los dos sitios.
   *
   * Es lo mismo que la regla de recolocar en vez de esconder: en un móvil el
   * gráfico tiene menos sitio, así que enseña menos meses (`xLabels`), no los
   * mismos más pequeños.
   */
  readonly W = signal(720);
  readonly H = 240;

  ngAfterViewInit(): void {
    const caja = this.host.nativeElement as HTMLElement;
    const medir = () => {
      const ancho = caja.querySelector('.plot')?.clientWidth || caja.clientWidth;
      if (ancho > 0) this.W.set(Math.round(Math.min(720, Math.max(280, ancho))));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    this.destroyRef.onDestroy(() => observador.disconnect());
  }
  readonly PAD_L = 48;
  readonly PAD_R = 12;
  readonly PAD_T = 12;
  /** Deja sitio al eje: un alto que se lo come recorta las etiquetas. */
  readonly PAD_B = 26;

  colorOf(index: number, s: LineSeries): string {
    return s.reference ? CHART_REFERENCE : CHART_CATEGORICAL[index % CHART_CATEGORICAL.length];
  }

  /** El techo del eje, redondeado hacia arriba para que la rejilla salga limpia. */
  private max(): number {
    const m = Math.max(1, ...this.series.flatMap((s) => s.values));
    const magnitud = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / magnitud) * magnitud;
  }

  xAt(i: number): number {
    const n = Math.max(1, this.labels.length - 1);
    return this.PAD_L + ((this.W() - this.PAD_L - this.PAD_R) * i) / n;
  }

  yAt(v: number): number {
    const alto = this.H - this.PAD_T - this.PAD_B;
    return this.PAD_T + alto - (alto * (Number(v) || 0)) / this.max();
  }

  pointsOf(s: LineSeries): string {
    return s.values.map((v, i) => `${this.xAt(i)},${this.yAt(v)}`).join(' ');
  }

  gridLines(): { y: number; label: string }[] {
    const max = this.max();
    return [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: this.yAt(max * f),
      label: `${Math.round(max * f)}`
    }));
  }

  /**
   * ⚠️ **No se etiquetan los doce meses, y cuántos se etiquetan depende del
   * ancho.** Apretados se solapan y el eje se vuelve una mancha; uno de cada dos
   * —o de cada tres en un móvil— se lee y sigue situando la línea igual.
   */
  xLabels(): { x: number; text: string }[] {
    /** Lo que ocupa «sept» a 10 px, con aire a los lados. */
    const MINIMO = 34;
    const porEtiqueta = (this.W() - this.PAD_L - this.PAD_R) / Math.max(1, this.labels.length);
    const cada = Math.max(1, Math.ceil(MINIMO / Math.max(1, porEtiqueta)));
    return this.labels
      .map((text, i) => ({ x: this.xAt(i), text, i }))
      .filter((l) => l.i % cada === 0);
  }

  /**
   * ⚠️ **La zona sensible es toda la columna, no el punto.** Obligar a acertar
   * en un círculo de cinco píxeles hace la información inalcanzable con un ratón
   * normal, y del todo en una pantalla táctil.
   */
  onMove(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const caja = svg.getBoundingClientRect();
    const x = ((event.clientX - caja.left) / caja.width) * this.W();
    const n = Math.max(1, this.labels.length - 1);
    const paso = (this.W() - this.PAD_L - this.PAD_R) / n;
    const i = Math.round((x - this.PAD_L) / paso);
    this.hover.set(i >= 0 && i < this.labels.length ? i : null);
  }
}
