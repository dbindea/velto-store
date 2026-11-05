import { describe, expect, it } from 'vitest';
import { driversForPdf, reservationForPdf, vehicleForPdf } from './contract-snapshot';

/**
 * El contrato se dibuja DOS veces —al generarlo y al firmarlo— y durante meses
 * las dos entradas se escribieron a mano por separado. El documento **firmado**,
 * que es el que tiene valor, salía con menos datos que el generado.
 *
 * Lo que estos tests vigilan no es cada campo: es que **no se pueda volver a
 * perder uno**. Si alguien añade algo al snapshot del contrato y no lo mapea,
 * la comparación de claves falla.
 */

/** Un contrato guardado con TODO lo que hoy se congela dentro. */
const vehiculoGuardado = {
  brand: 'Ford',
  model: 'Custom',
  version: ' 2.0 Tdci Ecoblue',
  plateNumber: '4907LSJ',
  acrissCode: 'VVMD',
  year: 2021,
  fuelType: 'diesel',
  transmission: 'manual',
  hasGpsTracker: true,
  insurerName: 'Mapfre',
  insurancePolicy: '2002600498481',
  roadsideAssistancePhone: '+34 918 365 365'
};

const reservaGuardada = {
  pickupDateTime: { seconds: 1762250400 },
  returnDateTime: { seconds: 1762855200 },
  totalDays: 7,
  pickupLocation: 'Arganda Del Rey — Vereda Del Melero, 3',
  returnLocation: 'Aeropuerto Adolfo Suárez Madrid-Barajas, T4',
  finalPrice: 500,
  depositAmount: 150,
  tariffPrice: 520,
  loyaltyDiscountPercent: 5,
  loyaltyDiscount: -26,
  manualAdjustment: 0,
  netPrice: 413.22,
  vatRate: 0.21,
  deliveryPickupFee: 15,
  deliveryReturnFee: 20,
  includedKmPerDay: 200,
  extraKmPrice: 0.25
};

describe('lo que del contrato guardado llega al PDF', () => {
  /**
   * ⚠️ **Este es el test que importa.** Compara las claves, no los valores: un
   * campo nuevo en el snapshot que nadie mapee hace fallar aquí en vez de
   * desaparecer en silencio del contrato que firma el cliente.
   */
  it('el vehículo no pierde NI UN campo por el camino', () => {
    expect(Object.keys(vehicleForPdf(vehiculoGuardado)).sort()).toEqual(
      Object.keys(vehiculoGuardado).sort()
    );
  });

  it('la reserva tampoco', () => {
    expect(Object.keys(reservationForPdf(reservaGuardada)).sort()).toEqual(
      Object.keys(reservaGuardada).sort()
    );
  });

  /**
   * ⚠️ El caso de PRODUCCIÓN, contrato C-0SBXUX-2026 del 4 de noviembre de
   * 2026: el Ford Custom salía firmado sin aseguradora, sin póliza y sin
   * teléfono de asistencia, mientras la cláusula de accidentes dice que
   * «constan en la sección Datos del vehículo».
   */
  it('el seguro del coche llega entero', () => {
    const v = vehicleForPdf(vehiculoGuardado);
    expect(v.insurerName).toBe('Mapfre');
    expect(v.insurancePolicy).toBe('2002600498481');
    expect(v.roadsideAssistancePhone).toBe('+34 918 365 365');
  });

  it('y lo demás que el firmado se dejaba', () => {
    const v = vehicleForPdf(vehiculoGuardado);
    // Combustible y transmisión: se imprimen traducidos desde el código.
    expect(v.fuelType).toBe('diesel');
    expect(v.transmission).toBe('manual');
    // El aviso de localización es una obligación de información, no un adorno.
    expect(v.hasGpsTracker).toBe(true);

    const r = reservationForPdf(reservaGuardada);
    // Un cargo que el contrato firmado no menciona es un cargo que el cliente
    // discute con razón.
    expect(r.deliveryPickupFee).toBe(15);
    expect(r.deliveryReturnFee).toBe(20);
    // Sin el kilometraje impreso no se puede cobrar el kilómetro de más.
    expect(r.includedKmPerDay).toBe(200);
    expect(r.extraKmPrice).toBe(0.25);
  });

  it('las fechas valen igual vengan de Firestore o de memoria', () => {
    const deFirestore = reservationForPdf({ pickupDateTime: { seconds: 1762250400 } });
    const deMemoria = reservationForPdf({ pickupDateTime: new Date(1762250400 * 1000) });
    expect(deFirestore.pickupDateTime).toEqual(deMemoria.pickupDateTime);
    expect(deFirestore.pickupDateTime instanceof Date).toBe(true);

    // Y un `Timestamp` del SDK, que trae su propio `toDate()`.
    const delSdk = reservationForPdf({
      pickupDateTime: { toDate: () => new Date(1762250400 * 1000) }
    });
    expect(delSdk.pickupDateTime).toEqual(deMemoria.pickupDateTime);
  });

  it('un contrato sin snapshot no revienta: sale vacío', () => {
    expect(vehicleForPdf(undefined).brand).toBe('');
    expect(vehicleForPdf(undefined).plateNumber).toBe('');
    expect(vehicleForPdf({}).insurancePolicy).toBeUndefined();
    expect(reservationForPdf(undefined).pickupDateTime).toBeUndefined();
  });

  /**
   * ⚠️ La cláusula 2 solo autoriza a conducir a quien esté «expresamente
   * declarado… identificado nominalmente». El PDF generado los imprimía y el
   * firmado no: un contrato que contradice su propio articulado.
   */
  it('los conductores autorizados viajan al PDF firmado', () => {
    const cuadrilla = [
      { fullName: 'Ana López', documentNumber: '12345678Z' },
      { fullName: 'Marius Ionescu', documentNumber: 'X1234567L' }
    ];
    expect(driversForPdf(cuadrilla)).toEqual(cuadrilla);
  });

  it('sin conductores no se pinta la sección', () => {
    // `undefined` y no `[]`: el PDF no debe sacar el rótulo de una sección sin
    // filas, y con `[]` lo sacaría.
    expect(driversForPdf([])).toBeUndefined();
    expect(driversForPdf(undefined)).toBeUndefined();
    expect(driversForPdf(null)).toBeUndefined();
    expect(driversForPdf('dos')).toBeUndefined();
  });
});
