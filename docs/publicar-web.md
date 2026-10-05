# Publicar la web pública

Procedimiento para poner el escaparate en `veltomobility.com`, y para que
`reservas@veltomobility.com` reciba y se pueda contestar desde Gmail.

Escrito el 25 de septiembre de 2026, con el estado medido ese día. **Se hace por
bloques y cada bloque acaba con una comprobación**: si la comprobación no sale,
no se pasa al siguiente. Los bloques 1 y 2 son de correo, el 3 es el ensayo en
desarrollo y los bloques 4 y 5 son producción.

⚠️ **Revisado el 30 de septiembre de 2026, y el bloque 4 cambió entero.** El
sitio de hosting **ya está creado** y las cinco functions públicas **ya están en
producción**; lo que falta son las dos de los formularios, que llegaron después.
Y falta algo que el 25 de septiembre no existía: **lo que la web promete ahora**.
Tiene diez páginas con precios, plazos y coberturas, y nueve datos de negocio sin
decidir —qué localidades entran en los 10 km gratis, el horario, el punto de
encuentro del aeropuerto…—. La lista está en
[traspaso-sesion.md](traspaso-sesion.md) § 5, y **no es un bloque técnico**: se
cierra hablando, no desplegando.

⚠️ **Lo que decide todo es el orden.** Tres dependencias que no se pueden
invertir, y las tres tienen detrás un fallo concreto:

1. **Recibir antes que responder.** Gmail manda el código de verificación **a la
   dirección que estás dando de alta**: sin reenvío montado, el código no llega
   a ninguna parte y el alta se queda a medias para siempre.
2. **Las Cloud Functions antes que el frontend.** El escaparate llama a
   `/api/*`, y el backoffice llama a `publishVehiclePhoto`. Publicado el
   frontend primero, la flota da error y el administrador no puede publicar una
   foto.
3. **El contenido antes que el dominio.** Conectar el dominio a un sitio vacío
   deja el escaparate roto en el dominio de la empresa, y además no se sabe si
   lo que falla es el DNS o el build.

---

## Los comandos van en PowerShell

⚠️ **Todo lo de aquí se lanza desde PowerShell**, que es donde se trabaja en
esta máquina, y eso descarta tres cosas que uno escribe por inercia. La primera
versión de este documento traía las tres y la primera falló al primer intento:

| No funciona | Por qué | Lo que se usa |
|---|---|---|
| `… \| grep "algo"` | `grep` no existe en PowerShell | `Select-String`, o mejor `Resolve-DnsName`, que devuelve objetos |
| `a && b` | El operador es de PowerShell **7**; aquí hay **5.1** | dos líneas, o `;` |
| `curl -sI https://…` | ⚠️ `curl` es un **alias de `Invoke-WebRequest`**: acepta el nombre pero no las banderas | **`curl.exe`**, con el `.exe` |

Es el mismo despiste que CLAUDE.md ya tenía anotado para
`FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy`: ese prefijo `VAR=valor` es
sintaxis de shell tipo Unix y en PowerShell la variable va aparte.

---

## Bloque 0 · Congelar el envío antes de tocar nada

⚠️ **`veltomobility.com` es el dominio desde el que se manda el contrato firmado
a los clientes.** Lo que viene toca su DNS, así que primero se guarda la foto de
lo que hay. Es un minuto y es la red de seguridad de todo lo demás.

```powershell
powershell -ExecutionPolicy Bypass -File docs\comprobar-correo.ps1
```

[`comprobar-correo.ps1`](comprobar-correo.ps1) imprime las cuatro cosas que
importan: qué envía, qué recibe, el SPF del apex y el DMARC. **Guarda la
salida**: los tres registros de la sección ENVIAR son los únicos que hay que
proteger, y si alguno cambia después, el envío está roto.

Para ver cómo queda cuando está bien, el mismo guion contra el dominio que ya
tiene las dos cosas conviviendo:

```powershell
powershell -ExecutionPolicy Bypass -File docs\comprobar-correo.ps1 -Dominio veltorent.com
```

Medido el 26 de septiembre de 2026, ese control devuelve **«el envio esta
SANO»** y **«RECIBE: Email Routing activo»** a la vez. Eso es exactamente lo que
tiene que salir en `veltomobility.com` al terminar el bloque 1.

### ¿Activar el correo entrante puede romper el envío? No

Y conviene saber por qué, porque el instinto dice que sí:

- **SPF no se comprueba contra el remitente que se ve, sino contra el
  Return-Path** (RFC 7208 §2.4). Resend usa `send.veltomobility.com` como
  Return-Path —de ahí el MX `feedback-smtp` que cuelga de ahí—, y **SPF no
  hereda hacia abajo**: el registro que Cloudflare escriba en el apex **nunca se
  evalúa** para un envío de Resend.
- **DKIM** vive en `resend._domainkey`; Cloudflare publica el suyo en
  `cf2024-1._domainkey`. Nombres distintos, registros distintos.
- **Los MX solo dicen dónde ENTREGAR**, no intervienen en la salida.

Y hay un control perfecto: **`veltorent.com` ya tiene las dos cosas a la vez**
—Email Routing de Cloudflare y envío por Resend— y conviven sin tocarse.

⚠️ **Aun así se comprueba al final, con un correo real.** Un fallo de SPF o DKIM
**no tumba el envío: lo manda a spam**, y Resend devuelve `200` igual. Por eso
la comprobación que vale es la cabecera de un correo recibido, no el `nslookup`.

---

## Bloque 1 · Que `reservas@veltomobility.com` reciba

Hoy ese buzón **no existe**: el dominio no tiene ni un registro MX. Lo que hay
montado en Resend es el **envío**, que es otra cosa — Resend no recibe correo.

1. **Cloudflare → zona `veltomobility.com` → Email Routing → Get started.**
   Antes de confirmar, mira la pantalla de revisión de registros: va a añadir
   tres MX `route1/2/3.mx.cloudflare.net`, un TXT SPF y un DKIM en
   `cf2024-1._domainkey`.
   ⚠️ **Si propone tocar `send.veltomobility.com` o `resend._domainkey`, para.**
   Ahí es exactamente donde se rompería el envío de producción.

2. **Destination addresses → añadir `veltorent@gmail.com`.** Cloudflare manda un
   correo de verificación; hay que pulsar el enlace desde el propio Gmail.
   ⚠️ Mientras esté en «Pending», cualquier regla que apunte ahí queda
   **deshabilitada** y el correo no se reenvía.

3. **Routing rules → Create routing rule:** local part `reservas` → Send to an
   email → `veltorent@gmail.com`.

4. **Catch-all: déjalo apagado.** Viene así por defecto. Encendido, todo el
   correo a direcciones inventadas del dominio acaba en el Gmail personal, y eso
   no se saca de la bandeja de entrada.

**Comprobación del bloque:**

```powershell
powershell -ExecutionPolicy Bypass -File docs\comprobar-correo.ps1
```

Tiene que decir **«RECIBE: Email Routing activo»** con los tres
`routeN.mx.cloudflare.net`, y la sección ENVIAR **idéntica** a la del bloque 0.

Y la de verdad: manda un correo a `reservas@veltomobility.com` **desde otra
cuenta** (no desde ese Gmail) y espera verlo llegar. Mira también Spam.

---

## Bloque 2 · Responder desde Gmail como `reservas@veltomobility.com`

⚠️ **Esto caduca en enero de 2027, y está confirmado en la ayuda de Google:**
*«Starting January 2027, Gmail will no longer support the "Send as" feature for
third-party email addresses»*. Exime a los alias de Google Workspace. O sea que
lo que se monta aquí es un **puente de unos tres meses**, no la solución.

La salida duradera, cuando toque decidirla, es **Google Workspace en
`veltomobility.com`**: la dirección deja de ser «de terceros» y pasa a ser un
alias nativo, que Google excluye expresamente del cierre. De paso quita el
reenvío de Cloudflare de en medio. Conviene tenerlo decidido **antes de
diciembre**, no el día que Gmail deje de enviar.

1. **Resend → API Keys → Create API Key.** Nombre reconocible
   (`gmail-reservas`), permiso **Sending access**, dominio `veltomobility.com`.
   ⚠️ **No reutilices la `RESEND_API_KEY` del proyecto.** Es la que usan
   `sendSignedContractEmail` y `sendDailyDigest`: el día que haya que rotarla,
   quieres saber exactamente qué se rompe. Y ojo con el matiz — restringirla al
   dominio **no la aísla de producción**, porque producción ya envía desde ese
   mismo dominio; lo que aísla es que sean dos claves distintas.
   ⚠️ La clave se enseña **una sola vez**. Cópiala antes de cerrar, y **nunca al
   repositorio** ni a `functions/.env.*`, que están versionados.

2. **Gmail → ⚙ → Ver todos los ajustes → Cuentas e importación → Enviar como →
   Añadir otra dirección de correo electrónico.**
   ⚠️ Desde el ordenador, no desde la app del móvil.
   ⚠️ Si el enlace ya no está, la retirada te ha alcanzado: el camino es
   Workspace.

3. Nombre `VELTO MOBILITY`, dirección `reservas@veltomobility.com`, y **deja
   marcada «Tratarla como un alias»** — es literalmente tu caso: Cloudflare mete
   esos correos en esta misma bandeja.

4. **Servidor SMTP:**

   | campo | valor |
   |---|---|
   | Servidor | `smtp.resend.com` |
   | Puerto | `465` (SSL) — si no autentica, `587` con TLS |
   | Usuario | **`resend`**, esa palabra literal |
   | Contraseña | la API key del paso 1, con su prefijo `re_` |

   ⚠️ El error más común aquí es meter la key en el campo de **usuario**: Gmail
   contesta «No se ha podido autenticar» y parece que la clave está mal.

5. **Confirma la dirección** con el código que llega de
   `send-as-noreply@google.com` — a `reservas@veltomobility.com`, que por eso el
   bloque 1 va antes.

6. ⚠️ **Gmail → Ajustes → Cuentas e importación → «Al responder a un mensaje» →
   marcar «Responder desde la misma dirección a la que se ha enviado el
   mensaje».** Sin esto contestarás desde `veltorent@gmail.com` sin darte
   cuenta, que es justo lo que esto viene a evitar. Es global: no hay que
   acordarse en cada correo, que es lo que falla cuando hay prisa.

**Comprobación del bloque:** manda un correo desde Gmail con ese «De:» a una
cuenta de fuera y abre **Mostrar original**. Tiene que decir
`spf=pass`, `dkim=pass header.d=veltomobility.com`, y **no** debe aparecer
«via resend.com» junto al remitente — eso último se lee como phishing.

⚠️ **Y ahora vuelve a pasar el guion:** la sección ENVIAR tiene que salir
**idéntica** a la del bloque 0. Manda además un contrato firmado desde
producción y mira su cabecera: `spf=pass` citando **`send.veltomobility.com`**,
no el apex.

⚠️ **En el móvil el remitente no se cambia solo** en un correo nuevo: hay que
abrir el campo «De». Las respuestas sí salen bien gracias al paso 6.

---

## Bloque 3 · El ensayo: `dev.veltorent.com`

Es el mismo procedimiento que producción sobre un nombre que **hoy no existe**
(NXDOMAIN medido), así que lo que salga mal, sale mal donde no importa.

1. **Publica contenido primero:** `npm run deploy:dev:web`, y comprueba que
   `https://velto-web-dev.web.app` devuelve 200.

2. **Consola de Firebase → proyecto `velto-store` → Hosting → la tarjeta
   `velto-web-dev`** (no la de `velto-store`) **→ Add custom domain →
   `dev.veltorent.com`**.
   ⚠️ **Mira la cabecera del asistente antes de continuar.** El proyecto tiene
   dos sitios: si lo conectas al equivocado, `dev.veltorent.com` serviría el
   **backoffice**.

3. Elige **Quick setup**. Anota los registros literales que te dé: un TXT de
   verificación y uno o dos registros **A**.
   ⚠️ **Usa las IP que te dé la consola**, no las de ninguna guía.

4. **Cloudflare → zona `veltorent.com` → DNS:** crea el TXT y el/los A.
   ⚠️ **El A en GRIS (DNS only).** Con el proxy naranja puesto, Firebase solo ve
   las IP anycast de Cloudflare y **el certificado no llega a emitirse**. No
   crees ningún AAAA a mano.

5. Pulsa **Verify** y espera: Pending → Minting certificate → Connected. Puede
   tardar; la emisión del certificado no es inmediata.

6. **Solo cuando esté Connected**, pasa el A a naranja si quieres el caché y las
   reglas de Cloudflare delante. Es opcional: en gris ya funciona.

**Comprobación:**

```powershell
curl.exe -sI https://dev.veltorent.com
```

Tiene que dar **200**. En gris trae `x-served-by` y **no** `cf-ray`; en naranja
trae los dos, igual que hoy trae `store.veltorent.com`.

⚠️ El `.exe` no es opcional: `curl` a secas es un alias de `Invoke-WebRequest`,
que acepta el nombre y **no** las banderas — el error que da no menciona nada de
esto.

---

## Bloque 4 · Preparar producción (sin publicar nada todavía)

Tres cosas que hay que tener **antes** del merge a `master`. Ninguna se ve desde
fuera: crear un sitio no publica nada y desplegar una function que nadie llama
no cambia el comportamiento de la aplicación.

1. ~~**Crear el sitio de hosting.**~~ **Hecho.** Aquí ponía que `velto-web` no
   existía y que por eso un merge a `master` se caería después de publicar el
   backoffice. **Ya está creado**: comprobado el 29 de septiembre de 2026 con
   `firebase hosting:sites:list --project prod`, que lo devuelve junto a
   `rentalcar-veltomobility`. Ese bloqueo del merge ya no existe.

   ```bash
   firebase hosting:sites:list --project prod   # tienen que salir los dos
   ```

2. **Desplegar las functions de la web pública que falten**, en tandas y
   **nombrándolas una a una**.

   ⚠️ **Las cinco primeras YA están en producción** desde el 25 de septiembre de
   2026 —`publicVehicles`, `publicVehicleDetail`, `checkPublicAvailability`,
   `publishVehiclePhoto`, `unpublishVehiclePhoto`—. Lo que falta a 30 de
   septiembre son **las dos de los formularios** y la **actualización** de
   `sendDailyDigest`, que ahora además borra las consultas caducadas:

   ```bash
   # Descartar el código antes de subir nada: lo carga igual que el contenedor.
   # ⚠️ Una línea cada uno: en PowerShell 5.1 el operador `&&` no existe.
   cd functions
   npm run build
   node -e "require('./lib/index.js')"
   cd ..

   firebase deploy --only functions:createBookingRequest,functions:createContactRequest --project prod
   firebase deploy --only functions:sendDailyDigest --project prod
   ```

   ⚠️ **`createContactRequest` necesita `RESEND_API_KEY`**, que ya está en
   producción; si algún día no estuviera, el despliegue **se cae** en vez de
   avisar. Se comprueba sin imprimir el valor:
   `firebase functions:secrets:access RESEND_API_KEY --project prod >/dev/null 2>&1; echo $?`

   ⚠️ **Y estas dos no bastan con desplegarlas: sus rewrites viajan con el
   HOSTING.** `/api/solicitud` y `/api/contacto` están en `firebase.json`, así
   que hasta que salga el hosting de producción los formularios de la web
   reciben **HTML** donde esperan JSON y enseñan un fallo de red. Es el mismo
   fallo silencioso que tuvo `/d/**`. El merge del bloque 5 los lleva; si se
   despliegan las functions y se retrasa el merge, la web queda con los dos
   formularios rotos.

   ⚠️ **Y que `node -e` no imprima error NO significa que la function
   funcione**: cargar un módulo no es llamarlo. Es justo lo que dejó pasar el
   `import sharp from 'sharp'` que reventó en producción el 25 de septiembre
   —pasó el typecheck, el build, los tests y esta misma comprobación—. Sirve
   para descartar que el bundle esté roto, y para nada más.

   ⚠️ **Nunca `--only functions` a secas en producción:** subiría también las
   cinco de la AEAT, que no deben ir hasta el 1 de enero — y una de ellas está
   **programada cada cinco minutos**.

   ⚠️ Si falla con *«Container Healthcheck failed»*, el `node -e` de arriba ya ha
   descartado el código: es cuota de Cloud Run, y se reintenta por tandas. Si
   falla con *«User code failed to load… Timeout after 10000»*, es la máquina
   cargada, no el código — en PowerShell:
   `$env:FUNCTIONS_DISCOVERY_TIMEOUT=120` y repetir.

3. **Comprobar que salieron 31 y ninguna es de la AEAT:**

   ```bash
   firebase functions:list --project prod
   ```

   El código define **36** y producción tenía **29** el 30 de septiembre de
   2026; con las dos de los formularios son **31**, y las cinco que siguen
   faltando son las de la Agencia. Si salen 36 y aparece
   `sweepVerifactuRecords`, se han colado y hay que borrarlas — esa además está
   **programada cada cinco minutos**.

   ⚠️ **No cuentes a ojo esa lista**: la imprime con caracteres de tabla y
   códigos de color ANSI. Lo que vale es comparar **nombres** contra el
   manifiesto de descubrimiento, que es la pregunta buena —qué falta, no cuántas
   hay—. El procedimiento está en CLAUDE.md § «El arranque en frío».

---

## Bloque 5 · Publicar

1. **Merge de `develop` a `master`.** El CI construye y despliega **solo
   hosting**: backoffice primero, web después, los dos con `target` explícito, y
   con una guarda que **falla si el artefacto de la web no es el de
   producción**. No hace falta desplegar reglas ni índices: no cambian.

2. **Comprobar en el dominio `.web.app`, no en el propio.** El dominio propio va
   detrás de Cloudflare y es «lo publicado **más la caché**».

3. **Publicar los coches en el backoffice de producción, con fotos de la flota
   real.**
   ⚠️ **Las fotos de desarrollo son de Wikimedia, licencia CC BY-SA:** obligan a
   acreditar al autor y **no valen para un escaparate comercial**.
   ⚠️ Y nada de sembrar coches `demo-*` en producción: allí Redsys está en
   `live`.
   Comprueba con `/api/fleet` del `.web.app` que la flota sale **antes** de que
   nadie pueda verla.

4. **Conectar `veltomobility.com`**, mismo procedimiento del bloque 3.
   ⚠️ Hoy ese apex está proxiado hacia IONOS y da **525** por HTTPS: hay que
   quitar ese registro y poner el de Firebase. No se pierde nada — lo que sirve
   hoy es el aparcamiento del registrador.
   ⚠️ **Los MX no se tocan.** Son un tipo de registro distinto: cambiar el A del
   apex no afecta al correo que montaste en el bloque 1.
   ⚠️ Revisa el **modo SSL/TLS** de la zona: con Firebase detrás corresponde
   **Full (strict)**. El 525 de hoy es lo que pasa cuando ese modo no cuadra con
   el origen.

5. **`veltorent.com` redirige a `veltomobility.com`**, con una **Redirect Rule
   de Cloudflare** — preservando ruta y query.
   ⚠️ Esto **no está en el repositorio**: `firebase.json` no tiene ningún bloque
   `redirects`. Si algún día alguien busca dónde está configurado, está en
   Cloudflare y en ningún otro sitio.
   ⚠️ Va **después** de que el canónico funcione: una redirección hacia un
   dominio que devuelve 525 manda al visitante a un error.

6. **Search Console y sitemap**, lo último. Anunciar el dominio antes de que
   sirva es pedirle a Google que indexe un error.

---

## Lo que queda anotado y no es de hoy

- **Enero de 2027: Gmail deja de enviar como direcciones de terceros.** Decidir
  antes de diciembre si se pasa a Workspace.
- **No hay `_dmarc` en ninguno de los dos dominios.** Hoy eso hace el cambio del
  bloque 1 más seguro —el reenvío rompe SPF por diseño, y con `p=reject`
  dejarían de entrar correos legítimos—. Si algún día se publica: empezar por
  `p=none` con `rua=`.
- **`index.html` del backoffice sigue a `max-age=3600`**, el mismo retraso de
  una hora que la web pública ya tiene corregido. Es un cambio aparte.

---

## Cloudflare: qué se cachea y qué NO puede cachearse nunca

Añadido el 5 de octubre de 2026, con el estado **medido** ese día contra
producción (`cf-cache-status` en la respuesta real, no leído de la configuración):

| | Estado |
|---|---|
| HTML (`/`, `/flota`) | `DYNAMIC` — no se cachea en el borde |
| `/_astro/*`, `/brand/*` | `HIT` — correcto, un año `immutable` |
| `/api/fleet` | `DYNAMIC` |
| Compresión | ya activa (`br` / `zstd`) |

⚠️ **`/api/fleet` bajó de `s-maxage=600` a `s-maxage=60`.** Aquel valor
contradecía la regla que sostiene el diseño de toda la web —«publicar un coche
se ve al momento, sin redesplegar»—: el día que Cloudflare empezara a respetarlo,
un coche recién publicado habría tardado **diez minutos** en aparecer, y nadie
habría relacionado una cosa con la otra. Hoy no se nota porque Cloudflare lo
ignora: por defecto solo cachea por extensión de fichero y `/api/fleet` no tiene.
O sea que era una trampa **armada y sin disparar**.

### Las tres reglas que tiene que haber si se activa el cacheo

⚠️ **`/api/solicitud`, `/api/contacto` y `/api/visita` van en BYPASS, siempre.**
Las dos primeras escriben; la tercera cuenta visitas y cacheada dejaría de
contarlas — y un contador que no cuenta no se nota, simplemente da un número más
bajo que nadie cuestiona.

`/api/fleet` y `/api/vehicle` sí pueden cachearse respetando el origen, ahora que
el plazo es de 60 s. El HTML solo si se añade **purga al desplegar**: no lleva
huella en el nombre, así que sin purgar, un despliegue no se vería hasta vencer
el TTL.

### Lo que NO se activa

- **Rocket Loader** — difiere los scripts y rompería el script en línea que fija
  el tema: parpadeo blanco en cada carga.
- **«Cache Everything» sin el bypass de `/api`** — congela la flota y mata la
  analítica.
- **Auto Minify** — retirado por Cloudflare, y sobre el HTML de Astro puede
  romper los scripts en línea.

⚠️ **Y la advertencia que evita gastar esfuerzo donde no toca:** con el tráfico
de hoy, el cacheo en el borde apenas ayuda —cada centro de datos cachea por su
cuenta—. Medido en caliente, la API contesta en **26–134 ms**. El riesgo real de
lentitud es el **arranque en frío** de la Cloud Function, y eso no lo arregla
ninguna opción de Cloudflare: se arregla con `minInstances`, que cuesta dinero
cada mes.

## El `www`, y por qué redirige en vez de servir

El canónico es el **apex** (`https://veltomobility.com`), y no es una preferencia
suelta: es lo que ya declaran `SITIO` en `web/src/lib/empresa.ts`, el
`<link rel="canonical">` y el sitemap. Lo que Google pide no es un host concreto,
sino que **solo uno sirva** y el otro mande un **301**, con todas las señales
apuntando al mismo.

⚠️ **`www` NO se añade como dominio personalizado en Firebase Hosting.** Eso
serviría el mismo sitio en dos hosts —contenido duplicado— en vez de redirigir.
Lo que hay es un registro DNS proxied y una **Redirect Rule** de Cloudflare, que
contesta en el borde sin llegar al origen:

```
Request URL:  https://www.veltomobility.com/*
Target URL:   https://veltomobility.com/${1}
Código:       301
Preserve query string: sí
```

⚠️ **La plantilla de Cloudflare trae `https://www.*` y dice «funciona sin
cambios». Aquí no.** Con ese patrón `${1}` captura `veltomobility.com/flota`
entero y el destino sale `https://veltomobility.com/veltomobility.com/flota`. La
pareja coherente con el comodín genérico sería `https://www.*` → `https://${1}`.

⚠️ Y **la ruta tiene que conservarse**. Una redirección que lo manda todo a la
portada pierde la página que el visitante pedía, y Google lo trata como un
*soft 404* en vez de como un traslado.
