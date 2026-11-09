# Los avisos de Telegram

Cómo dar de alta el bot de Telegram, qué avisos salen por él y qué hay que saber
antes de desplegarlos.

Escrito el 18 de octubre de 2026 para el aviso de cobro. **Ampliado el 7 de
noviembre de 2026**, cuando dejó de haber uno solo:

| Aviso | Cuándo | Lo manda |
|---|---|---|
| **Cobro recibido** | al instante, cuando el banco confirma | `redsysNotificationWebhook` |
| **Mañana termina un alquiler** | **17:00** de Madrid, todos los días | `sendReturnReminders` |

⚠️ **Y desde ese día los avisos llevan `(DEV)` fuera de producción.** La marca la
pone `avisarPorTelegram()` —donde se **envía**, igual que `asuntoDeCorreo()` en
los correos—, así que la llevan los dos y la llevará el que se añada mañana. Hoy
desarrollo escribe por `@VeltoDevBot` y producción por `@VeltoMobilityBot`, pero
`TELEGRAM_CHAT_ID` es **el mismo número** en los dos `.env` y lo único que
separaba los avisos era una decisión que no estaba escrita en el código.

---

## Por qué existe

`redsysNotificationWebhook` era la **única** pieza del sistema que sabía que un
cobro había entrado, y **no avisaba a nadie**. Lo contó Dorel: *«hasta que no
vea el email o entre no me entero»*.

Mientras los enlaces de pago los mandaba él por WhatsApp, el agujero era
molesto: ya sabía que había mandado el enlace. Con la vía de pago desde la web
pasa a ser caro — un cliente paga la señal a las dos de la mañana y la noticia
espera a que alguien abra el panel.

## Por qué Telegram y no SMS

Las tres opciones se midieron el mismo día:

| | Coste | Trabajo | Llega |
|---|---|---|---|
| **Telegram** | **gratis, sin límite** | ~1 h | segundos, con sonido |
| SMS (LabsMobile) | ~0,04 €/mensaje · **< 2 €/mes** a este volumen | ~2 h + alta de cuenta | segundos, sin apps ni datos |
| Push en la PWA | gratis | el mayor: no hay service worker ni FCM | segundos |

Decisión de Dorel: **Telegram**. Y hay un motivo técnico que lo acompaña:
**no añade ni una dependencia**. `fetch` es global en Node 22, así que el
módulo pesa lo que pesa `firebase-functions/logger`, que ya estaba cargado.
Eso importa más de lo que parece — `index.ts` se evalúa entero en cada arranque
en frío, así que una librería de SMS la pagaría también una petición de
`/api/fleet` desde la web pública.

---

## Darlo de alta

### 1. Crear el bot (lo hace Dorel, en el móvil)

1. Abrir Telegram y buscar **`@BotFather`**.
2. `/newbot`, y darle un nombre y un usuario que termine en `bot`.
3. BotFather devuelve un **token** con esta pinta:
   `8123456789:AAE_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. Ese token **es la llave**:
   quien lo tenga puede mandar mensajes como el bot.

> ⚠️ **El token son las DOS mitades, con los dos puntos en medio — y esto ya
> salió mal.** El 19 de octubre de 2026 los dos secrets se guardaron con solo
> la parte de **después** de los dos puntos: 35 caracteres en vez de 46. Se
> detectó comprobando la forma sin imprimir el valor, y `getMe` lo confirmó al
> reconstruirlo.
>
> ⚠️ **Y el número de delante es el ID DEL BOT, no tu chat.** Se pasaron
> `8831857807` y `8944806803` como «chat id de desarrollo y de producción» y
> eran los ids de `@VeltoDevBot` y `@VeltoMobilityBot`. Un bot **no puede
> escribirse a sí mismo**: con eso puesto, Telegram habría contestado
> `chat not found` en cada cobro y el aviso no habría llegado nunca.
>
> Para comprobar la forma sin que el token aparezca en ninguna parte:
>
> ```bash
> V=$(firebase functions:secrets:access TELEGRAM_BOT_TOKEN --project dev | tail -1 | tr -d '[:space:]')
> printf '%s' "$V" | grep -qE '^[0-9]{8,12}:[A-Za-z0-9_-]{30,}$' && echo OK || echo MAL
> ```

### 2. Saber a qué chat escribir

Un bot no puede escribirle a nadie que no le haya hablado antes. Así que:

1. Abrir una conversación con el bot recién creado y pulsar **Iniciar**.
2. Sacar el id del chat, abriendo esto en el navegador con el token dentro:

   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

   En la respuesta, `result[0].message.chat.id`. Es un número, a veces negativo
   (los grupos lo son).

> ⚠️ **Si `getUpdates` devuelve una lista vacía**, es que no se ha pulsado
> Iniciar o que ya se ha consumido la actualización. Se manda cualquier mensaje
> al bot y se vuelve a pedir.

### 3. Guardar el token y el chat

El token es lo **único** secreto. El id del chat no lo es, así que vive en el
fichero de entorno, que está en el repositorio.

```bash
# El token, en los DOS proyectos. Ver el aviso de abajo.
firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project dev
firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project prod
```

Y el chat, a mano, en `functions/.env.velto-store` y en
`functions/.env.rentalcar-veltomobility`:

```
TELEGRAM_CHAT_ID=123456789
```

> ⚠️ **Que no sea el mismo chat en los dos entornos.** En desarrollo se cobra
> contra la pasarela de pruebas: un aviso de dev mezclado con los reales enseña
> una cifra que no ha entrado en ningún sitio. Dos bots, o dos chats del mismo
> bot.

### 4. Desplegar

Las que hablan con Telegram son tres, y cada una monta el secret por su cuenta:

```bash
# El aviso de cobro
firebase deploy --only functions:redsysNotificationWebhook --project dev
# El recordatorio de las 17:00 y su vista previa
firebase deploy --only functions:sendReturnReminders,functions:previewReturnReminders --project dev
```

Y lo mismo con `--project prod`. ⚠️ **Nunca `--only functions` a secas en
producción**: subiría las cinco de la AEAT, que no van allí todavía.

---

## Lo que hay que saber antes de desplegar

⚠️ **Declarar un secret que no existe ROMPE EL DESPLIEGUE DE TODAS LAS
FUNCTIONS, no solo de la suya.** Esto es peor de lo que parecía y está medido:
el 19 de octubre de 2026, intentando desplegar `generateContractPdf` —que no
tiene nada que ver con Telegram— el CLI abortó con

```
Error: In non-interactive mode but have no value for the secret: TELEGRAM_BOT_TOKEN
```

El CLI valida los secrets del **codebase entero** antes de subir nada, así que
nombrar otras functions no esquiva el problema. Para comprobarlo sin imprimir
el valor:

```bash
firebase functions:secrets:access TELEGRAM_BOT_TOKEN --project prod >/dev/null 2>&1; echo $?   # 0 = existe
```

⚠️ **Por eso en desarrollo está dado de alta EN BLANCO**, con un espacio, desde
ese mismo día. No es un descuido ni una credencial de mentira: es lo que
desbloquea el resto de los despliegues mientras el bot no exista. Lo que
mantiene el aviso apagado es el **chat**, que sigue vacío en el `.env`, y
`avisarPorTelegram()` **recorta** los dos valores antes de mirarlos — un token
en blanco cuenta como «sin configurar», así que no se intenta hablar con la API
ni se llenan los logs de 401 en cada cobro.

⚠️ **En PRODUCCIÓN todavía NO está**, y hay que crearlo antes del próximo
despliegue de functions allí, o se caerá igual. Vale el mismo relleno:

```bash
printf ' ' | firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project prod --data-file -
```

Cuando el bot exista, se sobrescribe con el token de verdad y se pone el chat.

⚠️ **Sin configurar no falla: se calla.** Si el token o el chat están vacíos,
`avisarPorTelegram()` registra una línea en `info` y sigue. No es un error —
es que no está dado de alta—, y meterlo en los logs como `error` haría que los
logs dejaran de mirarse.

⚠️ **El aviso NUNCA puede tumbar el webhook.** `avisarPorTelegram()` no lanza
nunca y la llamada va además envuelta en su `try`. El orden de prioridades no
admite discusión: cuando esto corre, el dinero ya está en el banco y a la
pasarela hay que contestarle `200` — lo que no se le contesta, lo reintenta.
Perder el aviso es un problema; perder el registro de un cobro real es uno
mucho mayor. Es la misma regla que sella el contrato: antes guardarlo sin
sellar que perder la firma.

⚠️ **Y lleva plazo.** La petición a Telegram va con `AbortSignal.timeout(8000)`.
Sin él, una petición colgada dejaría la function esperando hasta su propio
timeout, y Redsys sin respuesta.

---

## El aviso de cobro: qué llega, y por qué así

```
💳 Cobro recibido

50,00 € · Señal de la reserva P-4K7M9X
Solicitud P-4K7M9X
De Marius Ionescu Pavel
Citroën Berlingo
```

- **Lleva dentro todo lo que hace falta para decidir sin abrir nada**, que es la
  misma regla que gobierna el correo de una solicitud nueva. Un aviso que
  obliga a entrar en la aplicación para saber de qué va es un aviso que se mira
  más tarde — y más tarde el cliente ya ha llamado.
- **La referencia va en `<code>`**: en Telegram se copia tocándola, y es lo que
  se teclea después en el buscador.
- **Un cobro parcial se dice que es parcial.** `status` queda en `partial`
  cuando entra menos que el total; enseñarlos igual haría dar por cobrado lo que
  no lo está.
- **Solo cuando el banco acepta.** Una denegación no merece un pitido de
  madrugada, y el aviso de una **devolución** aprobada no entra por aquí:
  anunciar «cobro recibido» cuando el dinero ha salido sería contarlo al revés.

El texto lo compone `mensajeCobro()` en
[functions/src/alerts/telegram.ts](../functions/src/alerts/telegram.ts), que es
**pura y tiene tests** — separada del envío por la misma razón que
`email-shell.ts`: el patrón de fallo que más se repite aquí es el código que se
escribe y nunca se ejecuta, y un mensaje que solo se puede ver mandándolo es un
mensaje que nadie mira.

⚠️ **El escape del HTML no es cosmético.** El nombre del pagador llega de un
formulario **público**. Con `parse_mode: 'HTML'`, un `<` sin escapar hace que
Telegram conteste `400 can't parse entities` y **el aviso no llegue** — o sea,
quedarse sin enterarse del cobro, que es justo lo que esto viene a arreglar.
Hay test.

---

## El aviso de las 17:00: mañana termina un alquiler

Lo pidió Dorel el 7 de noviembre de 2026, con el texto escrito a mano: *«Para las
reservas que caducan por ejemplo mañana me gustaría recibir hoy como a las 17:00h
… un mensaje en telegram para copiar y pegar al cliente en whatsapp»*.

Esto es lo que llega, uno por alquiler que termina mañana:

```
🔁 Mañana termina un alquiler

Renault Megane · 4466LKK
Luis Santiago Perdomo Maldonado · +34 615 591 101
Devolución mañana 14/11 a las 14:00

Para el cliente (tócalo para copiarlo):
┌──────────────────────────────────────────────┐
│ Buenas tardes Luis,                          │
│                                              │
│ Mañana a las 14:00 finaliza la reserva del   │
│ Renault Megane. Si deseas prolongar la       │
│ estancia, escríbeme y formalizamos la        │
│ prórroga.                                    │
│                                              │
│ En caso contrario, te espero a esa hora en   │
│ Aeropuerto T1. ¡Gracias!                     │
└──────────────────────────────────────────────┘

Abrir WhatsApp · Ver la reserva
```

- **El bloque del cliente se copia tocándolo**, porque va en `<pre>`. Ahí está la
  mitad del valor: seleccionar tres párrafos a mano en un móvil es justo el
  trabajo que esto quita. Por lo mismo va **uno por reserva** y no un mensaje con
  la lista — con tres clientes dentro no hay nada que tocar.
- **La cabecera queda fuera del bloque.** Lo que se copia tiene que ser
  exactamente lo que recibe el cliente: la matrícula no es asunto suyo, y un
  «Mañana termina un alquiler» pegado en su chat delata que lo escribió una
  máquina.
- **«Abrir WhatsApp» es un extra, no el plan.** `wa.me` abre la aplicación de
  verdad en el móvil; en el ordenador se escribe desde WhatsApp Web y hay que
  pegar. Las dos vías, como en la ficha de una solicitud.
- **No se manda nada al cliente.** Quien pulsa enviar es Dorel. Mandarlo solo
  pediría la API de WhatsApp Business —número aparte, verificación con Meta,
  plantilla aprobada y pago por mensaje— y quitaría la última revisión humana de
  algo que lee un cliente.
- **Si no hay devoluciones, no se manda nada**, igual que el resumen cuando no
  hay novedades: un aviso diario que casi siempre dice «nada» se acaba
  silenciando, y con él el que sí importaba.

### Para cambiar el texto

Está en `mensajeParaCliente()`, en
[functions/src/alerts/return-reminder.ts](../functions/src/alerts/return-reminder.ts),
en tres frases: el saludo, la prórroga y la devolución. Es el de Dorel casi
literal —solo se corrigieron «escibeme» y «proroga», y se añadió el lugar de
devolución—, y cambiarlo es cambiar una línea y desplegar
`sendReturnReminders`.

Va en **español siempre**: no hay ningún campo en `Client` que diga en qué idioma
habla el cliente, así que elegirlo sería inventárselo.

### Verlo sin esperar a las cinco

```js
// En la consola del navegador, con la sesión abierta. Con `enviar: true` lo
// manda de verdad; `fecha` es «haz como si hoy fuera este día».
const fn = firebase.functions().httpsCallable('previewReturnReminders');
```

Y sin SDK a mano, con el token de la sesión (el patrón de los guiones de esta
carpeta):

```js
await fetch('https://europe-west1-velto-store.cloudfunctions.net/previewReturnReminders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ data: { fecha: '2026-11-13', enviar: false } })
}).then((r) => r.json());
```

⚠️ **`fecha` no es un adorno de depuración: es lo que destapó un fallo de dos
meses.** Al poder preguntar «¿qué habrías mandado el 26 de octubre?» se vio que
el resumen diario de las 9:00 llevaba desde el 10 de septiembre saliendo **sin
una sola entrega ni devolución** — las consultas de rango sobre
`pickupDateTime`/`returnDateTime` no devuelven nada, porque esas fechas están
guardadas como un **mapa** y no como un `Timestamp`. El caso entero está en
CLAUDE.md, en «Firestore: una fecha de reserva NO se puede consultar por RANGO».

### Y saber si ha corrido SOLA es otra pregunta

La vista previa dice lo que mandaría; no dice si Cloud Scheduler ha disparado el
trabajo. Eso está en el log, y hay dos trampas al leerlo —las dos medidas el 9
de noviembre de 2026, comprobando las primeras ejecuciones automáticas:

⚠️ **`firebase functions:log` NO da «lo último».** Con `-n 300` devolvió una
ventana **más vieja** que sin bandera: la última línea era del 21 de octubre, y
sin `-n`, del 5 de noviembre. O sea que **la última línea no es la última
ejecución**, y creerlo lleva a dar por muerta una programada que está corriendo.
Lo que sí contesta es pedir una function con pocos logs, que cabe entera:

```bash
npx firebase functions:log --only sendReturnReminders --project prod
```

⚠️ **Y el visor de logs del MCP de Firebase lee el PROYECTO ACTIVO** —hoy
`velto-store`— y no acepta `--project`: lo que enseña es **desarrollo** aunque se
le pidan functions de los dos. Es la misma confusión que `firebase use` ya
provocó con los despliegues.

⚠️ **Un log vacío es el resultado BUENO.** `enviarRecordatorios()` solo escribe
`Recordatorios de devolución` **cuando hay devoluciones**, así que una tarde sin
ninguna deja únicamente el arranque del contenedor. Lo que delataría un fallo es
una línea `error`, no la ausencia de líneas — y lo que delata que la programada
**no existe** es que no haya ni arranque a esa hora.

---

## Lo que NO hace, y hace falta igual

**El correo.** Telegram es el pitido; el correo es el registro escrito que
queda cuando el pitido falla, y el que se puede buscar dentro de seis meses.
Hoy el webhook no manda ninguno. Está pendiente, y reutiliza la cáscara de
`functions/src/alerts/email-shell.ts`.

**Saber si falta cobrar algo.** El recordatorio de las 17:00 no lo dice, a
propósito: el día antes de la devolución es cuando interesa saberlo, pero
mezclarlo con el mensaje de la prórroga convierte un aviso comercial en un aviso
de cobro. Si hace falta, el sitio es la cabecera —nunca el texto del cliente— y
la cifra se deriva de `payments`, nunca de `reservation.paymentSummary`.
