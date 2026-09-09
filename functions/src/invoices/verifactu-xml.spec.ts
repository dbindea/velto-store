import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { validateXML } from 'xmllint-wasm';
import { buildEnvioDocumento, buildEnvioSoap, escapeXml, registroAltaXml } from './verifactu-xml';
import { buildRegistroAlta, sistemaInformatico } from './verifactu';

/**
 * ⚠️ **Esto valida contra los `.xsd` OFICIALES de la AEAT**, los mismos que
 * están versionados en `docs/aeat/`. No es una comprobación de que el XML «se
 * parezca»: es el mismo validador que aplicará la Agencia, corriendo aquí.
 *
 * Es la única forma de saber que el envío está bien **antes** de que exista un
 * envío. Sin esto, el primer XML que se comprueba de verdad es el primero que
 * se manda, y un rechazo ahí llega con una factura ya emitida detrás.
 */
const DIR_AEAT = path.resolve(__dirname, '../../../docs/aeat');

function leerEsquema(nombre: string) {
  return { fileName: nombre, contents: fs.readFileSync(path.join(DIR_AEAT, nombre), 'utf8') };
}

/**
 * `SuministroLR.xsd` importa `SuministroInformacion.xsd` por su ruta relativa,
 * así que hay que dárselos los dos al validador o no resuelve el `import`.
 *
 * ⚠️ **Y el de la AEAT importa a su vez el de firma XML del W3C por una URL.**
 * Sin él, el esquema **no compila** —«The QName value Signature does not
 * resolve»— y ningún XML se valida. Se precarga desde `docs/aeat/` con el
 * nombre exacto que espera el `import`, para que la validación no dependa de
 * que haya red ni de que el W3C siga sirviendo ese fichero.
 */
const ESQUEMAS = [
  leerEsquema('SuministroLR.xsd'),
  leerEsquema('SuministroInformacion.xsd'),
  {
    fileName: 'http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd',
    contents: fs.readFileSync(path.join(DIR_AEAT, 'xmldsig-core-schema.xsd'), 'utf8')
  }
];

async function validar(xml: string) {
  return validateXML({
    xml: [{ fileName: 'envio.xml', contents: xml }],
    schema: [ESQUEMAS[0].contents],
    preload: ESQUEMAS
  });
}

const cabecera = {
  obligadoNombreRazon: 'VELTO MOBILITY, S.L.',
  obligadoNif: 'B88866900',
  // Antes del 1 de enero de 2027 la remisión es voluntaria: es lo que evita el
  // tramo de facturas emitidas y no remitidas.
  remisionVoluntaria: { fechaFinVerifactu: '31-12-2026' }
};

const sistema = sistemaInformatico('B88866900', 'VELTO MOBILITY, S.L.');

const registroBase = {
  emisorNif: 'B88866900',
  emisorNombre: 'VELTO MOBILITY, S.L.',
  fullNumber: '2026/0001',
  fechaExpedicion: '09-09-2026',
  tipoFactura: 'F1' as const,
  descripcionOperacion: 'Alquiler de vehículo sin conductor Kia Ceed, matrícula 7777ATM',
  destinatario: { nombreRazon: 'Cliente Pruebas', nif: '12345678Z' },
  lines: [{ taxRegime: 'standard', vatRate: 0.21 }],
  desglose: [{ vatRate: 0.21, base: 200, vat: 42 }],
  cuotaTotal: 42,
  importeTotal: 242,
  sistema,
  fechaHoraHusoGenRegistro: '2026-09-09T10:20:30+02:00',
  huella: 'A'.repeat(64)
};

describe('el XML del envío valida contra los esquemas de la AEAT', () => {
  it('una factura ordinaria, primer registro de la cadena', async () => {
    const xml = buildEnvioDocumento(cabecera, [buildRegistroAlta(registroBase)]);
    const resultado = await validar(xml);
    expect(resultado.errors).toEqual([]);
    expect(resultado.valid).toBe(true);
  }, 30_000);

  it('una factura encadenada con la anterior', async () => {
    const registro = buildRegistroAlta({
      ...registroBase,
      fullNumber: '2026/0002',
      anterior: {
        numSerieFactura: '2026/0001',
        fechaExpedicionFactura: '09-09-2026',
        huella: 'B'.repeat(64)
      }
    });
    const resultado = await validar(buildEnvioDocumento(cabecera, [registro]));
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  it('una rectificativa por diferencias, con importes negativos', async () => {
    const registro = buildRegistroAlta({
      ...registroBase,
      fullNumber: 'R2026/0001',
      tipoFactura: 'R1',
      tipoRectificativa: 'I',
      rectificada: { numSerieFactura: '2026/0001', fechaExpedicionFactura: '09-09-2026' },
      desglose: [{ vatRate: 0.21, base: -200, vat: -42 }],
      cuotaTotal: -42,
      importeTotal: -242
    });
    const resultado = await validar(buildEnvioDocumento(cabecera, [registro]));
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  it('una rectificativa por sustitución declara base y cuota rectificadas', async () => {
    const registro = buildRegistroAlta({
      ...registroBase,
      fullNumber: 'R2026/0002',
      tipoFactura: 'R1',
      tipoRectificativa: 'S',
      rectificada: { numSerieFactura: '2026/0002', fechaExpedicionFactura: '09-09-2026' },
      importeRectificacion: { baseRectificada: 200, cuotaRectificada: 42 }
    });
    const resultado = await validar(buildEnvioDocumento(cabecera, [registro]));
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  /**
   * ⚠️ **El destinatario es EXTRANJERO, y ese es el punto.** Esta prueba
   * existía con un NIF español y por eso pasaba mientras la realidad fallaba:
   * una entrega intracomunitaria exenta la cobra, por definición, alguien de
   * otro Estado miembro, y su NIF-IVA **no puede ir en `NIF`**. La AEAT lo
   * rechazó con el `1100` el 9 de septiembre de 2026, contra preproducción, con
   * este mismo XML dándose por válido aquí.
   */
  it('una entrega intracomunitaria exenta, con destinatario extranjero', async () => {
    const registro = buildRegistroAlta({
      ...registroBase,
      destinatario: { nombreRazon: 'Client Intracomunitar SRL', nif: 'RO12345678' },
      lines: [{ taxRegime: 'exempt_eu' }],
      desglose: [],
      exemptTotal: 12000,
      cuotaTotal: 0,
      importeTotal: 12000
    });
    const xml = buildEnvioDocumento(cabecera, [registro]);
    // Lo que la validación de esquema NO comprueba, porque el patrón de `NIF`
    // admite la cadena: que el identificador esté en el campo que le toca.
    expect(xml).toContain('<sf:IDOtro>');
    expect(xml).toContain('<sf:CodigoPais>RO</sf:CodigoPais>');
    expect(xml).not.toContain('<sf:NIF>RO12345678</sf:NIF>');
    const resultado = await validar(xml);
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  it('una venta en REBU', async () => {
    const registro = buildRegistroAlta({
      ...registroBase,
      lines: [{ taxRegime: 'rebu', vatRate: 0.21 }],
      desglose: [{ vatRate: 0.21, base: 1239.67, vat: 260.33 }],
      cuotaTotal: 260.33,
      importeTotal: 7000
    });
    const resultado = await validar(buildEnvioDocumento(cabecera, [registro]));
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  it('con fecha de operación distinta de la de expedición', async () => {
    const registro = buildRegistroAlta({ ...registroBase, fechaOperacion: '01-08-2026' });
    const resultado = await validar(buildEnvioDocumento(cabecera, [registro]));
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  it('un lote de varias facturas en un solo envío', async () => {
    const registros = [1, 2, 3].map((n) =>
      buildRegistroAlta({ ...registroBase, fullNumber: `2026/000${n}` })
    );
    const resultado = await validar(buildEnvioDocumento(cabecera, registros));
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  it('sin remisión voluntaria, que es como irá a partir del 1 de enero', async () => {
    const xml = buildEnvioDocumento(
      { obligadoNombreRazon: 'VELTO MOBILITY, S.L.', obligadoNif: 'B88866900' },
      [buildRegistroAlta(registroBase)]
    );
    const resultado = await validar(xml);
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  /**
   * ⚠️ La prueba que da sentido a las de arriba: si el validador aceptara
   * cualquier cosa, que las nuestras pasen no diría nada.
   */
  it('y RECHAZA un registro al que le falta un campo obligatorio', async () => {
    const registro = buildRegistroAlta(registroBase);
    const xml = buildEnvioDocumento(cabecera, [registro]).replace(
      /<sf:CuotaTotal>[^<]*<\/sf:CuotaTotal>/,
      ''
    );
    const resultado = await validar(xml);
    expect(resultado.valid).toBe(false);
  }, 30_000);

  it('y RECHAZA los elementos en el orden equivocado', async () => {
    // El esquema los declara en un `xs:sequence`: el orden es parte de la
    // validación, y por eso el serializador no recorre el objeto.
    const xml = buildEnvioDocumento(cabecera, [buildRegistroAlta(registroBase)]).replace(
      /(<sf:TipoFactura>[^<]*<\/sf:TipoFactura>)(<sf:DescripcionOperacion>[^<]*<\/sf:DescripcionOperacion>)/,
      '$2$1'
    );
    const resultado = await validar(xml);
    expect(resultado.valid).toBe(false);
  }, 30_000);
});

describe('el escapado', () => {
  /**
   * ⚠️ Una razón social con `&` —«Pérez & Hijos, S.L.»— produce un XML mal
   * formado, y la AEAT contesta con un error de parseo que no dice cuál era el
   * campo.
   */
  it('una razón social con & no rompe el documento', async () => {
    const registro = buildRegistroAlta({
      ...registroBase,
      destinatario: { nombreRazon: 'Pérez & Hijos <S.L.>', nif: '12345678Z' }
    });
    const xml = buildEnvioDocumento(cabecera, [registro]);
    expect(xml).toContain('P&#233;rez &amp; Hijos &lt;S.L.&gt;'.replace('&#233;', 'é'));
    const resultado = await validar(xml);
    expect(resultado.errors).toEqual([]);
  }, 30_000);

  it('escapa los cinco caracteres de XML', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });
});

describe('los límites del envío', () => {
  it('un envío sin registros no tiene sentido y se rechaza aquí', () => {
    expect(() => buildEnvioSoap(cabecera, [])).toThrow();
  });

  it('más de 1000 registros se rechazan antes de salir', () => {
    const uno = buildRegistroAlta(registroBase);
    expect(() => buildEnvioSoap(cabecera, new Array(1001).fill(uno))).toThrow();
  });

  it('el sobre SOAP envuelve el mismo documento que se valida', () => {
    const registro = buildRegistroAlta(registroBase);
    expect(buildEnvioSoap(cabecera, [registro])).toContain('<soapenv:Body>');
    expect(registroAltaXml(registro)).toContain('<sf:RegistroAlta>');
  });
});
