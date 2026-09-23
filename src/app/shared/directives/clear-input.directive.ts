import { Directive, ElementRef, HostBinding, HostListener, NgZone, OnDestroy, inject } from '@angular/core';
import { enZonaDelAspa } from '@shared/utils/clear-input.util';
import { prefersNativePicker } from '@shared/directives/date-picker.directive';

/** Los campos que llevan el icono de otra cosa pegado al borde derecho. */
const CON_ICONO_PROPIO = new Set(['date', 'time', 'datetime-local']);

/**
 * El aspa que vacía un campo de un toque.
 *
 * La pidió Dorel el 23 de septiembre de 2026 señalando la de Android: «me viene
 * muy bien». Y le viene bien por una razón concreta de este negocio — los
 * campos que más se reescriben son los que traen un valor por defecto puesto
 * (el lugar de recogida, la fianza, una fecha que se completó por error), y
 * vaciar un campo con el pulgar en la calle es un rato de retrocesos.
 *
 * ⚠️ **No envuelve el campo ni le mete un `<button>` al lado, y esa es la
 * decisión que sostiene todo lo demás.** Son 63 campos de texto repartidos por
 * 24 plantillas, metidos en rejillas, en `<label>` que los envuelven, en filas
 * de flex con su `flex: 1` puesto **en el input**: cualquier elemento nuevo o
 * cualquier contenedor intercalado cambia quién es el hijo de quién y rompe la
 * maquetación de unos cuantos sin romper la de los demás — que es la peor
 * forma de romperla, porque se ve en tres pantallas y no en las otras
 * veintiuna. El aspa se dibuja como **fondo del propio campo**, igual que el
 * chevron de los `select` y el calendario de `DatePickerDirective`, y la pulsa
 * quien acierte en su zona. Cero elementos nuevos, cero cambios de estructura.
 *
 * ⚠️ **Va por TIPO de campo, sin atributo que recordar.** Basta con que el
 * componente importe la directiva. Es la lección de `.form-control`, que pasó a
 * global después de olvidarse cuatro veces, y la misma regla que ya sigue
 * `DatePickerDirective`.
 *
 * Lo que **no** es: un control más. No entra en el orden de tabulación y no lo
 * anuncia ningún lector de pantalla, a propósito — con el teclado ya se vacía
 * un campo seleccionándolo todo, y añadir una parada de tabulación por campo en
 * un formulario de veintinueve haría más lento justo al que navega con teclado.
 */
@Directive({
  selector:
    'input[type=text], input[type=search], input[type=email], input[type=tel], input[type=url],' +
    'input[type=date], input[type=time], input[type=datetime-local]',
  standalone: true
})
export class ClearInputDirective implements OnDestroy {
  private host: ElementRef<HTMLInputElement> = inject(ElementRef);
  private zone = inject(NgZone);

  private get input(): HTMLInputElement {
    return this.host.nativeElement;
  }

  private get tipo(): string {
    return this.input.getAttribute('type') ?? 'text';
  }

  /**
   * ¿Hay algo que vaciar?
   *
   * ⚠️ **Se lee del DOM y no de un valor guardado**, porque el campo se escribe
   * por los dos lados: lo teclea el operador y lo escribe `ngModel` cuando el
   * modelo cambia por su cuenta —al cargar una ficha, al elegir un cliente de
   * la lista—. Guardando una copia, el aspa no aparecería en el segundo caso.
   */
  @HostBinding('class.has-clear')
  get visible(): boolean {
    return !!this.input.value && !this.input.disabled && !this.input.readOnly;
  }

  /**
   * ¿Manda el selector del sistema? Se resuelve una vez, como en
   * `DatePickerDirective`: un ratón no se convierte en un dedo a mitad de un
   * formulario.
   */
  private readonly iconoNativo = prefersNativePicker();

  /**
   * El aspa se corre un hueco hacia dentro para dejarle el borde al calendario.
   *
   * ⚠️ **Depende de QUIÉN pinta el calendario, no del tipo del campo**, y
   * confundirlo descolocaba el aspa en todo el móvil. La aplicación solo dibuja
   * el suyo en escritorio (`picker-custom`); con el dedo manda el del
   * navegador, que vive **al final de la caja de contenido** — o sea que el
   * `padding-right` lo empuja hacia dentro en vez de dejarlo donde estaba. Con
   * el desplazamiento puesto, los 3,5 rem de relleno metían el icono del
   * sistema 56 px hacia dentro y el aspa acababa a su derecha, con la zona
   * pulsable montada encima de él.
   *
   * Así que cada plataforma coloca los dos iconos como le toca: en escritorio
   * el calendario pegado al borde y el aspa a su izquierda; en el móvil al
   * revés, porque ahí el sitio del calendario no lo decidimos nosotros.
   */
  private get correrse(): boolean {
    return CON_ICONO_PROPIO.has(this.tipo) && !this.iconoNativo;
  }

  @HostBinding('class.has-clear--offset')
  get desplazada(): boolean {
    return this.visible && this.correrse;
  }

  /**
   * ⚠️ **`pointerdown` y no `click`**, para llegar antes que el navegador: sin
   * cancelar aquí, el clic coloca el cursor —o selecciona un segmento de la
   * fecha— antes de que se vacíe.
   */
  @HostListener('pointerdown', ['$event'])
  onPointerDown(evento: PointerEvent): void {
    this.aspaPulsada = this.enLaZona(evento.clientX);
    if (!this.aspaPulsada) return;

    evento.preventDefault();
    evento.stopPropagation();
    this.vaciar();
  }

  /**
   * ⚠️ **Cancelar `pointerdown` NO cancela el `click`, y dar eso por hecho
   * habría roto todos los campos de fecha del móvil.**
   *
   * Pointer Events solo suprime los eventos **de compatibilidad de ratón**
   * —`mousedown` y `mouseup`—; `click`, `auxclick` y `contextmenu` quedan
   * expresamente fuera. Medido con inyección táctil real: la secuencia es
   * `pointerdown(touch) → focus → touchstart → touchend → click(touch)`, con el
   * `click` vivo.
   *
   * Y eso importa porque **en un `input[type=date]` el `click` es la activación
   * que abre la hoja del sistema**: en el móvil, donde manda el selector
   * nativo, tocar el aspa vaciaba la fecha y acto seguido se abría el
   * calendario pidiendo la que el operador acababa de quitar. Justo lo que este
   * bloque existe para evitar.
   *
   * ⚠️ **Hace falta la bandera y no vale volver a preguntar por la zona**: para
   * cuando llega el `click`, el campo ya está vacío, así que `visible` es falso
   * y `enLaZona()` contesta que no.
   *
   * No se vio en escritorio porque allí `picker-custom` esconde el indicador
   * del navegador y el panel propio escucha `mousedown`, que sí queda
   * suprimido: no había nada que se abriera.
   */
  @HostListener('click', ['$event'])
  onClick(evento: MouseEvent): void {
    if (!this.aspaPulsada) return;
    this.aspaPulsada = false;
    evento.preventDefault();
    evento.stopPropagation();
  }

  /** El toque anterior cayó sobre el aspa; lo consume el `click` de después. */
  private aspaPulsada = false;

  /**
   * La mano encima del aspa.
   *
   * ⚠️ **No vale poner `cursor: pointer` a todo el campo**, que es lo que hace
   * `DatePickerDirective` porque allí el campo entero se pulsa. Aquí se teclea:
   * un campo de texto con cursor de mano dice que no se puede escribir en él.
   * Así que la mano se enciende solo sobre la zona del aspa.
   *
   * ⚠️ **Y el seguimiento del ratón va FUERA de Angular.** Un `mousemove` es
   * decenas de eventos por segundo; dentro de la zona dispararía un ciclo de
   * detección de cambios en cada uno, en una aplicación que no es zoneless. Se
   * escucha al entrar, se suelta al salir, y la clase se pone a mano sobre el
   * elemento: nada de esto necesita que Angular se entere.
   */
  @HostListener('mouseenter')
  onMouseEnter(): void {
    if (this.seguimiento) return;
    this.zone.runOutsideAngular(() => {
      this.input.addEventListener('mousemove', this.alMover);
    });
    this.seguimiento = true;
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.soltarSeguimiento();
    this.input.classList.remove('has-clear--hover');
  }

  ngOnDestroy(): void {
    this.soltarSeguimiento();
  }

  private seguimiento = false;

  private alMover = (evento: MouseEvent): void => {
    this.input.classList.toggle('has-clear--hover', this.enLaZona(evento.clientX));
  };

  private soltarSeguimiento(): void {
    if (!this.seguimiento) return;
    this.input.removeEventListener('mousemove', this.alMover);
    this.seguimiento = false;
  }

  /**
   * Si esa abscisa cae sobre el aspa.
   *
   * ⚠️ **La cuenta vive en `clear-input.util.ts`, no aquí**, por la misma razón
   * que `qrRects()` vive fuera del dibujo del QR: un aspa que no se puede
   * pulsar tiene exactamente la misma pinta que una buena, así que esto tiene
   * que poder probarse sin un navegador delante.
   */
  private enLaZona(clientX: number): boolean {
    if (!this.visible) return false;
    return enZonaDelAspa(this.input.getBoundingClientRect(), clientX, this.correrse);
  }

  /**
   * Vaciar **como si lo hubiera hecho una persona**.
   *
   * ⚠️ **Sin los eventos, Angular no se entera de nada.** Asignar `.value` a
   * mano no dispara ninguno, así que el formulario se quedaría con el valor
   * anterior: la pantalla enseñaría el campo vacío y se guardaría lo de antes.
   * Es exactamente la misma nota que lleva `DatePickerDirective`, y por el
   * mismo motivo.
   *
   * Y el foco se queda dentro: se vacía para escribir otra cosa, no para
   * dejarlo vacío y marcharse. En el móvil eso mantiene el teclado abierto.
   *
   * ⚠️ **Salvo en los campos de fecha y hora del móvil, donde enfocar ABRE el
   * selector.** El argumento de arriba es el del teclado, y en un campo de
   * fecha no hay teclado que mantener: hay una hoja a pantalla completa que en
   * Safari se abre con el propio foco, así que cancelar el `click` no bastaría
   * y volveríamos a pedir la fecha que se acaba de quitar.
   */
  private vaciar(): void {
    this.input.value = '';
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
    if (!(this.iconoNativo && CON_ICONO_PROPIO.has(this.tipo))) {
      this.input.focus({ preventScroll: true });
    }
  }
}
