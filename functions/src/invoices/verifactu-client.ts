/**
 * El cliente que habla con la AEAT.
 *
 * ⚠️ **La autenticación es mTLS con el certificado de representante**, el mismo
 * `.p12` de la FNMT con el que se sellan los contratos. No hay usuario ni clave:
 * el servicio identifica al obligado tributario por el certificado con el que se
 * abre la conexión. Por eso probarlo entrando en la sede con el navegador **no
 * prueba nada**: ahí lo presenta el navegador, aquí lo presenta Node, y cambian
 * el formato y la cadena que se envía.
 *
 * El certificado vive en Secret Manager y **se lee dentro del handler**, nunca
 * en el módulo: en Cloud Functions los secretos se resuelven después de cargar
 * el grafo de módulos, y leerlo arriba da `undefined` (F-12).
 */

import * as https from 'https';
import * as tls from 'tls';
import { URL } from 'url';
import * as forge from 'node-forge';
import { parseRespuesta, RespuestaEnvio } from './verifactu-respuesta';

/**
 * El certificado ya abierto: clave privada y cadena, en PEM.
 *
 * ⚠️ **No se le pasa el `.p12` a Node directamente, y hay un motivo.** Node 22
 * usa OpenSSL 3, que **rechaza los PKCS#12 cifrados con algoritmos antiguos**
 * —RC2, 3DES— con un escueto `Unsupported PKCS12 PFX data`. Y así es como se
 * emiten muchos certificados, incluidos los de la FNMT.
 *
 * Se abre con `node-forge`, que trae su propia implementación y no depende de
 * lo que OpenSSL haya decidido deshabilitar. Es la misma librería con la que ya
 * se sella el contrato, así que no entra nada nuevo en el proyecto.
 *
 * Descubierto probando el cliente contra un servidor TLS de verdad. Contra un
 * doble de la capa HTTP no habría aparecido: habría salido en el primer intento
 * real contra la AEAT.
 */
export interface CertificadoCliente {
  key: string;
  /**
   * La cadena en PEM, **el del titular primero** y detrás los intermedios que
   * traiga el `.p12`.
   *
   * ⚠️ **Los intermedios van aquí, no en `ca`.** Son dos cosas distintas que se
   * escriben parecido: `ca` es con qué verificamos al **servidor**, y `cert` es
   * lo que le **presentamos** a él. Mandando solo el certificado del titular, un
   * servidor que no tenga el intermedio cargado no puede construir la cadena y
   * rechaza la conexión — un fallo que aparece únicamente contra el servicio
   * real, porque un servidor de pruebas se monta con el propio certificado como
   * CA y no necesita intermedio ninguno.
   */
  cert: string;
  /**
   * Quién es y hasta cuándo vale, leído del propio certificado.
   *
   * ⚠️ **El certificado de la FNMT caduca**, y cuando lo haga las facturas
   * dejarán de remitirse. Sin este dato el primer aviso sería una factura sin
   * llegar a la Agencia; con él, la pantalla puede avisar antes.
   */
  titular?: {
    subject: string;
    emisor: string;
    validoHasta: string;
    intermedios: number;
  };
}

export interface EnvioOptions {
  endpoint: string;
  certificado: CertificadoCliente;
  /** Milisegundos. Un envío que no contesta no puede colgar la function. */
  timeoutMs?: number;
  /** Solo para pruebas: aceptar un certificado de servidor no verificable. */
  rejectUnauthorized?: boolean;
  /** Solo para pruebas: la CA con la que verificar al servidor. */
  ca?: Buffer | string;
}

export class VerifactuHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`verifactu: el servicio respondió ${status}`);
    this.name = 'VerifactuHttpError';
  }
}

/**
 * Manda el sobre SOAP y devuelve la respuesta ya parseada.
 *
 * ⚠️ **Un fallo de red no es un rechazo.** Si la conexión se corta, no sabemos
 * si la AEAT llegó a registrar el envío: puede haberlo procesado y habernos
 * perdido la respuesta. Por eso los errores de transporte se lanzan como tales y
 * **nunca se traducen a «rechazado»** — quien llame tiene que poder distinguir
 * «lo rechazaron» de «no sé qué ha pasado», y en el segundo caso consultar antes
 * de reenviar, o se duplica.
 */
export async function enviarRegistros(
  soapXml: string,
  options: EnvioOptions
): Promise<{ respuesta: RespuestaEnvio; raw: string }> {
  const url = new URL(options.endpoint);
  const cuerpo = Buffer.from(soapXml, 'utf8');

  const raw = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        key: options.certificado.key,
        cert: options.certificado.cert,
        ca: options.ca,
        rejectUnauthorized: options.rejectUnauthorized !== false,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': cuerpo.length,
          // El WSDL declara `soapAction` vacío, pero la cabecera tiene que ir:
          // algunos servidores rechazan la petición si falta.
          SOAPAction: '""'
        }
      },
      (res) => {
        const trozos: Buffer[] = [];
        res.on('data', (d) => trozos.push(d as Buffer));
        res.on('end', () => {
          const texto = Buffer.concat(trozos).toString('utf8');
          const status = res.statusCode ?? 0;
          /**
           * ⚠️ Un `500` **puede traer un SOAP Fault que sí hay que leer**, así
           * que no se descarta por el código: se deja pasar y que lo interprete
           * el parseo, que sabe distinguir un fault de un cuerpo ilegible.
           */
          if (status >= 400 && status !== 500) {
            reject(new VerifactuHttpError(status, texto));
            return;
          }
          resolve(texto);
        });
      }
    );

    req.setTimeout(options.timeoutMs ?? 30_000, () => {
      req.destroy(new Error('verifactu: el servicio no respondió a tiempo'));
    });
    req.on('error', reject);
    req.write(cuerpo);
    req.end();
  });

  return { respuesta: parseRespuesta(raw), raw };
}

/**
 * El certificado desde el secreto, listo para usar.
 *
 * Secret Manager guarda **texto**, así que el `.p12` va en base64 y hay que
 * decodificarlo. Sin certificado no se lanza el envío: es mejor no salir que
 * salir sin identificarse y recibir un rechazo que parece otra cosa.
 *
 * ⚠️ **El `.p12` se abre aquí y no se le pasa a Node.** Ver `CertificadoCliente`:
 * OpenSSL 3 rechaza el cifrado con el que se emiten muchos certificados, el de
 * la FNMT entre ellos, con un mensaje que no dice de qué se queja.
 */
export function certificadoDesdeSecreto(
  p12Base64: string | undefined,
  passphrase: string | undefined
): CertificadoCliente {
  if (!p12Base64) {
    throw new Error('verifactu: falta el certificado (VELTO_SIGNING_CERT)');
  }
  return abrirP12(Buffer.from(p12Base64, 'base64'), passphrase ?? '');
}

/**
 * Saca la clave privada y la cadena de un PKCS#12.
 *
 * ⚠️ **La contraseña equivocada no da un error claro.** node-forge falla al
 * descifrar con un mensaje sobre MAC o ASN.1, que manda a buscar un problema en
 * el fichero. Se traduce aquí, porque el caso real —el secreto de la contraseña
 * cambiado y el del certificado no— es exactamente ese.
 */
export function abrirP12(p12: Buffer, passphrase: string): CertificadoCliente {
  let almacen: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12.toString('binary')));
    almacen = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);
  } catch (e) {
    throw new Error(
      `verifactu: no se pudo abrir el certificado — ¿contraseña incorrecta? (${
        e instanceof Error ? e.message : String(e)
      })`
    );
  }

  const claves = almacen.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ];
  const clave = claves?.find((b) => b.key)?.key;
  if (!clave) {
    throw new Error('verifactu: el certificado no contiene una clave privada');
  }

  const certBags =
    almacen.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certificados = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  if (!certificados.length) {
    throw new Error('verifactu: el certificado no contiene ningún certificado');
  }

  /**
   * ⚠️ **El orden dentro del `.p12` no está garantizado**, y el primero no tiene
   * por qué ser el del titular. Se identifica por ser el que **casa con la clave
   * privada**: comparando el módulo de la pública con el de la clave. Cogiendo
   * el primero a ciegas se puede acabar presentando el intermedio de la FNMT
   * como si fuera nuestro, y el servicio responde que el titular no está
   * autorizado — que parece un problema de permisos.
   */
  const propio =
    certificados.find((c) => {
      const pub = c.publicKey as forge.pki.rsa.PublicKey | undefined;
      return !!pub?.n && pub.n.equals((clave as forge.pki.rsa.PrivateKey).n);
    }) ?? certificados[0];

  // El del titular primero: es el orden que Node espera en una cadena.
  const cadena = [propio, ...certificados.filter((c) => c !== propio)];

  return {
    key: forge.pki.privateKeyToPem(clave),
    cert: cadena.map((c) => forge.pki.certificateToPem(c)).join(''),
    titular: {
      subject: nombreDistinguido(propio.subject.attributes),
      emisor: nombreDistinguido(propio.issuer.attributes),
      validoHasta: propio.validity.notAfter.toISOString(),
      intermedios: cadena.length - 1
    }
  };
}

/**
 * El nombre distinguido de un certificado, legible.
 *
 * ⚠️ **node-forge devuelve las cadenas byte a byte, no decodificadas.** Un
 * certificado de la FNMT trae «AC Representación» en UTF-8, y sin decodificarlo
 * sale «AC Representaciã³n». No es cosmético: este texto está para que una
 * persona lo lea y reconozca su propio certificado, y un nombre roto invita a
 * pensar que el fichero está mal.
 */
function nombreDistinguido(attrs: forge.pki.CertificateField[]): string {
  return attrs
    .map((a) => {
      const nombre = a.shortName || a.name || a.type;
      const valor = typeof a.value === 'string' ? Buffer.from(a.value, 'binary').toString('utf8') : String(a.value);
      return `${nombre}=${valor}`;
    })
    .join(', ');
}

export interface PruebaConexion {
  endpoint: string;
  /** ¿Completó el saludo TLS presentando nuestro certificado? */
  handshake: boolean;
  /** Lo que sabemos de nuestro propio certificado. */
  titular?: CertificadoCliente['titular'];
  /** Días que le quedan al certificado. Negativo si ya caducó. */
  diasParaCaducar?: number;
  error?: string;
}

/**
 * ¿Se puede abrir una conexión autenticada con la AEAT?
 *
 * ⚠️ **Esto NO prueba que la Agencia acepte nuestra identidad**, y decirlo
 * importa: el saludo TLS puede completarse y el servicio rechazar después al
 * titular en la capa de aplicación (`4112`, «el titular del certificado debe ser
 * obligado a emisión, colaborador social, apoderado o sucesor»). Lo que esto
 * responde es lo anterior a eso — que el `.p12` se abre, que no ha caducado y
 * que llega hasta el otro lado— que es justo lo que falla primero y lo que un
 * navegador entrando en la sede no demuestra: allí el certificado lo presenta el
 * navegador, aquí lo presenta Node.
 *
 * Sirve además para lo que va a pasar seguro: **el certificado de la FNMT
 * caduca**. Sin esto, el primer aviso sería una factura sin remitir.
 */
export async function probarConexion(
  endpoint: string,
  certificado: CertificadoCliente,
  timeoutMs = 15_000
): Promise<PruebaConexion> {
  const url = new URL(endpoint);
  const caducidad = certificado.titular?.validoHasta
    ? new Date(certificado.titular.validoHasta)
    : undefined;
  const base: PruebaConexion = {
    endpoint,
    handshake: false,
    titular: certificado.titular,
    diasParaCaducar: caducidad
      ? Math.floor((caducidad.getTime() - Date.now()) / 86_400_000)
      : undefined
  };

  return new Promise<PruebaConexion>((resolve) => {
    const socket = tls.connect(
      {
        host: url.hostname,
        port: Number(url.port) || 443,
        servername: url.hostname,
        key: certificado.key,
        cert: certificado.cert
      },
      () => {
        resolve({ ...base, handshake: socket.authorized });
        socket.end();
      }
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({ ...base, error: 'la conexión no se completó a tiempo' });
    });
    socket.on('error', (e) => resolve({ ...base, error: e.message }));
  });
}
