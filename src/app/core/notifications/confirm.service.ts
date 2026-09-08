import { Injectable, signal } from '@angular/core';

/**
 * Las preguntas de sí o no, sin `confirm()` del navegador.
 *
 * ⚠️ **Esto sustituye a once `confirm()` nativos**, que eran lo que quedaba del
 * mismo problema que ya se resolvió con los `alert()` (M-43). Un `confirm()`
 * tiene tres defectos y los tres se ven en cuanto se mira la pantalla:
 *
 * - **Lo pinta el navegador**, con «store.veltorent.com dice» encima y los
 *   botones del sistema. En medio de una aplicación con su propia identidad
 *   parece que la haya secuestrado otra cosa.
 * - **No se puede traducir del todo**: los botones «Aceptar» y «Cancelar» los
 *   pone el navegador en el idioma del sistema, así que a un operador rumano le
 *   salían en rumano dentro de una pregunta en español. Y cuatro de las once
 *   preguntas estaban además **escritas en español duro** en el código.
 * - **No distingue lo grave de lo trivial.** Borrar una foto y cancelar un
 *   cobro se preguntaban exactamente igual.
 *
 * La API devuelve una promesa de `boolean`, así que sustituir `if (!confirm(x))`
 * por `if (!(await this.confirm.ask(...)))` no cambia la forma del código que
 * la usa. Es a propósito: once llamadas que hay que migrar a mano son once
 * ocasiones de colar un fallo.
 */
export interface ConfirmRequest {
  /** Clave i18n del título. */
  title: string;
  /** Clave i18n del cuerpo. */
  message: string;
  /** Clave i18n del botón que confirma. Por defecto, «Aceptar». */
  confirmLabel?: string;
  /** Clave i18n del botón que cancela. Por defecto, «Cancelar». */
  cancelLabel?: string;
  /**
   * Pinta el botón de confirmar en rojo.
   *
   * Para lo **irreversible**: borrar una foto, cancelar un cobro, anular un
   * enlace de firma. No para «te falta un dato, ¿sigo?», que es una advertencia
   * y no un destrozo.
   */
  danger?: boolean;
  /** Sustituciones para el mensaje, como en `NotificationService`. */
  params?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  /** La pregunta en pantalla, o `null`. El componente raíz la pinta. */
  readonly pending = signal<ConfirmRequest | null>(null);

  private resolver: ((value: boolean) => void) | null = null;

  /**
   * Pregunta y espera. Resuelve `true` si el operador confirma.
   *
   * ⚠️ **Una pregunta a la vez.** Si llega otra con una abierta, la anterior se
   * resuelve como «no»: dos diálogos apilados dejarían al operador respondiendo
   * a uno creyendo que responde al otro, y aquí las respuestas borran cosas.
   */
  ask(request: ConfirmRequest): Promise<boolean> {
    this.resolver?.(false);
    this.pending.set(request);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** La respuesta. La llama el componente del diálogo. */
  answer(value: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.pending.set(null);
    resolve?.(value);
  }
}
