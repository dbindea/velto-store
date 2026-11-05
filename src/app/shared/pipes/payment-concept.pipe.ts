import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@core/i18n/translate.service';
import { Payment } from '@shared/models/payment.model';
import { paymentConceptKey } from '@shared/utils/payment-concept.util';

/**
 * Resolves the label shown for a payment row.
 *
 * ⚠️ **El concepto pasa por el traductor SIEMPRE**, aunque sea texto libre, y
 * eso no es un rodeo: `translate()` devuelve la clave tal cual cuando no la
 * encuentra, así que «Rueda pinchada» sale intacto y
 * `payments.types.remainingPayment` sale «Resto alquiler». Hace falta porque
 * hay documentos con **la clave dentro**: `buildRepricedRow()` guardaba
 * `PAYMENT_TYPE_LABELS[type]` en vez del tipo. Se corrigió en origen, y esto
 * arregla los ya escritos al leerlos, sin migrar nada.
 *
 * ⚠️ **Quién decide el rótulo es `paymentConceptKey()`, no este pipe**, porque
 * la misma pregunta la hacen la ficha de la reserva (`paymentTypeIfUseful()`)
 * y el recibo en PDF. Con la decisión aquí dentro, el pipe se arreglaba y el
 * papel que se le da al cliente seguía imprimiendo el enumerado.
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
    const key = paymentConceptKey(payment);
    return key ? this.translateService.translate(key) : '';
  }
}
