import { Injectable, signal, computed } from '@angular/core';

export type Language = 'es' | 'ro' | 'en';

interface TranslationMap {
  [key: string]: string | TranslationMap;
}

@Injectable({
  providedIn: 'root'
})
export class TranslateService {
  private translations = signal<TranslationMap>({});
  private translationsCache: Record<string, TranslationMap> = {};

  readonly language = signal<Language>(this.getInitialLanguage());
  readonly languageLabel = computed(() => this.getLanguageLabel(this.language()));

  constructor() {
    this.preloadTranslations();
  }

  private getInitialLanguage(): Language {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('language') as Language;
      if (stored && ['es', 'ro', 'en'].includes(stored)) {
        return stored;
      }
    }
    return 'es';
  }

  private getLanguageLabel(lang: Language): string {
    const labels: Record<Language, string> = {
      es: 'Español',
      ro: 'Română',
      en: 'English'
    };
    return labels[lang];
  }

  private preloadTranslations(): void {
    const lang = this.language();
    // Load synchronously using XMLHttpRequest to ensure translations are available immediately
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/assets/i18n/${lang}.json`, false); // false = synchronous
    xhr.send(null);

    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        this.translationsCache[lang] = data;
        this.translations.set(data);
      } catch (e) {
        console.error('Error parsing translations:', e);
      }
    } else {
      console.error('Error loading translations:', xhr.status);
    }
  }

  async setLanguage(lang: Language): Promise<void> {
    this.language.set(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('language', lang);
    }

    // Load async for subsequent changes
    if (this.translationsCache[lang]) {
      this.translations.set(this.translationsCache[lang]);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/assets/i18n/${lang}.json`, false);
    xhr.send(null);

    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        this.translationsCache[lang] = data;
        this.translations.set(data);
      } catch (e) {
        console.error('Error parsing translations:', e);
      }
    }
  }

  /**
   * Resolve an i18n key. Unknown keys come back as themselves, which is ugly
   * on screen but visible — and visible is the point.
   *
   * ⚠️ **A missing key must never throw.** The label maps in `shared/models`
   * are `Record<Enum, string>`, so a value that is not in the enum — a field
   * saved before an option was renamed, or anything that reached Firestore by
   * another route — indexes to `undefined`. This used to call `.split()` on it
   * and take down the whole list with an unhandled error: one bad vehicle and
   * the fleet screen rendered nothing.
   */
  translate(key: string | null | undefined): string {
    if (typeof key !== 'string' || !key) return '';

    const own = this.lookup(this.translations(), key);
    if (own !== null) return own;

    // Respaldo al español antes de rendirse.
    //
    // Sin esto, una clave que falte en `ro.json` se le pinta **en crudo** al
    // usuario rumano aunque el español exista: ve `payments.status.cancelled`
    // donde debería leer una palabra. Hoy la paridad está al 100 % y el
    // auditor la vigila, así que esto no debería activarse nunca — pero el día
    // que se escape una, es mejor que el rumano lea español a que lea una
    // clave.
    if (this.language() !== 'es') {
      const spanish = this.translationsCache['es'] ?? this.loadLanguageSync('es');
      const fallback = spanish ? this.lookup(spanish, key) : null;
      if (fallback !== null) return fallback;
    }

    return key;
  }

  /** Recorre la clave con puntos. `null` si no lleva a una cadena. */
  private lookup(translations: TranslationMap, key: string): string | null {
    let value: any = translations;
    for (const k of key.split('.')) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return null;
      }
    }
    return typeof value === 'string' ? value : null;
  }

  /** Carga un idioma y lo cachea. Devuelve `null` si no se pudo. */
  private loadLanguageSync(lang: Language): TranslationMap | null {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `/assets/i18n/${lang}.json`, false);
      xhr.send(null);
      if (xhr.status !== 200) return null;
      const data = JSON.parse(xhr.responseText);
      this.translationsCache[lang] = data;
      return data;
    } catch {
      return null;
    }
  }

  getCurrentLanguage(): Language {
    return this.language();
  }

  getAvailableLanguages(): { code: Language; label: string }[] {
    return [
      { code: 'es', label: 'Español' },
      { code: 'ro', label: 'Română' },
      { code: 'en', label: 'English' }
    ];
  }
}
