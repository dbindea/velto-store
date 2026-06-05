import { Pipe, PipeTransform, inject, effect } from '@angular/core';
import { TranslateService } from '@core/i18n/translate.service';

@Pipe({
  name: 'translate',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform {
  private translateService = inject(TranslateService);
  private lastKey = '';
  private lastValue = '';
  private currentLang = '';

  constructor() {
    effect(() => {
      const lang = this.translateService.language();
      if (lang !== this.currentLang) {
        this.currentLang = lang;
        if (this.lastKey) {
          this.lastValue = this.translateService.translate(this.lastKey);
        }
      }
    });
  }

  transform(key: string): string {
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.lastValue = this.translateService.translate(key);
    }
    return this.lastValue;
  }
}
