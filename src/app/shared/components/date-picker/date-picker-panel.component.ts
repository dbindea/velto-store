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
  monthGrid,
  outOfRange,
  parseLimitValue,
  parseValue
} from '@shared/utils/date-picker.util';

/**
 * ¿El panel se pega al borde inferior de la pantalla en vez de colgar del campo?
 *
 * ⚠️ **Colgando del campo, en un teléfono el mes NO se ve entero.** Entre la
 * rejilla, las horas y el pie el panel mide unos 550 px, así que `place()` lo
 * recortaba contra la pantalla y lo que sobraba —casi siempre las dos últimas
 * semanas y el botón de aceptar— había que buscarlo desplazando **dentro** del
 * panel. Y la pregunta que un calendario contesta de un vistazo es justo esa:
 * en qué día de la semana cae el 15. Lo pidió Dorel el 7 de octubre de 2026:
 * «ver el mes completo en la pantalla».
 *
 * ⚠️ **Y lo que cambia con el ratón es DÓNDE se pone, no cómo se ve.** El 8 de
 * octubre de 2026 esto llegó a devolver `true` siempre, porque Dorel pidió «el
 * mismo tipo de calendario del móvil» para escritorio. Lo que quería era el
 * **aspecto** —la rejilla grande, las horas en fichas, el botón— y eso se queda
 * en los dos: lo dijo él mismo ese día, pidiendo que en escritorio fuera más
 * pequeño y que colgara del campo siguiendo a la página. Son dos cosas distintas
 * y conviene no volver a mezclarlas:
 *
 * - **el diseño** es común, y vive fuera de `.is-sheet` en el SCSS;
 * - **la colocación** depende del aparato: hoja abajo con el dedo, colgando del
 *   campo con el ratón, que es el modismo de cada uno.
 */
export function prefersSheetLayout(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

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

  /** Con el dedo, hoja abajo; con el ratón, colgando del campo. */
  readonly asSheet = prefersSheetLayout();

  /** Lo elegido ahora mismo; nace de lo que hubiera en el campo. */
  private readonly picked = signal<Date | null>(null);
  /** Qué mes se está mirando, que no es lo mismo que qué día está elegido. */
  private readonly visibleMonth = signal<Date>(new Date());

  readonly showsCalendar = computed(() => this.mode() !== 'time');
  readonly showsTime = computed(() => this.mode() !== 'date');

  // ⚠️ `parseLimitValue` y no `parseValue('date', …)`: un `datetime-local` trae
  // el límite con hora dentro y aquel lo descartaba entero. Ver el util.
  private readonly minDate = computed(() => parseLimitValue(this.min()));
  private readonly maxDate = computed(() => parseLimitValue(this.max()));

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
    requestAnimationFrame(() => this.place());
  }

  /*
   * ⚠️ **Aquí había un `centrarHoraElegida()` y se borró el 8 de octubre de
   * 2026.** Movía a mano el `scrollTop` de la columna de horas para que la
   * elegida no se abriera fuera de la vista, y traía dos trampas documentadas:
   * nada de `scrollIntoView()` —desplaza también la página— y medir por
   * rectángulos y no por `offsetTop`, que se cuenta contra el antepasado
   * posicionado. Dejó de hacer falta al pasar las horas a una rejilla que cabe
   * entera: ya no hay nada que desplazar. Si algún día vuelve una lista larga,
   * está en el historial de git con su explicación.
   */

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

  /**
   * ⚠️ **La hora se elige EN PUNTO: el minuto se pone a 0 siempre.** Decisión
   * de Dorel del 7 de octubre de 2026. La columna de minutos de cinco en cinco
   * era doce opciones más que recorrer con el pulgar para un negocio que pacta
   * las entregas a y media como mucho — y la hora exacta de verdad la pone el
   * parte de entrega, no este campo.
   *
   * ⚠️ **Y pone 0 aunque el campo ya trajera minutos.** Dejar los de antes
   * —`base.getMinutes()`, que es lo que hacía— significaría que una recogida
   * guardada a las 10:35 se queda en 11:35 al tocar la hora, con un minuto que
   * ya no se puede cambiar porque la columna no existe.
   */
  pickHour(h: number): void {
    const base = this.picked() ?? new Date();
    const nueva = new Date(base);
    nueva.setHours(h, 0, 0, 0);
    this.commit(nueva);
    // En un campo de solo hora, la hora es el último dato que falta.
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
  /**
   * Mueve el panel con la página, en vez de cerrarlo al primer desplazamiento.
   *
   * ⚠️ **Antes se cerraba, y eso es lo que Dorel pidió quitar** el 8 de octubre
   * de 2026: «que al hacer scroll de la página con el calendario abierto no
   * desaparezca, sino que suba o baje haciendo scroll». Un panel que se cierra
   * solo obliga a volver a abrirlo cada vez que uno mira algo de la pantalla, y
   * encima parece que se ha roto.
   *
   * ⚠️ **Se reaplica el DESFASE, no se vuelve a colocar.** `place()` decide si
   * el panel va encima o debajo del campo según lo que quepa, así que llamarlo
   * en cada fotograma de desplazamiento haría que **saltara de un lado a otro**
   * del campo a media lectura. Con el desfase se comporta como si estuviera
   * pegado.
   *
   * ⚠️ **Y aquí NO se recorta contra la pantalla**, al revés que al abrir: si el
   * campo se va de la vista, el panel se va con él. Es justo lo que se ha
   * pedido; dejarlo clavado en el borde sería un panel flotando sin dueño.
   */
  follow(anchor: DOMRect): void {
    if (this.asSheet || this.desfase === null) return;
    const panel = this.host.nativeElement.firstElementChild as HTMLElement | null;
    if (!panel) return;
    panel.style.top = `${Math.round(anchor.top + this.desfase)}px`;
  }

  /** Lo que separa el borde de arriba del panel del del campo. Ver `follow()`. */
  private desfase: number | null = null;

  private place(): void {
    // Como hoja no hay nada que colocar: lo hace el CSS pegándola al borde de
    // abajo. Y escribir `top`/`left` en línea le GANARÍA a esa regla, así que
    // esto no es un atajo, es lo que hace que la hoja funcione.
    if (this.asSheet) return;

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

    // A partir de aquí el panel va pegado al campo: ver `follow()`.
    this.desfase = Math.round(arriba) - r.top;
  }
}
