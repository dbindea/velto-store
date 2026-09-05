import { Injectable, computed, signal } from '@angular/core';

/**
 * Qué clase de aviso es. Decide el color y, sobre todo, **si desaparece solo**.
 */
export type NoticeKind = 'error' | 'success' | 'info';

export interface Notice {
  id: number;
  kind: NoticeKind;
  /** Clave i18n. Nunca texto literal: ver `notify()`. */
  key: string;
  /**
   * Sustituciones para la plantilla del mensaje, por nombre:
   * `{ amount: '145,00' }` rellena `{amount}`.
   */
  params?: Record<string, string>;
  /**
   * Qué se reintenta. Si viene, el aviso enseña un botón; al pulsarlo se cierra
   * y se vuelve a lanzar la acción.
   *
   * Solo para lo que de verdad se puede repetir: un fallo de red al generar un
   * PDF, sí; «no hay importe a retener», no — ahí no ha fallado nada, falta un
   * dato.
   */
  retry?: () => void;
}

/**
 * Los avisos de operación de la aplicación.
 *
 * ⚠️ **Esto sustituye a 27 `alert()`** repartidos por el backoffice (M-43), y
 * resuelve dos problemas distintos que tenían todos:
 *
 * 1. **Eran ventanas del navegador**: modales, hay que cerrarlas para poder
 *    mirar la pantalla de la que hablan, y no caben dos a la vez — tres fallos
 *    seguidos eran tres ventanas en fila.
 * 2. **La mitad estaban en español duro**, así que un operador con la
 *    aplicación en rumano leía castellano justo en el peor momento.
 *
 * No es lo mismo que `<app-form-error>`. Aquel dice **qué falta por rellenar**
 * y vive pegado a su campo; este dice **qué ha fallado** al intentar algo, y por
 * eso es global y puede ofrecer reintentar.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  /** Cuánto dura en pantalla lo que no es un error, en milisegundos. */
  private static readonly AUTO_DISMISS_MS = 5000;

  private nextId = 1;
  private readonly items = signal<Notice[]>([]);

  /** Los avisos vivos, del más antiguo al más reciente. */
  readonly notices = computed(() => this.items());

  /**
   * Algo ha fallado.
   *
   * ⚠️ **No se va solo, y es deliberado.** Un error que se desvanece a los
   * cinco segundos es un error que el operador se pierde mientras mira otra
   * cosa — y entonces cree que la acción salió bien. Se queda hasta que lo
   * cierra o lo reintenta.
   */
  error(key: string, options?: { params?: Record<string, string>; retry?: () => void }): number {
    return this.push('error', key, options?.params, options?.retry);
  }

  /** Ha salido bien. Se retira solo: nadie necesita cerrar una buena noticia. */
  success(key: string, params?: Record<string, string>): number {
    return this.push('success', key, params);
  }

  /** Ni bien ni mal: algo que conviene saber. También se retira solo. */
  info(key: string, params?: Record<string, string>): number {
    return this.push('info', key, params);
  }

  dismiss(id: number): void {
    this.items.update(list => list.filter(n => n.id !== id));
  }

  /** Vaciar la pila. La usa el cambio de ruta: los avisos son de una pantalla. */
  clear(): void {
    this.items.set([]);
  }

  private push(
    kind: NoticeKind,
    key: string,
    params?: Record<string, string>,
    retry?: () => void
  ): number {
    const id = this.nextId++;

    // Un mismo fallo repetido no apila copias: el operador que pulsa tres veces
    // un botón roto acabaría con tres avisos idénticos tapándose entre sí.
    this.items.update(list => [...list.filter(n => !(n.key === key && n.kind === kind)), {
      id,
      kind,
      key,
      params,
      retry
    }]);

    if (kind !== 'error') {
      setTimeout(() => this.dismiss(id), NotificationService.AUTO_DISMISS_MS);
    }
    return id;
  }
}
