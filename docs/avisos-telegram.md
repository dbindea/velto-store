# El aviso de que ha entrado dinero

Cómo dar de alta el bot de Telegram que avisa cuando un cobro con tarjeta se
confirma, y qué hay que saber antes de desplegarlo.

Escrito el 18 de octubre de 2026.

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

```bash
firebase deploy --only functions:redsysNotificationWebhook --project dev
firebase deploy --only functions:redsysNotificationWebhook --project prod
```

---

## Lo que hay que saber antes de desplegar

⚠️ **Declarar un secret que no existe ROMPE el despliegue.** `TELEGRAM_BOT_TOKEN`
está en el `secrets: [...]` de `redsysNotificationWebhook`, así que **tiene que
existir en los dos proyectos** antes del primer despliegue de esa function, o el
del proyecto que falte se cae. No hace falta que esté *usado* —el chat puede
quedarse vacío— pero el secret tiene que existir. Para comprobarlo sin imprimir
el valor:

```bash
firebase functions:secrets:access TELEGRAM_BOT_TOKEN --project prod >/dev/null 2>&1; echo $?   # 0 = existe
```

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

## Qué llega, y por qué así

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

## Lo que NO hace, y hace falta igual

**El correo.** Telegram es el pitido; el correo es el registro escrito que
queda cuando el pitido falla, y el que se puede buscar dentro de seis meses.
Hoy el webhook no manda ninguno. Está pendiente, y reutiliza la cáscara de
`functions/src/alerts/email-shell.ts`.
