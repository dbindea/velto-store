import {
  ApplicationRef,
  ComponentRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  HostBinding,
  HostListener,
  OnDestroy,
  createComponent,
  inject
} from '@angular/core';
import { DatePickerPanelComponent } from '@shared/components/date-picker/date-picker-panel.component';
import { PickerMode } from '@shared/utils/date-picker.util';

/**
 * Cuánto mide, por la derecha del campo, la zona que abre el calendario.
 *
 * Es el ancho del icono más su margen. Fuera de esa zona el clic no abre nada
 * —solo coloca el cursor— que es **exactamente lo que hace el navegador**: en
 * un `input[type=date]` nativo, pulsar sobre el día no abre el panel, solo lo
 * hace el botón del calendario. Copiarlo importa: si el panel se abriera con
 * cualquier clic, tapar la mitad de la pantalla cada vez que alguien va a
 * teclear una fecha sería peor que no tener panel.
 */
const ZONA_ICONO_PX = 34;

/**
 * ¿Manda el selector del sistema?
 *
 * ⚠️ **Ya no: nunca. Y esto es una REVERSIÓN, por eso está escrita.** Del 22 al
 * 24 de septiembre de 2026 esta función devolvía `true` con el dedo, con un
 * argumento que sigue siendo bueno —la hoja a pantalla completa de iOS y
 * Android está pensada para el pulgar y esta aplicación se usa en la calle—.
 * Lo que lo tumbó fue una cosa que no se había mirado: **el diálogo de fecha de
 * Android no tiene forma de vaciar**. Solo trae «Cancelar» y «Aceptar», así que
 * una fecha puesta por error no se podía quitar ni con el dedo ni con el
 * teclado. El de hora sí trae «Borrar»; el de fecha no.
 *
 * Se tapó un tiempo con el aspa dentro del campo, y Dorel la quitó el día 24
 * porque con el dedo se confunde con el botón de abrir: «mejor en modal y en
 * form dejarlo limpio». Quitada el aspa y sin «Borrar» en el diálogo del
 * sistema, no quedaba ninguna forma de vaciar una fecha en un teléfono.
 *
 * Así que manda el panel propio en los dos sitios: es el único que tiene
 * «Borrar», y de paso los dos se comportan igual. Se conserva la función —y no
 * se borra la llamada— porque el argumento de la hoja del sistema sigue siendo
 * cierto y este es el punto donde volver si algún día el diálogo de Android
 * aprende a vaciar.
 */
export function prefersNativePicker(): boolean {
  return false;
}

/**
 * Pone el calendario de la aplicación en todos los campos de fecha y hora.
 *
 * ⚠️ **El selector no pide ningún atributo, y es a propósito.** Va por tipo de
 * campo (`input[type=date]`…), así que basta con que el componente importe la
 * directiva: ningún formulario tiene que acordarse de marcar sus campos. Es la
 * misma lección que `.form-control`, que pasó a ser global después de
 * olvidarse **cuatro veces** — la última en una pantalla que mueve dinero.
 *
 * ⚠️ **Y no sustituye al campo: lo viste.** Debajo sigue habiendo un
 * `input[type=date]` con su valor `yyyy-MM-dd`, su `min`, su `max`, su
 * validación y su teclado. Esto solo escribe en él y dispara sus eventos, así
 * que el día que este panel estorbe, se quita la directiva de los `imports` y
 * todo vuelve a ser nativo sin tocar una sola plantilla.
 */
@Directive({
  selector: 'input[type=date], input[type=time], input[type=datetime-local]',
  standalone: true
})
export class DatePickerDirective implements OnDestroy {
  private host: ElementRef<HTMLInputElement> = inject(ElementRef);
  private appRef = inject(ApplicationRef);
  private injector = inject(EnvironmentInjector);

  private panel: ComponentRef<DatePickerPanelComponent> | null = null;
  private contenedor: HTMLElement | null = null;

  /**
   * Se resuelve una vez, al crear la directiva.
   *
   * Preguntarlo en cada ciclo de detección de cambios crearía un
   * `MediaQueryList` por campo y por ciclo para contestar algo que no cambia:
   * un ratón no se convierte en un dedo a mitad de un formulario.
   */
  private readonly nativo = prefersNativePicker();

  /**
   * La clase que esconde el icono del navegador y pinta el nuestro.
   *
   * Va aquí y no en la plantilla porque las plantillas no saben nada de esto:
   * el campo sigue siendo un `<input type="date">` corriente.
   */
  @HostBinding('class.picker-custom')
  get conPanelPropio(): boolean {
    return this.usaPanelPropio();
  }

  private get input(): HTMLInputElement {
    return this.host.nativeElement;
  }

  private get mode(): PickerMode {
    const t = this.input.getAttribute('type');
    if (t === 'time') return 'time';
    if (t === 'datetime-local') return 'datetime';
    return 'date';
  }

  /**
   * ⚠️ **`mousedown` y no `click`.** El `preventDefault` tiene que llegar
   * antes de que el navegador mueva el foco a un segmento del campo; en
   * `click` ya es tarde y el panel se abre con el cursor parpadeando dentro
   * del día, que es confuso.
   */
  @HostListener('mousedown', ['$event'])
  onMouseDown(evento: MouseEvent): void {
    if (!this.usaPanelPropio()) return;
    const rect = this.input.getBoundingClientRect();
    if (evento.clientX < rect.right - ZONA_ICONO_PX) return;

    evento.preventDefault();
    /**
     * ⚠️ **`preventScroll` no es un detalle.** Enfocar un campo que no está
     * entero a la vista hace que el navegador desplace la página, y ese
     * desplazamiento dispara el oyente que cierra el panel: se abría y se
     * cerraba en el mismo clic, sin error en consola y sin nada que mirar.
     * Costó un rato de más.
     */
    this.input.focus({ preventScroll: true });
    this.panel ? this.cerrar() : this.abrir();
  }

  /** `Alt` + flecha abajo es el atajo de siempre para abrir un desplegable. */
  @HostListener('keydown', ['$event'])
  onKeyDown(evento: KeyboardEvent): void {
    if (!this.usaPanelPropio()) return;
    if (evento.altKey && evento.key === 'ArrowDown') {
      evento.preventDefault();
      this.abrir();
    } else if (evento.key === 'Escape' && this.panel) {
      evento.preventDefault();
      this.cerrar();
    }
  }

  ngOnDestroy(): void {
    this.cerrar();
  }

  private usaPanelPropio(): boolean {
    return !this.nativo && !this.input.disabled && !this.input.readOnly;
  }

  private abrir(): void {
    if (this.panel) return;

    /**
     * ⚠️ **Se cuelga del `<body>`, no del formulario.** Un antepasado con
     * `overflow: hidden` recortaría el panel, y uno con `transform` —cualquier
     * animación— haría que `position: fixed` se midiera contra él y no contra
     * la pantalla. Las dos cosas son invisibles hasta que pasan.
     */
    this.contenedor = document.createElement('div');
    document.body.appendChild(this.contenedor);

    this.panel = createComponent(DatePickerPanelComponent, {
      environmentInjector: this.injector,
      hostElement: this.contenedor
    });

    this.panel.setInput('mode', this.mode);
    this.panel.setInput('value', this.input.value);
    this.panel.setInput('min', this.input.getAttribute('min'));
    this.panel.setInput('max', this.input.getAttribute('max'));
    this.panel.setInput('anchor', this.input.getBoundingClientRect());

    this.panel.instance.valuePicked.subscribe((valor: string) => this.escribir(valor));
    this.panel.instance.closed.subscribe(() => this.cerrar());

    this.appRef.attachView(this.panel.hostView);

    /**
     * Se escuchan **al abrir** y se quitan al cerrar: un oyente de documento
     * que sobreviva al panel es el que acaba respondiendo a clics de otra
     * pantalla.
     *
     * ⚠️ **Y no en este mismo instante, sino en el siguiente fotograma.**
     * Abrir mueve cosas —el foco, el sitio que ocupa el panel— y cualquier
     * desplazamiento que eso provoque llegaría a unos oyentes cuyo único
     * trabajo es cerrar. Un fotograma después, lo que llegue ya es del
     * usuario.
     */
    requestAnimationFrame(() => {
      if (!this.panel) return;
      document.addEventListener('mousedown', this.alPulsarFuera, true);
      window.addEventListener('resize', this.alMoverse, true);
      window.addEventListener('scroll', this.alMoverse, true);
    });
  }

  private cerrar(): void {
    if (!this.panel) return;
    document.removeEventListener('mousedown', this.alPulsarFuera, true);
    window.removeEventListener('resize', this.alMoverse, true);
    window.removeEventListener('scroll', this.alMoverse, true);

    this.appRef.detachView(this.panel.hostView);
    this.panel.destroy();
    this.panel = null;
    this.contenedor?.remove();
    this.contenedor = null;
  }

  /**
   * Un clic fuera cierra — salvo en el propio campo, que ya tiene su
   * alternancia y si no se cerraría dos veces y volvería a abrirse.
   */
  private alPulsarFuera = (evento: Event): void => {
    const destino = evento.target as Node;
    if (this.contenedor?.contains(destino) || this.input.contains(destino) || destino === this.input) {
      return;
    }
    this.cerrar();
  };

  /**
   * Al desplazar o cambiar el tamaño, el panel se cierra en vez de perseguir
   * al campo. Es lo que hace el del navegador, y perseguirlo obliga a
   * recalcular en cada píxel de desplazamiento.
   *
   * ⚠️ **Salvo si lo que se desplaza es el propio panel**, y esta línea costó
   * un buen rato. El oyente va en fase de **captura** para enterarse también
   * de lo que se desplace dentro de un contenedor con `overflow` —un modal, un
   * panel lateral—, y un evento de desplazamiento **no burbujea** pero sí baja
   * en la captura. Consecuencia: al abrir el reloj, centrar la hora elegida
   * mueve la columna, eso dispara un desplazamiento, y el panel se cerraba a sí
   * mismo en el mismo fotograma en que se abría. Sin error en consola y sin
   * nada que mirar: simplemente no salía.
   */
  private alMoverse = (evento: Event): void => {
    const destino = evento.target;
    if (destino instanceof Node && this.contenedor?.contains(destino)) return;
    this.cerrar();
  };

  /**
   * Escribe en el campo **como si lo hubiera tecleado una persona**.
   *
   * ⚠️ **Sin los eventos, Angular no se entera de nada.** Asignar `.value` a
   * mano no dispara ninguno, así que el formulario seguiría con el valor
   * anterior: la pantalla enseñaría la fecha nueva y se guardaría la vieja.
   * `input` es el que escucha `ngModel`; `change` va detrás por lo que pueda
   * haber escuchándolo.
   */
  private escribir(valor: string): void {
    this.input.value = valor;
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
