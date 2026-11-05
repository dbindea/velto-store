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

## 3 bis. El comercio de pruebas, y las operaciones que pidió el banco

⚠️ **El 2 de noviembre de 2026 BBVA entregó el entorno de pruebas del alta.** Es
el paso siguiente al expediente del § 4: el banco pide probar «varias
operaciones» contra su entorno de test y después se solicita el pase a
producción, con clave nueva.

| | Comercio | Terminal | Moneda | Clave |
|---|---|---|---|---|
| **desarrollo** (`velto-store`) | `370770240` | `001` | 978 | la **pública de test** de Redsys |
| producción (`rentalcar-veltomobility`) | `361040215` | `1` | 978 | la real, en Secret Manager |

⚠️ **El comercio de producción NO se tocó, y es deliberado.** El `361040215` es
de otro comercio y está prestado; es el que lleva cobrando de verdad desde el 31
de agosto de 2026 y el alta de VELTO todavía no está concedida. Cambiarlo hoy
dejaría producción sin cobrar.

⚠️ **La clave de desarrollo no hizo falta cambiarla, aunque el comercio sí.** El
banco asignó a este comercio de pruebas la clave que **Redsys publica en su
documentación**, que es la que ya estaba en Secret Manager. Comprobado
comparando huellas sin imprimir los valores: la de desarrollo coincidía y la de
producción es otra, que es lo que tiene que pasar. Sorprende leer que una clave
está en internet; en el entorno de test no hay nada que proteger.

⚠️ **Y lo que cambia en el repositorio es UN fichero**: `.env.velto-store`. El
código de comercio y el terminal no son secretos —viajan firmados dentro del
formulario que ve cualquier cliente— y viven ahí desde M-23.

### Las seis operaciones, medidas

Todas contra `sis-t.redsys.es:25443` con la tarjeta de pruebas
`4548 8120 4940 0004` (12/34, CVV 123) y el simulador EMV3DS 2.2.0. La pasarela
se identifica como **VELTO MOBILITY (SPAIN)**, terminal `370770240-1`, y su
pantalla sale con la marca **BBVA** — que es la confirmación de que el comercio
es el nuestro y no el prestado.

| # | Operación | Vía | Pedido | Resultado |
|---|---|---|---|---|
| 1 | Señal 50,00 € | **web pública** → `/pay/:id` | `9969DDD56F60` | autorizada, **401385** |
| 2 | Fianza 150,00 € | backoffice, ficha de reserva | `1960400B85A1` | autorizada, **055388** |
| 3 | Resto 197,95 € | backoffice | `4025599282AD` | **denegada** (autenticación 3DS) y después **SIS9915** al cancelar |
| 4 | Resto 197,95 €, reintento | backoffice | `8683E8CE6504` | autorizada, **055393** |
| 5 | Devolución parcial 50,00 € | ficha del cobro | sobre `1960400B85A1` | aceptada, **0900** |
| 6 | Devolución del resto 100,00 € | ficha del cobro | sobre `1960400B85A1` | aceptada, **0900** |

Lo que cada una demuestra, que es lo que no se ve en la tabla:

- **La 1 cierra una deuda vieja.** La pantalla pública del móvil «no tenía
  todavía un pago que se hubiera registrado solo» desde que perdió un cobro real
  el 4 de septiembre de 2026 (F-32). Ahora sí: el visitante hizo la pre-reserva
  en `dev.veltorent.com`, pulsó «Pagar la señal», pagó, y la aplicación se
  enteró **sin que nadie abriera el panel** — `/pay/:id` enseñaba «Pago recibido
  · 50,00 €» al recargar. En producción esa vía sigue apagada.
- **La 3 separa dos cosas que se confunden.** Un fallo de **autenticación**
  3-D Secure no llega a autorización, así que Redsys **no notifica nada** y el
  cobro se queda `Pendiente` y pagable — comprobado: ni un aviso en el webhook y
  la ficha sin cambiar. Lo que sí notifica es la **cancelación** (SIS9915), y
  ahí el cobro pasa a `Fallido`. Son dos pruebas, no una.
- **La 4 es la que protege de `SIS0051`.** El pedido es **distinto** del
  quemado: `resolveOrder()` emite uno nuevo en cuanto el anterior recibió aviso,
  porque la pasarela rechaza un pedido ya procesado. Si reutilizara, el
  reintento tras una denegación fallaría siempre.
- **La 5 y la 6 se leen con OTRA regla.** `0900` es devolución aceptada; con la
  regla del cobro (`0000`–`0099`) parecerían un error, y lo que sigue a un error
  es reintentar: dinero fuera dos veces. Y la parcial **no cambia el estado**:
  el cobro sigue `paid` con `refundedAmount: 50`, que es lo que hace que
  `sumPaid()` descuente en vez de mirar el estado.

⚠️ **Y el tope funciona.** Tras devolver los 150 € completos la sección de
devolver **desaparece** y la ficha dice «Este cobro está devuelto»:
`refundableAmount` es 0 y no hay forma de sacar más desde la aplicación.

⚠️ **Lo que NO se probó, y hay que decirlo:** una **denegación de autorización**
de verdad —fondos insuficientes, tarjeta caducada—. El simulador de este entorno
deniega en la **autenticación**, que es un paso antes, y para el otro caso hace
falta una tarjeta de pruebas concreta que el banco no ha dado. Si BBVA lo exige
en su lista, hay que pedírsela. Tampoco se probó **Bizum**, que la pasarela
ofrece y la aplicación no integra.

### Lo que hay que cambiar el día que concedan producción

⚠️ **Son TRES líneas, no una.** Lo que el banco mandará es la clave nueva, así
que la tentación es sustituir solo el secret; con el `361040215` todavía escrito
en `.env.rentalcar-veltomobility`, las firmas saldrían con la clave de un
comercio y el código de otro y la pasarela contestaría **`SIS0042`** — que se lee
como «la clave está mal» y no como «no se corresponden».

```bash
# functions/.env.rentalcar-veltomobility
REDSYS_MERCHANT_CODE=370770240      # el nuevo
REDSYS_TERMINAL=001                 # tres dígitos, no 1
REDSYS_ENVIRONMENT=live             # se queda

firebase functions:secrets:set REDSYS_SECRET_KEY --project prod
firebase deploy --only functions:createRedsysPaymentLink,functions:getPaymentCheckout --project prod
firebase deploy --only functions:redsysNotificationWebhook,functions:refundRedsysPayment --project prod
```

⚠️ **Y son esas CUATRO functions y ninguna más.** Son las únicas que leen
`REDSYS_*`; tocar el `.env` cambia el hash de todas, pero en producción el
despliegue va por nombre y nunca `--only functions` a secas, que subiría las
cinco de la AEAT que allí no deben estar.

⚠️ **Lo primero es CONFIRMAR el comercio que mandan, no darlo por hecho.** Arriba
va `370770240` porque lo normal en Redsys es que el número sea el mismo para test
y para real y que lo único distinto sea la clave — pero eso es lo normal, no lo
seguro: algunas altas traen número de comercio propio para producción. Lo que
venga en el correo del banco manda sobre este fichero.

⚠️ **La primera operación en producción se hace con un importe mínimo y se
devuelve.** Allí `live` significa dinero real: no hay tarjetas de prueba.

### ⚠️ Y lo que de verdad hay que mirar antes: las fianzas del comercio viejo

**Una devolución se firma con el comercio y la clave de HOY, y con el pedido del
cobro de entonces.** `refundRedsysPayment` lee `REDSYS_MERCHANT_CODE` y
`REDSYS_SECRET_KEY` de `process.env` en cada llamada —no del documento del
pago— y manda `payment.redsys.order`, que se emitió bajo el comercio anterior.

Es decir: **en cuanto se cambie el comercio de producción, cualquier cobro ya
hecho con el `361040215` deja de poderse devolver desde la aplicación.** La
petición saldría diciendo que es del `370770240` con un pedido que ese comercio
no conoce, y el banco la rechaza. Y el pago que más probabilidades tiene de estar
en ese estado es justo el peor: **una fianza cobrada y todavía sin devolver**,
porque la fianza se devuelve casi siempre y se devuelve semanas después de
cobrarse.

⚠️ **No es un fallo del código, y por eso no tiene arreglo en el código.** El
documento del pago sí guarda su `redsys.merchantCode` y su `redsys.terminal`, así
que la función podría usarlos; lo que no puede recuperar es **la clave del
comercio viejo**, que es una sola en Secret Manager. Dos comercios vivos a la vez
pedirían dos claves, y eso es rehacer la configuración entera por un caso que
dura unas semanas.

Así que el cambio se **planifica**, no se hace a mitad de mes:

1. **Antes de tocar nada**, mirar en Pagos de producción si queda algún cobro con
   tarjeta sin devolver del todo — fianzas sobre todo.
2. Si queda alguno, o se **devuelve antes** del cambio, o se asume que esa
   devolución habrá que hacerla **desde el panel del banco** y no desde la
   aplicación.
3. Y dejar dicho a quien atienda: durante la transición, una fianza antigua que
   haya que devolver va por el panel.

⚠️ **El síntoma, si se olvida, no dice esto.** Lo que se verá es una devolución
que el banco rechaza sobre un cobro que está perfectamente registrado y pagado, y
lo primero que uno piensa es que la clave nueva está mal puesta.

---

## 4. Lo que falta, y es de Dorel

⚠️ **A 20 de octubre de 2026 el expediente está EN MANOS DEL BANCO.** Lo que
rechazaron está corregido y publicado; lo que queda de esta tabla es amarillo y
ninguno de los tres bloquea volver a presentarlo. Y mientras no contesten, **el
pago de la señal desde la web sigue apagado en producción**
(`VELTO_WEB_SIGNAL_PAYMENT_ENABLED=false`): encenderlo es una decisión de Dorel
y son dos functions, no una.

> ⚠️ **El 2 de noviembre de 2026 el banco contestó con el entorno de pruebas**
> —ver § 3 bis—, así que el expediente ya no está parado. Lo que queda de esta
> tabla sigue vigente.

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
