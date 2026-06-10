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
