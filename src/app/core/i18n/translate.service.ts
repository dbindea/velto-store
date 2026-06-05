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

  translate(key: string): string {
    const trans = this.translations();
    const keys = key.split('.');
    let value: any = trans;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return key;
      }
    }

    return typeof value === 'string' ? value : key;
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
