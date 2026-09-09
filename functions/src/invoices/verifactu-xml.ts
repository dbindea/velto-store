/**
 * El XML del envío a la AEAT.
 *
 * Construye el sobre SOAP con `RegFactuSistemaFacturacion`: una cabecera y
 * hasta 1000 registros. Es una pieza **pura y sin red**, y por eso está
 * separada del cliente que la envía: así se puede validar contra los `.xsd`
 * oficiales sin llamar a nadie, que es la única forma de saber que el XML está
 * bien antes de que lo diga la Agencia.
 *
 * ⚠️ **El orden de los elementos forma parte de la validación.** El esquema los
 * declara en un `xs:sequence`, así que un campo correcto en el sitio equivocado
 * es un XML inválido. Por eso este módulo **no serializa recorriendo el
 * objeto** —el orden de las propiedades de un objeto de JavaScript no es el del
 * esquema, y los campos condicionales se añaden al final— sino que emite cada
 * elemento en el orden en que lo declara `SuministroInformacion.xsd`.
 *
 * ⚠️ **Ambos esquemas son `elementFormDefault="qualified"`**: todos los
 * elementos van con su prefijo de espacio de nombres, también los hijos.
 */

import type { RegistroAlta } from './verifactu';

const NS_LR =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';
const NS_SF =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';
const NS_SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';

/** Un envío admite hasta 1000 registros (`maxOccurs="1000"`). */
export const MAX_REGISTROS_POR_ENVIO = 1000;

export interface CabeceraEnvio {
  /** El obligado a expedir: razón social y NIF. */
  obligadoNombreRazon: string;
  obligadoNif: string;
  /**
   * Solo en remisión **voluntaria**, es decir antes de estar obligado.
   *
   * ⚠️ `FechaFinVeriFactu` tiene que ser `31-12-20XX` del año en curso o del
   * anterior (error `4120`): es hasta cuándo se asume el compromiso de remitir.
   * Y `RemisionVoluntaria` **solo se informa en sistemas VERI\*FACTU** (error
   * `4127`), que es el nuestro.
   */
  remisionVoluntaria?: { fechaFinVerifactu?: string; incidencia?: 'S' | 'N' };
}

/**
 * Escapa lo que XML no admite en el contenido de un elemento.
 *
 * ⚠️ Hace falta de verdad: una razón social con `&` —«Pérez & Hijos, S.L.»— o
 * una descripción con `<` producen un XML mal formado que la AEAT rechaza con
 * un error de parseo (`4103`) que no dice cuál era el campo.
 */
export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Un elemento con texto, o cadena vacía si no hay valor. */
function el(nombre: string, valor: string | undefined | null): string {
  if (valor === undefined || valor === null || valor === '') return '';
  return `<sf:${nombre}>${escapeXml(valor)}</sf:${nombre}>`;
}

/**
 * El bloque `RegistroAlta`, en el orden exacto del esquema.
 *
 * El orden es el de `RegistroFacturacionAltaType` y **no se toca**: reordenar
 * produce un XML que parece igual de correcto y que el validador rechaza.
 */
export function registroAltaXml(r: RegistroAlta): string {
  const partes: string[] = [];

  partes.push(el('IDVersion', r.IDVersion));

  partes.push(
    '<sf:IDFactura>' +
      el('IDEmisorFactura', r.IDFactura.IDEmisorFactura) +
      el('NumSerieFactura', r.IDFactura.NumSerieFactura) +
      el('FechaExpedicionFactura', r.IDFactura.FechaExpedicionFactura) +
      '</sf:IDFactura>'
  );

  partes.push(el('NombreRazonEmisor', r.NombreRazonEmisor));
  partes.push(el('TipoFactura', r.TipoFactura));
  partes.push(el('TipoRectificativa', r.TipoRectificativa));

  if (r.FacturasRectificadas?.IDFacturaRectificada?.length) {
    const rectificadas = r.FacturasRectificadas.IDFacturaRectificada.map(
      (f) =>
        '<sf:IDFacturaRectificada>' +
        el('IDEmisorFactura', f.IDEmisorFactura) +
        el('NumSerieFactura', f.NumSerieFactura) +
        el('FechaExpedicionFactura', f.FechaExpedicionFactura) +
        '</sf:IDFacturaRectificada>'
    ).join('');
    partes.push(`<sf:FacturasRectificadas>${rectificadas}</sf:FacturasRectificadas>`);
  }

  if (r.ImporteRectificacion) {
    partes.push(
      '<sf:ImporteRectificacion>' +
        el('BaseRectificada', r.ImporteRectificacion.BaseRectificada) +
        el('CuotaRectificada', r.ImporteRectificacion.CuotaRectificada) +
        '</sf:ImporteRectificacion>'
    );
  }

  // Va DESPUÉS de la rectificación y ANTES de la descripción. Es el orden del
  // esquema, y no el que sugeriría leer la factura.
  partes.push(el('FechaOperacion', r.FechaOperacion));
  partes.push(el('DescripcionOperacion', r.DescripcionOperacion));

  if (r.Destinatarios?.IDDestinatario?.length) {
    const destinatarios = r.Destinatarios.IDDestinatario.map((d) => {
      /**
       * ⚠️ **`NIF` e `IDOtro` son un `choice`, no dos campos.** `NIF` es solo
       * para identificadores españoles; un NIF-IVA extranjero ahí valida contra
       * el esquema y la AEAT lo rechaza con el `1100`. Quién va dónde lo decide
       * `identificacionDestinatario()`; aquí solo se serializa lo que venga.
       */
      const identificacion = d.IDOtro
        ? '<sf:IDOtro>' +
          el('CodigoPais', d.IDOtro.CodigoPais) +
          el('IDType', d.IDOtro.IDType) +
          el('ID', d.IDOtro.ID) +
          '</sf:IDOtro>'
        : el('NIF', d.NIF);
      return '<sf:IDDestinatario>' + el('NombreRazon', d.NombreRazon) + identificacion + '</sf:IDDestinatario>';
    }).join('');
    partes.push(`<sf:Destinatarios>${destinatarios}</sf:Destinatarios>`);
  }

  const detalles = r.Desglose.DetalleDesglose.map(
    (d) =>
      '<sf:DetalleDesglose>' +
      el('Impuesto', d.Impuesto) +
      el('ClaveRegimen', d.ClaveRegimen) +
      // ⚠️ Alternativas, no dos campos: el esquema las declara en un `choice`.
      el('CalificacionOperacion', d.CalificacionOperacion) +
      el('OperacionExenta', d.OperacionExenta) +
      el('TipoImpositivo', d.TipoImpositivo) +
      el('BaseImponibleOimporteNoSujeto', d.BaseImponibleOimporteNoSujeto) +
      el('CuotaRepercutida', d.CuotaRepercutida) +
      '</sf:DetalleDesglose>'
  ).join('');
  partes.push(`<sf:Desglose>${detalles}</sf:Desglose>`);

  partes.push(el('CuotaTotal', r.CuotaTotal));
  partes.push(el('ImporteTotal', r.ImporteTotal));

  const encadenamiento =
    'RegistroAnterior' in r.Encadenamiento
      ? '<sf:RegistroAnterior>' +
        el('IDEmisorFactura', r.Encadenamiento.RegistroAnterior.IDEmisorFactura) +
        el('NumSerieFactura', r.Encadenamiento.RegistroAnterior.NumSerieFactura) +
        el('FechaExpedicionFactura', r.Encadenamiento.RegistroAnterior.FechaExpedicionFactura) +
        el('Huella', r.Encadenamiento.RegistroAnterior.Huella) +
        '</sf:RegistroAnterior>'
      : el('PrimerRegistro', r.Encadenamiento.PrimerRegistro);
  partes.push(`<sf:Encadenamiento>${encadenamiento}</sf:Encadenamiento>`);

  const s = r.SistemaInformatico;
  partes.push(
    '<sf:SistemaInformatico>' +
      el('NombreRazon', s.NombreRazon) +
      el('NIF', s.NIF) +
      el('NombreSistemaInformatico', s.NombreSistemaInformatico) +
      el('IdSistemaInformatico', s.IdSistemaInformatico) +
      el('Version', s.Version) +
      el('NumeroInstalacion', s.NumeroInstalacion) +
      el('TipoUsoPosibleSoloVerifactu', s.TipoUsoPosibleSoloVerifactu) +
      el('TipoUsoPosibleMultiOT', s.TipoUsoPosibleMultiOT) +
      el('IndicadorMultiplesOT', s.IndicadorMultiplesOT) +
      '</sf:SistemaInformatico>'
  );

  partes.push(el('FechaHoraHusoGenRegistro', r.FechaHoraHusoGenRegistro));
  partes.push(el('TipoHuella', r.TipoHuella));
  partes.push(el('Huella', r.Huella));

  return `<sf:RegistroAlta>${partes.join('')}</sf:RegistroAlta>`;
}

/**
 * La cabecera del envío.
 *
 * ⚠️ **`Cabecera` va en el espacio de nombres de `SuministroLR`, no en el de
 * `SuministroInformacion`.** Es donde la declara el esquema —dentro de
 * `RegFactuSistemaFacturacion`—, aunque su *tipo* (`sf:CabeceraType`) venga del
 * otro fichero: en XML Schema el elemento pertenece al esquema que lo declara,
 * no al que define su tipo. Sus hijos sí son `sf:`, porque vienen del tipo.
 *
 * Lo cazó el validador contra los `.xsd` oficiales. A ojo no se ve: el XML
 * parece correcto y solo cambia un prefijo.
 */
export function cabeceraXml(c: CabeceraEnvio): string {
  let xml =
    '<sfLR:Cabecera>' +
    '<sf:ObligadoEmision>' +
    el('NombreRazon', c.obligadoNombreRazon) +
    el('NIF', c.obligadoNif) +
    '</sf:ObligadoEmision>';

  if (c.remisionVoluntaria) {
    xml +=
      '<sf:RemisionVoluntaria>' +
      el('FechaFinVeriFactu', c.remisionVoluntaria.fechaFinVerifactu) +
      el('Incidencia', c.remisionVoluntaria.incidencia) +
      '</sf:RemisionVoluntaria>';
  }

  return xml + '</sfLR:Cabecera>';
}

/**
 * El sobre SOAP completo, listo para enviar.
 *
 * ⚠️ **Un envío admite hasta 1000 registros, y no es lo mismo que 1000 envíos
 * correctos.** La respuesta puede ser `ParcialmenteCorrecto`: cada línea trae su
 * propio estado, así que quien llame tiene que mirar línea por línea y no darse
 * por satisfecho con el estado global.
 */
export function buildEnvioSoap(cabecera: CabeceraEnvio, registros: RegistroAlta[]): string {
  if (!registros.length) {
    throw new Error('verifactu: un envío sin registros no tiene sentido');
  }
  if (registros.length > MAX_REGISTROS_POR_ENVIO) {
    throw new Error(
      `verifactu: ${registros.length} registros superan el máximo de ${MAX_REGISTROS_POR_ENVIO}`
    );
  }

  const cuerpo = registros
    .map((r) => `<sfLR:RegistroFactura>${registroAltaXml(r)}</sfLR:RegistroFactura>`)
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="${NS_SOAP}" xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_SF}">` +
    '<soapenv:Header/>' +
    '<soapenv:Body>' +
    '<sfLR:RegFactuSistemaFacturacion>' +
    cabeceraXml(cabecera) +
    cuerpo +
    '</sfLR:RegFactuSistemaFacturacion>' +
    '</soapenv:Body>' +
    '</soapenv:Envelope>'
  );
}

/**
 * El documento sin el sobre SOAP, que es lo que validan los `.xsd`.
 *
 * Los esquemas describen `RegFactuSistemaFacturacion`, no el `Envelope`: para
 * validar hay que quitarle el sobre, y para enviar hay que ponérselo.
 */
export function buildEnvioDocumento(cabecera: CabeceraEnvio, registros: RegistroAlta[]): string {
  const soap = buildEnvioSoap(cabecera, registros);
  const inicio = soap.indexOf('<sfLR:RegFactuSistemaFacturacion>');
  const fin = soap.indexOf('</soapenv:Body>');
  const nucleo = soap.slice(inicio, fin);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    nucleo.replace(
      '<sfLR:RegFactuSistemaFacturacion>',
      `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_SF}">`
    )
  );
}
