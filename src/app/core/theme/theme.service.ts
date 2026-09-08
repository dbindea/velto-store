import { Injectable, signal, effect } from '@angular/core';

/**
 * Los cuatro temas.
 *
 * Eran dos —claro y oscuro— y el oscuro se volvió **casi negro** al adoptar la
 * rampa del design system: `#0B0F0E` de fondo cansa a la vista en una jornada
 * entera delante de la pantalla, que es como se usa esto. En vez de retocar el
 * oscuro y dejar a medias a quien sí lo prefiera, se abre la elección.
 *
 * - `light` — el claro de siempre.
 * - `dark` — el carbón profundo, el más contrastado.
 * - `forest` — **intermedio verdoso**. Grises con el tinte teal de la marca,
 *   varios escalones por encima del negro.
 * - `ocean` — **intermedio azulado**, la rampa `slate` que tenía la aplicación
 *   antes del design system. Está aquí porque a Dorel le resultaba cómoda y
 *   porque un azul apagado es lo que usan casi todas las herramientas donde se
 *   pasan ocho horas.
 */
export type Theme = 'light' | 'dark' | 'forest' | 'ocean';

/** Los tres que son oscuros: deciden el logo y el `color-scheme` nativo. */
const DARK_THEMES: Theme[] = ['dark', 'forest', 'ocean'];

const THEMES: Theme[] = ['light', 'dark', 'forest', 'ocean'];

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private _theme = signal<Theme>(this.getStoredTheme());

  readonly theme = this._theme.asReadonly();
  readonly themes = THEMES;

  /**
   * ⚠️ **`isDark()` significa «fondo oscuro», no «tema dark».**
   *
   * Lo consultan el logo —que necesita su versión clara— y el conmutador. Con
   * tres temas oscuros, preguntar `theme() === 'dark'` habría dejado el logo
   * negro sobre fondo negro en `forest` y en `ocean`.
   */
  readonly isDark = () => DARK_THEMES.includes(this._theme());

  constructor() {
    this.applyTheme();
    effect(() => {
      this.applyTheme();
    });
  }

  private getStoredTheme(): Theme {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme;
      if (THEMES.includes(stored)) return stored;
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        // Quien no ha elegido y tiene el sistema en oscuro entra por el
        // intermedio verdoso, no por el carbón: es el que menos cansa y sigue
        // siendo de la casa.
        return 'forest';
      }
    }
    return 'light';
  }

  private applyTheme(): void {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    // Se quitan todas y se pone la que toca: acumularlas dejaría dos paletas
    // pisándose según el orden del CSS.
    el.classList.remove('dark', 'theme-forest', 'theme-ocean');

    const theme = this._theme();
    // ⚠️ `dark` se mantiene en TODOS los oscuros, y no es histórico: es la
    // clase que ya usan decenas de reglas de componente y la que lleva el
    // `color-scheme: dark` del que dependen los desplegables y los calendarios
    // nativos. Las de `forest` y `ocean` solo redefinen las variables encima.
    if (DARK_THEMES.includes(theme)) el.classList.add('dark');
    if (theme === 'forest') el.classList.add('theme-forest');
    if (theme === 'ocean') el.classList.add('theme-ocean');
  }

  setTheme(theme: Theme): void {
    this._theme.set(theme);
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', theme);
    }
  }

  /**
   * Rota entre los cuatro, en orden de claro a oscuro.
   *
   * Se conserva porque el botón de la barra superior es un solo control y
   * pulsarlo tiene que hacer algo predecible. El selector completo está en
   * Ajustes, que es donde se elige de verdad.
   */
  toggleTheme(): void {
    const i = THEMES.indexOf(this._theme());
    this.setTheme(THEMES[(i + 1) % THEMES.length]);
  }
}
