import { describe, expect, it } from 'vitest';
import {
  clientDocumentName,
  contractFileName,
  extensionOf,
  inspectionPhotoName,
  slugForFile,
  uniqueSuffix,
  vehiclePhotoName
} from './storage-name.util';

// ---------------------------------------------------------------------------
// Cómo se llaman los ficheros
//
// Un nombre mal compuesto no da ningún error: el fichero se sube, la pantalla
// lo enseña y solo se ve el día que alguien lo descarga. Y una barra dentro del
// nombre no es cosmética — en Storage crea una carpeta.
// ---------------------------------------------------------------------------

describe('slugForFile', () => {
  it('quita los acentos en vez de dejarlos pasar', () => {
    expect(slugForFile('Andreea Mitoșeriu Peña')).toBe('Andreea-Mitoseriu-Pena');
  });

  /**
   * ⚠️ El caso que importa: en Storage una barra **crea una carpeta**, así que
   * un nombre con una barra dentro partiría la ruta y el fichero acabaría
   * donde nadie lo busca.
   */
  it('la barra no sobrevive', () => {
    expect(slugForFile('a/b')).toBe('a-b');
    expect(slugForFile('../../etc/passwd')).toBe('etc-passwd');
  });

  it('no deja guiones sueltos en los extremos', () => {
    expect(slugForFile('  ¡hola!  ')).toBe('hola');
    expect(slugForFile('***')).toBe('');
  });

  it('recorta lo muy largo sin dejar el guion colgando', () => {
    const largo = slugForFile('a'.repeat(60) + ' ' + 'b'.repeat(60));
    expect(largo.length).toBeLessThanOrEqual(40);
    expect(largo.endsWith('-')).toBe(false);
  });

  it('aguanta un hueco', () => {
    expect(slugForFile(null)).toBe('');
    expect(slugForFile(undefined)).toBe('');
  });
});

describe('extensionOf', () => {
  it('conserva la del original, en minúsculas', () => {
    expect(extensionOf('IMG_1234.JPG')).toBe('.jpg');
    expect(extensionOf('carné.HEIC')).toBe('.heic');
  });

  /** Sin extensión no se inventa una que mienta sobre el contenido. */
  it('usa el respaldo cuando no hay ninguna', () => {
    expect(extensionOf('sin-extension')).toBe('.jpg');
    expect(extensionOf('sin-extension', '.pdf')).toBe('.pdf');
  });

  it('no confunde un punto del nombre con una extensión', () => {
    expect(extensionOf('foto.del.coche.png')).toBe('.png');
  });
});

describe('vehiclePhotoName', () => {
  it('lleva la matrícula delante', () => {
    const n = vehiclePhotoName({
      plate: '4466LKK',
      vehicleId: 'abc123',
      originalName: 'IMG_20260919_143201.jpg',
      at: 1758291600000
    });
    expect(n.startsWith('4466LKK_')).toBe(true);
    expect(n.endsWith('.jpg')).toBe(true);
  });

  /**
   * ⚠️ Sin sufijo, dos fotos del mismo coche se llamarían igual — y en Storage
   * subir dos veces el mismo nombre **pisa la primera sin avisar**.
   */
  it('dos fotos del mismo coche no se llaman igual', () => {
    const a = vehiclePhotoName({ plate: '4466LKK', vehicleId: 'x', originalName: 'a.jpg', at: 1 });
    const b = vehiclePhotoName({ plate: '4466LKK', vehicleId: 'x', originalName: 'a.jpg', at: 2 });
    expect(a).not.toBe(b);
  });

  it('la miniatura se distingue de la foto', () => {
    const foto = vehiclePhotoName({ plate: '4466LKK', vehicleId: 'x', originalName: 'a.jpg', at: 1 });
    const thumb = vehiclePhotoName({
      plate: '4466LKK', vehicleId: 'x', originalName: 'a.jpg', at: 1, variant: '-thumb'
    });
    expect(thumb).not.toBe(foto);
    expect(thumb).toContain('-thumb');
  });

  /** Un coche a medio dar de alta todavía no tiene matrícula. */
  it('sin matrícula manda el id', () => {
    const n = vehiclePhotoName({ plate: '', vehicleId: 'abc123', originalName: 'a.jpg', at: 1 });
    expect(n.startsWith('abc123_')).toBe(true);
  });

  it('nunca mete una barra en el nombre', () => {
    const n = vehiclePhotoName({
      plate: '4466/LKK', vehicleId: 'x', originalName: 'a.jpg', at: 1
    });
    expect(n).not.toContain('/');
  });
});

describe('clientDocumentName', () => {
  it('lleva el nombre, el documento y el tipo', () => {
    const n = clientDocumentName({
      fullName: 'Andreea Mitoseriu',
      documentNumber: 'X1234567L',
      type: 'driving_license',
      originalName: 'Screenshot_2026-09-19.png',
      at: 1758291600000
    });
    expect(n).toContain('Andreea-Mitoseriu');
    expect(n).toContain('X1234567L');
    // El guion bajo del enumerado sale como guion: '_' separa CAMPOS y '-'
    // une palabras dentro de uno. Ver la nota de `slugForFile`.
    expect(n).toContain('driving-license');
    expect(n.endsWith('.png')).toBe(true);
  });

  /** Dos clientes pueden llamarse igual; el documento no se repite. */
  it('el documento entra aunque el nombre ya esté', () => {
    const a = clientDocumentName({
      fullName: 'Juan Garcia', documentNumber: '11111111H', type: 'dni', originalName: 'a.pdf', at: 1
    });
    const b = clientDocumentName({
      fullName: 'Juan Garcia', documentNumber: '22222222J', type: 'dni', originalName: 'a.pdf', at: 1
    });
    expect(a).not.toBe(b);
  });

  it('una ficha a medias no rompe el nombre', () => {
    const n = clientDocumentName({ type: 'dni', originalName: 'a.pdf', at: 1 });
    expect(n).toContain('dni');
    expect(n).not.toContain('__');
    expect(n.endsWith('.pdf')).toBe(true);
  });
});

describe('inspectionPhotoName', () => {
  it('dice de qué coche, de qué fase y de qué parte', () => {
    const n = inspectionPhotoName({
      plate: '4466LKK',
      reservationId: 'r1',
      phase: 'pickup',
      category: 'exterior_front',
      originalName: 'a.jpg',
      at: 1
    });
    expect(n).toContain('4466LKK');
    expect(n).toContain('pickup');
    expect(n).toContain('exterior-front');
  });

  /** Una inspección son ocho fotos del mismo coche el mismo día. */
  it('dos fotos de la misma categoría no se pisan', () => {
    const a = inspectionPhotoName({
      plate: 'X', reservationId: 'r', phase: 'pickup', category: 'c', originalName: 'a.jpg', at: 1
    });
    const b = inspectionPhotoName({
      plate: 'X', reservationId: 'r', phase: 'pickup', category: 'c', originalName: 'a.jpg', at: 2
    });
    expect(a).not.toBe(b);
  });

  it('sin categoría no deja un hueco en el nombre', () => {
    const n = inspectionPhotoName({
      plate: 'X', reservationId: 'r', phase: 'return', originalName: 'a.jpg', at: 1
    });
    expect(n).not.toContain('__');
  });
});

describe('contractFileName', () => {
  it('es legible fuera de la aplicación', () => {
    expect(
      contractFileName({
        documentWord: 'Contrato',
        stateWord: 'firmado',
        plate: '4466LKK',
        clientName: 'Andreea Mitoseriu',
        contractNumber: 'C-P2RJP0-2026'
      })
    ).toBe('Contrato_4466LKK_Andreea-Mitoseriu_firmado.pdf');
  });

  it('el original no dice «firmado»', () => {
    const n = contractFileName({
      documentWord: 'Contrato',
      stateWord: 'original',
      plate: '4466LKK',
      clientName: 'Andreea Mitoseriu'
    });
    expect(n).toBe('Contrato_4466LKK_Andreea-Mitoseriu_original.pdf');
  });

  /**
   * ⚠️ El fallo que costó una vuelta: componer la identidad con el mismo
   * ayudante y volver a pasarla por él convierte el guion bajo en guion, porque
   * no es alfanumérico. `4466LKK_Andreea` salía `4466LKK-Andreea`.
   */
  it('mantiene el guion bajo entre trozos', () => {
    const n = contractFileName({
      documentWord: 'Contrato', plate: 'AAA', clientName: 'BBB', stateWord: 'firmado'
    });
    expect(n).toBe('Contrato_AAA_BBB_firmado.pdf');
  });

  /** El número de contrato es el respaldo, no el encabezado. */
  it('cae al número de contrato cuando no hay coche ni cliente', () => {
    expect(
      contractFileName({ documentWord: 'Contrato', contractNumber: 'C-P2RJP0-2026', stateWord: 'firmado' })
    ).toBe('Contrato_C-P2RJP0-2026_firmado.pdf');
  });

  it('sin nada que decir sigue produciendo un fichero descargable', () => {
    expect(contractFileName({ documentWord: '' })).toBe('documento.pdf');
  });

  it('en otro idioma sale en ese idioma', () => {
    expect(
      contractFileName({
        documentWord: 'Contract', stateWord: 'semnat', plate: '4466LKK', clientName: 'Ion Popescu'
      })
    ).toBe('Contract_4466LKK_Ion-Popescu_semnat.pdf');
  });

  /** Una barra en el nombre del cliente crearía una carpeta al descargar. */
  it('nunca produce una ruta', () => {
    const n = contractFileName({
      documentWord: 'Contrato', plate: 'a/b', clientName: 'c/d', stateWord: 'firmado'
    });
    expect(n).not.toContain('/');
  });
});

describe('uniqueSuffix', () => {
  it('es corto y ordena como el tiempo', () => {
    const antes = uniqueSuffix(1758291600000);
    const despues = uniqueSuffix(1758291600001);
    expect(antes.length).toBeLessThanOrEqual(9);
    expect(antes < despues).toBe(true);
  });
});
