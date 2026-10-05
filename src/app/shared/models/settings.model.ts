/**
 * Ajustes de la operación.
 *
 * Un único documento, `settings/operation`. No es una colección de opciones
 * sueltas: son los valores por defecto con los que nacen las cosas, y tenerlos
 * juntos permite leerlos de una sola vez tanto desde la aplicación como desde
 * las Cloud Functions.
 *
 * ⚠️ **Son valores POR DEFECTO, no reglas que se apliquen hacia atrás.** El tipo
 * de IVA se congela en cada reserva, el precio se congela en su snapshot y la
 * caducidad del enlace de firma queda escrita en el propio token. Cambiar algo
 * aquí afecta a lo que se cree a partir de ahora y **nunca** a lo que ya existe:
 * un contrato firmado no puede moverse porque alguien toque una pantalla de
 * ajustes.
 *
 * ⚠️ **Si el documento no existe, mandan las constantes del código.** Eso no es
 * un parche de compatibilidad —los que este proyecto prohíbe— sino el estado
 * inicial: hasta que alguien guarde por primera vez, la aplicación se comporta
 * exactamente como se comportaba antes de que existieran los ajustes.
 */

export interface OperationSettings {
  /**
   * Fianza que propone el asistente al crear una reserva, en euros.
   *
   * Sigue siendo **editable en cada reserva**, y 0 sigue siendo una respuesta
   * legítima con motivo obligatorio. Esto solo decide con qué número se abre el
   * formulario.
   */
  defaultDepositAmount: number;

  /** Días que el presupuesto se anuncia como válido. Se imprime en el PDF. */
  quoteValidityDays: number;

  /** Días que dura el enlace de firma del contrato antes de caducar. */
  signingLinkExpiryDays: number;

  /**
   * Tipo de IVA general, como **fracción** (0.21 = 21 %).
   *
   * ⚠️ Ojo con la convención: aquí fracción, como en `pricingSnapshot.vatRate`.
   * El descuento de fidelidad, en cambio, es un porcentaje (5 = 5 %).
   */
  vatRate: number;

  /** Kilómetros incluidos por día que se proponen al dar de alta un vehículo. */
  defaultIncludedKmPerDay: number;

  /**
   * Cuántas horas se mantiene el precio de una solicitud de la web.
   *
   * ⚠️ **Lo que se garantiza es el PRECIO, no el coche.** Apartar un vehículo
   * sin pago ni identidad deja la flota bloqueable por cualquiera: con cinco
   * coches, una persona la aparta entera en dos minutos. Mantener una cifra no
   * quita inventario y sigue siendo una promesa que se puede cumplir.
   */
  bookingRequestPriceHours: number;

  /**
   * Cuántas horas se conserva una solicitud **ya atendida** antes de borrarla.
   *
   * ⚠️ **Solo se borra lo atendido.** Una solicitud sin tocar no se borra nunca:
   * es trabajo pendiente, y perderla es perder un alquiler. Borrando por
   * antigüedad a secas, una que entrara un viernes a las 23:40 desaparecería el
   * sábado a la misma hora sin dejar rastro, y no habría forma de distinguir
   * «no escribió nadie» de «se me pasaron tres».
   */
  bookingRequestKeepHours: number;

  updatedAt?: any;
  updatedBy?: string;
}

/**
 * Lo que rige mientras nadie haya guardado ajustes.
 *
 * Son exactamente los valores que el código traía escritos antes de que existiera
 * esta pantalla, para que estrenarla no cambie nada por sí sola.
 */
export const DEFAULT_OPERATION_SETTINGS: OperationSettings = {
  // Los mismos que `APP_DEFAULTS` y `DEFAULT_VAT_RATE` traían escritos.
  defaultDepositAmount: 150,
  quoteValidityDays: 7,
  signingLinkExpiryDays: 7,
  vatRate: 0.21,
  defaultIncludedKmPerDay: 500,
  // ⚠️ Los mismos que `functions/src/settings.ts`, que es la otra copia: la app
  // y las functions no pueden compartir módulo. Si cambian, cambian en los dos.
  bookingRequestPriceHours: 24,
  bookingRequestKeepHours: 24
};

/** El documento único donde viven. */
export const OPERATION_SETTINGS_PATH = 'settings/operation';
