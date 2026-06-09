import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@core/i18n/translate.service';

@Pipe({
  name: 'translate',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform {
  private translateService = inject(TranslateService);

  transform(key: string): string {
    // Access translations signal to make Angular reactive to language changes
    this.translateService['translations']();
    return this.translateService.translate(key);
  }
}