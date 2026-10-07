/**
 * El nombre con el que se baja un PDF al disco de quien lo descarga.
 *
 * ⚠️ **Existe porque Storage no manda `Content-Disposition` por su cuenta.** Sin
 * esa cabecera el navegador saca el nombre **de la ruta de la URL**
 * —`…/o/reservations%2F<id>%2Fbooking-confirmation.pdf`—, la descodifica y trata
 * cada barra como un directorio: lo que se baja es una **carpeta** con el id de
 * la reserva dentro y un `booking-confirmation.pdf` al fondo. Lo contó Dorel el
 * 8 de octubre de 2026 descargando un justificante de producción, y le pasa
 * igual al cliente que abre el enlace corto desde su WhatsApp.
 *
 * ⚠️ **Y por eso se arregla AQUÍ y no en el frontend.** El backoffice ya tenía
 * `triggerDownload()`, que baja el fichero a un blob y le pone el nombre a mano,
 * pero eso solo cubre los dos botones que lo llaman: no cubre los enlaces
 * `target="_blank"` de las otras siete pantallas, ni el botón de guardar del
 * visor de PDF del navegador, ni —sobre todo— el enlace `/d/…` que recibe el
 * cliente. Puesto en los metadatos del objeto, **todas** esas vías bajan un
 * fichero con su nombre.
 *
 * ⚠️ **`inline` y no `attachment`.** Con `attachment` el navegador se salta el
 * visor y descarga directamente, y entonces los botones de «Abrir» del
 * backoffice dejarían de abrir: pasarían a bajar un fichero. Con `inline` el PDF
 * se sigue viendo en la pestaña y el nombre solo se usa al guardarlo, que es
 * exactamente lo que se quería.
 *
 * ⚠️ **Solo entra ASCII.** `Content-Disposition` admite caracteres de fuera por
 * la vía de `filename*=UTF-8''…` (RFC 5987), y no se usa a propósito: un nombre
 * sin acentos vale en los dos sitios, se puede teclear en cualquier terminal y
 * no depende de que un navegador viejo entienda la forma larga. Lo garantiza
 * `trozo()`, que es la copia de `slugForFile()` de la app — dos builds que no
 * pueden compartir módulo, como el IVA.
 */

/** Lo que mide, como mucho, cada trozo del nombre. */
const MAX_TROZO = 40;

/**
 * Un trozo de nombre de fichero: sin acentos, sin espacios y sin nada que no
 * sea alfanumérico. Copia de `slugForFile()` de la app.
 */
export function trozo(valor: string | null | undefined): string {
  return String(valor ?? '')
    .normalize('NFD')
    /*
     * Las marcas de combinación que deja NFD, por su categoría Unicode.
     *
     * ⚠️ **Se nombra la CATEGORÍA y no el rango.** La app escribe aquí el rango
     * de códigos, y cualquier copia de esa línea arrastra dos caracteres
     * **invisibles** que un editor puede normalizar sin que se note: la
     * expresión dejaría de quitar acentos y nadie lo vería hasta que un cliente
     * se llamara José. Esta forma es solo ASCII y dice lo mismo.
     */
    .replace(/\p{Mn}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TROZO)
    .replace(/-+$/g, '');
}

/**
 * Junta los trozos con `_`, como el resto de los nombres de la casa.
 *
 * ⚠️ **`_` separa campos y `-` une palabras**, que es lo que permite partir un
 * nombre por `_` y saber qué es cada trozo.
 */
export function nombreDePdf(...trozos: (string | null | undefined)[]): string {
  const limpios = trozos.map(trozo).filter(Boolean);
  // `documento.pdf` es el último recurso: sin datos no hay nombre que inventar,
  // pero un fichero sin nombre vuelve a bajar la carpeta.
  return (limpios.join('_') || 'documento') + '.pdf';
}

/**
 * La cabecera entera, lista para los metadatos del objeto.
 *
 * ⚠️ **Las comillas no son decoración**: sin ellas, un nombre con un espacio
 * —que `trozo()` no deja pasar, pero el día que alguien llame a esto con un
 * literal sí— corta la cabecera por la mitad y el navegador se queda con la
 * primera palabra.
 */
export function disposicionEnLinea(nombre: string): string {
  return `inline; filename="${nombre.replace(/"/g, '')}"`;
}

/** Los documentos que se descargan con nombre. */
export type TipoDeDocumento =
  | 'quote'
  | 'booking'
  | 'inspection'
  | 'invoice'
  | 'proforma'
  | 'receipt'
  | 'compliance';

/**
 * La palabra que encabeza el nombre del fichero, en el idioma del documento.
 *
 * ⚠️ **Lo que se DESCARGA se traduce; lo que se SUBE a Storage, no.** Es la
 * regla de `storage-name.util.ts` de la app: la ruta de un objeto es un dato y
 * con palabras traducidas dentro el mismo coche tendría ficheros con prefijos
 * distintos según el idioma del operador. Esto es lo contrario — un nombre que
 * lee una persona en su carpeta de descargas—, así que sigue el idioma del PDF.
 *
 * ⚠️ **Y la declaración responsable no se traduce**: es un documento para la
 * AEAT y se emite en español, pase lo que pase.
 */
export function palabraDocumento(tipo: TipoDeDocumento, locale: string = 'es'): string {
  const en = locale === 'en';
  const ro = locale === 'ro';
  switch (tipo) {
    case 'quote':
      return en ? 'Quote' : ro ? 'Oferta' : 'Presupuesto';
    case 'booking':
      return en ? 'Booking' : ro ? 'Rezervare' : 'Justificante';
    case 'inspection':
      return en ? 'Report' : ro ? 'Raport' : 'Parte';
    case 'invoice':
      return en ? 'Invoice' : ro ? 'Factura' : 'Factura';
    case 'proforma':
      return 'Proforma';
    case 'receipt':
      return en ? 'Receipt' : ro ? 'Chitanta' : 'Recibo';
    case 'compliance':
      return 'Declaracion-responsable';
  }
}
