import {
  AfterViewInit,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@core/i18n/translate.service';
import {
  DayCell,
  HOURS,
  PickerMode,
  addMonths,
  formatValue,
  minuteSteps,
  monthGrid,
  outOfRange,
  parseValue
} from '@shared/utils/date-picker.util';

/**
 * El calendario y el reloj de la aplicación.
 *
 * ⚠️ **Existe porque el panel del navegador NO se puede estilar.** Un
 * `input[type=date]` se deja vestir por fuera —el recuadro, la tipografía, el
 * icono— pero lo que se abre al pulsarlo lo dibuja el navegador y **no hay
 * ningún selector de CSS que lo alcance**: no es parte de la página. Lo único
 * que se le puede decir es si el fondo es claro u oscuro, con `color-scheme`.
 * Así que la única forma de que tenga la cara de Velto es poner uno nuestro
 * delante. Lo pidió Dorel el 22 de septiembre de 2026, viéndolo en escritorio.
 *
 * ⚠️ **En el móvil NO se usa**, y esa es la decisión importante. El selector
 * nativo de iOS y Android es una hoja a pantalla completa con su rueda: más
 * grande, más familiar y mejor hecha que cualquier cosa que dibujemos aquí, y
 * esta es una aplicación que se usa en la calle. Quien decide es
 * `prefersNativePicker()` en la directiva.
 *
 * ⚠️ **Y el campo sigue siendo un `input[type=date]` de verdad.** Esto solo
 * escribe en él y dispara sus eventos: el formulario, la validación, el
 * `min`/`max` y el teclado siguen siendo los del navegador. Si este panel
 * fallara, se sigue pudiendo teclear la fecha.
 */
@Component({
  selector: 'app-date-picker-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './date-picker-panel.component.html',
  styleUrl: './date-picker-panel.component.scss'
})
export class DatePickerPanelComponent implements OnInit, AfterViewInit {
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private translate = inject(TranslateService);

  readonly mode = input<PickerMode>('date');
  /** El valor crudo del campo, tal y como lo guarda el navegador. */
  readonly value = input<string>('');
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  /** Dónde está el campo, para colocarse debajo. */
  readonly anchor = input<DOMRect | null>(null);

  readonly valuePicked = output<string>();
  readonly closed = output<void>();

  readonly hours = HOURS;
  readonly minutes = minuteSteps();

  /** Lo elegido ahora mismo; nace de lo que hubiera en el campo. */
  private readonly picked = signal<Date | null>(null);
  /** Qué mes se está mirando, que no es lo mismo que qué día está elegido. */
  private readonly visibleMonth = signal<Date>(new Date());

  readonly showsCalendar = computed(() => this.mode() !== 'time');
  readonly showsTime = computed(() => this.mode() !== 'date');

  private readonly minDate = computed(() => parseValue('date', this.min()));
  private readonly maxDate = computed(() => parseValue('date', this.max()));

  readonly cells = computed<DayCell[]>(() =>
    monthGrid(this.visibleMonth(), {
      selected: this.picked(),
      min: this.minDate(),
      max: this.maxDate()
    })
  );

  /**
   * El idioma de la plataforma decide los nombres de los meses.
   *
   * ⚠️ **Se sacan de `Intl`, no de los ficheros de traducción.** Son doce
   * meses y siete días por idioma: ochenta y siete claves que el navegador ya
   * sabe, que nadie tendría que mantener y en las que una errata solo se ve en
   * el mes en que caiga.
   */
  private readonly locale = computed(() => {
    const idiomas: Record<string, string> = { es: 'es-ES', en: 'en-GB', ro: 'ro-RO' };
    return idiomas[this.translate.language()] ?? 'es-ES';
  });

  readonly monthLabel = computed(() => {
    const texto = new Intl.DateTimeFormat(this.locale(), {
      month: 'long',
      year: 'numeric'
    }).format(this.visibleMonth());
    // Mayúscula solo en la primera letra. `text-transform: capitalize` daría
    // «Octubre De 2026»: en español la preposición va en minúscula.
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  });

  /** Las iniciales de la semana, empezando en lunes como los tres idiomas. */
  readonly weekdays = computed(() => {
    const fmt = new Intl.DateTimeFormat(this.locale(), { weekday: 'short' });
    // Un lunes cualquiera del que partir: el 5 de enero de 2026 lo es.
    const lunes = new Date(2026, 0, 5);
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i))
    );
  });

  readonly pickedHour = computed(() => this.picked()?.getHours() ?? null);
  readonly pickedMinute = computed(() => this.picked()?.getMinutes() ?? null);

  /**
   * El valor de partida se lee **una vez**, aquí.
   *
   * A partir de este momento manda el panel: es él quien escribe en el campo,
   * así que volver a leerlo en cada ciclo sería preguntarle la respuesta a
   * quien acaba de copiársela.
   */
  ngOnInit(): void {
    const actual = parseValue(this.mode(), this.value());
    this.picked.set(actual);
    this.visibleMonth.set(
      actual ? new Date(actual.getFullYear(), actual.getMonth(), 1) : new Date()
    );
  }

  ngAfterViewInit(): void {
    this.place();
    // Y otra vez cuando ya se ha pintado con su alto real, que es lo que
    // decide si cabe debajo del campo o hay que subirlo.
    requestAnimationFrame(() => {
      this.place();
      this.centrarHoraElegida();
    });
  }

  /**
   * Deja la hora elegida a la vista al abrir.
   *
   * ⚠️ **Sin esto el panel se abre mintiendo.** Las 24 horas no caben, así que
   * un campo con las 12:00 se abría enseñando de la 00 a la 05 y ninguna
   * marcada: parecía que no había nada elegido y había que buscarlo
   * desplazando.
   *
   * ⚠️ **Y se mueve la columna a mano, no con `scrollIntoView()`.** Ese método
   * desplaza **todos** los antepasados con desplazamiento, incluida la página:
   * el panel es `fixed` y se quedaría quieto mientras el formulario de detrás
   * se va solo a otra parte.
   */
  private centrarHoraElegida(): void {
    const columnas = this.host.nativeElement.querySelectorAll<HTMLElement>('.picker-time-col');
    columnas.forEach((col) => {
      const marcada = col.querySelector<HTMLElement>('.is-selected');
      if (!marcada) return;
      /**
       * ⚠️ **Por rectángulos y no por `offsetTop`.** `offsetTop` se mide
       * contra el antepasado **posicionado**, que aquí es el panel entero y no
       * la columna: con el calendario encima le sumaba sus 250 px y la lista
       * de horas se iba a las cuatro de la tarde con las nueve marcadas fuera
       * de la vista. Solo se veía en el campo de fecha **y** hora — en el de
       * hora sola no hay nada encima y los dos números coinciden.
       */
      const rc = col.getBoundingClientRect();
      const rm = marcada.getBoundingClientRect();
      col.scrollTop += rm.top - rc.top - (col.clientHeight - marcada.clientHeight) / 2;
    });
  }

  t(clave: string): string {
    return this.translate.translate(clave);
  }

  pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  prevMonth(): void {
    this.visibleMonth.update((m) => addMonths(m, -1));
  }

  nextMonth(): void {
    this.visibleMonth.update((m) => addMonths(m, 1));
  }

  pickDay(celda: DayCell): void {
    if (celda.disabled) return;
    const base = this.picked() ?? new Date();
    const nueva = new Date(
      celda.date.getFullYear(),
      celda.date.getMonth(),
      celda.date.getDate(),
      this.mode() === 'date' ? 0 : base.getHours(),
      this.mode() === 'date' ? 0 : base.getMinutes()
    );
    this.commit(nueva);
    // Con fecha y hora el trabajo no ha terminado: falta la hora.
    if (this.mode() === 'date') this.closed.emit();
  }

  pickHour(h: number): void {
    const base = this.picked() ?? new Date();
    const nueva = new Date(base);
    nueva.setHours(h, base.getMinutes(), 0, 0);
    this.commit(nueva);
  }

  pickMinute(m: number): void {
    const base = this.picked() ?? new Date();
    const nueva = new Date(base);
    nueva.setMinutes(m, 0, 0);
    this.commit(nueva);
    // En un campo de hora, el minuto es el último dato que falta.
    if (this.mode() === 'time') this.closed.emit();
  }

  /**
   * Vacía el campo y cierra.
   *
   * ⚠️ **Emite la cadena vacía por el mismo canal que una fecha elegida**, así
   * que la directiva la escribe en el campo y dispara `input` y `change` igual
   * que si el operador la hubiera borrado a mano: `ngModel` se entera, la
   * validación se rehace y el formulario queda coherente. Escribir directamente
   * en el `input` desde aquí dejaría a Angular con el valor anterior.
   */
  clear(): void {
    this.valuePicked.emit('');
    this.closed.emit();
  }

  /** «Hoy» en un calendario y «Ahora» en un reloj: el mismo botón. */
  pickNow(): void {
    const ahora = new Date();
    if (this.mode() !== 'time' && outOfRange(ahora, this.minDate(), this.maxDate())) return;
    this.visibleMonth.set(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
    if (this.mode() === 'date') ahora.setHours(0, 0, 0, 0);
    this.commit(ahora);
    if (this.mode() !== 'datetime') this.closed.emit();
  }

  /** Verdadero si «Hoy» no llevaría a ninguna parte por los límites del campo. */
  readonly nowDisabled = computed(() => {
    if (this.mode() === 'time') return false;
    return outOfRange(new Date(), this.minDate(), this.maxDate());
  });

  private commit(d: Date): void {
    this.picked.set(d);
    this.valuePicked.emit(formatValue(this.mode(), d));
  }

  /**
   * Colocarse pegado al campo, y dentro de la pantalla.
   *
   * ⚠️ **`position: fixed` y colgado del `<body>`.** Dentro del formulario, un
   * antepasado con `overflow: hidden` —o con `transform`, que convierte a
   * `fixed` en relativo a él— recortaría el panel o lo dejaría a media
   * pantalla. Por eso lo monta la directiva fuera del árbol del formulario.
   */
  private place(): void {
    const r = this.anchor();
    const panel = this.host.nativeElement.firstElementChild as HTMLElement | null;
    if (!r || !panel) return;

    const MARGEN = 8;
    const ancho = panel.offsetWidth;
    const alto = panel.offsetHeight;

    // Debajo del campo si cabe; si no, encima. Nunca tapando el propio campo.
    let arriba = r.bottom + 4;
    if (arriba + alto > window.innerHeight - MARGEN) {
      arriba = r.top - alto - 4;
      if (arriba < MARGEN) arriba = Math.max(MARGEN, window.innerHeight - alto - MARGEN);
    }

    let izquierda = r.left;
    if (izquierda + ancho > window.innerWidth - MARGEN) {
      izquierda = window.innerWidth - ancho - MARGEN;
    }
    if (izquierda < MARGEN) izquierda = MARGEN;

    panel.style.top = `${Math.round(arriba)}px`;
    panel.style.left = `${Math.round(izquierda)}px`;
  }
}
