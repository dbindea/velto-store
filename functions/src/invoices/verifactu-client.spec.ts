import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as https from 'https';
import * as tls from 'tls';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  abrirP12,
  certificadoDesdeSecreto,
  enviarRegistros,
  VerifactuHttpError
} from './verifactu-client';
import { SoapFaultError } from './verifactu-respuesta';

/**
 * El cliente, contra un servidor TLS **de verdad** levantado aquí.
 *
 * ⚠️ **No es un mock.** La autenticación contra la AEAT es mTLS: el servicio
 * identifica al obligado por el certificado con el que se abre la conexión. Un
 * doble de la capa HTTP probaría el parseo y no probaría lo único que aquí
 * puede fallar de verdad — que el `.p12` se cargue, se descifre con su
 * contraseña y **llegue al otro lado**.
 *
 * Por eso el servidor pide certificado de cliente y cada prueba comprueba que
 * lo ha recibido. Así apareció `Unsupported PKCS12 PFX data`, que contra un
 * doble no habría salido hasta el primer envío real a la Agencia.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verifactu-'));
let servidor: https.Server;
let puerto = 0;
let pfxBase64 = '';
let caPem = '';
const CLAVE = 'pruebas';

/** Última petición recibida, para poder mirarla desde las pruebas. */
let ultima: { cuerpo: string; headers: Record<string, unknown>; certCliente?: tls.PeerCertificate };
/** Qué contesta el servidor en la próxima petición. */
let siguienteRespuesta: { status: number; body: string } = { status: 200, body: '' };

const sobre = (cuerpo: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;

const respuestaCorrecta = sobre(`
  <RespuestaRegFactuSistemaFacturacion>
    <CSV>CSV-DE-PRUEBAS</CSV>
    <EstadoEnvio>Correcto</EstadoEnvio>
    <RespuestaLinea>
      <IDFactura><NumSerieFactura>2026/0001</NumSerieFactura></IDFactura>
      <EstadoRegistro>Correcto</EstadoRegistro>
    </RespuestaLinea>
  </RespuestaRegFactuSistemaFacturacion>`);

function openssl(args: string[]) {
  execFileSync('openssl', args, { cwd: tmp, stdio: 'pipe' });
}

beforeAll(async () => {
  // Un certificado autofirmado que hace de servidor y de CA, y otro de cliente
  // empaquetado en `.p12` como el de la FNMT.
  openssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', 'server.key', '-out', 'server.crt', '-days', '2',
    '-subj', '/CN=localhost',
    // Sin SAN no vale el CN: Node exige el nombre alternativo desde hace años.
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'
  ]);
  openssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', 'client.key', '-out', 'client.crt', '-days', '2',
    '-subj', '/CN=VELTO MOBILITY SL'
  ]);
  /**
   * ⚠️ **El cifrado antiguo se pide a mano, y es lo que hace útil esta prueba.**
   * Es como empaqueta la FNMT, y es justo lo que OpenSSL 3 —el de Node 22— se
   * niega a abrir: `Unsupported PKCS12 PFX data`. Dejando que `openssl` elija,
   * el resultado depende de la versión instalada: con la 1.1.1 sale el antiguo y
   * la prueba vale, con la 3.x sale en AES, Node lo abre sin ayuda y la prueba
   * pasaría **aunque el fallo siguiera ahí**. Un test que solo detecta el fallo
   * en algunas máquinas es peor que no tenerlo.
   */
  openssl([
    'pkcs12', '-export', '-out', 'client.p12',
    '-inkey', 'client.key', '-in', 'client.crt',
    '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1',
    '-passout', `pass:${CLAVE}`
  ]);

  pfxBase64 = fs.readFileSync(path.join(tmp, 'client.p12')).toString('base64');
  caPem = fs.readFileSync(path.join(tmp, 'server.crt'), 'utf8');

  servidor = https.createServer(
    {
      key: fs.readFileSync(path.join(tmp, 'server.key')),
      cert: fs.readFileSync(path.join(tmp, 'server.crt')),
      // Pide certificado de cliente, pero no corta la conexión si no llega:
      // así una prueba puede comprobar que SIN certificado tampoco se identifica.
      requestCert: true,
      rejectUnauthorized: false,
      ca: [fs.readFileSync(path.join(tmp, 'client.crt'))]
    },
    (req, res) => {
      const trozos: Buffer[] = [];
      req.on('data', (d) => trozos.push(d as Buffer));
      req.on('end', () => {
        ultima = {
          cuerpo: Buffer.concat(trozos).toString('utf8'),
          headers: req.headers as Record<string, unknown>,
          certCliente: (req.socket as tls.TLSSocket).getPeerCertificate()
        };
        res.writeHead(siguienteRespuesta.status, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(siguienteRespuesta.body);
      });
    }
  );

  await new Promise<void>((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      puerto = (servidor.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const opciones = () => ({
  endpoint: `https://127.0.0.1:${puerto}/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`,
  certificado: certificadoDesdeSecreto(pfxBase64, CLAVE),
  ca: caPem,
  timeoutMs: 5000
});

describe('el cliente contra un servicio TLS real', () => {
  /**
   * ⚠️ **La prueba que importa**: que el certificado llegue al otro lado. Es lo
   * único que no se puede comprobar entrando en la sede con el navegador, y lo
   * primero que falla al pasar de la sede a una llamada máquina a máquina.
   */
  it('presenta el certificado de cliente', async () => {
    siguienteRespuesta = { status: 200, body: respuestaCorrecta };
    await enviarRegistros(sobre('<x/>'), opciones());
    expect(ultima.certCliente?.subject?.CN).toBe('VELTO MOBILITY SL');
  });

  it('manda el XML como texto y con las cabeceras SOAP', async () => {
    siguienteRespuesta = { status: 200, body: respuestaCorrecta };
    await enviarRegistros(sobre('<marca>hola</marca>'), opciones());
    expect(ultima.cuerpo).toContain('<marca>hola</marca>');
    expect(String(ultima.headers['content-type'])).toContain('text/xml');
    expect(ultima.headers['soapaction']).toBe('""');
  });

  it('devuelve la respuesta ya parseada', async () => {
    siguienteRespuesta = { status: 200, body: respuestaCorrecta };
    const { respuesta } = await enviarRegistros(sobre('<x/>'), opciones());
    expect(respuesta.csv).toBe('CSV-DE-PRUEBAS');
    expect(respuesta.estadoEnvio).toBe('Correcto');
  });

  /**
   * ⚠️ Un `500` puede traer un SOAP Fault que sí hay que leer. Descartarlo por
   * el código de estado perdería el motivo real del rechazo.
   */
  it('un 500 con SOAP Fault se lee, no se descarta', async () => {
    siguienteRespuesta = {
      status: 500,
      body: sobre(
        '<soapenv:Fault xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><faultcode>Client</faultcode><faultstring>NIF no identificado</faultstring></soapenv:Fault>'
      )
    };
    await expect(enviarRegistros(sobre('<x/>'), opciones())).rejects.toThrow(SoapFaultError);
  });

  it('un 403 se lanza con su cuerpo, para poder leer el motivo', async () => {
    siguienteRespuesta = { status: 403, body: 'Certificado no autorizado' };
    await expect(enviarRegistros(sobre('<x/>'), opciones())).rejects.toThrow(VerifactuHttpError);
  });

  /**
   * ⚠️ **Un fallo de red NO es un rechazo.** Si la conexión se corta no sabemos
   * si la AEAT llegó a registrar el envío, y tratarlo como «rechazado» llevaría
   * a reenviar algo que quizá ya entró — o a dar por no remitida una factura que
   * sí lo está.
   */
  it('un servicio que no contesta da un error de transporte, no un rechazo', async () => {
    // Un puerto donde no escucha nadie: la conexión ni se abre.
    const muerto = { ...opciones(), endpoint: `https://127.0.0.1:${puerto + 1}/x`, timeoutMs: 2000 };
    await expect(enviarRegistros(sobre('<x/>'), muerto)).rejects.toThrow();
    // Y lo que NO puede pasar es que devuelva una respuesta con estado.
    await expect(enviarRegistros(sobre('<x/>'), muerto)).rejects.not.toHaveProperty(
      'estadoEnvio'
    );
  });
});

describe('el certificado desde el secreto', () => {
  it('se decodifica desde base64, que es como lo guarda Secret Manager', () => {
    const cert = certificadoDesdeSecreto(pfxBase64, CLAVE);
    expect(cert.key).toContain('-----BEGIN RSA PRIVATE KEY-----');
    expect(cert.cert).toContain('-----BEGIN CERTIFICATE-----');
  });

  /**
   * ⚠️ **La prueba de la regresión**, y todo el bloque de arriba también: el
   * `.p12` de estas pruebas lleva **el cifrado antiguo a propósito**, el mismo
   * que usa la FNMT y que OpenSSL 3 rechaza. Si alguien vuelve a pasárselo a
   * Node directamente, las conexiones de este fichero dejan de abrirse.
   *
   * No se comprueba que Node falle: eso es afirmar el defecto de otro, y el día
   * que lo arregle esta prueba se caería sin que nada estuviera roto. Lo que se
   * comprueba es lo que nos importa — que el certificado se abre y **llega al
   * otro lado**.
   */
  it('abre un .p12 con el cifrado antiguo de la FNMT', () => {
    const abierto = abrirP12(Buffer.from(pfxBase64, 'base64'), CLAVE);
    expect(abierto.cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(abierto.key).toContain('PRIVATE KEY');
  });

  /**
   * ⚠️ La contraseña equivocada da un error de ASN.1 que manda a buscar un
   * fichero corrupto. El caso real es cambiar un secreto y no el otro.
   */
  it('una contraseña incorrecta lo dice, en vez de parecer un fichero roto', () => {
    expect(() => abrirP12(Buffer.from(pfxBase64, 'base64'), 'otra')).toThrow(/contraseña/);
  });

  /**
   * ⚠️ Sin certificado es mejor no salir: una petición sin identificarse recibe
   * un rechazo que parece otra cosa —un problema de datos— y manda a buscar el
   * fallo donde no está.
   */
  it('sin certificado no se intenta el envío', () => {
    expect(() => certificadoDesdeSecreto(undefined, CLAVE)).toThrow(/VELTO_SIGNING_CERT/);
  });
});
