import { describe, expect, it } from 'vitest';
import { conceptAddsDetail, methodLabel, paymentTypeLabel } from './receipt-pdf';

/**
 * Lo que decide si el recibo se repite a sí mismo.
 *
 * Salió mirando el PDF, no leyendo código: el recibo más normal de todos —una
 * señal cobrada— imprimía «Señal de la reserva» y debajo «Señal reserva», que
 * es el concepto que la propia aplicación siembra en la fila de pago.
 */
describe('cuándo el concepto del operador añade algo', () => {
  it('los tres conceptos que siembra la aplicación no añaden nada', () => {
    expect(conceptAddsDetail('Señal reserva', 'Señal de la reserva')).toBe(false);
    expect(conceptAddsDetail('Resto alquiler', 'Resto del alquiler')).toBe(false);
    expect(conceptAddsDetail('Fianza', 'Fianza')).toBe(false);
  });

  it('un concepto escrito a mano sí se imprime', () => {
    expect(
      conceptAddsDetail('Fianza del alquiler, entregada en la oficina de Arganda', 'Fianza')
    ).toBe(true);
    expect(conceptAddsDetail('Limpieza del coche de empresa', 'Cobro')).toBe(true);
  });

  it('las tildes no cuentan: «señal» y «senal» son la misma palabra', () => {
    expect(conceptAddsDetail('Senal reserva', 'Señal de la reserva')).toBe(false);
  });

  /**
   * ⚠️ El caso que se vio en el PDF rumano: el titular sale traducido pero el
   * concepto que siembra la aplicación está en español, así que comparándolo
   * solo contra el rumano «aportaba» y el recibo imprimía «Avans rezervare» con
   * «Señal reserva» debajo — media línea en el idioma equivocado.
   */
  it('el concepto sembrado en español tampoco aporta en un recibo rumano', () => {
    const titulares = ['Señal de la reserva', 'Booking deposit', 'Avans rezervare'];
    expect(conceptAddsDetail('Señal reserva', titulares)).toBe(false);
    // Y lo que de verdad añade información sigue imprimiéndose.
    expect(conceptAddsDetail('Señal entregada en mano por su hermano', titulares)).toBe(true);
  });

  it('un concepto vacío no aporta nada', () => {
    expect(conceptAddsDetail('', 'Fianza')).toBe(false);
    expect(conceptAddsDetail('   ', 'Fianza')).toBe(false);
  });

  /**
   * ⚠️ El caso que se vio en PRODUCCIÓN, y el que la comparación por palabras
   * NO puede cazar: `rental_payment` no comparte una sola palabra con «Señal de
   * la reserva», así que «aportaba» y el recibo del cliente imprimía el
   * identificador de código en gris debajo del titular.
   *
   * Pasó porque la ficha de la reserva mandaba el enumerado como concepto
   * cuando el operador dejaba el campo vacío, y `settlePendingPayment()` lo
   * tomaba por texto tecleado. Quedaron así 6 de las 11 filas de cobro de
   * producción, todas con recibo emitible.
   */
  it('un concepto que es un ENUMERADO no se imprime nunca', () => {
    const titulares = ['Señal de la reserva', 'Booking deposit', 'Avans rezervare'];
    expect(conceptAddsDetail('rental_payment', titulares)).toBe(false);
    expect(conceptAddsDetail('  rental_payment  ', titulares)).toBe(false);
    expect(conceptAddsDetail('initial_payment', 'Señal de la reserva')).toBe(false);
    expect(conceptAddsDetail('remaining_payment', 'Resto del alquiler')).toBe(false);
    // Los dos que siembra la aplicación con el tipo dentro a propósito.
    expect(conceptAddsDetail('delivery_fee', 'Entrega a domicilio')).toBe(false);
    expect(conceptAddsDetail('collection_fee', 'Recogida a domicilio')).toBe(false);
    expect(conceptAddsDetail('deposit', 'Fianza')).toBe(false);
  });

  it('y el control: lo que SÍ es texto del operador sigue imprimiéndose', () => {
    // Sin el control, el test anterior pasaría por no encontrar nada que quitar.
    expect(conceptAddsDetail('Pago completo del alquiler', 'Señal de la reserva')).toBe(true);
    expect(conceptAddsDetail('constructor', 'Fianza')).toBe(true);
    expect(conceptAddsDetail('rental payment en metálico', 'Señal de la reserva')).toBe(true);
  });
});

/**
 * ⚠️ Los códigos llegan crudos de Firestore y **no son texto libre**. Pintar
 * `bank_transfer` tal cual es el mismo fallo que sacaba `diesel` y `manual` en
 * la ficha de vehículo del contrato.
 */
describe('los códigos se traducen, no se pintan', () => {
  it('el método sale en el idioma del documento', () => {
    expect(methodLabel('bank_transfer', 'es')).toBe('Transferencia bancaria');
    expect(methodLabel('bank_transfer', 'en')).toBe('Bank transfer');
    expect(methodLabel('bank_transfer', 'ro')).toBe('Transfer bancar');
    expect(methodLabel('physical_pos', 'es')).toBe('TPV');
  });

  it('un método desconocido no imprime el código en crudo', () => {
    expect(methodLabel('paypal', 'es')).toBe('—');
    expect(methodLabel(undefined, 'es')).toBe('—');
  });

  it('el tipo de cobro también', () => {
    expect(paymentTypeLabel('initial_payment', 'es')).toBe('Señal de la reserva');
    expect(paymentTypeLabel('deposit', 'ro')).toBe('Garanție');
  });

  /**
   * ⚠️ **La tabla tiene que estar COMPLETA y el compilador no lo comprueba**:
   * la clave es `string` porque la app y las functions no comparten módulo, así
   * que un tipo que falte devuelve cadena vacía — titular en blanco en el
   * recibo. Faltaban `delivery_fee` y `collection_fee`, que son dos de los que
   * sí admiten recibo, y el PDF salía sin rótulo y con el enumerado debajo.
   */
  it('los tipos que admiten recibo tienen TODOS su rótulo en los tres idiomas', () => {
    const conRecibo = [
      'initial_payment',
      'remaining_payment',
      'rental_payment',
      'delivery_fee',
      'collection_fee',
      'deposit',
      'extra_fuel',
      'refuel_penalty',
      'extra_cleaning',
      'extra_km',
      'extra_damage',
      'extra_fine',
      'extra_other',
      'free_payment'
    ];
    for (const tipo of conRecibo) {
      for (const loc of ['es', 'en', 'ro'] as const) {
        expect(paymentTypeLabel(tipo, loc), `${tipo}/${loc}`).not.toBe('');
      }
    }
  });

  it('un tipo desconocido deja el titular vacío en vez de soltar la clave', () => {
    expect(paymentTypeLabel('tipo_retirado', 'es')).toBe('');
    expect(paymentTypeLabel(undefined, 'es')).toBe('');
  });
});
