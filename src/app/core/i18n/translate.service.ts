import { Injectable, signal, effect, computed } from '@angular/core';

export type Language = 'es' | 'ro' | 'en';

interface TranslationMap {
  [key: string]: string | TranslationMap;
}

@Injectable({
  providedIn: 'root'
})
export class TranslateService {
  private translations = signal<TranslationMap>({});
  private currentLang = signal<Language>(this.getStoredLanguage());
  private translationsCache: { [lang: string]: TranslationMap } = {};

  readonly language = this.currentLang.asReadonly();
  readonly languageLabel = computed(() => this.getLanguageLabel(this.currentLang()));
  readonly translationsReady = signal(false);

  constructor() {
    this.preloadTranslations();
  }

  private getStoredLanguage(): Language {
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

  private async preloadTranslations(): Promise<void> {
    const lang = this.currentLang();
    if (this.translationsCache[lang]) {
      this.translations.set(this.translationsCache[lang]);
      this.translationsReady.set(true);
      return;
    }

    try {
      const response = await fetch(`/assets/i18n/${lang}.json`);
      if (response.ok) {
        const data = await response.json();
        this.translationsCache[lang] = data;
        this.translations.set(data);
        this.translationsReady.set(true);
      }
    } catch (error) {
      console.error(`Error loading language ${lang}:`, error);
      this.translationsReady.set(true);
    }
  }

  async setLanguage(lang: Language): Promise<void> {
    this.currentLang.set(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('language', lang);
    }
    await this.preloadTranslations();
  }

  translate(key: string): string {
    const keys = key.split('.');
    let value: any = this.translations();

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
    return this.currentLang();
  }

  getAvailableLanguages(): { code: Language; label: string }[] {
    return [
      { code: 'es', label: 'Español' },
      { code: 'ro', label: 'Română' },
      { code: 'en', label: 'English' }
    ];
  }
}
