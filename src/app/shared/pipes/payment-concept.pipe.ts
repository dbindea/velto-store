import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@core/i18n/translate.service';
import { Payment, PAYMENT_TYPE_LABELS } from '@shared/models/payment.model';

/**
 * Resolves the label shown for a payment row.
 *
 * `concept` is meant to be operator-written free text, but existing documents
 * store the raw payment type in it ("initial_payment", "remaining_payment"),
 * which templates rendered straight from Firestore — untranslated, in every
 * language. When `concept` only echoes the type, fall back to the translated
 * type label instead.
 *
 * Impure like TranslatePipe, so the label follows a language change.
 */
@Pipe({
  name: 'paymentConcept',
  standalone: true,
  pure: false
})
export class PaymentConceptPipe implements PipeTransform {
  private translateService = inject(TranslateService);

  transform(payment: Payment | null | undefined): string {
    if (!payment) return '';
    if (payment.concept && payment.concept !== payment.type) {
      /**
       * ⚠️ **El concepto pasa por el traductor SIEMPRE**, aunque sea texto
       * libre, y eso no es un rodeo: `translate()` devuelve la clave tal cual
       * cuando no la encuentra, así que «Señal reserva» sale «Señal reserva» y
       * `payments.types.remainingPayment` sale «Resto alquiler».
       *
       * Hace falta porque hay documentos con **la clave dentro**:
       * `buildRepricedRow()` guardaba `PAYMENT_TYPE_LABELS[type]` en vez del
       * tipo, así que cualquier fila recreada —subir la señal desde 0, cambiar
       * el precio— quedó titulada «payments.types.remainingPayment». Se
       * corrigió en origen, pero los documentos ya escritos siguen ahí y esto
       * los arregla al leerlos, sin migrar nada.
       */
      return this.translateService.translate(payment.concept);
    }
    const key = PAYMENT_TYPE_LABELS[payment.type];
    return key ? this.translateService.translate(key) : (payment.type ?? '');
  }
}
