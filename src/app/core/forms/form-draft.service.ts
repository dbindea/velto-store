import { DestroyRef, Injectable } from '@angular/core';

/**
 * El borrador de un formulario largo, para que abrir la cámara no cueste el
 * trabajo hecho.
 *
 * ⚠️ **El problema no es nuestro y no se puede impedir.** Cuando se abre la
 * cámara desde un `input[type=file]`, Android pasa la aplicación a segundo
 * plano y **el sistema puede matar la pestaña para liberar memoria** —una
 * cámara es lo más caro que abre un móvil—. Al volver, el navegador recarga la
 * página: Angular arranca de cero, el formulario sale vacío y lo que el
 * operador llevaba escrito ya no existe. Pasa igual si el cliente llama en ese
 * momento, o si se cambia de aplicación para mirar algo.
 *
 * Así que la defensa no es evitarlo, es **sobrevivirlo**: se guarda lo escrito
 * justo antes de que la página se vaya a segundo plano y se restaura al volver.
 *
 * Dos decisiones que importan:
 *
 * - **`sessionStorage`, no `localStorage`.** El borrador muere con la pestaña.
 *   Estos formularios llevan datos de un cliente —km, daños, notas— y no tienen
 *   por qué sobrevivir en el disco del móvil hasta que alguien los pise.
 * - **Se guarda al ocultarse la página, no en cada tecla.** `visibilitychange`
 *   es exactamente el momento en que el sistema puede llevarse la pestaña, y es
 *   el único evento que dispara tanto al abrir la cámara como al cambiar de
 *   aplicación. Guardar en cada pulsación sería escribir cien veces para el
 *   caso que ocurre una.
 */
@Injectable({ providedIn: 'root' })
export class FormDraftService {
  /** Un borrador viejo no se restaura: media hora después ya no es «lo que estaba haciendo». */
  private static readonly MAX_AGE_MS = 12 * 60 * 60 * 1000;
  private static readonly PREFIX = 'velto:draft:';

  /**
   * Conecta un formulario a su borrador.
   *
   * Restaura lo que hubiera guardado, y a partir de ahí guarda solo cuando la
   * página se va a segundo plano. Se desconecta con el componente.
   *
   * @param key    Identifica el formulario Y su sujeto: `pickup:<reservaId>`.
   *               Sin el id, volver a otra reserva restauraría datos ajenos.
   * @param read   Devuelve lo que hay que guardar. Se llama al ocultarse.
   * @param write  Recibe lo guardado. Solo se llama si había borrador.
   * @param destroyRef El del componente, para soltar los listeners con él.
   *
   * ⚠️ El `DestroyRef` **llega como parámetro y no se inyecta aquí**: esto se
   * llama desde métodos `async`, que ya están fuera del contexto de inyección,
   * y un `inject()` ahí revienta en tiempo de ejecución con un error que no
   * dice nada del formulario.
   */
  attach<T>(
    key: string,
    read: () => T,
    write: (draft: T) => void,
    destroyRef: DestroyRef
  ): { clear: () => void } {
    const storageKey = FormDraftService.PREFIX + key;

    const saved = this.read<T>(storageKey);
    if (saved !== null) write(saved);

    const save = () => {
      // Solo al ocultarse: en `visible` no hay nada que proteger, y guardar
      // ahí machacaría el borrador bueno con el estado a medio restaurar.
      if (document.visibilityState !== 'hidden') return;
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ at: Date.now(), data: read() })
        );
      } catch {
        // Cuota llena o modo privado: no hay borrador, pero tampoco se rompe
        // el formulario que el operador está usando.
      }
    };

    document.addEventListener('visibilitychange', save);
    // Safari en iOS no siempre dispara `visibilitychange` al descargar, pero sí
    // `pagehide`. Los dos llaman a lo mismo, así que da igual cuál llegue.
    window.addEventListener('pagehide', save);

    const clear = () => {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* nada que limpiar */
      }
    };

    destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', save);
      window.removeEventListener('pagehide', save);
    });

    return { clear };
  }

  private read<T>(storageKey: string): T | null {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { at?: number; data?: T };
      if (!parsed?.at || Date.now() - parsed.at > FormDraftService.MAX_AGE_MS) {
        sessionStorage.removeItem(storageKey);
        return null;
      }
      return (parsed.data ?? null) as T | null;
    } catch {
      return null;
    }
  }
}
