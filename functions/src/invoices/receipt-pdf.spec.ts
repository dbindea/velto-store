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

  it('un tipo desconocido deja el titular vacío en vez de soltar la clave', () => {
    expect(paymentTypeLabel('deposit_refund', 'es')).toBe('');
    expect(paymentTypeLabel(undefined, 'es')).toBe('');
  });
});
