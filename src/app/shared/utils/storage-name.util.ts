/**
 * Cómo se llaman los ficheros: los que se suben y los que se descargan.
 *
 * ⚠️ **Antes un fichero se llamaba como lo llamara el móvil.** Una foto de coche
 * se guardaba como `1758291600000-IMG_20260919_143201.jpg` y el DNI de un
 * cliente como `1758291600000-Screenshot_2026-09-19.png`: dentro de la carpeta
 * de su ficha se sabe de quién es, pero fuera de ella —descargada, adjuntada a
 * un correo, abierta desde el disco— no se sabe de qué coche ni de qué persona.
 * Y es justo fuera de la aplicación donde hace falta saberlo.
 *
 * Ahora el nombre lleva el dato que lo identifica: la matrícula del coche o el
 * nombre y el documento del cliente.
 *
 * ## Dos reglas distintas, y conviene no mezclarlas
 *
 * ⚠️ **Lo que se SUBE no se traduce.** El nombre de un objeto de Storage es un
 * dato, no una pantalla: si llevara palabras traducidas, el mismo coche tendría
 * ficheros con prefijos distintos según el idioma que tuviera puesto quien los
 * subió, y buscar «entrega» en el bucket dejaría fuera la mitad. Por eso aquí
 * solo entran datos del negocio —matrícula, nombre, documento— y valores de
 * enumerado, que son estables.
 *
 * ⚠️ **Lo que se DESCARGA sí**, porque eso es lo que lee el operador y sigue la
 * misma regla que los PDF: salen en el idioma que tiene puesta la plataforma.
 * Quien compone esos nombres pasa las palabras ya traducidas.
 */

/** Lo más largo que se deja un trozo de nombre, para no acabar con rutas absurdas. */
const MAX_TROZO = 40;

/**
 * Un trozo de nombre de fichero seguro en cualquier sistema.
 *
 * ⚠️ **Quita los acentos en vez de dejarlos pasar.** Storage los admite, pero el
 * fichero acaba en el disco de alguien, en un adjunto o en un ZIP, y «Peña» se
 * convierte en `Pen?a` en unos cuantos sitios del camino. `normalize('NFD')`
 * separa la letra de su tilde y el rango de combinación se descarta.
 *
 * ⚠️ **Y la barra NO sobrevive**, que es lo importante: en Storage una barra
 * **crea una carpeta**. Un nombre de cliente con una barra dentro partiría la
 * ruta en dos y el fichero acabaría en un sitio que nadie busca.
 *
 * ⚠️ **El guion bajo tampoco sobrevive DENTRO de un trozo**, y es deliberado:
 * `_` separa campos y `-` une palabras. Por eso el enumerado
 * `driving_license` sale `driving-license`, y el nombre se puede partir por
 * `_` para saber qué es cada cosa — cliente, documento, tipo, sufijo.
 */
export function slugForFile(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    // El rango de marcas de combinación, escrito con códigos y no con los
    // caracteres: pegados en el fichero son invisibles y el día que un editor
    // los normalice, la expresión deja de quitar nada sin que se note.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TROZO)
    .replace(/-+$/g, '');
}

/**
 * La extensión del fichero original, con su punto y en minúsculas.
 *
 * ⚠️ **Se conserva la del original y no se deduce del tipo MIME.** Un HEIC de
 * iPhone que el navegador no sabe reducir se sube tal cual, y renombrarlo a
 * `.jpg` porque «es una foto» daría un fichero que no abre nada.
 */
export function extensionOf(originalName: string, fallback = '.jpg'): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(String(originalName ?? '').trim());
  return m ? '.' + m[1].toLowerCase() : fallback;
}

/**
 * Une los trozos que tengan algo, con guion bajo entre ellos.
 *
 * Los huecos se caen solos: un coche sin matrícula —todavía no dada de alta— no
 * deja un `__` en medio del nombre.
 */
function unir(...trozos: (string | null | undefined)[]): string {
  return trozos.map((t) => slugForFile(t)).filter((t) => t.length > 0).join('_');
}

/**
 * Un sufijo corto que hace único el nombre.
 *
 * ⚠️ **Hace falta y no es decorativo.** Dos fotos del mismo coche se llamarían
 * igual, y en Storage subir dos veces el mismo nombre **pisa la primera sin
 * avisar**: la foto anterior desaparece y la ficha se queda con dos entradas
 * apuntando al mismo fichero.
 *
 * Es la marca de tiempo en base 36 —seis o siete caracteres— en vez de los trece
 * dígitos de un `Date.now()`: cabe, ordena igual y no come el nombre.
 */
export function uniqueSuffix(at: number = Date.now()): string {
  return Math.floor(at).toString(36);
}

/**
 * El nombre de una foto de vehículo: `4466LKK_mfk3n1.jpg`.
 *
 * La matrícula es lo que el operador reconoce de un vistazo; el sufijo la hace
 * única. Sin matrícula —un coche a medio dar de alta— manda su id, que es lo
 * único que hay.
 */
export function vehiclePhotoName(opts: {
  plate?: string | null;
  vehicleId: string;
  originalName: string;
  /** `-thumb` para la miniatura. Va pegado al sufijo, no al final del nombre. */
  variant?: string;
  at?: number;
}): string {
  const base = unir(opts.plate || opts.vehicleId, uniqueSuffix(opts.at) + (opts.variant ?? ''));
  return base + extensionOf(opts.originalName);
}

/**
 * El nombre de un documento de cliente:
 * `Andreea-Mitoseriu_X1234567L_driving-license_mfk3n1.jpg`.
 *
 * ⚠️ **El tipo va en el nombre y en su forma de enumerado**, sin traducir: es lo
 * que permite distinguir el carné del DNI cuando los dos están descargados en la
 * misma carpeta, y tiene que decir lo mismo lo suba quien lo suba.
 *
 * ⚠️ **Y el número de documento entra aunque el nombre ya esté.** Dos clientes
 * pueden llamarse igual —pasa—, y lo que no se repite es el documento.
 */
export function clientDocumentName(opts: {
  fullName?: string | null;
  documentNumber?: string | null;
  type: string;
  originalName: string;
  at?: number;
}): string {
  const base = unir(opts.fullName, opts.documentNumber, opts.type, uniqueSuffix(opts.at));
  return base + extensionOf(opts.originalName, '.pdf');
}

/**
 * El nombre de una foto de inspección:
 * `4466LKK_pickup_exterior-front_mfk3n1.jpg`.
 *
 * Lleva la fase y la categoría porque una inspección son ocho o diez fotos del
 * mismo coche el mismo día: sin ellas, el nombre distingue el coche pero no cuál
 * de las ocho es. Y son justo las fotos que sostienen un cargo por daños, así
 * que tienen que poder enseñarse sueltas.
 */
export function inspectionPhotoName(opts: {
  plate?: string | null;
  reservationId: string;
  phase: string;
  category?: string | null;
  originalName: string;
  variant?: string;
  at?: number;
}): string {
  const base = unir(
    opts.plate || opts.reservationId,
    opts.phase,
    opts.category,
    uniqueSuffix(opts.at) + (opts.variant ?? '')
  );
  return base + extensionOf(opts.originalName);
}

/**
 * El nombre con el que se le ofrece un contrato al operador:
 * `Contrato_4466LKK_Andreea-Mitoseriu_firmado.pdf`.
 *
 * ⚠️ **Las palabras llegan ya traducidas**, no se escriben aquí: el fichero lo
 * lee una persona, y este proyecto no deja español duro en nada que se le
 * enseñe a nadie. Ver la nota de cabecera.
 *
 * ⚠️ **Y el número de contrato es el respaldo, no el encabezado.** Un
 * `C-P2RJP0-2026` identifica sin ambigüedad pero no le dice nada a quien busca
 * el contrato «del Megane de Andreea» en su carpeta de descargas; entra solo
 * cuando falta la matrícula o el nombre.
 */
export function contractFileName(opts: {
  /** «Contrato» / «Contract» / «Contract», ya traducido. */
  documentWord: string;
  /** «firmado» / «signed» / «semnat», ya traducido. Vacío para el original. */
  stateWord?: string;
  plate?: string | null;
  clientName?: string | null;
  contractNumber?: string | null;
}): string {
  /**
   * ⚠️ **Los trozos se juntan UNA vez.** Componer la identidad con `unir()` y
   * volver a pasarla por `unir()` la destroza: el guion bajo que acaba de poner
   * no es alfanumérico, así que la segunda pasada lo convierte en guion y
   * `4466LKK_Andreea` sale `4466LKK-Andreea`. Por eso se decide qué trozos
   * entran y se unen al final, no por partes.
   */
  const hayIdentidad = !!slugForFile(opts.plate) || !!slugForFile(opts.clientName);
  const base = unir(
    opts.documentWord,
    ...(hayIdentidad ? [opts.plate, opts.clientName] : [opts.contractNumber]),
    opts.stateWord
  );
  // `documento.pdf` es el último recurso: sin datos no hay nombre que inventar,
  // pero un fichero sin nombre no se puede descargar.
  return (base || 'documento') + '.pdf';
}
