/**
 * Lo que de un contrato guardado llega al PDF.
 *
 * ## Por qué existe
 *
 * ⚠️ **El contrato se dibuja DOS veces y las dos entradas se escribían a mano
 * por separado**, así que divergieron: `generateContractPdf` le pasaba al
 * constructor todo lo que había congelado, y `signContract` —que **rehace** el
 * PDF para incrustar la firma— copiaba a mano cinco campos del vehículo y se
 * dejaba el resto. El documento que se genera salía completo y el que **se
 * firma**, que es el que tiene valor, salía sin:
 *
 * - la **aseguradora, la póliza y el teléfono de asistencia** — y la cláusula
 *   de accidentes dice literalmente que «constan en la sección Datos del
 *   vehículo». Lo vio Dorel el 5 de noviembre de 2026 en un contrato real de
 *   producción;
 * - el **combustible** y la **transmisión**;
 * - el aviso de **localizador GPS**, que es una obligación de información;
 * - la **entrega y la recogida a domicilio**, que el propio comentario del
 *   snapshot dice que se congelan «para que re-renderizar el PDF al firmar
 *   reproduzca exactamente el mismo desglose»;
 * - el **kilometraje pactado**, sin el cual no se puede cobrar el extra;
 * - y los **conductores adicionales**, que la cláusula 2 exige identificar
 *   nominalmente — o sea un contrato firmado que contradice su propio
 *   articulado.
 *
 * ## Qué lo impide ahora
 *
 * ⚠️ **Los dos caminos pasan por aquí**, así que no hay dos listas que puedan
 * discrepar: lo que no esté mapeado no se imprime en **ninguno** de los dos, y
 * eso se ve al momento. Parchear la lista de `signContract` habría arreglado
 * los siete campos de hoy y dejado el mecanismo intacto para el octavo.
 *
 * ⚠️ **Y lo que se imprime sale del snapshot CONGELADO, no de la ficha viva.**
 * El seguro es la única excepción y se resuelve antes: `generateContractPdf` lo
 * lee del coche al generar —la póliza que vale es la vigente el día de la
 * firma— y lo guarda en el snapshot. Al firmar ya no se vuelve a buscar: el
 * documento tiene que decir lo mismo que el cliente leyó al aceptar.
 */

function aFecha(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return undefined;
}

/**
 * El vehículo del contrato, entero.
 *
 * ⚠️ **Enumera los campos uno a uno y no hace `{ ...snapshot }`**, por lo mismo
 * que `public/mapper.ts`: un objeto expandido metería en el PDF cualquier cosa
 * que alguien añada al snapshot sin pensarlo. Lo que sí hay es un test que
 * compara las claves con las de un snapshot completo, así que un campo nuevo
 * **obliga** a pasar por aquí en vez de olvidarse.
 */
export function vehicleForPdf(snapshot: any): {
  brand: string;
  model: string;
  version?: string;
  plateNumber: string;
  acrissCode?: string;
  year?: number;
  fuelType?: string;
  transmission?: string;
  hasGpsTracker?: boolean;
  insurerName?: string;
  insurancePolicy?: string;
  roadsideAssistancePhone?: string;
} {
  const s = snapshot || {};
  return {
    brand: s.brand || '',
    model: s.model || '',
    version: s.version,
    plateNumber: s.plateNumber || '',
    acrissCode: s.acrissCode,
    year: s.year,
    fuelType: s.fuelType,
    transmission: s.transmission,
    hasGpsTracker: s.hasGpsTracker,
    insurerName: s.insurerName,
    insurancePolicy: s.insurancePolicy,
    roadsideAssistancePhone: s.roadsideAssistancePhone
  };
}

/**
 * La reserva del contrato, entera, con las fechas ya resueltas.
 *
 * Las guardadas son `Timestamp` de Firestore y las de la generación son `Date`;
 * `aFecha()` cubre las dos, que es lo que permite que el mismo mapeo sirva al
 * generar y al firmar.
 */
export function reservationForPdf(snapshot: any): {
  pickupDateTime?: Date;
  returnDateTime?: Date;
  totalDays?: number;
  pickupLocation?: string;
  returnLocation?: string;
  finalPrice?: number;
  depositAmount?: number;
  tariffPrice?: number;
  loyaltyDiscountPercent?: number;
  loyaltyDiscount?: number;
  manualAdjustment?: number;
  netPrice?: number;
  vatRate?: number;
  deliveryPickupFee?: number;
  deliveryReturnFee?: number;
  includedKmPerDay?: number;
  extraKmPrice?: number;
} {
  const s = snapshot || {};
  return {
    pickupDateTime: aFecha(s.pickupDateTime),
    returnDateTime: aFecha(s.returnDateTime),
    totalDays: s.totalDays,
    pickupLocation: s.pickupLocation,
    returnLocation: s.returnLocation,
    finalPrice: s.finalPrice,
    depositAmount: s.depositAmount,
    tariffPrice: s.tariffPrice,
    loyaltyDiscountPercent: s.loyaltyDiscountPercent,
    loyaltyDiscount: s.loyaltyDiscount,
    manualAdjustment: s.manualAdjustment,
    netPrice: s.netPrice,
    vatRate: s.vatRate,
    deliveryPickupFee: s.deliveryPickupFee,
    deliveryReturnFee: s.deliveryReturnFee,
    includedKmPerDay: s.includedKmPerDay,
    extraKmPrice: s.extraKmPrice
  };
}

/**
 * Los conductores autorizados además del arrendatario.
 *
 * ⚠️ **Sin ellos el contrato firmado contradice su cláusula 2**, que solo
 * autoriza a conducir a las personas «expresamente declaradas… identificadas
 * nominalmente». El PDF generado los imprimía y el firmado no, que es
 * exactamente al revés de donde importa.
 *
 * Devuelve `undefined` con la lista vacía: el PDF no debe pintar el rótulo de
 * una sección que no tiene filas.
 */
export function driversForPdf(value: any): any[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value;
}
