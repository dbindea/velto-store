# Guion de despliegue a producción

> ## ✅ Ejecutado a medias el 3 de octubre de 2026
>
> **Hecho ya, y no hay que repetirlo:**
>
> - **Las reglas** (`npm run deploy:prod:rules`). Con ellas, `bookingRequests` y
>   `contactRequests` ya existen en producción: la pantalla de Solicitudes no
>   dará el error de permisos que daba.
> - **Las 28 functions**, en las seis tandas y los 15 comandos de abajo.
>   **28 de 28 correctas, cero fallos de cuota** — con la máquina despejada y el
>   manifiesto respondiendo en 0,4 s. Producción sigue en **31**, y ninguna de
>   las cinco de la AEAT se ha colado.
>
> ⚠️ **Y ese ✅ ya no vale entero: hay que volver a pasar por las functions.**
> Entre el 4 y el 5 de octubre se tocó código que alcanza a **24** de las
> desplegadas —medido el 5 recorriendo el grafo de imports desde `index.ts`
> contra `git diff 7a3d8d3..HEAD`, no a ojo—. Lo que cambia, por qué importa, y
> a quién alcanza:
>
> | Fichero | Qué trae | A cuántas alcanza |
> |---|---|---|
> | `contracts/pdf.ts` | el subconjunto de fuente: **1194 KB → 41 KB** por PDF | 16 |
> | `public/mapper.ts`, `types.ts` | etiqueta DGT y frase destacada en la web | 9 |
> | `alerts/*` | las solicitudes sin contestar en el resumen, y su borrado | 2 |
> | `redsys.ts` | — | 4 |
> | `public/trackWebVisit.ts` + `analitica-core.ts` | **se CREA, no existe allí** | 1 |
>
> O sea: las seis tandas de abajo se vuelven a lanzar tal cual, más la orden
> nueva de `trackWebVisit` en la tanda 2. Nada de esto es urgente salvo que se
> quiera el ahorro de los PDF, pero **la web publicada va a medir contra
> `trackWebVisit`**, así que esa sí entra con el merge.
>
> **Y sigue faltando el § 4, el hosting**, que va con el merge a `master`.
> Aplazado al **lunes 5 de octubre** por decisión de Dorel: ese merge publica
> **los dos sitios**, y la web pública quería más rodaje en desarrollo antes de
> salir.
>
> ⚠️ **Mientras tanto, producción está en un estado mixto a propósito**:
> functions y reglas al día, frontend del 2 de octubre (`06d751a`). Comprobado
> ese mismo día en cinco pantallas —panel, Reservas, Contratos, Facturas y
> Ajustes—: **cero errores de consola**. El menú todavía no enseña Solicitudes
> porque esa pantalla llega con el merge.

Preparado el 2 de octubre de 2026, con el estado medido ese día. **Léelo entero
antes de lanzar nada**: el orden importa en dos sitios y hay una comprobación
previa que ahorra una hora de buscar un fallo que no existe.

> ⚠️ **Esto despliega sobre datos reales.** Hay clientes, contratos firmados y
> facturas emitidas en `rentalcar-veltomobility`.

---

## 0. El estado del que se parte

Medido contra `firebase functions:list --project prod`:

| | Cuántas |
|---|---|
| el código define | **36** |
| producción tiene | **31** |
| faltan, a propósito | **5** (las de la AEAT, hasta el 1 de enero) |

Y de las 31 desplegadas, **28 corren código viejo**: cambian 27 ficheros de
`functions/src/` entre `origin/master` y `develop`, y uno de ellos es
`company-config.ts`, que lo importa casi todo.

**Solo tres quedan intactas** y no hay que tocarlas:
`documentLink`, `syncAuthClaims`, `onAuthorizedUserChanged`.

---

## 1. Antes de lanzar nada

### 1.1 Comprobar que el bundle carga

```powershell
cd functions
npm run build
node -e "require('./lib/index.js')"
```

⚠️ **Si eso imprime sin error, el código está bien.** Cuando un despliegue
falle con `Container Healthcheck failed` —que parece un fallo de arranque— la
causa real es la **cuota de CPU de Cloud Run**, y sale una línea antes. Haber
hecho esta comprobación es lo que evita buscar durante una hora un error de
compilación que no existe.

### 1.2 Si la máquina va cargada

El CLI arranca el bundle y le pide el manifiesto; si no contesta en 10
segundos, aborta con `User code failed to load`. **No significa que el código
esté roto**: ha pasado dos veces con la máquina llena de procesos de node.

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT=120
```

⚠️ En PowerShell la variable va **en su propia línea**. El `VAR=valor comando`
de Unix no funciona y el despliegue vuelve a fallar con el mismo mensaje,
pareciendo que el truco no sirve.

### 1.3 Cerrar lo que estorbe

Cierra el `ng serve` y cualquier build de fondo. Es literalmente la causa de
los dos fallos de descubrimiento anteriores.

---

## 2. Las tandas

⚠️ **Nunca `--only functions` a secas en producción.** Subiría las cinco de la
AEAT, que no deben estar allí hasta enero.

⚠️ **De dos o tres, con una pausa entre tandas.** Con 13 a la vez fallan cuatro
o seis al azar; con 35, fallaron 19. Es cuota de CPU de Cloud Run y se libera
sola: el reintento de una tanda pequeña entra.

⚠️ **Y aquí `Skipped (No changes detected)` NO va a salir.** Ese atajo solo
funciona con `--only functions` a secas; nombrándolas, el CLI las actualiza
todas. Lo que hay que leer en cada una es `Successful update operation`.

### Tanda 1 — lo que hoy está MAL en producción

Va primera porque es lo único que está causando daño ahora mismo: los contratos
que se firman hoy imprimen una cláusula de sumisión a los juzgados de Madrid
que es **nula** frente a un consumidor (art. 54.2 LEC y 90.2 TRLGDCU).

```powershell
firebase deploy --only functions:generateContractPdf,functions:getContractForSigning --project prod
firebase deploy --only functions:signContract --project prod
```

### Tanda 2 — por donde entra el cliente desde la web

```powershell
firebase deploy --only functions:createBookingRequest,functions:createContactRequest --project prod
firebase deploy --only functions:publicVehicles,functions:publicVehicleDetail --project prod
firebase deploy --only functions:checkPublicAvailability --project prod
firebase deploy --only functions:trackWebVisit --project prod
```

⚠️ **`trackWebVisit` es la única que se CREA, no se actualiza** (5 de octubre de
2026): producción tiene 31 y el código define 37, y lo que falta son las cinco de
la AEAT —a propósito— **y esta**. Va sola en su orden por eso. Es `onRequest`, no
un trigger de Eventarc, así que no aplica lo del primer trigger que falla.

⚠️ **Y sin su rewrite no mide nada.** `/api/visita` viaja con el **hosting**,
igual que `/api/solicitud` y `/api/contacto`: los tres están en el
`firebase.json` de `develop` y **ninguno** en el de `master`. Su secret
`VELTO_ANALYTICS_SALT` sí está ya puesta en los dos proyectos (comprobado el 5 de
octubre), así que no hay que crearla.

### Tanda 3 — el dinero

```powershell
firebase deploy --only functions:getPaymentCheckout,functions:createRedsysPaymentLink --project prod
firebase deploy --only functions:redsysNotificationWebhook,functions:refundRedsysPayment --project prod
```

### Tanda 4 — facturación

```powershell
firebase deploy --only functions:issueInvoice,functions:generateProforma --project prod
firebase deploy --only functions:generateReceipt,functions:getComplianceStatus --project prod
firebase deploy --only functions:issueComplianceDeclaration --project prod
```

### Tanda 5 — los documentos del cliente

```powershell
firebase deploy --only functions:generateQuotePdf,functions:generateBookingConfirmationPdf --project prod
firebase deploy --only functions:generateInspectionReport,functions:sendSignedContractEmail --project prod
firebase deploy --only functions:getContractVerification --project prod
firebase deploy --only functions:createContractSigningLink,functions:cancelContractSigningLink --project prod
```

### Tanda 6 — avisos y fotos

```powershell
firebase deploy --only functions:sendDailyDigest,functions:previewDailyDigest --project prod
firebase deploy --only functions:publishVehiclePhoto,functions:unpublishVehiclePhoto --project prod
```

**Total: 29 functions en 16 órdenes.**

### Las que NO se despliegan

- **Las cinco de la AEAT** —`sendVerifactuRecords`, `sweepVerifactuRecords`,
  `getVerifactuStatus`, `retryVerifactuRecord`, `checkVerifactuConnection`—
  hasta el guion del 1 de enero.
- `documentLink`, `syncAuthClaims` y `onAuthorizedUserChanged`: no han
  cambiado.

---

## 3. Las reglas de Firestore

⚠️ **Van ANTES del hosting**, y el motivo es concreto: las dos colecciones
nuevas —`bookingRequests` y `contactRequests`— **no existen** hoy en las reglas
de producción. Sin ellas, el `match` final lo deniega todo y la pantalla de
Solicitudes del backoffice sale vacía con un error de permisos.

```powershell
npm run deploy:prod:rules
```

---

## 4. El hosting

⚠️ **Los dos rewrites nuevos viajan con el hosting, no con las functions.**
`/api/solicitud` y `/api/contacto` **no están** en el `firebase.json` de
`master`: hoy esas dos functions están desplegadas y **no se pueden alcanzar
por su ruta pública**. Sin este paso, el visitante rellena el formulario y ve
un fallo de red — es la lección de `/d/**`.

El hosting lo despliega el CI al hacer merge a `master`, los dos sitios:

```powershell
git checkout master
git merge develop
git push
```

⚠️ **«Los dos sitios» no es una forma de hablar: ese merge PUBLICA LA WEB
PÚBLICA.** El workflow de `master` despliega el target `backoffice` **y** el
target `web` con `build:prod`, o sea en modo `live` —con sitemap y sin
`noindex`—. No hay forma de hacer un merge «solo del backoffice».

Es lo que llevó a partir el despliegue el 3 de octubre de 2026: las functions y
las reglas se podían subir ya —y arreglaban daño real, como la cláusula de
sumisión nula de los contratos— mientras la web esperaba. Si algún día hace
falta lo contrario —backoffice sí, web no—, la única vía limpia es mandar
temporalmente el target `web` a un canal de vista previa en el workflow, y
acordarse de revertirlo.

⚠️ **El backoffice se publica antes que la web en el workflow**, a propósito:
son dos productos en un repositorio y que falle el build de Astro no puede
impedir que salga el backoffice.

⚠️ **Y la web de producción se compila con `--mode live`.** Es lo único que
distingue el sitio real: pone el sitemap en `robots.txt` y quita el `noindex`.
Lo lanza **solo** el workflow de `master`.

---

## 5. Comprobar que ha salido

### 5.1 Las functions

```powershell
firebase functions:list --project prod
```

Tiene que seguir dando **31**. ⚠️ **No las cuentes a ojo ni con `grep -c`**: la
lista lleva caracteres de tabla y códigos de color, y el recuento sale mal.
Compara los **nombres**.

### 5.2 El backoffice

Mira el **pie de la aplicación**: dice el commit que se está ejecutando, y
tiene que ser el del merge.

⚠️ **Y míralo en `rentalcar-veltomobility.web.app`, no en el dominio propio.**
Aquel es lo que hay publicado; este es lo publicado **más la caché de
Cloudflare**, que puede seguir sirviendo lo viejo un rato. Un romper-caché con
`?algo` **no basta**: se comprobó y devolvía igualmente la copia vieja.

### 5.3 La web pública

```powershell
curl.exe -s https://velto-web.web.app/robots.txt
```

Tiene que traer la línea `Sitemap:`. **Si no está, el build no salió en modo
`live`** y la web de producción se está ofreciendo con `noindex`.

---

## 6. Lo que NO arregla este despliegue

| | |
|---|---|
| `veltomobility.com` no sirve | el dominio sigue dando el aparcamiento del registrador |
| las facturas ya emitidas | llevan `www.veltorent.com` impreso y **no se pueden corregir** |
| el enlace a la política en la pantalla de pago | sigue apagado hasta poner `VELTO_WEB_BASE_URL` en el `.env` de producción |
| la remisión a la AEAT | sigue en `false`, y solo la cambia Dorel |
