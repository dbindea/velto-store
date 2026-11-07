/**
 * Probar la operativa de PREAUTORIZACIÓN contra el entorno de test de BBVA.
 *
 * ⚠️ **Esto NO es código de la aplicación.** Es la herramienta con la que se
 * contestó, el 7 de noviembre de 2026, si la fianza se puede **retener** en la
 * tarjeta en vez de cobrarse: Dorel lo preguntó así —*«pre-autorizar y luego
 * cobrar parte de ellas, total y desbloquear»*— y la respuesta no se podía dar
 * leyendo documentación, porque lo que decide es si **su comercio** tiene la
 * operativa habilitada y con qué plazo.
 *
 * Vive en `docs/` por lo mismo que los guiones de reglas: no se compila, no se
 * despliega y no entra en el bundle.
 *
 * ⚠️ **Solo contra `sis-t.redsys.es` y con la tarjeta de pruebas.** Las
 * operaciones de este guion se ven en el portal de test del banco
 * (`https://sis-t.redsys.es:25443/portalBBVA`), que es el otro motivo por el que
 * existe: deja operaciones con la fecha de hoy y un pedido conocido para poder
 * buscarlas allí.
 *
 * LOS CUATRO TIPOS DE OPERACIÓN QUE IMPORTAN AQUÍ
 *   1  Preautorización          — bloquea el importe, sin cargo en firme
 *   2  Confirmación             — cobra, por importe MENOR O IGUAL; el resto se libera
 *   9  Anulación                — libera el bloqueo entero
 *   11 Preautorización de reemplazo — sustituye una anterior (prórrogas)
 *
 * CÓMO SE USA
 *   # La clave de TEST, que es la que Redsys publica en su documentación.
 *   export CLAVE=$(npx firebase functions:secrets:access REDSYS_SECRET_KEY --project dev | tail -1 | tr -d '[:space:]')
 *
 *   # 1) El formulario de la preautorización, para abrirlo en el navegador.
 *   node docs/probar-preautorizacion.js form 150.00
 *
 *   # 2) Confirmar parte (lo que se queda la agencia por daños) o anular (devolver).
 *   node docs/probar-preautorizacion.js rest 2 <PEDIDO> 60.00
 *   node docs/probar-preautorizacion.js rest 9 <PEDIDO> 150.00
 *
 * ⚠️ **La clave NO se escribe aquí ni se imprime.** Llega por `process.env` y lo
 * único que el guion dice de ella es cuántos caracteres tiene.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// El comercio de pruebas que BBVA entregó el 2 de noviembre de 2026. No es un
// secreto: viaja firmado dentro del formulario que ve cualquier cliente.
const COMERCIO = process.env.COMERCIO || '370770240';
const TERMINAL = process.env.TERMINAL || '001';
const MONEDA = '978';
const CLAVE = process.env.CLAVE || '';

const FORM_URL = 'https://sis-t.redsys.es:25443/sis/realizarPago';
const REST_URL = 'https://sis-t.redsys.es:25443/sis/rest/trataPeticionREST';

if (!CLAVE) {
  console.error('Falta CLAVE. Ver la cabecera de este fichero.');
  process.exit(1);
}

/**
 * La firma HMAC_SHA256_V1, igual que `signRedsysParameters()` en
 * `functions/src/redsys.ts` — que tiene su test contra un vector congelado.
 *
 * ⚠️ La clave del comercio se deriva con 3DES usando el **número de pedido**
 * como dato, y esa clave derivada es la que firma. Saltarse ese paso da
 * `SIS0042`, que se lee como «la clave está mal».
 */
function firmar(parametrosBase64, pedido) {
  const clave = Buffer.from(CLAVE, 'base64');
  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv('des-ede3-cbc', clave, iv);
  cipher.setAutoPadding(false);
  // El pedido se rellena con ceros hasta múltiplo de 8.
  const bloque = Buffer.alloc(Math.ceil(pedido.length / 8) * 8, 0);
  bloque.write(pedido, 'utf8');
  const derivada = Buffer.concat([cipher.update(bloque), cipher.final()]);
  return crypto.createHmac('sha256', derivada).update(parametrosBase64).digest('base64');
}

/** 12 caracteres con los cuatro primeros numéricos, como pide la pasarela. */
function nuevoPedido() {
  return `${Date.now().toString().slice(-4)}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

const centimos = (euros) => Math.round(Number(euros) * 100).toString();

function codificar(parametros) {
  return Buffer.from(JSON.stringify(parametros), 'utf8').toString('base64');
}

function decodificar(base64) {
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
}

const [modo, ...resto] = process.argv.slice(2);

if (modo === 'form') {
  const importe = resto[0] || '150.00';
  const tipo = resto[1] || '1';
  const pedido = resto[2] || nuevoPedido();

  const parametros = {
    DS_MERCHANT_AMOUNT: centimos(importe),
    DS_MERCHANT_CURRENCY: MONEDA,
    DS_MERCHANT_ORDER: pedido,
    DS_MERCHANT_MERCHANTCODE: COMERCIO,
    DS_MERCHANT_TERMINAL: TERMINAL,
    DS_MERCHANT_TRANSACTIONTYPE: tipo,
    DS_MERCHANT_PRODUCTDESCRIPTION: 'Prueba fianza preautorizada',
    /*
     * ⚠️ **Sin `MERCHANTURL` a propósito.** Con él, la pasarela avisaría a
     * `redsysNotificationWebhook`, que no encontraría ningún pago con este
     * pedido y lo apuntaría como notificación huérfana. Esto es una prueba de la
     * pasarela, no de la aplicación.
     */
    DS_MERCHANT_CONSUMERLANGUAGE: '001'
  };

  const codificados = codificar(parametros);
  const firma = firmar(codificados, pedido);

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Preautorización ${pedido}</title></head>
<body style="font-family: system-ui; padding: 2rem">
<h1>Preautorización de prueba</h1>
<p>Comercio <b>${COMERCIO}</b> · terminal <b>${TERMINAL}</b> · tipo <b>${tipo}</b><br>
Pedido <b>${pedido}</b> · importe <b>${importe} €</b></p>
<form id="f" action="${FORM_URL}" method="POST">
  <input type="hidden" name="Ds_SignatureVersion" value="HMAC_SHA256_V1">
  <input type="hidden" name="Ds_MerchantParameters" value="${codificados}">
  <input type="hidden" name="Ds_Signature" value="${firma}">
  <button type="submit">Ir a la pasarela</button>
</form>
<script>document.getElementById('f').submit();</script>
</body></html>`;

  const destino = path.join(os.tmpdir(), `preauth-${pedido}.html`);
  fs.writeFileSync(destino, html, 'utf8');
  /*
   * Los tres campos salen también por aquí porque el navegador de pruebas
   * **no abre `file:`**: la forma que funciona es inyectar el formulario en una
   * pestaña ya abierta y enviarlo, que además es exactamente lo que hace la
   * aplicación en `RedsysPaymentService.openGateway()`.
   */
  console.log(
    JSON.stringify(
      {
        pedido,
        importe,
        tipo,
        comercio: COMERCIO,
        terminal: TERMINAL,
        fichero: destino,
        campos: {
          Ds_SignatureVersion: 'HMAC_SHA256_V1',
          Ds_MerchantParameters: codificados,
          Ds_Signature: firma
        },
        accion: FORM_URL
      },
      null,
      1
    )
  );
} else if (modo === 'rest') {
  const [tipo, pedido, importe] = resto;
  if (!tipo || !pedido || !importe) {
    console.error('Uso: rest <tipo 2|9|3> <pedido> <importe>');
    process.exit(1);
  }

  const parametros = {
    DS_MERCHANT_ORDER: pedido,
    DS_MERCHANT_MERCHANTCODE: COMERCIO,
    DS_MERCHANT_TERMINAL: TERMINAL,
    DS_MERCHANT_CURRENCY: MONEDA,
    DS_MERCHANT_TRANSACTIONTYPE: tipo,
    DS_MERCHANT_AMOUNT: centimos(importe)
  };
  const codificados = codificar(parametros);
  const firma = firmar(codificados, pedido);

  fetch(REST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Ds_SignatureVersion: 'HMAC_SHA256_V1',
      Ds_MerchantParameters: codificados,
      Ds_Signature: firma
    })
  })
    .then((r) => r.json())
    .then((j) => {
      /*
       * ⚠️ **Una respuesta sin `Ds_MerchantParameters` es un rechazo**, y llega
       * con un 200: el motivo viene en `errorCode` (`SIS0xxx`). Es la misma
       * lección que ya está escrita en `redsys-refund.ts`.
       */
      if (typeof j.Ds_MerchantParameters === 'string') {
        const d = decodificar(j.Ds_MerchantParameters);
        console.log(JSON.stringify({ ok: true, tipo, pedido, respuesta: d }, null, 1));
      } else {
        console.log(JSON.stringify({ ok: false, tipo, pedido, cuerpo: j }, null, 1));
      }
    })
    .catch((e) => console.error('fallo de red:', e.message));
} else {
  console.error('Modos: form | rest. Ver la cabecera de este fichero.');
  process.exit(1);
}
