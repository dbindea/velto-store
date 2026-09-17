import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

/**
 * Baja los trozos de las demás pantallas **cuando la red está libre**.
 *
 * Sin estrategia de precarga —que es como estaba— el trozo de una sección no se
 * pide hasta que se navega a ella: cada salto a Pagos, a Reservas o a Facturas
 * espera su descarga. Medido en desarrollo, unos 200 ms por sección la primera
 * vez que se entra en cada una.
 *
 * ⚠️ **No es `PreloadAllModules` a secas, y la diferencia importa.** Angular
 * arranca la precarga en cuanto termina la primera navegación, que es
 * exactamente el momento en el que el panel está pidiendo sus reservas, sus
 * contratos y su mantenimiento a Firestore. Ponerse a bajar un mega y medio de
 * JavaScript justo ahí compite con los datos que el operador está esperando ver
 * — se ganaría en la segunda pantalla lo que se pierde en la primera.
 *
 * Por eso espera. Primero a que el navegador esté ocioso
 * (`requestIdleCallback`), y si no existe —Safari no lo trae— a un retardo
 * fijo, que es la misma idea con peor puntería.
 *
 * ⚠️ **Lo que NO se precarga son las rutas públicas.** El contrato que firma el
 * cliente, la pantalla de pago y los enlaces cortos los abre alguien que no es
 * el operador y muchas veces desde datos móviles; bajarle el backoffice entero
 * a un cliente que solo va a firmar es gastarle su tarifa para nada. Se marcan
 * con `data: { precargar: false }`.
 */
@Injectable({ providedIn: 'root' })
export class CuandoLaRedEsteLibre implements PreloadingStrategy {
  /** Margen antes de empezar, si no hay `requestIdleCallback`. */
  private static readonly ESPERA_MS = 2500;

  preload(route: Route, cargar: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['precargar'] === false) return of(null);

    return this.cuandoHayaHueco().pipe(mergeMap(() => cargar()));
  }

  /**
   * Un observable que emite cuando el navegador no tiene nada urgente.
   *
   * `requestIdleCallback` con `timeout` garantiza que se ejecuta aunque el hilo
   * no llegue a estar ocioso nunca: sin ese tope, en una pantalla que se
   * refresca sola la precarga podría no ocurrir jamás.
   */
  private cuandoHayaHueco(): Observable<unknown> {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;

    if (typeof ric !== 'function') {
      return timer(CuandoLaRedEsteLibre.ESPERA_MS);
    }

    return new Observable((subscriber) => {
      ric(
        () => {
          subscriber.next(null);
          subscriber.complete();
        },
        { timeout: CuandoLaRedEsteLibre.ESPERA_MS }
      );
    });
  }
}
