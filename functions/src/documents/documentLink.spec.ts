/**
 * The short-link mapping.
 *
 * There is no lookup table behind these URLs: the id IS the address. So the
 * mapping has to be exactly right in both directions — a mistake here is a
 * customer opening a link from WhatsApp and getting a 404, or worse, reaching
 * a path they should not.
 */

import { describe, expect, it } from 'vitest';
import { documentKindOf, nombreDeDescarga, resolveDocumentPath, shortIdFor } from './documentLink';
import { disposicionEnLinea, nombreDePdf, palabraDocumento } from './nombre-descarga';

describe('shortIdFor', () => {
  it('un prefijo por documento: q presupuesto, r reserva, c recibo, i parte', () => {
    expect(shortIdFor('quote', 'A1b2C3d4')).toBe('qA1b2C3d4');
    expect(shortIdFor('booking', 'p2RjP0LG1zp7KHqyNtB0')).toBe('rp2RjP0LG1zp7KHqyNtB0');
    expect(shortIdFor('receipt', '9f3a1c77b2e40d58')).toBe('c9f3a1c77b2e40d58');
    expect(shortIdFor('inspection', 'p2RjP0LG1zp7KHqyNtB0')).toBe('ip2RjP0LG1zp7KHqyNtB0');
  });

  it('round-trips: what we mint is what resolves', () => {
    const quoteId = 'A1b2C3d4E5f6G7h8';
    expect(resolveDocumentPath(shortIdFor('quote', quoteId))).toBe(`quotes/${quoteId}/quote.pdf`);

    const reservationId = 'p2RjP0LG1zp7KHqyNtB0';
    expect(resolveDocumentPath(shortIdFor('booking', reservationId))).toBe(
      `reservations/${reservationId}/booking-confirmation.pdf`
    );

    const receiptId = '9f3a1c77b2e40d58';
    expect(resolveDocumentPath(shortIdFor('receipt', receiptId))).toBe(
      `receipts/${receiptId}/receipt.pdf`
    );

    const inspectionId = 'kQ8sV2rL0mNbX4tYuZ1c';
    expect(resolveDocumentPath(shortIdFor('inspection', inspectionId))).toBe(
      `inspections/${inspectionId}/report.pdf`
    );
  });

});

describe('resolveDocumentPath', () => {
  it('refuses anything that is not a known prefix', () => {
    expect(resolveDocumentPath('xABC123')).toBeNull();
    expect(resolveDocumentPath('ABC123')).toBeNull();
  });

  it('refuses empty and truncated ids', () => {
    expect(resolveDocumentPath('')).toBeNull();
    expect(resolveDocumentPath('q')).toBeNull();
    expect(resolveDocumentPath('r')).toBeNull();
    expect(resolveDocumentPath('c')).toBeNull();
    expect(resolveDocumentPath('qab')).toBeNull(); // shorter than the minimum
    expect(resolveDocumentPath('cab')).toBeNull();
    expect(resolveDocumentPath('i')).toBeNull();
    expect(resolveDocumentPath('iab')).toBeNull();
  });

  it('el recibo no escapa de su carpeta más que los otros dos', () => {
    expect(resolveDocumentPath('c../../contracts/secret')).toBeNull();
    expect(resolveDocumentPath('cfoo/bar')).toBeNull();
    expect(resolveDocumentPath('cfoo.bar')).toBeNull();
  });

  it('refuses ids that could climb out of their folder', () => {
    // The id lands straight in a Storage path, so traversal is the thing to
    // keep out. Anything with a slash or a dot is rejected outright.
    expect(resolveDocumentPath('q../../contracts/secret')).toBeNull();
    expect(resolveDocumentPath('q..%2F..%2Fcontracts')).toBeNull();
    expect(resolveDocumentPath('qfoo/bar')).toBeNull();
    expect(resolveDocumentPath('qfoo.bar')).toBeNull();
    expect(resolveDocumentPath('q' + 'a'.repeat(200))).toBeNull();
  });

  it('never resolves to the contracts folder', () => {
    // Contracts are reached through the signing token, which is single-use and
    // expires. They must not become permanently readable through a short link.
    for (const id of ['cABC123456', 'contractsABC', 'qcontracts', 'rcontracts']) {
      const path = resolveDocumentPath(id);
      expect(path === null || !path.startsWith('contracts/')).toBe(true);
    }
  });

  it('accepts the url-safe alphabet Firestore and our ids use', () => {
    expect(resolveDocumentPath('qA1b2-C3d_4E5f')).toBe('quotes/A1b2-C3d_4E5f/quote.pdf');
  });
});

describe('documentKindOf', () => {
  it('el prefijo decide el tipo, en los cuatro', () => {
    expect(documentKindOf(shortIdFor('quote', 'A1b2C3d4'))).toBe('quote');
    expect(documentKindOf(shortIdFor('booking', 'p2RjP0LG1zp7KHqyNtB0'))).toBe('booking');
    expect(documentKindOf(shortIdFor('receipt', '9f3a1c77b2e40d58'))).toBe('receipt');
    expect(documentKindOf(shortIdFor('inspection', 'kQ8sV2rL0mNbX4tYuZ1c'))).toBe('inspection');
  });

  it('un id que no resuelve a ninguna ruta no tiene tipo', () => {
    // Si no, `/d/q` contestaria «presupuesto» sin que haya ningun documento.
    expect(documentKindOf('q')).toBeNull();
    expect(documentKindOf('qab')).toBeNull();
    expect(documentKindOf('xABC123')).toBeNull();
    expect(documentKindOf('qfoo/bar')).toBeNull();
    expect(documentKindOf('')).toBeNull();
  });
});

/**
 * El nombre con el que el cliente guarda el PDF que abre desde su WhatsApp.
 *
 * ⚠️ **Es la vía que el arreglo del 7 de octubre de 2026 dejó fuera**, y el
 * primer test de aquí es su control: con los cuatro nombres fijos de antes
 * —`reserva.pdf`, `presupuesto.pdf`…— falla, porque el nombre que el objeto
 * trae dentro no se miraba.
 */
describe('nombreDeDescarga', () => {
  it('manda el nombre que escribió quien generó el PDF', () => {
    const delObjeto = disposicionEnLinea('Justificante_1234JKL_Marius-Ionescu-Pavel.pdf');
    expect(nombreDeDescarga(delObjeto, 'booking')).toBe(
      'Justificante_1234JKL_Marius-Ionescu-Pavel.pdf'
    );
  });

  it('da la vuelta a lo que compone `uploadPdf`, en los tres idiomas', () => {
    // Ata los dos extremos: si alguien cambia como se escribe la cabecera al
    // subir, esto se rompe aqui en vez de en la carpeta de descargas de un
    // cliente. Y es lo que prueba que el idioma del documento VIAJA: este
    // endpoint no sabe en que idioma se emitio el PDF y no tiene que saberlo.
    for (const locale of ['es', 'en', 'ro']) {
      const nombre = nombreDePdf(palabraDocumento('booking', locale), '1234JKL', 'Ana Ionescu');
      expect(nombreDeDescarga(disposicionEnLinea(nombre), 'booking')).toBe(nombre);
    }
    const enRumano = disposicionEnLinea(nombreDePdf(palabraDocumento('booking', 'ro')));
    expect(nombreDeDescarga(enRumano, 'booking')).toBe('Rezervare.pdf');
  });

  it('acepta el filename sin comillas, que es HTTP válido igual', () => {
    expect(nombreDeDescarga('inline; filename=Recibo_Ana-Ionescu.pdf', 'receipt')).toBe(
      'Recibo_Ana-Ionescu.pdf'
    );
    expect(nombreDeDescarga('attachment; filename="Parte_4466LKK_entrega.pdf"', 'inspection')).toBe(
      'Parte_4466LKK_entrega.pdf'
    );
  });

  it('un objeto sin metadato cae en la palabra de su tipo, no en la ruta', () => {
    // Son los ficheros subidos ANTES del 7 de octubre de 2026. Lo que no puede
    // pasar es quedarse sin nombre: entonces el navegador se lo saca de la ruta
    // y baja una carpeta, que es el fallo entero.
    expect(nombreDeDescarga(null, 'booking')).toBe('Justificante.pdf');
    expect(nombreDeDescarga(undefined, 'quote')).toBe('Presupuesto.pdf');
    expect(nombreDeDescarga('', 'receipt')).toBe('Recibo.pdf');
    expect(nombreDeDescarga('inline', 'inspection')).toBe('Parte.pdf');
    expect(nombreDeDescarga('inline; filename=""', 'booking')).toBe('Justificante.pdf');
  });

  it('solo la forma ASCII: `filename*=` cae al respaldo en vez de dar basura', () => {
    const rfc5987 = "inline; filename*=UTF-8''Justificante%20Jos%C3%A9.pdf";
    expect(nombreDeDescarga(rfc5987, 'booking')).toBe('Justificante.pdf');
  });

  it('no deja colar un salto de línea en la cabecera', () => {
    // Esto acaba en un `res.setHeader()`: con un CRLF dentro, Node tumba la
    // peticion con ERR_INVALID_CHAR y el cliente ve un 500 al abrir su enlace.
    const sucio = nombreDeDescarga(
      'inline; filename="Justificante.pdf\r\nX-Inyectada: 1"',
      'booking'
    );
    expect(sucio).not.toContain('\r');
    expect(sucio).not.toContain('\n');
    expect(() => disposicionEnLinea(sucio)).not.toThrow();
    expect(disposicionEnLinea(sucio)).toBe('inline; filename="Justificante.pdfX-Inyectada: 1"');
  });
});
