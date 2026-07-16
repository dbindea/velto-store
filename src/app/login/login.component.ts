import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '@core/auth/auth.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { LanguageSelectorComponent } from '@shared/components/language-selector/language-selector.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, TranslatePipe, LanguageSelectorComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  authService = inject(AuthService);

  async loginWithGoogle() {
    await this.authService.loginWithGoogle();
  }

  /**
   * Fallback chain for the brand mark.  The login page only shows
   * the isologo; if that fails we hide the image and let the
   * <h1> title underneath it act as the brand mark.
   */
  onLogoError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (!img || img.dataset['fallback'] === '1') {
      img.style.display = 'none';
      return;
    }
    img.dataset['fallback'] = '1';
    img.src = 'assets/brand/logo.svg';
  }
}
