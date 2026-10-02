# Alta del TPV Virtual de BBVA (PayGold)

Qué pide el banco, dónde está cubierto y qué falta. Escrito el 2 de octubre de
2026 al preparar la solicitud.

> ⚠️ **Esto lo ha redactado un programador, no un abogado.** Los artículos
> citados están comprobados contra la norma, pero la revisión legal sigue
> pendiente y está anotada como tal en el traspaso de sesión.

---

## 1. Qué es PayGold y por qué encaja aquí

PayGold es el producto de **pago por enlace** de Redsys que BBVA revende: el
comercio genera un enlace o un QR y se lo manda al cliente por SMS, correo o
WhatsApp, y el cliente paga en la pasarela del banco. No hace falta carrito ni
tienda online.

Es exactamente lo que Velto hace desde el 2 de octubre de 2026: el operador
pulsa «Cobrar la señal» en la ficha de una solicitud y manda el enlace
`/pay/{id}` por WhatsApp.

⚠️ **Hoy ese enlace NO es PayGold.** Lo que hay montado es el **TPV Virtual por
redirección** con un formulario propio: la aplicación genera la petición
firmada y la pantalla `/pay/:id` publica el formulario contra
`sis.redsys.es/sis/realizarPago`. PayGold haría que **Redsys** mandase el SMS o
el correo con su propio enlace, usando `Ds_Merchant_Customer_Mobile` y
`Ds_Merchant_Customer_Mail`.

Las dos cosas funcionan. La diferencia práctica, para decidir:

| | Lo que hay hoy | PayGold |
|---|---|---|
| Quién manda el enlace | Velto, por WhatsApp | Redsys, por SMS o correo |
| Qué ve el cliente | Una pantalla de Velto y luego el banco | Directamente el banco |
| Dominio del enlace | el del backoffice | el de Redsys |
| Trabajo pendiente | ninguno | integrar la petición PayGold |

**PayGold no sustituye a lo que hay: lo complementa.** Si lo que se quiere es
mandar por WhatsApp —que es el canal de esta empresa—, lo de hoy ya sirve y el
alta del TPV Virtual es lo único que hace falta.

---

## 2. Requisitos del banco sobre la web, y dónde están cubiertos

Lo que la entidad revisa antes de aprobar el alta:

| Requisito | Dónde está | Estado |
|---|---|---|
| Identificación completa del titular: razón social, NIF y domicilio | [`/aviso-legal`](https://veltomobility.com/aviso-legal), enlazado en el pie de todas las páginas | ✅ |
| Condiciones generales de contratación | [`/condiciones`](https://veltomobility.com/condiciones) | ✅ |
| **Política de cancelaciones, devoluciones y reembolsos** | [`/devoluciones`](https://veltomobility.com/devoluciones) | ✅ *(nueva, 2 oct 2026)* |
| **Derecho de desistimiento** | `/devoluciones#desistimiento` | ✅ *(nueva)* |
| Política de privacidad y cookies | [`/privacidad`](https://veltomobility.com/privacidad) | ✅ |
| Descripción del servicio y precios **con impuestos** | portada, `/flota`, ficha de cada coche | ✅ |
| Moneda | declarada en `/devoluciones#pagos` | ✅ |
| Medios de pago aceptados | `/devoluciones#pagos` | ✅ |
| Datos de contacto y atención al cliente | [`/contacto`](https://veltomobility.com/contacto), con horario | ✅ |
| Nombre del comercio **y del titular** en la portada y **en la página de pago** | pie de la web y pie de `/pay/:id` | ✅ *(nueva)* |
| HTTPS en todo el sitio | Firebase Hosting | ✅ |
| Entorno de pruebas superado antes de pasar a producción | `REDSYS_ENVIRONMENT=test` en desarrollo | ✅ |

⚠️ **El domicilio del aviso legal tiene que coincidir con el del contrato del
TPV.** El banco lo compara. En `web/src/lib/empresa.ts` conviven dos
direcciones a propósito —el **domicilio social** y la **oficina**—; la que va
en el contrato es el **domicilio social**, que es el que publica
`/aviso-legal`.

---

## 3. Lo que hay que decirle al banco, y que no es obvio

### 3.1 Son DOS dominios, y los dos procesan

El contrato del TPV registra la o las páginas web desde las que se podrán
originar transacciones: **el comercio solo puede procesar pagos originados
desde las webs registradas**. Aquí hay dos:

| Dominio | Qué es | ¿Procesa pagos? |
|---|---|---|
| `veltomobility.com` | el escaparate público | no, pero es donde están las políticas |
| `rentalcar.veltomobility.com` | el backoffice, y donde vive `/pay/:id` | **sí** |

⚠️ **Hay que declarar los dos.** Declarando solo el escaparate, el banco
rechazaría las operaciones que salen del que de verdad cobra; declarando solo
el backoffice, el revisor no encuentra las políticas.

### 3.2 Qué se cobra, y cuándo

Tres conceptos, y conviene que el banco lo sepa porque cambian el perfil de
riesgo y la tasa de devoluciones:

1. **Señal** — 50 €, o 25 € si el alquiler cuesta menos de 50 €. Se cobra al
   reservar y **se descuenta** del precio. No reembolsable si cancela el
   cliente (ver 3.3).
2. **Resto del alquiler** — antes de entregar el coche.
3. **Fianza** — depósito en garantía, se devuelve tras la inspección.

⚠️ **La fianza se cobra y se devuelve casi siempre**, así que este comercio va
a tener un porcentaje de devoluciones alto **por diseño**. Dicho de antemano no
es un problema; descubierto por el banco en la monitorización, es una
retención de fondos.

### 3.3 Por qué la señal no se devuelve, y por qué eso es legal

El **art. 103.l del TRLGDCU** (RDL 1/2007) excluye del derecho de desistimiento
el alquiler de vehículos «si los contratos prevén una fecha o un periodo de
ejecución específicos». Una reserva del 10 al 14 lo es, así que **no hay 14 días
de desistimiento** y la señal puede no ser reembolsable.

⚠️ **Pero el art. 97.1.l OBLIGA a informar de que no lo hay**, y si no se
informa correctamente **el plazo de 14 días se convierte en 12 meses**. Por eso
`/devoluciones#desistimiento` lo dice en afirmativo, con el artículo delante, y
el pie de todas las páginas enlaza esa página.

⚠️ **Y por eso la política está escrita en los dos sentidos.** Una cláusula que
solo penaliza al consumidor es la que los **arts. 85 y 87.6 del TRLGDCU** dejan
sin efecto; una señal que funciona igual en ambas direcciones —el cliente la
pierde si anula, Velto la devuelve entera si no puede dar el coche— es la figura
de las **arras del art. 1454 del Código Civil** y se sostiene.

### 3.4 Plazos de abono

La devolución se ordena el mismo día, pero **cuándo aparece en la tarjeta lo
decide el banco emisor del cliente: entre 2 y 31 días**. Y una devolución a
tarjeta solo cabe sobre un cobro de los **últimos 120 días**; más allá, por
transferencia. Las dos cosas están publicadas en `/devoluciones#como`.

---

## 4. Lo que falta, y es de Dorel

| Qué | Por qué bloquea |
|---|---|
| Que **`veltomobility.com` sirva de verdad** | hoy da el aparcamiento del registrador; el banco entra a mirar las políticas y no las encuentra |
| Que ese dominio **reciba correo** | no tiene registros MX, y las políticas dan `reservas@veltomobility.com` como canal de reclamación |
| **Entidad de resolución de litigios** | `/aviso-legal` lleva un `[PENDIENTE]`; la Ley 7/2017 no deja callarse |
| **Revisión por un abogado** | lo legal está escrito y es honesto, pero lo firma una empresa real |
| **Cuenta de empresa en BBVA** | requisito de contratación del TPV |

⚠️ **Los dos primeros son el camino crítico.** El resto de la web está listo:
mientras el dominio no responda, la solicitud se cae en la revisión del comercio
por un motivo que no tiene nada que ver con el código.

---

## 5. Encender el enlace a la política en la pantalla de pago

Está montado y **apagado a propósito**: `VELTO_WEB_BASE_URL` en
`functions/.env.<proyecto>`. En desarrollo apunta a `velto-web-dev.web.app` y
el enlace se pinta; en producción está **vacía** porque el dominio todavía no
sirve, y un enlace muerto en la pantalla donde alguien va a meter la tarjeta se
lee como que la empresa no tiene esa política.

El día que `veltomobility.com` responda:

```bash
# functions/.env.rentalcar-veltomobility
VELTO_WEB_BASE_URL=https://veltomobility.com
```

y redesplegar `getPaymentCheckout`.
