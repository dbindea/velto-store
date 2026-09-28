/**
 * Una solicitud de la web pública: «que me llamen».
 *
 * ⚠️ **NO es una reserva a medias: es otra cosa.** No tiene contrato, ni pagos,
 * ni fianza, ni inspecciones, y su ciclo —nueva, contactada, convertida o
 * descartada— no se parece al del alquiler. Por eso vive en su propia colección
 * y no como un estado más de `Reservation`.
 *
 * Y meterla ahí no habría sido solo incómodo: `blocksAvailability()` de la web
 * pública es una **lista invertida** —solo `returned`, `closed` y `cancelled`
 * dejan el coche libre, todo lo demás bloquea—, así que un estado nuevo habría
 * empezado a **bloquear el coche en la web** el mismo día, sin que nadie
 * escribiera una línea. Justo lo contrario de lo que esto tiene que hacer: el
 * coche sigue libre para quien llame, y lo que se garantiza es el precio.
 *
 * ⚠️ **La escribe SOLO la Cloud Function.** `firestore.rules` deniega `create`
 * desde cliente: si se pudiera, cualquiera con la clave del bundle —que viaja
 * en la web— se saltaría los topes de longitud, el campo trampa y el límite por
 * teléfono que la function aplica.
 */

/**
 * Dónde está la solicitud.
 *
 * ⚠️ **`new` es la única que no se borra sola.** El barrido diario solo alcanza
 * lo ya atendido: una solicitud sin tocar es trabajo pendiente, y perderla es
 * perder un alquiler. Ver `bookingRequestKeepHours` en los ajustes.
 */
export type BookingRequestStatus = 'new' | 'contacted' | 'converted' | 'discarded';

export const BOOKING_REQUEST_STATUS_LABELS: Record<BookingRequestStatus, string> = {
  new: 'bookingRequests.status.new',
  contacted: 'bookingRequests.status.contacted',
  converted: 'bookingRequests.status.converted',
  discarded: 'bookingRequests.status.discarded'
};

/**
 * ⚠️ **Las cuatro clases van declaradas bajo el selector que de verdad las
 * lleva.** Media tabla estilada no da error en ninguna parte, y el estado que
 * falta es siempre el que nadie mira hasta que aparece — pasó dos veces en la
 * ficha de la reserva.
 */
export const BOOKING_REQUEST_STATUS_COLORS: Record<BookingRequestStatus, string> = {
  new: 'status-new',
  contacted: 'status-contacted',
  converted: 'status-converted',
  discarded: 'status-discarded'
};

/** Lo que el cliente vio, congelado. */
export interface BookingRequestQuote {
  totalDays: number;
  net: number;
  gross: number;
  /** Fracción (`0.21`), como `pricingSnapshot.vatRate`. */
  vatRate: number;
  currency: string;
}

export interface BookingRequestVehicle {
  brand: string;
  model: string;
  category: string;
}

export interface BookingRequest {
  id?: string;

  /** `P-4K7M9X`. Se dicta por teléfono; ver el alfabeto en la function. */
  reference: string;
  status: BookingRequestStatus;
  createdAt?: any;

  name: string;
  /** Solo dígitos con prefijo y sin `+`: lo que `wa.me` necesita. */
  phone: string;
  note: string;

  vehicleId: string;
  /**
   * ⚠️ **El coche que vio, no el que exista al mirarlo.** El catálogo cambia y
   * un coche se puede despublicar; lo que el operador cita al llamar es lo que
   * el cliente eligió. Misma razón que `clientSnapshot` en la reserva.
   */
  vehicleSnapshot: BookingRequestVehicle;

  /**
   * ⚠️ **El precio que se le enseñó, congelado.** El operador va a llamar
   * citando esa cifra y las tarifas del coche pueden cambiar mañana. Misma
   * razón que `pricingSnapshot`.
   */
  quoteSnapshot: BookingRequestQuote;

  pickupDate?: any;
  returnDate?: any;

  /**
   * Hasta cuándo se mantiene el precio.
   *
   * ⚠️ **Se congeló al crearla, no se lee de Ajustes.** Cambiar el plazo no
   * puede mover la caducidad de lo ya prometido — igual que el IVA de una
   * reserva ya creada.
   */
  priceGuaranteedUntil?: any;

  /** El plazo de borrado, también congelado. */
  keepHours: number;

  // --- Lo que escribe el operador -----------------------------------------
  handledAt?: any;
  handledBy?: string;
  /** Lo que se habló. No es la nota del cliente: esa es `note`. */
  internalNote?: string;
  /** La reserva que salió de aquí, si se convirtió. */
  reservationId?: string;
}
