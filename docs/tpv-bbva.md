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
| Moneda | declarada en `/devoluciones#pagos` y en `/aviso-legal#pagos` | ✅ |
| Medios de pago aceptados | `/devoluciones#pagos` | ✅ |
| **Qué se paga con tarjeta** | [`/aviso-legal#pagos`](https://veltomobility.com/aviso-legal#pagos) | ✅ *(nueva, 17 oct 2026 — es la que falló)* |
| Datos de contacto y atención al cliente | [`/contacto`](https://veltomobility.com/contacto), con horario | ✅ |
| Nombre del comercio **y del titular** en la portada y **en la página de pago** | pie de la web y pie de `/pay/:id` | ✅ *(nueva)* |
| **Política de devoluciones enlazada desde la página de pago** | pie de `/pay/:id`, vía `VELTO_WEB_BASE_URL` | ✅ *(17 oct 2026 — estaba vacía en producción)* |
| HTTPS en todo el sitio | Firebase Hosting | ✅ |
| Entorno de pruebas superado antes de pasar a producción | `REDSYS_ENVIRONMENT=test` en desarrollo | ✅ |

### 2 bis. El rechazo del 17 de octubre de 2026, y qué faltaba de verdad

BBVA tumbó el alta con un motivo de una línea:

> En el aviso legal indicar lo que se pagará mediante tarjeta.

⚠️ **La información estaba escrita, pero en la página equivocada.** Las dos
filas de arriba —moneda y medios de pago— la daban por cubierta porque vivía en
`/devoluciones#pagos`. El banco la quiere en el **aviso legal**, que es la
página que identifica al prestador y la primera que abre un revisor.

⚠️ **Y el aviso legal decía lo contrario.** Su sección «Qué se ofrece aquí»
llevaba escrito, en negrita: *«No se contrata ni se paga desde aquí»*. O sea
que el revisor entra a aprobar una pasarela de pago y encuentra una declaración
de que ahí no se paga. La frase era cierta en lo que negaba —esta web no tiene
carrito, nadie teclea una tarjeta en `veltomobility.com`— y falsa en lo que
daba a entender: Velto cobra con tarjeta desde el 31 de agosto de 2026, sobre
un enlace `/pay/:id` que manda la agencia.

**Lo que se hizo:** sustituir esa frase por «No tiene carrito de compra» más un
párrafo que remite al bloque nuevo, y añadir `#pagos` con los cinco conceptos
que se cobran, la moneda, los impuestos, la pasarela y el 3-D Secure. Cada
línea contrastada contra el código, no contra lo que convendría cobrar.

⚠️ **De paso salió a la luz un tope que ninguna página decía**:
`suggestInitialPayment()` termina en `Math.min(propuesta, precio)`, así que un
alquiler de 20 € pide 20 € de señal y no 25. Las dos páginas decían «25 € si el
alquiler cuesta menos de 50 €» a secas. Ahora dicen «y nunca más que el propio
alquiler».

⚠️ **El domicilio del aviso legal tiene que coincidir con el del contrato del
TPV.** El banco lo compara. En `web/src/lib/empresa.ts` conviven dos
direcciones a propósito —el **domicilio social** y la **oficina**—; la que va
en el contrato es el **domicilio social**, que es el que publica
`/aviso-legal`.

---

## 3. Lo que hay que decirle al banco, y que no es obvio

### 3.1 Se declara solo `veltomobility.com`, y hay que saber qué asume eso

El contrato del TPV registra la o las páginas web desde las que se podrán
originar transacciones: **el comercio solo puede procesar pagos originados
desde las webs registradas**. Aquí hay dos sitios:

| Dominio | Qué es | ¿De ahí salen pagos? |
|---|---|---|
| `veltomobility.com` | el escaparate público | no, pero es donde están las políticas |
| `rentalcar.veltomobility.com` | el backoffice, y donde vive `/pay/:id` | **sí** |

**Decisión de Dorel (2 de octubre de 2026): declarar solo el principal.** Lo
habitual es que el alta cubra el dominio y sus subdominios, y
`rentalcar.veltomobility.com` lo es.

⚠️ **Pero conviene tenerlo escrito, porque si algo se tuerce será por aquí.**
Quien de verdad publica el formulario contra `sis.redsys.es` es el
**subdominio**, no el escaparate. Si en la revisión el banco pregunta de dónde
sale el pago, la respuesta es `rentalcar.veltomobility.com`, y las dos salidas
son: añadirlo al contrato —un trámite— o mover `/pay/:id` al escaparate, que es
rehacer esa pantalla en Astro. **No se adelanta trabajo por si acaso**; se deja
dicho para no tener que averiguarlo con el alta parada.

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

⚠️ **A 20 de octubre de 2026 el expediente está EN MANOS DEL BANCO.** Lo que
rechazaron está corregido y publicado; lo que queda de esta tabla es amarillo y
ninguno de los tres bloquea volver a presentarlo. Y mientras no contesten, **el
pago de la señal desde la web sigue apagado en producción**
(`VELTO_WEB_SIGNAL_PAYMENT_ENABLED=false`): encenderlo es una decisión de Dorel
y son dos functions, no una.

| Qué | Estado el 17 de octubre de 2026 |
|---|---|
| Que **`veltomobility.com` sirva de verdad** | ✅ **resuelto** — sirve desde el 5 de octubre de 2026, comprobado cargándolo |
| Que ese dominio **reciba correo** | ✅ **resuelto** — Email Routing de Cloudflare activo, comprobado con `Resolve-DnsName … -Type MX` |
| **Qué se paga con tarjeta, en el aviso legal** | ✅ **resuelto Y PUBLICADO** — `/aviso-legal#pagos`, escrito el 17 y vivo en **producción desde el 19 de octubre de 2026**. Es lo que falló |
| **Entidad de resolución de litigios** | 🟡 escrito como «no adherido»; falta que Dorel lo confirme |
| **Revisión por un abogado** | 🟡 en marcha, con un abogado y otra IA |
| **Decirle al banco lo de la fianza** | 🟡 pendiente — ver 3.2: tasa de devoluciones alta por diseño, y no hay rastro de que se dijera |
| **Cuenta de empresa en BBVA** | ✅ ya la tiene |
| **Ficha de Google Business Profile** | ✅ creada, enlazada desde el JSON-LD |

> ⚠️ **Aquí ponía que el dominio era el camino crítico y que no respondía.**
> Era cierto el 2 de octubre y dejó de serlo el 5. Esta tabla se quedó tres
> semanas diciendo que el banco «entra a mirar las políticas y no las
> encuentra», así que quien preparase la respuesta al rechazo leyendo esto
> habría ido a arreglar un problema que ya no existe —y habría dejado el que
> sí—. Es la cuarta vez que un inventario de dominios escrito a mano caduca en
> este repositorio: **antes de dar por fallido un dominio, vuelve a medirlo.**

---

## 5. El enlace a la política en la pantalla de pago: encendido

`VELTO_WEB_BASE_URL`, en `functions/.env.<proyecto>`. Lo lee
`getPaymentCheckout` y de ahí sale el `termsUrl` que pinta el pie de
`/pay/:id`; vacío, el `@if` no pinta nada.

⚠️ **Estuvo vacía en producción hasta el 17 de octubre de 2026**, y puesta en
desarrollo. O sea que la única pantalla de pago sin el enlace a la política de
cancelaciones era la única con dinero de verdad — y quien lo probara en
desarrollo veía el enlace y daba el asunto por cerrado. La condición que la
mantenía apagada («el día que el dominio responda») había caducado doce días
antes.

```bash
# functions/.env.rentalcar-veltomobility
VELTO_WEB_BASE_URL=https://veltomobility.com   # desde el 17 oct 2026
```

⚠️ **Tocar el `.env` cambia el hash de TODAS las functions.** En producción el
despliegue va por nombre y nunca `--only functions` a secas, que subiría las
cinco de la AEAT que allí no deben estar:

```bash
firebase deploy --only functions:getPaymentCheckout --project prod
```
