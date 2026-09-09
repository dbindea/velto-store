import { describe, expect, it } from 'vitest';
import {
  desenlaceDe,
  envioReintentable,
  parseRespuesta,
  SoapFaultError,
  ERRORES_TECNICOS,
  ERROR_DUPLICADO
} from './verifactu-respuesta';

/**
 * Las respuestas de la AEAT, con la forma que declara `RespuestaSuministro.xsd`.
 *
 * ⚠️ **Estos son los caminos que no se pueden provocar a voluntad** contra el
 * servicio real: no puedes pedirle a la Agencia que te devuelva un duplicado o
 * un envío parcialmente correcto cuando te venga bien. Si no se prueban aquí,
 * se prueban en producción con una factura real detrás.
 */
const sobre = (cuerpo: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
     <soapenv:Body>${cuerpo}</soapenv:Body>
   </soapenv:Envelope>`;

const correcta = sobre(`
  <sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="urn:x">
    <sfR:CSV>ABC123456789</sfR:CSV>
    <sfR:Cabecera/>
    <sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>
    <sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>
    <sfR:RespuestaLinea>
      <sfR:IDFactura>
        <sfR:NumSerieFactura>2026/0001</sfR:NumSerieFactura>
        <sfR:FechaExpedicionFactura>09-09-2026</sfR:FechaExpedicionFactura>
      </sfR:IDFactura>
      <sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro>
    </sfR:RespuestaLinea>
  </sfR:RespuestaRegFactuSistemaFacturacion>`);

describe('la respuesta correcta', () => {
  it('trae el CSV, el estado y la línea', () => {
    const r = parseRespuesta(correcta);
    expect(r.csv).toBe('ABC123456789');
    expect(r.estadoEnvio).toBe('Correcto');
    expect(r.tiempoEsperaEnvio).toBe(60);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].numSerieFactura).toBe('2026/0001');
    expect(desenlaceDe(r.lineas[0])).toBe('aceptado');
  });

  /**
   * ⚠️ El número de factura es texto, siempre. Sin forzarlo, «12345» se
   * convertiría en número y «2026/0001» no: el mismo campo con dos tipos según
   * la factura, y una comparación que falla solo a veces.
   */
  it('el número de factura se lee como texto aunque sean solo dígitos', () => {
    const xml = correcta.replace('2026/0001', '12345');
    const r = parseRespuesta(xml);
    expect(r.lineas[0].numSerieFactura).toBe('12345');
    expect(typeof r.lineas[0].numSerieFactura).toBe('string');
  });
});

describe('el envío parcialmente correcto', () => {
  /**
   * ⚠️ **El caso que hay que acertar.** La estructura y la cabecera estaban
   * bien, así que el envío «funcionó»; pero una de las dos facturas no entró.
   * Darlo por bueno mirando solo `EstadoEnvio` deja una factura sin remitir y
   * con el sistema convencido de lo contrario.
   */
  const parcial = sobre(`
    <RespuestaRegFactuSistemaFacturacion>
      <CSV>XYZ987</CSV>
      <EstadoEnvio>ParcialmenteCorrecto</EstadoEnvio>
      <RespuestaLinea>
        <IDFactura><NumSerieFactura>2026/0001</NumSerieFactura></IDFactura>
        <EstadoRegistro>Correcto</EstadoRegistro>
      </RespuestaLinea>
      <RespuestaLinea>
        <IDFactura><NumSerieFactura>2026/0002</NumSerieFactura></IDFactura>
        <EstadoRegistro>Incorrecto</EstadoRegistro>
        <CodigoErrorRegistro>1180</CodigoErrorRegistro>
        <DescripcionErrorRegistro>Error en el bloque de Encadenamiento.</DescripcionErrorRegistro>
      </RespuestaLinea>
    </RespuestaRegFactuSistemaFacturacion>`);

  it('se distingue línea a línea, no por el estado global', () => {
    const r = parseRespuesta(parcial);
    expect(r.estadoEnvio).toBe('ParcialmenteCorrecto');
    expect(desenlaceDe(r.lineas[0])).toBe('aceptado');
    expect(desenlaceDe(r.lineas[1])).toBe('rechazado');
    expect(r.lineas[1].codigoError).toBe(1180);
    expect(r.lineas[1].descripcionError).toContain('Encadenamiento');
  });
});

describe('el duplicado', () => {
  const duplicado = sobre(`
    <RespuestaRegFactuSistemaFacturacion>
      <EstadoEnvio>Incorrecto</EstadoEnvio>
      <RespuestaLinea>
        <IDFactura><NumSerieFactura>2026/0001</NumSerieFactura></IDFactura>
        <EstadoRegistro>Incorrecto</EstadoRegistro>
        <CodigoErrorRegistro>3000</CodigoErrorRegistro>
        <DescripcionErrorRegistro>Registro de facturación duplicado.</DescripcionErrorRegistro>
        <RegistroDuplicado>
          <IdPeticionRegistroDuplicado>PET-001</IdPeticionRegistroDuplicado>
          <EstadoRegistroDuplicado>Correcto</EstadoRegistroDuplicado>
        </RegistroDuplicado>
      </RespuestaLinea>
    </RespuestaRegFactuSistemaFacturacion>`);

  /**
   * ⚠️ **Un duplicado no es un fallo que arreglar: es que ya está registrado.**
   * Tratarlo como error lleva a reintentar en bucle algo que la AEAT ya aceptó,
   * y a dar por no remitida una factura que sí lo está.
   */
  it('se reconoce como duplicado, no como rechazo', () => {
    const r = parseRespuesta(duplicado);
    expect(desenlaceDe(r.lineas[0])).toBe('duplicado');
    expect(r.lineas[0].duplicado?.idPeticion).toBe('PET-001');
    expect(r.lineas[0].duplicado?.estadoRegistroDuplicado).toBe('Correcto');
  });

  it('y no se reintenta', () => {
    expect(envioReintentable(parseRespuesta(duplicado))).toBe(false);
  });
});

describe('qué se reintenta y qué no', () => {
  const conError = (codigo: number) =>
    parseRespuesta(
      sobre(`
      <RespuestaRegFactuSistemaFacturacion>
        <EstadoEnvio>Incorrecto</EstadoEnvio>
        <RespuestaLinea>
          <IDFactura><NumSerieFactura>2026/0001</NumSerieFactura></IDFactura>
          <EstadoRegistro>Incorrecto</EstadoRegistro>
          <CodigoErrorRegistro>${codigo}</CodigoErrorRegistro>
        </RespuestaLinea>
      </RespuestaRegFactuSistemaFacturacion>`)
    );

  it('un error técnico de la AEAT sí', () => {
    // 3501 = «Error técnico de base de datos». No es culpa del XML.
    expect(desenlaceDe(conError(3501).lineas[0])).toBe('reintentable');
    expect(envioReintentable(conError(3501))).toBe(true);
  });

  /**
   * ⚠️ Reenviar el mismo XML ante un error de validación da exactamente el
   * mismo resultado: gasta cuota y esconde el problema.
   */
  it('un error de validación NO', () => {
    // 1174 = fecha de expedición del registro anterior incorrecta.
    expect(desenlaceDe(conError(1174).lineas[0])).toBe('rechazado');
    expect(envioReintentable(conError(1174))).toBe(false);
  });

  it('los doce técnicos salen del fichero de errores de la AEAT', () => {
    expect(ERRORES_TECNICOS.size).toBe(12);
    expect(ERRORES_TECNICOS.has(4108)).toBe(true); // al obtener el certificado
    expect(ERRORES_TECNICOS.has(3501)).toBe(true); // de base de datos
    expect(ERRORES_TECNICOS.has(ERROR_DUPLICADO)).toBe(false);
  });

  /**
   * ⚠️ **`AceptadoConErrores` cuenta como aceptado.** El registro entró;
   * reenviarlo daría un duplicado. Los errores que trae son avisos que mirar,
   * no un motivo para repetir.
   */
  it('aceptado con errores es aceptado', () => {
    const r = parseRespuesta(
      sobre(`
      <RespuestaRegFactuSistemaFacturacion>
        <EstadoEnvio>Correcto</EstadoEnvio>
        <RespuestaLinea>
          <IDFactura><NumSerieFactura>2026/0001</NumSerieFactura></IDFactura>
          <EstadoRegistro>AceptadoConErrores</EstadoRegistro>
          <CodigoErrorRegistro>1300</CodigoErrorRegistro>
        </RespuestaLinea>
      </RespuestaRegFactuSistemaFacturacion>`)
    );
    expect(desenlaceDe(r.lineas[0])).toBe('aceptado');
  });
});

describe('lo que no es una respuesta', () => {
  it('un SOAP Fault se distingue y se lanza', () => {
    const fault = sobre(`
      <soapenv:Fault xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <faultcode>soapenv:Client</faultcode>
        <faultstring>El titular del certificado no está autorizado</faultstring>
      </soapenv:Fault>`);
    expect(() => parseRespuesta(fault)).toThrow(SoapFaultError);
  });

  /**
   * ⚠️ Un cuerpo ilegible **no es un rechazo**: significa que no sabemos qué ha
   * pasado con las facturas. Confundir las dos cosas es dar por no remitida una
   * factura que puede haber entrado.
   */
  it('un cuerpo que no reconocemos falla en vez de parecer un rechazo', () => {
    expect(() => parseRespuesta('<html>Servicio no disponible</html>')).toThrow(
      /no contiene RespuestaRegFactuSistemaFacturacion/
    );
  });

  it('una respuesta sin EstadoEnvio tampoco se interpreta', () => {
    const sinEstado = sobre('<RespuestaRegFactuSistemaFacturacion><CSV>X</CSV></RespuestaRegFactuSistemaFacturacion>');
    expect(() => parseRespuesta(sinEstado)).toThrow(/EstadoEnvio/);
  });
});
