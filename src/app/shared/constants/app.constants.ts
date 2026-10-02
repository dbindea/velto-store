/**
 * App-wide default values.
 * 
 * Modify these values to change defaults across the entire app
 * (vehicle creation form, reservation creation, service defaults, etc.)
 */

export const APP_DEFAULTS = {
  /** Default deposit amount (fianza) in EUR for new vehicles. */
  DEFAULT_DEPOSIT_AMOUNT: 150,

  /** Default km included per day for new vehicles. */
  DEFAULT_INCLUDED_KM_PER_DAY: 500,

  /** Default price per extra km in EUR. */
  DEFAULT_EXTRA_KM_PRICE: 0.25,

  /** Default minimum rental days for new vehicles. */
  DEFAULT_MINIMUM_RENTAL_DAYS: 1,

  /** Default initial payment (señal) in EUR for new reservations. */
  DEFAULT_INITIAL_PAYMENT: 50,

  /**
   * La señal de un alquiler barato.
   *
   * ⚠️ **Dos cifras y ningún porcentaje, y es deliberado.** Lo fijó Dorel el 2
   * de octubre de 2026 con sus palabras: «50 €, y si el alquiler es menos de
   * 50 € entonces 25 €; para no complicarme con porcentajes ni cálculos
   * complejos». Una señal que se dice en una frase es una señal que el
   * operador puede repetir por teléfono sin mirar la pantalla.
   *
   * ⚠️ **Y arregla algo que estaba mal.** La regla anterior era
   * `min(50, precio)`: un alquiler de 40 € pedía **40 € de señal**, o sea el
   * alquiler entero por adelantado. Eso no es una señal, es cobrar la reserva
   * — y dejaba el «resto» a cero en un alquiler que aún no había empezado.
   */
  REDUCED_INITIAL_PAYMENT: 25,

  /**
   * Lugar con el que nacen la recogida y la devolución de una reserva.
   *
   * Casi todos los alquileres salen y vuelven a la oficina, así que el campo se
   * abre escrito y el operador solo lo toca cuando no es así. Decisión de Dorel
   * del 23 de septiembre de 2026.
   *
   * ⚠️ **No lleva el verbo delante —«Recogida en…»— a propósito.** Los tres
   * documentos ya imprimen su etiqueta («Lugar de entrega:», «Lugar de
   * devolución:») y **la misma cadena se usa en los dos campos**, así que
   * cualquier verbo metido dentro sobraría en uno de los dos: el contrato
   * habría salido diciendo «Lugar de devolución: Recogida en Oficinas Velto».
   *
   * ⚠️ **No se traduce, y no debe traducirse.** Es un dato que se guarda en la
   * reserva y se congela en `contract.reservationSnapshot`, no texto de
   * interfaz: el idioma del PDF se decide al generarlo, así que una reserva
   * creada por un operador rumano sacaría el lugar en rumano dentro de un
   * contrato en español. Lo que se traduce es la etiqueta. Misma regla que
   * «lo que se SUBE no se traduce» de `storage-name.util.ts`.
   *
   * ⚠️ **Y pasa por `capitalizeWords()` en la primera pulsación**, que baja a
   * minúscula las preposiciones internas. Esta cadena sobrevive intacta; una
   * variante con «de» o «del» dentro saldría en minúscula **impresa en el
   * contrato**. Compruébalo antes de cambiarla.
   */
  DEFAULT_RENTAL_LOCATION: 'Oficinas Velto - Arganda',

  /** Default number of days before pickup when remaining payment is due. */
  REMAINING_PAYMENT_DUE_DAYS_BEFORE_PICKUP: 7,

  /** Maximum file size for client documents (in bytes). */
  MAX_DOCUMENT_FILE_SIZE: 5 * 1024 * 1024,

  /** Allowed mime types for client documents. */
  ALLOWED_DOCUMENT_TYPES: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/pdf'
  ] as const
};
