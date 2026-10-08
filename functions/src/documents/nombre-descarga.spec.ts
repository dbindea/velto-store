import { describe, expect, it } from 'vitest';
import { disposicionEnLinea, nombreDePdf, trozo } from './nombre-descarga';

// ---------------------------------------------------------------------------
// El nombre con el que se baja un PDF
//
// ⚠️ **Lo que se comprueba aquí no es el formato, es que no vuelva la
// CARPETA.** Sin `Content-Disposition`, el navegador saca el nombre de la ruta
// de la URL y trata cada barra como un directorio: descargar un justificante
// bajaba una carpeta con el id de la reserva dentro. Así que lo que no puede
// pasar es que de aquí salga una barra, ni un nombre vacío.
// ---------------------------------------------------------------------------

describe('trozo', () => {
  it('quita los acentos sin perder la letra', () => {
    expect(trozo('José Muñoz')).toBe('Jose-Munoz');
    expect(trozo('Mitoșeriu Ană')).toBe('Mitoseriu-Ana');
  });

  /**
   * ⚠️ **Esta es LA comprobación.** Una barra dentro del nombre vuelve a crear
   * una carpeta, que es justo el fallo que esto viene a cerrar; y en Storage,
   * además, crearía una ruta nueva.
   */
  it('no deja pasar barras ni nada que haga una ruta', () => {
    expect(trozo('reservations/abc123/booking')).toBe('reservations-abc123-booking');
    expect(trozo('..\\..\\etc')).toBe('etc');
    expect(trozo('a/b')).not.toContain('/');
  });

  it('se queda vacío con lo que no tiene nada que aportar', () => {
    expect(trozo('')).toBe('');
    expect(trozo(null)).toBe('');
    expect(trozo(undefined)).toBe('');
    expect(trozo('   ---   ')).toBe('');
  });

  it('corta los nombres largos, que no se leen en una carpeta de descargas', () => {
    expect(trozo('a'.repeat(80)).length).toBe(40);
  });
});

describe('nombreDePdf', () => {
  it('junta los campos con `_` y las palabras con `-`', () => {
    expect(nombreDePdf('Justificante', '4466LKK', 'Andreea Mitoseriu')).toBe(
      'Justificante_4466LKK_Andreea-Mitoseriu.pdf'
    );
  });

  it('se salta los trozos que no traen nada, sin dejar separadores sueltos', () => {
    expect(nombreDePdf('Presupuesto', null, 'Ana')).toBe('Presupuesto_Ana.pdf');
    expect(nombreDePdf('Factura', '', undefined)).toBe('Factura.pdf');
  });

  /**
   * ⚠️ **Sin datos hay que devolver ALGO.** Un `.pdf` a secas —o una cadena
   * vacía— deja que el navegador vuelva a sacar el nombre de la ruta, que es el
   * fallo de partida.
   */
  it('nunca devuelve un nombre vacío', () => {
    expect(nombreDePdf()).toBe('documento.pdf');
    expect(nombreDePdf(null, undefined, '')).toBe('documento.pdf');
  });

  it('siempre acaba en .pdf y nunca lleva barras', () => {
    const n = nombreDePdf('Parte', 'vehicles/4466LKK', 'entrega');
    expect(n.endsWith('.pdf')).toBe(true);
    expect(n).not.toContain('/');
  });
});

describe('disposicionEnLinea', () => {
  /**
   * ⚠️ **`inline` y no `attachment`.** Con `attachment` el navegador se salta su
   * visor y descarga directamente, así que los botones de «Abrir» del backoffice
   * dejarían de abrir nada: pasarían a bajar un fichero.
   */
  it('deja que el PDF se siga viendo en el navegador', () => {
    expect(disposicionEnLinea('Factura_F-2026-1.pdf')).toBe(
      'inline; filename="Factura_F-2026-1.pdf"'
    );
  });

  it('no se puede partir la cabecera con una comilla', () => {
    expect(disposicionEnLinea('ra"ro.pdf')).toBe('inline; filename="raro.pdf"');
  });
});
