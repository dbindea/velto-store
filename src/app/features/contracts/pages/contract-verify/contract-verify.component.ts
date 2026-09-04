import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { BrandLogoComponent } from '@shared/components/brand-logo/brand-logo.component';

interface VerificationView {
  state: 'valid' | 'cancelled' | 'unknown';
  contractNumber?: string;
  signedAt?: string;
  vehiclePlate?: string;
  fingerprint?: string;
  digitallySealed?: boolean;
  brandName: string;
}

/**
 * Página pública de verificación de un contrato (N-9).
 *
 * La abre quien escanea el QR impreso en la casilla del arrendador, o quien
 * teclea el código a mano desde un papel. Es pública a propósito y va **antes**
 * del bloque con `authGuard`: pedirle sesión a quien quiere comprobar un
 * contrato es pedirle que no lo compruebe.
 *
 * ⚠️ **Qué resuelve y qué no, y los textos no deben confundirlo.** Confirma que
 * el contrato existe, que está firmado y —comparando la huella— que el fichero
 * que alguien tiene es el que emitimos. **No valida la firma electrónica**: eso
 * lo hace Adobe Reader o VALIDe abriendo el PDF. Prometer lo segundo sería
 * repetir el error de la frase que afirmaba una firma digital que no existía.
 *
 * ⚠️ **Aquí no aparece ni un dato personal.** Ni el nombre del cliente, ni su
 * documento, ni el importe: un contrato olvidado en un mostrador no puede
 * convertirse en la ficha de nadie. La function pública devuelve solo los cinco
 * datos que se pintan abajo.
 */
@Component({
  selector: 'app-contract-verify',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, BrandLogoComponent],
  templateUrl: './contract-verify.component.html',
  styleUrl: './contract-verify.component.scss'
})
export class ContractVerifyComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);

  readonly loading = signal(false);
  readonly view = signal<VerificationView | null>(null);
  /** Lo que hay escrito en el campo, cuando se teclea el código a mano. */
  readonly typedCode = signal('');

  ngOnInit(): void {
    const code = this.route.snapshot.paramMap.get('code') || '';
    if (code) {
      this.typedCode.set(code);
      void this.check(code);
    }
  }

  /** Comprueba lo tecleado, llevándolo también a la URL para poder compartirla. */
  submit(): void {
    const code = this.typedCode().trim();
    if (!code) return;
    void this.router.navigate(['/v', code]);
    void this.check(code);
  }

  private async check(code: string): Promise<void> {
    this.loading.set(true);
    try {
      const fn = httpsCallable<{ code: string }, VerificationView>(
        this.functions,
        'getContractVerification'
      );
      const result = await fn({ code });
      this.view.set(result.data);
    } catch {
      // Un fallo de red y un código inexistente se cuentan igual: desde fuera
      // nadie debería poder distinguir qué códigos son reales.
      this.view.set({ state: 'unknown', brandName: '' });
    } finally {
      this.loading.set(false);
    }
  }
}
