/**
 * El rótulo de una fila de cobro, en el lado del backend.
 *
 * ⚠️ **Es el gemelo de `src/app/shared/utils/payment-concept.util.ts`**,
 * duplicado por lo mismo que la aritmética del IVA: la app y las functions
 * compilan con tsconfigs separados y no pueden compartir módulo. Si cambia la
 * regla allí, cambia aquí.
 *
 * ⚠️ **Y vive en su propio fichero, no dentro de `invoices/receipt-pdf.ts`,
 * porque aquél importa `pdf-lib` en el arranque.** Lo necesita `redsys.ts`, que
 * está en el camino del cliente, y meterle la cadena de `pdf-lib` por traerse
 * una tabla de rótulos es justo lo que `arranque.spec.ts` existe para impedir.
 *
 * ## Por qué hace falta
 *
 * `concept` es texto del operador, pero el código lo usó como centinela de «no
 * escribió nada» y por ahí se coló el enumerado en crudo: la ficha de la
 * reserva mandaba el tipo cuando el campo iba vacío y `settlePendingPayment()`
 * lo tomaba por concepto tecleado. En producción se escribieron así **6 de las
 * 11 filas de cobro**, y ese `rental_payment` llegaba hasta tres sitios que ve
 * el CLIENTE: el recibo en PDF, la pantalla pública de pago y la descripción
 * de la operación que pinta la pasarela del banco.
 *
 * Hoy la aplicación siembra el tipo **a propósito** —es lo que permite que el
 * mismo cobro se lea en español, inglés o rumano según quién mire—, así que
 * esto no es un parche: es el lector que esa convención necesitaba.
 */

import type { ContractLocale } from './contracts/contract-types';

/**
 * Los rótulos, traducidos.
 *
 * ⚠️ **Tiene que llevar TODOS los valores de `PaymentType`, y el compilador no
 * lo comprueba**: la clave es `string` porque el enumerado vive en la app. Un
 * tipo que falte devuelve **cadena vacía**, o sea un recibo con el titular en
 * blanco. Lo cubre un test que los enumera.
 */
export const PAYMENT_TYPE_TEXT: Record<string, Record<ContractLocale, string>> = {
  initial_payment: { es: 'Señal de la reserva', en: 'Booking deposit', ro: 'Avans rezervare' },
  remaining_payment: { es: 'Resto del alquiler', en: 'Rental balance', ro: 'Rest închiriere' },
  rental_payment: { es: 'Alquiler', en: 'Rental', ro: 'Închiriere' },
  delivery_fee: {
    es: 'Entrega a domicilio',
    en: 'Delivery to address',
    ro: 'Livrare la domiciliu'
  },
  collection_fee: {
    es: 'Recogida a domicilio',
    en: 'Collection from address',
    ro: 'Ridicare de la domiciliu'
  },
  deposit: { es: 'Fianza', en: 'Security deposit', ro: 'Garanție' },
  deposit_refund: {
    es: 'Devolución de la fianza',
    en: 'Deposit refund',
    ro: 'Restituirea garanției'
  },
  deposit_retention: {
    es: 'Retención de la fianza',
    en: 'Deposit retention',
    ro: 'Reținerea garanției'
  },
  extra_fuel: { es: 'Combustible', en: 'Fuel', ro: 'Combustibil' },
  refuel_penalty: {
    es: 'Penalización por no repostar',
    en: 'Refuelling penalty',
    ro: 'Penalizare pentru nealimentare'
  },
  extra_cleaning: { es: 'Limpieza', en: 'Cleaning', ro: 'Curățenie' },
  extra_km: { es: 'Kilómetros extra', en: 'Extra mileage', ro: 'Kilometri suplimentari' },
  extra_damage: { es: 'Daños', en: 'Damage', ro: 'Daune' },
  extra_fine: { es: 'Multa', en: 'Fine', ro: 'Amendă' },
  extra_other: { es: 'Otros cargos', en: 'Other charges', ro: 'Alte costuri' },
  free_payment: { es: 'Cobro', en: 'Payment', ro: 'Încasare' }
};

/**
 * ¿Lo guardado en `concept` es un valor de `PaymentType` en crudo?
 *
 * ⚠️ **`hasOwnProperty` y no indexar a pelo**: `PAYMENT_TYPE_TEXT['constructor']`
 * es verdadero por el prototipo, y un concepto que se llamara así desaparecería
 * del documento.
 */
export function esTipoEnCrudo(concept: string | undefined | null): boolean {
  const limpio = concept?.trim();
  if (!limpio) return false;
  return Object.prototype.hasOwnProperty.call(PAYMENT_TYPE_TEXT, limpio);
}

/** El rótulo del tipo, en el idioma del documento. Vacío si no se conoce. */
export function paymentTypeText(value: string | undefined, loc: ContractLocale): string {
  const entry = value ? PAYMENT_TYPE_TEXT[value] : undefined;
  return entry ? entry[loc] : '';
}

/**
 * La clave i18n de un tipo, **derivada** del propio valor
 * (`initial_payment` → `payments.types.initialPayment`).
 *
 * ⚠️ **Derivada y no una tercera tabla, a propósito.** El mapa de verdad es
 * `PAYMENT_TYPE_LABELS` en la app, y copiarlo aquí sería un sitio más donde
 * quedarse viejo en silencio. Los dieciséis valores siguen la misma regla, y
 * hay un test que los enumera para que el día que uno no la siga se vea.
 */
export function paymentTypeI18nKey(type: string): string {
  const camel = type.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  return `payments.types.${camel}`;
}

interface ConceptoDe {
  type?: string;
  concept?: string;
}

/**
 * Lo que hay que mandarle al FRONTEND para que titule el cobro: una clave i18n
 * cuando lo escribió el sistema, y el texto libre cuando lo escribió una
 * persona.
 *
 * Quien lo pinta pasa el resultado por `translate()`, que devuelve tal cual lo
 * que no es clave — así «Rueda pinchada» sale intacto y el cliente inglés lee
 * «Booking deposit» donde el español lee «Señal de la reserva».
 */
export function paymentConceptI18nKey(payment: ConceptoDe | null | undefined): string {
  if (!payment) return '';
  const concepto = payment.concept?.trim();
  if (concepto && !esTipoEnCrudo(concepto)) return concepto;
  return payment.type ? paymentTypeI18nKey(payment.type) : '';
}

/**
 * Lo mismo, pero ya resuelto a TEXTO, para los destinos que no pueden recibir
 * una clave: la descripción que viaja a la pasarela del banco y el aviso de
 * Telegram.
 *
 * `respaldo` es lo que se dice cuando no se sabe nada del cobro — ahí no vale
 * dejarlo en blanco, porque es lo que el cliente lee en la pantalla del TPV.
 */
export function paymentConceptText(
  payment: ConceptoDe | null | undefined,
  loc: ContractLocale,
  respaldo: string
): string {
  if (!payment) return respaldo;
  const concepto = payment.concept?.trim();
  if (concepto && !esTipoEnCrudo(concepto)) return concepto;
  return paymentTypeText(payment.type, loc) || respaldo;
}
