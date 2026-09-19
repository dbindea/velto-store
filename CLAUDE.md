# CLAUDE.md

Velto Store — SPA de gestión de flota de alquiler de vehículos. Angular 20 + Firebase.

Este archivo cubre el **cómo** (stack, comandos, convenciones). Para el **qué y el porqué**
—negocio, estado real de cada módulo, decisiones abiertas y roadmap— ver [FUNCIONAL.md](FUNCIONAL.md).

## Stack

- **Angular 20.3** — standalone components, sin NgModules
- **TypeScript 5.9** — `strict: true` + `strictTemplates`
- **Firebase 12** / **AngularFire 20** — Auth (Google), Firestore, Storage, Hosting
- **Cloud Functions** — Node 22, TypeScript, `pdf-lib` + `fontkit`
- **Tailwind CSS v4** (vía `@tailwindcss/postcss`) + SCSS
- **PrimeIcons** — iconos por clase CSS (`<i class="pi pi-car">`)

## Comandos

Todos verificados contra `package.json`.

```bash
npm start                 # ng serve → http://localhost:4200 (apunta a velto-store)
npm run build             # build optimizada → velto-store   (configuración dev)
npm run build:prod        # build optimizada → rentalcar-veltomobility (configuración production)

# Despliegues. El nombre del script dice a dónde va, y el destino viaja en
# --project: nunca dependas del `firebase use` que quedara de la última vez.
npm run deploy:dev:hosting     npm run deploy:prod:hosting
npm run deploy:dev:functions   npm run deploy:prod:functions
npm run deploy:dev:rules       npm run deploy:prod:rules   # reglas + índices + storage

npm run firebase:emulators

# i18n (ver sección abajo)
npm run i18n:audit        # verifica claves faltantes, huérfanas y paridad es/en/ro
npm run css:audit         # clases usadas en plantillas que no declara nadie
npm run spacing:audit     # espaciados fuera de la escala (--fix los alinea)
npm run rows:audit        # formularios en escalera: campos que van al lado y salen escalonados

# Cloud Functions
npm --prefix functions run build      # tsc + copia de fuentes TTF
npm --prefix functions run logs:dev   # o logs:prod
```

**Typecheck sin compilar** (lo más rápido para validar un cambio):

```bash
npx tsc -p tsconfig.app.json --noEmit
cd functions && npx tsc --noEmit
```

⚠️ **`tsc` NO comprueba las plantillas, y `strictTemplates` está activado.** Un
`[problems]="problems"` que le pasa el mapa entero a un `@Input()` que espera una
clave **pasa el typecheck y revienta en `npm run build`**, porque la que valida
los tipos del HTML es la compilación de Angular. Es decir: el typecheck vale para
iterar, pero antes de dar un cambio por bueno hay que construir.

⚠️ **Y una Cloud Function editada no es una Cloud Function desplegada.** Lo
obvio, hasta que se prueba contra desarrollo un cambio de backend que solo está
en el disco: el frontend llama, la function **vieja** contesta, y lo que se ve
es el comportamiento antiguo con el código nuevo delante. Pasó el 15 de
septiembre de 2026 probando la sustitución de contratos, y costó un rato
entender por qué el archivo no se creaba.

## Tests

Hay dos suites independientes, ambas con Vitest:

```bash
npm test                      # app (src/**/*.spec.ts) vía @angular/build:unit-test
npm --prefix functions test   # Cloud Functions (functions/src/**/*.spec.ts)
```

Cobertura actual — deliberadamente estrecha, centrada en lo que puede costar dinero:

- `reservation-workflow.util.spec.ts` — los guards `can*`, los overrides de `WorkflowContext`, y las excepciones de workflow
- `payment-summary.util.spec.ts` — la liquidación de pagos sembrados (M-14)
- `pricing.util.spec.ts` — que el IVA se **extrae** y no se suma, que `base + vat` cuadra al céntimo, y que el descuento de fidelidad y el precio acordado se acumulan sin fundirse
- `functions/src/redsys.spec.ts` — la firma `HMAC_SHA256_V1` contra un vector de referencia congelado
- `functions/src/contracts/qr.spec.ts` — que el QR del contrato **se lee de verdad**: rasteriza los rectángulos que se dibujan y los descifra con `jsqr`. Un símbolo mal montado tiene la misma pinta que uno bueno

El builder `@angular/build:unit-test` es **experimental** en Angular 20 y avisa por consola al arrancar. `tsconfig.spec.json` usa `vitest/globals`, no jasmine.

⚠️ `functions/tsconfig.json` excluye `**/*.spec.ts` del build. No quites esa exclusión: `firebase deploy` sube todo lo que haya en `lib/`, y el bundle acabaría importando vitest en runtime.

⚠️ **`rootDir` está puesto a mano en los tres tsconfig, y en `functions/` no es cosmético.**
Sin él TypeScript lo deduce del directorio común de las entradas. Hoy todo cuelga de `src/`,
así que `src/index.ts` sale en `lib/index.js`, que es lo que dice el `main` del
package.json. El día que un fichero de entrada quede fuera de `src/` —basta con importar
algo de `../` para compartir código con la app— la raíz común sube, la salida pasa a
`lib/src/index.js` y el `main` apunta a un fichero que ya no existe: compila, despliega y
las functions revientan al arrancar. Con `rootDir` explícito, ese caso da un error de
compilación (`TS6059`) en vez de mover la salida en silencio. Es además el motivo técnico
por el que la app y las functions **no pueden compartir módulo**, más allá de tener
tsconfigs separados.

## Lo que NO existe en este proyecto

- **No hay lint.** No hay ESLint configurado ni script `lint`.
- **El CI no despliega Cloud Functions.** Solo hosting. Van a mano y con destino explícito: `npm run deploy:dev:functions` o `deploy:prod:functions`. Es el punto más frágil de los dos entornos — es fácil arreglar algo en uno y olvidarlo en el otro.
- **No hay tests de componentes ni E2E.** Solo utils y lógica pura.

⚠️ **Desplegar las trece de golpe agota la cuota de CPU de Cloud Run**, y el
mensaje no lo dice a la primera. Lo que se lee es `Container Healthcheck
failed. Revision … is not ready and cannot serve traffic`, que parece un fallo
de arranque del código; la causa real —`Quota exceeded for total allowable CPU
per project per region`— sale una línea antes y solo en algunos intentos. Fallan
cuatro o seis functions al azar, distintas cada vez.

Antes de tocar nada, **descarta el código** cargando el bundle igual que lo carga
el contenedor:

```bash
cd functions && node -e "require('./lib/index.js')"
```

Si eso imprime sin error, el código está bien y lo que falta es cuota: reintenta
**por tandas de dos o tres** con `firebase deploy --only functions:a,functions:b`.
Pasó el 7 de septiembre de 2026, y se perdió un rato buscando un error de
compilación que no existía.

⚠️ **Y hay un segundo error que también acusa al código sin motivo:**

```
Error: User code failed to load. Cannot determine backend specification.
Timeout after 10000.
```

No dice lo que parece. Antes de subir nada, el CLI arranca `lib/index.js` en un
servidor local y le pide el manifiesto por `http://127.0.0.1:<puerto>/__/functions.yaml`;
si no contesta en **10 segundos**, aborta. O sea que significa «no me contestó a
tiempo», no «tu código está roto» — y **no se despliega nada**, así que no deja
medio estado.

Medido el 17 de septiembre de 2026, cuando salió: el bundle carga en **1,2 s**, y
**1,9 s** recién compilado; el descubrimiento entero responde `200` en **1,18 s**
con las 26 functions. Lo que se comió los diez segundos era la máquina —31
procesos de node, con un `ng serve` recompilando de fondo—. Se reproduce a mano
así, que es lo que descarta el código:

```bash
cd functions
FUNCTIONS_CONTROL_API=true PORT=8355 node node_modules/firebase-functions/lib/bin/firebase-functions.js . &
curl -s -m 30 -o /dev/null -w "%{http_code} en %{time_total}s\n" http://127.0.0.1:8355/__/functions.yaml
curl -s http://127.0.0.1:8355/__/quitquitquit   # apagarlo
```

⚠️ Sin `FUNCTIONS_CONTROL_API=true` esa ruta **no se registra** y responde `404`
—que parece el fallo y no lo es—: el servidor solo la monta con esa variable.

El plazo se sube con `FUNCTIONS_DISCOVERY_TIMEOUT`, **en segundos**:

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions:x --project prod
```

## Dos entornos, dos proyectos de Firebase

Una sola base de código. Lo único que cambia entre entornos es **qué fichero de
entorno se compila** y **a qué proyecto apunta el CLI**. No hay `if (production)`
en el código de la app, y no debe haberlo.

| | Desarrollo | Producción |
|---|---|---|
| Proyecto Firebase | `velto-store` | `rentalcar-veltomobility` |
| Rama | `develop` | `master` |
| Entorno compilado | `environment.ts` | `environment.production.ts` |
| Configuración de build | `dev` | `production` |
| Dominio | `store.veltorent.com` | `rentalcar.veltomobility.com` |
| Alias del CLI | `--project dev` | `--project prod` |
| Firestore | `eur3` | `eur3` |
| Storage | `eu` multirregión | `eu` multirregión |
| Cloud Functions | `europe-west1` | `europe-west1` |

⚠️ **Las dos configuraciones producen bundle optimizado.** La diferencia no es
cuánto optimizan, es a qué proyecto apuntan. `development` (sin `--configuration`
propia en los scripts) es solo para `ng serve`.

⚠️ **El `default` de `.firebaserc` es `velto-store`, y tiene que seguir
siéndolo.** Es el proyecto al que va cualquier comando del CLI lanzado sin
`--project`: un `firebase deploy` a secas, un `firestore:delete`, un
`functions:secrets:set`. Con producción como defecto, el despiste se paga caro;
con desarrollo, no pasa nada. Los scripts de `package.json` llevan el destino
explícito precisamente para no depender de esto, pero el defecto es la última
red. Estuvo apuntando a producción el 29 de agosto de 2026 y se devolvió a
desarrollo el mismo día.

⚠️ **`.firebaserc` no es el único sitio.** El CLI guarda además cuál es el
proyecto **activo por carpeta**, fuera del repositorio, y ese manda sobre el
`default` del fichero. Editar `.firebaserc` no lo cambia. Para comprobarlo y
corregirlo:

```bash
firebase use          # dice a dónde irían los comandos sin --project
firebase use dev      # lo devuelve a desarrollo
```

⚠️ **El `fileReplacements` estuvo invertido hasta el 28 de agosto de 2026**: la
configuración `production` metía el fichero de desarrollo. Con un solo proyecto
no se notaba; con dos, `master` habría desplegado la web de producción contra la
base de datos de desarrollo. Si tocas `angular.json`, compruébalo con:

```bash
npm run build:prod && grep -o 'projectId:"[a-z-]*"' dist/velto-store/browser/*.js | head -1
```

- Commits en formato convencional (`feat:` / `fix:` / `docs:` / `refactor:`).
- No existe rama `main`.

⚠️ Merge a `master` = despliegue a **producción con datos reales**. Confirma antes.

### La región de las functions está en TRES sitios

`europe-west1`, junto a Firestore y Storage. Todo lo que corre allí está al lado
de sus datos; hasta el 28 de agosto de 2026 las functions vivían en
`us-central1` y cada PDF cruzaba el Atlántico dos veces, con datos personales de
contratos procesándose en Estados Unidos aunque se guardaran en Europa.

Si se cambia, se cambian **los tres a la vez** o algo deja de encontrarse:

1. `functions/src/global-options.ts` — `FUNCTIONS_REGION`, donde se despliegan.
2. `src/app/app.config.ts` — `getFunctions(getApp(), 'europe-west1')`. Sin el
   segundo argumento el SDK pide **us-central1**, y todos los callables fallan
   con un 404 que parece un problema de permisos y no lo es.
3. `firebase.json` — la región del rewrite `/d/**`. Esta viaja con el
   **hosting**, no con las functions: al mover la región los enlaces cortos
   dieron 404 hasta redesplegar hosting. Verificado ese día: 404 antes,
   `200 application/pdf` después.

⚠️ `setGlobalOptions` solo afecta a lo declarado **después** de llamarlo, y los
`export ... from` de `index.ts` evalúan sus módulos antes que cualquier
sentencia escrita en ese fichero. Por eso vive en su propio módulo importado en
la primera línea y no como una llamada suelta: ahí llegaría tarde y las
functions se desplegarían en la región por defecto sin que nadie se enterase.

### Los datos de producción YA SON REALES — se migra, no se borra

⚠️ **Vigente desde el 17 de septiembre de 2026.** Dorel avisó ese día de que la
empresa empieza a trabajar en real sobre `rentalcar-veltomobility`. Hasta
entonces regía la regla contraria —datos desechables, nada de parches de
compatibilidad— y esta sección se escribió desde el principio para ser
sustituida el día que llegara este aviso. Ha llegado.

Lo que había detrás de aquella regla sigue siendo cierto y por eso se cuenta:
**un parche de compatibilidad se escribe en un minuto y se arrastra durante
meses** (`tariffIncludesVat`), así que la forma de un documento se pensaba bien
y, si había que cambiarla, se borraba y se volvía a crear. Eso ya no está
disponible.

A partir de ahora, y esto es lo importante:

- **Los campos son solo aditivos.** Uno nuevo nace opcional y con su valor por
  defecto resuelto **al leer**, no rellenando la colección entera.
- **Nunca se renombra en sitio.** Renombrar es escribir el nuevo, migrar y
  borrar el viejo, **en despliegues separados**: entre el primero y el último
  hay clientes usando la aplicación, y un móvil con la pestaña abierta desde
  ayer sigue ejecutando el bundle anterior.
- **Nada de borrar colecciones en producción.** Lo del 17 de septiembre fue el
  último; después de él hay reservas y clientes de verdad.
- **Se prueba en `velto-store`, no en producción.** Mientras los datos fueron
  desechables estuvo permitido ensuciar producción para probar, y ya no lo está:
  una reserva de prueba entre las reales es una reserva que alguien atenderá.
- **Un cambio de forma se prueba contra una copia**, no contra la base viva. Las
  copias diarias y el PITR están activos desde el 11 de septiembre; el
  procedimiento, en [docs/copias-de-seguridad.md](docs/copias-de-seguridad.md).

⚠️ **Y lo que no se puede migrar hacia atrás es lo congelado.** Los snapshots
—`pricingSnapshot`, `ownerShareSnapshot`, `clientSnapshot`, el del contrato— son
histórico: si el modelo cambia, los antiguos **se quedan como están**, y el
código nuevo tiene que saber leerlos. Eso no es un parche de compatibilidad, es
la razón de ser de un snapshot.

⚠️ **La facturación va a ser la primera excepción, y ya está aprobada** (N-18, 8
de septiembre de 2026). Una factura emitida **no se borra ni se edita nunca**:
un error se corrige con una factura rectificativa, y el número consumido queda
consumido aunque la operación se anule. A partir de 2027 va además encadenada
por huella SHA-256, así que borrar una rompe la cadena de todas las siguientes.

Es decir: `invoices` nacerá con `create` permitido y **`update` y `delete`
denegados a todo el mundo, administrador incluido** —como ya ocurre con los
contratos firmados—, y con la forma del registro fijada desde la primera factura
porque después no se puede reconstruir. El análisis, con las fuentes del BOE y
de la AEAT, está en [docs/facturacion.md](docs/facturacion.md).

⚠️ **Y la inmutabilidad tiene un límite que costó descubrir: lo que se congela
no se puede corregir, ni siquiera cuando la AEAT lo rechaza.** El registro de
facturación se guardaba entero dentro de la factura, así que un registro
rechazado —por un fallo del código, no del dato— no había forma de arreglarlo, y
como todo lo que viene detrás encadena con su huella, la facturación se quedaba
parada sin salida. Por eso el registro se **reconstruye al enviar**
(`verifactu-rebuild.ts`) y la huella se **comprueba**, no se copia: la factura
sigue siendo inmutable, y lo que puede cambiar es solo cómo se declara algo que
no entra en la huella. Ver «El registro que se manda» más abajo.

## Estructura

Alias de path definidos en `tsconfig.json` — **úsalos siempre** en vez de rutas relativas largas:

```
@app/*      → src/app/*
@core/*     → src/app/core/*
@shared/*   → src/app/shared/*
@features/* → src/app/features/*
@layout/*   → src/app/layout/*
@env/*      → src/environments/*
```

```
src/app/
├── core/
│   ├── auth/auth.service.ts          # Firebase Auth + autorización vía Firestore
│   ├── config/brand.config.ts
│   ├── firebase/                     # firestore.service.ts, storage.service.ts
│   ├── guards/                       # auth.guard.ts, public.guard.ts
│   ├── i18n/translate.service.ts
│   ├── reports/reports.service.ts
│   ├── search/global-search.service.ts
│   ├── services/firebase-status.service.ts
│   └── theme/theme.service.ts
├── features/                         # cada uno con pages/ + services/ + components/
│   ├── calendar/  clients/  contracts/  dashboard/  expenses/
│   ├── inspections/  payments/  reports/  reservations/
│   ├── settings/  vehicles/
├── layout/private-layout/
├── login/
└── shared/
    ├── components/                   # global-search, icon, image-gallery,
    │                                 # language-selector, photo-upload-buttons,
    │                                 # reservation-timeline, signature-pad
    ├── models/                       # client, contract, inspection, payment,
    │                                 # reservation, vehicle, authorized-user
    ├── pipes/translate.pipe.ts
    └── utils/                        # ver "Lógica de negocio"

functions/src/
├── admin-guard.ts                    # init lazy del admin SDK
├── company-config.ts                 # datos de empresa, leídos en cada llamada
├── redsys.ts                         # createRedsysPaymentLink + webhook
├── public-url.ts                     # el dominio que ve el cliente, en un solo sitio
├── contracts/                        # generateContractPdf, signingLink,
│                                     # getContractForSigning, signContract,
│                                     # sendSignedContractEmail, clauses, pdf,
│                                     # sign-pdf, verification + qr (el CSV)
├── documents/                        # presupuesto y justificante de reserva
│                                     # (documents-pdf, storage, locator,
│                                     # documentLink, los 2 callables)
└── invoices/                         # factura, rectificativa (issueInvoice),
                                      # proforma y recibo de cobro. hash.ts es
                                      # la cadena de huellas; receipt-core.ts,
                                      # qué cobro admite recibo
```

**Ya no queda ningún placeholder**: Gastos y Ajustes se construyeron el 4 de septiembre de 2026.

## Lógica de negocio

### El workflow es la única fuente de verdad

`src/app/shared/utils/reservation-workflow.util.ts` (19 KB) define el orden canónico del alquiler:

```
Presupuesto → Reserva → Cliente → Pago señal → Contrato PDF
  → Link de firma → Firma cliente → Pago resto + fianza
  → Entrega (inspección) → Devolución (inspección)
  → Cargos extra + fianza → Cierre
```

`canStartPickup`, `canStartReturn`, `canCloseReservation`, etc. son **la única autoridad**. La UI los usa para deshabilitar botones y los servicios los invocan antes de mutar estado (defensa en profundidad). No dupliques estas reglas en componentes.

Para saltarse un paso hay que llamar `buildWorkflowException(action, reason, createdBy)` con motivo obligatorio (mín. 3 caracteres), que se persiste en `reservation.workflowExceptions[]`.

⚠️ **`canCreateReservationForClient()` no admite excepción.** Un cliente `blocked` no puede
tener reserva nueva, y punto: saltarse un paso es un atajo operativo, pero alquilar a alguien
a quien has bloqueado es una decisión sobre ese cliente y se toma en su ficha, cambiándole el
nivel de confianza. `risk` no bloquea; solo avisa vía `clientTrustWarning()`.

### `reservation-edit.util.ts` es la única autoridad sobre qué se puede CAMBIAR

Lo que el workflow es a «qué pasos se pueden dar», este util lo es a «qué campos
de una reserva ya creada se pueden tocar y cuándo». La pantalla apaga o explica
cada campo preguntándole, y `editReservation()` le pregunta lo mismo antes de
escribir.

⚠️ **La decisión es POR CAMPO, y ese es el motivo de que exista.** Las
restricciones no se parecen: la fecha de **devolución** se mueve con el coche ya
entregado —una prórroga es el caso más normal del negocio— y la de **recogida**
no, porque el coche ya salió y la fecha real está en el parte de entrega. Un
único «¿se puede editar esta reserva?» tendría que contestar lo más restrictivo
para todos, y entonces no se podría prorrogar nada.

⚠️ **El dinero se decide mirando `payments`, no `paymentSummary`.** La copia de
la reserva se queda vieja y **responde `0` en vez de fallar**: con ella, una
fianza ya cobrada parecería editable. Y se mide **movimiento, no saldo**
(`movedOn`): una fianza cobrada y devuelta entera deja un neto de 0, pero al
cliente se le cobraron 150 € y cambiar después el importe exigido dejaría la
reserva diciendo otra cosa. Es justo lo contrario de `sumPaid()`, que sí resta —
aquella contesta cuánto entró, y esta si ha pasado algo.

⚠️ **La señal y el resto se reparten sin mover el total**
(`redistributeInitialPayment`). Bajar la señal de 50 a 30 sube el resto a 272,50:
los 20 € no desaparecen. Con dos campos sueltos, olvidar subir el resto dejaría
la reserva debiendo 20 € menos de lo que vale el alquiler, y se podría cerrar
cobrando de menos sin que nada avisara.

⚠️ **La reserva y sus filas de cobro se reescriben en el MISMO `writeBatch`**,
por lo mismo que al crearla: separadas, un fallo entre medias deja una reserva
que dice valer 302,50 € y unas filas que piden 250 — y las dos cifras se enseñan
en pantallas distintas, así que nadie se entera.

⚠️ **Y un campo que llega igual que estaba no es un cambio.** Abrir el formulario
de una reserva con la fianza cobrada y guardarlo sin tocar nada fallaría con «la
fianza ya está cobrada», porque el importe viaja en la petición aunque nadie lo
escribiera. Ojo con el precio: «sin precio acordado» **no es lo mismo que** el
neto de la tarifa, y compararlo contra `netPrice` marcaba un cambio de precio que
no existía. Lo resuelve `agreedNetPriceOf()`, que usan el formulario y el
servicio para que las dos preguntas sean la misma.

### Un contrato firmado se ARCHIVA, nunca se pisa

Cuando cambia algo que el PDF imprime —el cliente, las fechas, el precio, la
fianza o los conductores—, el contrato firmado deja de decir la verdad y hay que
rehacerlo. **No se borra**: `firestore.rules` deniega `delete` en `contracts`
incluso al administrador, y con razón. Se copia entero a
`contracts/{reservaId}-v{n}` con estado `superseded` —su PDF firmado, su huella
y su código de verificación— y el vigente se rehace limpio. Misma idea que la
factura rectificativa: un error no se borra, se corrige con un documento nuevo.

⚠️ **`generateContractPdf` escribía con `set(merge: true)` sin mirar el
estado**, así que llamar al callable sobre una reserva ya firmada dejaba el
documento en `generated` con un `pdfUrl` nuevo y los campos de la firma colgando
de un fichero que ya no era ese. La pantalla lo impedía (`canGenerateContract`
deniega si `signed`), pero eso es la interfaz, no la seguridad. Ahora el backend
se niega sin `supersede: true` y sin motivo.

⚠️ **Lo de la firma anterior hay que BORRARLO a mano** al rehacer. `merge: true`
conserva lo que no se nombre, así que el contrato nuevo nacía con el `signedAt`,
la huella y el código de verificación del anterior pegados encima.

⚠️ **Y `superseded` tiene que ser un estado PROPIO en la verificación pública.**
Cayendo en `unknown`, el QR del papel del cliente respondía «No encontrado» — se
le decía que su contrato no existe, que es lo contrario de lo que pasó y lo único
que archivarlo tenía que evitar. Tampoco vale devolverlo como `valid`: el papel
ya no es el acuerdo vigente. Se le dicen las dos cosas.

⚠️ **`getContractByReservation` descarta lo sustituido ANTES de ordenar.** El
archivo copia el documento entero, `createdAt` incluido, así que empata con el
vigente: ordenar por fecha y quedarse con el primero devolvería uno de los dos al
azar.

### `pricing.util.ts` es la única autoridad sobre el precio

`resolveRentalPrice()` resuelve los tres escalones en orden — tarifa → descuento de
fidelidad del cliente → precio acordado a mano — y devuelve cada tramo por separado.
La usan el asistente de creación y `reservation.service.ts`, que **recalcula** en vez de
fiarse de la cifra que enseñó la UI. No dupliques la aritmética en un componente.

Dos convenciones distintas que conviene no confundir, y por eso los nombres son explícitos:

- `vatRate` es una **fracción** (`0.21`)
- `loyaltyDiscountPercent` es un **porcentaje** (`5`)

⚠️ **El precio de tarifa es NETO: el IVA se SUMA.** Un coche a 30 €/día son 30 € de base
y el cliente paga 36,30 €. Es lo contrario de como empezó la app, y es deliberado: el número
redondo es el que se negocia, y el cliente que no quiere factura paga exactamente ese neto.

`vatBreakdownOf()` parte siempre de `pricingSnapshot.netPrice`, **nunca de `finalPrice`**,
que es el derivado. El IVA se calcula por resta para que `base + vat` cuadre al céntimo.

El tipo sí se congela por reserva en `pricingSnapshot.vatRate`, para que una subida futura
del tipo general no mueva un contrato ya firmado.

#### Una reserva puede ir SIN IVA, y entonces los papeles no lo nombran

Decisión de Dorel del 18 de septiembre de 2026, y el caso es el que esta misma
sección ya describía: **el cliente que no va a pedir factura paga exactamente el
neto**. Ahora eso se puede pactar con una casilla —«Sin IVA», en el asistente y
en la edición de la reserva— en vez de a mano.

⚠️ **Lo único que se guarda es el tipo congelado a 0.** Se pensó en un campo
aparte (`vatExempt`) y sobra: dos datos para el mismo hecho son dos datos que
pueden discrepar, y el día que discrepen el contrato diría una cosa y el importe
otra. `resolveVatRate()` ya respeta el 0 en vez de caer al general, así que la
aritmética sale sola.

⚠️ **Y `chargesVat()` decide TEXTO, no aritmética.** Es toda su razón de ser: el
contrato, el presupuesto y el justificante **no mencionan el impuesto** cuando no
lo hay — ni la base imponible, ni la cuota, ni el «(no sujeta a IVA)» de la
fianza, ni el aviso del presupuesto que explica que el IVA se suma, ni la
enumeración de la cláusula de precio («…tasas aeroportuarias si las hubiere, IVA
aplicable y…»), que la recorta `withoutVatMentions()` en `clauses.ts`. Un IVA del
0 % impreso se lee como si algo hubiera fallado al calcularlo. Está duplicada en
`functions/src/contracts/pdf.ts`, como el resto de la aritmética del IVA.

⚠️ **El recorte de las cláusulas puede fallar EN SILENCIO**, porque es una
sustitución literal dentro de una frase legal larga: el día que alguien reescriba
la cláusula de precio, el fragmento deja de encontrarse y el contrato vuelve a
nombrar el impuesto sin que nada avise. Lo cubre `clauses-vat.spec.ts`, que lee
el articulado ya recortado en los tres idiomas y **comprueba también el control**
—que el articulado normal sí lo menciona—, o el test pasaría por no encontrar
nada que quitar. Y `layout.spec.ts` lo comprueba sobre los PDF reales: los tres
documentos × tres idiomas, con IVA y sin él.

⚠️ **Ausencia no es exención.** Una reserva antigua sin `vatRate` guardado lleva
IVA al tipo general; leerla como exenta dejaría de repercutirlo en contratos ya
firmados. Hay test de las dos cosas en los dos lados.

⚠️ **La factura NO hereda el 0.** Si un cliente de estos acaba pidiendo factura,
va en régimen general y el 0 % no se sostiene — y una factura emitida no se edita
ni se borra. El formulario propone el tipo general y **lo explica**: el total no
va a coincidir con lo que se cobró, y qué hacer con esa diferencia lo decide el
operador.

⚠️ **Cambiarlo obliga a rehacer el contrato** (`requiresNewContract`) y **no se
puede tocar con parte del alquiler ya cobrada**: mover el total cuando las filas
de cobro ya llevan dinero dentro dejaría la reserva pidiendo una cifra distinta
de la que entró.

⚠️ **Y salió a la luz un tipo que se calculaba con un número y se guardaba con
otro.** `resolveRentalPrice()` se llamaba **sin su cuarto argumento** en los dos
creadores de reservas y en el asistente, así que el precio se componía con el
21 % fijo de `DEFAULT_VAT_RATE` mientras el snapshot congelaba el tipo de
Ajustes. Con el general los dos coincidían de casualidad y no se notaba; bajando
el tipo en Ajustes, el contrato habría desglosado un IVA y cobrado otro. Ahora el
tipo viaja explícito, que es lo que además hace posible el 0.

> Hubo un `tariffIncludesVat` que congelaba también la **dirección**, porque las reservas
> anteriores al 27 de agosto de 2026 se guardaron con el IVA incluido. Se retiró el 28 de
> agosto, al borrar los datos de producción y empezar de cero: ya no existe ninguna reserva
> inclusiva. Si algún día vuelve a haberlas, el parche está en el historial de git.

La constante y la aritmética están **duplicadas en `functions/src/contracts/pdf.ts`** a
propósito: app y functions compilan con tsconfigs separados y no pueden compartir módulo.
Si cambia el tipo, se cambia en los dos sitios.

⚠️ **Y el TEXTO que describe la aritmética también cuenta.** El presupuesto decía «los
precios incluyen IVA» tres líneas debajo de un desglose que sumaba el 21 % a la base
(F-36, 7 de septiembre de 2026): otro resto de `tariffIncludesVat`, porque al corregir el
cálculo nadie tocó la frase que lo explicaba. No falla ningún test —los de maquetación
comprueban que el texto quepa, nunca que sea cierto— y solo se ve leyendo el PDF como lo
lee el cliente. Al cambiar una convención de dinero, **busca las frases, no solo las
fórmulas**.

⚠️ **Redondea el dinero derivado.** `108.9 - 50` es `58.900000000000006`: el asistente lo
enseñaba tal cual y lo sembraba así en la fila de pago. Todo importe calculado pasa por
`roundMoney()` antes de mostrarse o escribirse.

### Coches de colaborador: Velto alquila y factura, y reparte después

⚠️ **Un coche cedido no cambia quién alquila ni quién factura.** El cliente
recibe una factura de VELTO MOBILITY por el importe total, sea el coche propio o
de un tercero; el propietario no aparece en ninguna parte de cara al cliente. Lo
que hay detrás es otra relación: Velto le debe su parte por la cesión.

`owner-share.util.ts` es la única autoridad sobre la base del reparto: **el
alquiler sin IVA, y solo el alquiler**. Tres exclusiones, las tres con motivo:

- **El IVA no es de la empresa**, es de Hacienda. Repartirlo sería pagarle al
  propietario un porcentaje de un impuesto — hay test de que 100 y 121 no dan lo
  mismo, el mismo que protege las comisiones de captación.
- **La fianza es del cliente**, en custodia.
- **Los cargos extra son de Velto** (decisión de Dorel, 12 de septiembre de
  2026): cubren un coste o un perjuicio que pone la agencia.

⚠️ **El porcentaje vive en el coche**, con el del colaborador como propuesta —un
propietario puede ceder un utilitario y una furgoneta con repartos distintos— y
la reserva lo **congela** en `ownerShareSnapshot`, igual que el precio. Lo
congela `commitReservationWithPayments()`, que recibe el vehículo entero para que
**ninguno de los dos creadores de reservas pueda olvidarse**. La parte se
**devenga al cerrar** la reserva, cuando los importes ya son definitivos.

⚠️ **Y lo devengado se DERIVA de las reservas cerradas, no se guarda**
(`ownerShareAccruals()`, 12 de septiembre de 2026). Hay dos motivos y los dos
importan: una colección de devengos sería una segunda fuente de verdad para el
mismo euro —la reserva ya lleva su reparto y su precio congelados—, y sobre todo
**cerrar una reserva no pide ningún permiso** mientras `collaboratorSales` es de
administrador. Escribiendo el apunte al cerrar, el empleado que termina la
devolución en la calle vería fallar el cierre por permisos, o —peor— se tragaría
el error y el propietario no cobraría sin que nadie se enterase.

⚠️ **`unsettledAccruals()` quita lo ya liquidado, y sin eso se cuenta dos
veces.** Al liquidar, el reparto pasa a ser un `CollaboratorSale` con su importe
congelado; si la derivación siguiera contando esa reserva, el propietario
aparecería con el doble de lo que se le debe. El apunte se escribe **al
liquidar**, que siempre lo hace un administrador.

⚠️ **`saleForReservation()` exige el `kind`, y no es una firma incómoda por
gusto.** Una misma reserva puede tener los dos apuntes. Preguntando «¿esta
reserva ya está asignada?» a secas, el reparto de un coche cedido haría que la
comisión de captación de esa misma reserva se rechazara con «ya está asignada» —
justo lo que se separó al crear `kind`. La pantalla de asignar filtra igual.

⚠️ **El nombre del propietario se copia al COCHE (`ownerCollaboratorName`), y no
es comodidad.** El snapshot lo lleva dentro para sobrevivir a un borrado de la
ficha, pero `firestore.rules` solo deja leer `collaborators` a un administrador:
yendo a buscarlo allí, un **empleado** que crea la reserva de un coche cedido
recibiría un error de permisos a media operación, o —peor— se guardaría el
reparto sin nombre y nadie sabría a quién hay que pagarle. Lo escribe el
administrador al asignar el coche, y la reserva lo lee de un documento que sí
puede leer.

⚠️ **`ownerShareSnapshot` está protegido en las reglas igual que
`pricingSnapshot`**: un no-administrador no puede moverlo en un `update`. Decide
dinero exactamente igual que el precio, y se había quedado fuera.

⚠️ **Pero se puede LEER**, como toda la reserva: un empleado ve por la API REST
de quién es el coche y qué porcentaje se lleva. Es el caso de `payments` —no se
puede cerrar sin romper la operación diaria— y no el de `invoices`, que sí era un
descuido. Está dicho aquí para que nadie lo dé por lo que no es.

⚠️ **`CollaboratorSale.kind` separa dos cosas que se pagan a la misma persona.**
Un colaborador puede traer el cliente **y** poner el coche de la **misma**
reserva: son **dos apuntes**, no uno mayor. Se pactan, se calculan y se
justifican distinto, y uno lleva detrás una factura suya por la cesión y el otro
no. `balanceByKind()` los da separados; el total hay que pedirlo.

⚠️ **`kind` es OBLIGATORIO desde el 12 de septiembre de 2026**, al vaciarse la
base de desarrollo. Nació opcional porque había cuatro comisiones antiguas sin
él y la ausencia se leía como `referral` en `kindOf()`; sin esos apuntes, el
campo se exige y **el compilador obliga a contestarlo**. `kindOf()` ya no
existe. Un valor por defecto aquí sería peor que un hueco: apuntaría como
comisión de captación el reparto de un coche cedido.

⚠️ **Y un `commissionPercent` de 0 es válido: significa «no trae clientes».**
Desde que un colaborador puede ser solo el dueño de un coche, exigir una comisión
de captación mayor que cero obligaba a inventarse un número para alguien que no
trae a nadie — y un número inventado que vive en la ficha acaba aplicándose el
día que se le asigne una venta. Lo que sigue sin valer es el **hueco**:
`Number(null)` y `Number('')` son **0**, no `NaN`, así que la ausencia se
comprueba antes de convertir. Es el mismo fallo que salió con
`ownerSharePercent`.

### Liquidar, pagar y la factura: TRES cosas, no una

⚠️ **Confundirlas es el error que Dorel avisó expresamente**, y la aplicación ya
lo cometía: decía «liquidar» donde hacía «pagar».

- **Liquidar** es *reconocer* lo que se le debe. En el reparto del propietario es
  el momento en que el devengo derivado se convierte en un `CollaboratorSale` con
  su importe **congelado** — ahí la cifra deja de salir de la reserva.
- **Pagar** es entregarle el dinero: `status: 'paid'`, con su fecha, su forma y
  su nota.
- **La factura** es el justificante que manda él, y llega cuando llega.

⚠️ **Se puede pagar sin factura, y tener factura no es estar pagado.** Atar el
pago al papel dejaría a alguien sin cobrar por un trámite suyo.

⚠️ **La fecha del pago se elige, y no es la de cuando se apunta.** A un
colaborador se le paga en efectivo el martes y se anota el jueves; sellando
siempre el momento de la escritura, el histórico —que agrupa por día— contaba el
pago en un día en el que no salió nada. Una fecha **futura** se rechaza
(`paidAtProblem()`): marcar como pagado algo que no ha salido hace que el balance
diga que no se le debe nada a alguien a quien sí.

⚠️ **«Pendiente de recibir factura» NO es «no hay que facturar».** Es la frase
literal de Dorel. Un «sin factura» a secas se lee como una exención, y entonces
nadie la reclama nunca. Solo la esperan los apuntes de `vehicle_owner`: una
comisión de captación no lleva factura detrás en este negocio.

### La fecha de operación se PROPONE, y se explica

⚠️ **No es la de expedición ni, por defecto, la de devolución.** Son tres cosas:
cuándo se expide la factura, cuándo se devengó el impuesto y entre qué fechas
duró el alquiler. El formulario ponía siempre la de devolución —lo que haría lo
fácil— hasta el 12 de septiembre de 2026.

`suggestOperationDate()` en `invoice.util.ts` propone según la **exigibilidad**:
si el precio se cobró entero **antes de entregar** el coche, el IVA se devengó
ese día (art. 75.Dos LIVA) y no al terminar; en otro caso, la fecha de
finalización. Un **anticipo parcial** no mueve la fecha pero **avisa**: esa parte
ya devengó al cobrarse y no se devenga otra vez.

⚠️ **Propone, no decide, y por eso viaja con una explicación.** No hay ningún
campo que diga qué se pactó con el cliente, así que la propuesta sale de lo único
que consta: cuándo se cobró. Una fecha fiscal puesta sola es una cifra creíble
que nadie revisa, y la factura no se puede corregir después.

⚠️ **Los cobros se derivan de `payments`, nunca de `reservation.paymentSummary`**
—la copia que se queda vieja y responde `0` en vez de fallar—, y **sin fianzas**:
una fianza no es precio, es custodia, y no devenga nada.

### `collaboratorInvoices`: la factura que manda el propietario

⚠️ **No confundir con `invoices`, que son las de VELTO.** Aquellas las emite la
empresa, son inmutables, consumen número de serie y van a la AEAT. Esta llega de
fuera y solo registra un papel: se corrige y se borra, y `firestore.rules` lo
permite a propósito.

⚠️ **Es una colección propia y no unos campos dentro del apunte** (decisión de
Dorel, 12 de septiembre de 2026). Una sola factura suele cubrir **varias**
reservas, así que metida en cada apunte habría que teclearla tantas veces como
repartos cubra, con el mismo número repetido y sin que su importe total constara
en ninguna parte. Es la excepción razonada a «no hay colección de liquidaciones»:
aquello era **derivable** de los pagos, y un número de factura no se deriva de
nada.

⚠️ **El importe NO tiene que cuadrar con lo que cubre.** Una factura con IRPF
retenido trae menos que la suma de los repartos y es correcta. La diferencia se
**enseña** (`invoiceMismatch()`), no se rechaza — y ese cálculo normaliza el cero
negativo, porque `Intl.NumberFormat` escribe `-0` como «-0,00 €» y un aviso de
descuadre de menos cero es peor que no avisar.

⚠️ **Registrarla no la convierte en un gasto todavía**, igual que las comisiones
(decisión del mismo día). No escribe en `expenses`. Con factura delante el
reparto sí sería deducible, y los cuatro datos que hacen falta ya están
guardados.

⚠️ **Su carpeta de Storage hay que declararla en `storage.rules`.** El `match`
final lo deniega todo, así que sin la regla el fichero no sube y la pantalla no
dice por qué — el mismo descuido que tuvo la factura de un gasto.

### Colaboradores: comisiones que NO son contabilidad

Comerciales que traen clientes y cobran un porcentaje. ⚠️ **No son usuarios y no
entran nunca**: son fichas, como los clientes. Quien accede vive en
`authorizedUsers`.

⚠️ **La base de la comisión es el NETO, sin IVA**, y no es un detalle: el IVA no
es dinero de la empresa, es dinero de Hacienda que la empresa cobra y entrega.
Comisionando sobre el total se le paga al colaborador un porcentaje de un
impuesto — 5,25 € de más por cada cien euros con un 21 % y un 25 % de comisión.
Hay test de que 100 y 121 no dan lo mismo.

⚠️ **El neto y el porcentaje se congelan en cada venta**, como el precio en la
reserva: subirle la comisión mañana no puede mover lo que se pactó hace tres
meses. La fila lo enseña («200,00 € × 25%») para poder explicar la cifra después.

Tres reglas más, todas porque esto es dinero que se debe a una persona: una
reserva **no se asigna dos veces**; si la reserva se cancela la comisión se anula
**salvo que ya esté pagada** —el dinero salió, y marcarla anulada haría cuadrar
el balance mintiendo—; y lo anulado **sigue a la vista**, o el colaborador
preguntará por una venta que aquí no sale.

⚠️ **Es un registro interno**: no genera factura, no entra en VeriFactu y no
escribe en `expenses`. Decisión de Dorel del 10 de septiembre de 2026. Queda
anotado en el modelo que una comisión suele ser gasto deducible y que si el
colaborador es autónomo lo normal es que emita factura con retención de IRPF —
está preparado para convertir un pago en gasto sin rehacer nada.

### El calendario, y la conversión de fechas que lo vaciaba

⚠️ **El calendario no enseñaba ninguna reserva en producción, y la causa era una
conversión de fechas escrita a mano.** `calendar.component.ts` filtraba con su
propia copia de `toDate()`:

```ts
const pickup = (r.pickupDateTime as any)?.toDate
  ? (r.pickupDateTime as any).toDate()
  : new Date(r.pickupDateTime);
```

Esa copia solo entiende un `Timestamp` del SDK, con su método `.toDate()`, y
**esta aplicación no guarda eso**: `toTimestamp()` escribe un mapa
`{ seconds, nanoseconds }` normal, que es lo que Firestore devuelve. Así que
caía en `new Date({seconds})` → **Invalid Date**, toda comparación salía falsa y
la reserva se descartaba. `toDate()`, el util de verdad, sí cubre las cuatro
formas (`Date`, `Timestamp`, `seconds`, `_seconds`).

⚠️ **Y lo que lo hacía difícil de ver es que las canceladas SÍ salían**: el
filtro las dejaba pasar con un `return true` antes de tocar las fechas. O sea
que el calendario no estaba vacío —enseñaba justo las reservas que no
importan—, y eso se lee como «faltan datos», no como «hay un fallo». Medido en
desarrollo: **2 barras antes, 19 después**.

⚠️ **El segundo fallo, en la misma función: la ventana se calculaba desde HOY.**
Traía tres meses alrededor de `new Date()`, no del mes que se está mirando, así
que al avanzar dos meses la rejilla salía vacía aunque hubiera reservas. Se ha
quitado entera: quien decide qué se pinta en cada día es `MonthGridComponent`,
que ya filtra celda a celda, así que la ventana no ahorraba nada.

⚠️ **Al quitarla, `cells` tuvo que dejar de ser un getter.** Era un `get cells()`
—42 celdas × todas las reservas, recalculado en cada ciclo de detección de
cambios— y se sostenía porque el padre recortaba la lista. Ahora es un
`computed()` con entradas de señal: una vez por cambio real de mes o de datos.

**El detalle del día es una modal y lo primero que se lee es el COCHE.** La
pregunta del mostrador es «¿qué tengo fuera hoy?», y antes había que abrir cada
reserva para saber la matrícula. Cada fila dice además qué pasa **ese día**
—entrega, devolución o sigue alquilado— con su hora, y lleva a la reserva.

**En móvil se cambia de mes deslizando.** Solo cuenta el gesto claramente
horizontal (60 px y más que el vertical): sin comparar contra el desplazamiento
vertical, bajar por el calendario cambiaba de mes a media lectura, y sin el
umbral pulsar un día saltaría de mes. Con el detalle abierto el gesto no cuenta.
⚠️ **Y se anuncia**: un gesto que no se dice no existe, así que hay una pista
bajo la rejilla, solo en pantalla estrecha.

⚠️ **`text-transform: capitalize` no sirve para un título en español.**
Capitaliza **todas** las palabras: «Sábado, 12 De Septiembre De 2026». Ya se
había corregido en el rótulo del mes poniendo en mayúscula solo la primera letra,
y reapareció en la cabecera de la modal porque allí lo hacía el CSS y no el
texto.

### Entrega y recogida a domicilio: un servicio, no un cargo extra

Velto entrega gratis cerca de Arganda; más lejos se pacta un suplemento.
Decisión de Dorel del 19 de septiembre de 2026, con dos partes:

- **El importe se teclea a mano**, no hay tarifa por kilómetro en Ajustes. Cada
  reserva lleva la cifra que se dijo por teléfono.
- **Son dos cobros, no uno.** Los dos trayectos se pactan por separado —hay
  quien recoge en oficina y solo pide que se le vaya a buscar— y se cobran en
  momentos distintos.

⚠️ **`deliveryFees` vive FUERA de `pricingSnapshot`, y ese es el punto que
decide dinero de otra persona.** El reparto con el dueño del coche se calcula
sobre `pricingSnapshot.netPrice` (`owner-share.util.ts`), y llevar el coche a
30 km lo pone la agencia con su furgoneta y su hora — no lo pone el coche. Metido
en el snapshot, el propietario cobraría un porcentaje del desplazamiento sin que
nadie lo hubiera decidido. Es la misma razón por la que los cargos extra son de
Velto.

⚠️ **Y tampoco son `extra_*`.** Un cargo extra nace de la inspección de
devolución y cubre un perjuicio; esto se pacta al reservar y va impreso en el
contrato. Mezclarlos tenía dos consecuencias visibles: la ficha diría «Cargos
extra 36,30 €» de un alquiler sin un solo daño, y
`distributeRetentionAcrossCharges()` dejaría cubrir el desplazamiento con la
**fianza retenida**, que es dinero del cliente guardado para responder de daños.
Por eso hay una tercera categoría, `SERVICE_TYPES`, con sus tres campos propios
en el resumen (`servicesRequired`, `servicesPaid`, `servicesPending`).

⚠️ **Lo tecleado es NETO y el IVA se suma**, como la tarifa: 15 € pactados son
15 € de base y el cliente paga 18,15 €. Con la casilla «sin IVA» paga
exactamente 15. Lo resuelve `deliveryFeeBreakdown()` en `pricing.util.ts`,
duplicada en `functions/src/contracts/pdf.ts` como el resto de la aritmética del
impuesto. **Cada trayecto se redondea por su cuenta** antes de sumarlos, porque
cada uno abre su propia fila de cobro.

⚠️ **`collectedTotalsOf()` va por lista blanca, al revés que `analytics.util.ts`.**
Aquel usa una lista de lo que **no** es ingreso, así que un tipo nuevo cuenta
solo; este enumera lo que **sí**, y un tipo que no se añada deja de contar como
ingreso **en silencio**. Al crear un `PaymentType` de cobro, hay que pasar por
las dos.

⚠️ **Y el recálculo de pagos reescribía el estado de la señal sin saber decir
`waived`.** `recalculateReservationPaymentSummary()` traía un ternario suelto
—con las dos ramas del final iguales— que solo producía `paid` o `pending`: cada
recálculo volvía a etiquetar como PENDIENTE una señal que el operador había
decidido no cobrar. Era el mismo fallo que la fianza ya tenía resuelto tres
líneas más abajo con `depositStatusFromSummary()`. Ahora lo decide
`initialPaymentStatus()`, la misma función que usan la creación y la edición.
**Se vio guardando la reserva**: la ficha pasaba sola de «No se solicita» a
«Pendiente».

**Los tres documentos lo imprimen** —presupuesto, justificante y contrato— en su
propia línea, debajo del total del alquiler y solo si se pactó. No se suman al
«Total alquiler», que es lo que vale el coche y la base del reparto con su dueño.
⚠️ Un cargo que el contrato firmado no menciona es un cargo que el cliente
discute con razón: lo comprueba `layout.spec.ts` sobre los PDF reales, en los
tres idiomas y los tres documentos, **y también que no aparezca** cuando no se
pactó.

### Eventos próximos: se derivan, no se guardan

⚠️ **Una entrega ya está en su reserva y una ITV en su mantenimiento.** Copiarlas
a una colección de «eventos» sería una segunda fuente de verdad que se queda
vieja en cuanto alguien mueve una fecha de recogida. Se derivan al pintar; por
eso hay un botón de recargar y no hay nada que sincronizar.

Lo único que se guarda son los **recordatorios manuales** (`reminders`), porque
no se deducen de ningún dato: «comprar ambientadores» no está en ninguna parte.

⚠️ **Lo ya vencido entra siempre, se mire el plazo que se mire.** Una ITV que
caducó hace tres días no deja de importar por haber elegido «hoy». Un filtro
«entre hoy y dentro de N» la escondería justo cuando más falta hace verla.

⚠️ **Y no se duplica lo que ya se ve donde se trabaja.** El contrato sin firmar
va *dentro* de la entrega, no como fila aparte: la misma reserva en dos filas
hace que se lean las dos por encima, y una lista de avisos que se lee por encima
es peor que no tenerla.

La pantalla la ve **todo el equipo**, sin permiso: «limpiar coches» es trabajo de
la agencia. Las comisiones no — esas van con `viewCollaborators`.

### `permissions.util.ts` es la única autoridad sobre quién puede qué

Rol → permisos, en una tabla. El menú y los guards de ruta preguntan ahí; un
`if (role === 'admin')` suelto en una plantilla es una segunda fuente de verdad,
y la primera vez que discrepen nadie sabrá cuál manda. Misma idea que el workflow.

⚠️ **Es la interfaz, no la seguridad.** Un permiso denegado oculta un botón o
corta una navegación; lo que impide de verdad leer o escribir es
`firestore.rules`. Los dos ficheros se editan por separado y nada los ata: al
añadir un permiso hay que tocar **los dos**.

Los permisos se aplican en **tres capas, y las tres hacen falta**: la pantalla
(esconde o bloquea), el servicio (rechaza la llamada venga por donde venga) y
`firestore.rules` (lo único que impide de verdad). `PermissionsService` es el
atajo para las plantillas; la tabla sigue estando en un solo sitio.

⚠️ **Un permiso denegado se explica.** «Tu rol no permite cambiar el precio», al
lado del campo. Un botón que desaparece sin más hace que el compañero llame
preguntando qué le pasa a la aplicación — misma idea que el «Falta contrato
firmado» del workflow. **También vale para las rutas**: `permissionGuard` levanta
un aviso antes de devolver al panel, porque una redirección muda es la versión
de pantalla completa del mismo problema.

⚠️ **Para cambiar de cuenta basta el botón de entrar.** El
`GoogleAuthProvider` pide `prompt: 'select_account'`: sin eso el popup entraba
con la última sesión de Google **sin preguntar**, y cerrar sesión en la
aplicación no servía de nada porque quien recuerda la cuenta es Google. Era lo
que obligaba a una ventana de incógnito para probar las reglas como empleado, y
por lo que esa prueba se posponía.

**Los permisos están probados con un empleado real** (7 de septiembre de 2026,
repetido y ampliado el 14 de septiembre: 19 comprobaciones, cero fallos),
bajando el rol de la propia cuenta en el `authorizedUsers` de desarrollo. La
prueba que vale es la de las reglas, atacadas **saltándose la aplicación**: con
el token de la sesión sacado de IndexedDB y llamadas directas a la API REST de
Firestore. Un empleado recibe **403** al leer gastos, leer la lista de usuarios,
**ascenderse a administrador**, borrar un vehículo, borrar una reserva y **mover
el `pricingSnapshot`**; y **200** al leer reservas y escribir una nota, que es
lo que necesita para trabajar. Repetir esa prueba es la forma de validar un
cambio en `firestore.rules`.

**Y hay dos guiones para repetirla**, que se pegan en la consola del navegador
con la sesión abierta. No son código de la aplicación y no se compilan; viven en
`docs/` para que no lo parezcan.

- [comprobar-reglas-facturas.js](docs/comprobar-reglas-facturas.js) — que una
  factura emitida devuelve **403** al modificarla y al borrarla, y que la cadena
  de huellas está bien formada.
- [comprobar-reglas-financieras.js](docs/comprobar-reglas-financieras.js) — que
  las ocho colecciones del dinero (`expenses`, `invoices`, `invoiceCounters`,
  `billingProfiles`, `verifactuDeclarations`, `verifactuSubmissions`,
  `collaborators`, `collaboratorSales`) dan **403** a quien no es administrador,
  y que un empleado no puede ascenderse. **Lee el rol de `authorizedUsers` y
  ajusta lo que espera**, así que la misma pasada sirve con las dos cuentas.

### El dinero de la empresa: qué está cerrado y qué no

Un empleado no ve la cuenta de resultados. Cinco permisos lo gobiernan
—`viewReports`, `viewExpenses`, `viewInvoices`, `viewCollaborators` y
`viewPaymentHistory`— y `permissions.util.spec.ts` los comprueba **en bloque y
por lista completa**: el test afirma que el empleado tiene *exactamente* dos
permisos, así que cualquier cosa que se le conceda obliga a venir a decirlo
a propósito. Enumerando solo lo denegado, un permiso nuevo concedido sin querer
no lo coge nadie — porque nadie escribe el test de un permiso que no sabe que
existe.

⚠️ **`payments` está abierto a cualquier autorizado, y es deliberado.** No es el
descuido que fue `invoices`: la ficha de la reserva y la del cliente enseñan el
resumen de sus cobros, y para eso hay que leer los pagos **cobrados**. Una regla
no distingue si quien lee llegó desde una reserva o desde una consulta a la
colección entera, así que cerrarla rompería la operación diaria.

La consecuencia hay que decirla: **un empleado puede listar todos los cobros por
la API REST y sumarlos.** Lo que la aplicación hace es no ofrecerle el histórico
—`viewPaymentHistory`, en `payment-scope.util.ts`: sin él la lista de Pagos
enseña solo lo **abierto** (`pending`, `partial`, `failed`), y la pestaña
«Cobrado» ni se ofrece, porque saldría siempre vacía—. Eso es interfaz, no
seguridad, y está dicho así en los tres sitios para que nadie lo dé por lo que
no es.

Lo que sí impide reconstruir la cuenta de resultados es que los **gastos** y las
**comisiones** sean de administrador en las reglas: sin ellos no hay beneficio,
solo ingresos.

⚠️ **El recorte se aplica al cargar, no al filtrar.** Puesto en `applyFilters()`,
cambiar de pestaña volvería a enseñarlo todo.

⚠️ **Ese guion encontró un agujero el 8 de septiembre de 2026, y es el patrón a
vigilar**: `viewInvoices` es permiso de administrador, pero las reglas dejaban
leer `invoices` a cualquier usuario autorizado. Un empleado no veía el menú de
Facturas y tenía por debajo el NIF, el domicilio fiscal y el importe de todos
los clientes facturados. **Ningún test lo habría cogido**, porque la aplicación
respetaba el permiso; solo se ve atacando las reglas por fuera. Al añadir un
módulo con permiso propio, comprueba que la regla es **igual de estricta** que
la tabla, no solo que existe.

⚠️ **Lo que las reglas no pueden cubrir:** el precio con el que una reserva
**nace**. Al crear no hay valor anterior con el que comparar, así que ahí manda
la comprobación del servicio. Una reserva **ya creada** sí está protegida:
`update` no puede mover `pricingSnapshot` salvo siendo administrador.

⚠️ **`allow write` incluye borrar.** Todas las colecciones lo tenían, así que un
empleado podía vaciar la flota desde cualquier cliente de Firestore con la
pantalla perfectamente bloqueada. Ahora `create, update` y `delete` van
separados.

⚠️ **Nadie puede desactivarse ni degradarse a sí mismo** en Ajustes. Si el único
administrador se quita el acceso, no hay forma de volver desde la aplicación:
habría que entrar a Firestore por la consola.

### `settings/operation`: valores por defecto, nunca retroactivos

Un único documento con la fianza propuesta, el IVA general, la validez del
presupuesto, la caducidad del enlace de firma y los km incluidos.

⚠️ **Rige para lo que se cree a partir de ahora y nada más.** El IVA se congela
en `pricingSnapshot.vatRate`, el precio en su snapshot y la caducidad en el
propio token de firma. Si alguna vez un cambio en Ajustes recalcula algo
existente, se habrá roto lo que hace que un contrato firmado siga cuadrando
dentro de dos años.

⚠️ **Sin documento mandan las constantes del código.** No es un parche de
compatibilidad: es el estado inicial, y por eso los valores por defecto de
`settings.model.ts` son exactamente los que `APP_DEFAULTS` traía escritos.

Las Cloud Functions leen **el mismo documento** con el admin SDK
(`functions/src/settings.ts`) para la validez del presupuesto y la caducidad del
enlace: esas dos se deciden en el backend. Si se añade un ajuste que gobierne un
PDF, hay que tocar los dos lados.

### El IVA va en dos direcciones, y no es una incoherencia

⚠️ **En un alquiler el IVA se SUMA al neto. En un gasto se EXTRAE del total.**

- Un **alquiler** se negocia por el neto —30 €/día— y el impuesto va encima:
  `addVat()` en `pricing.util.ts`.
- Un **gasto** llega como una factura de 60,50 € y hay que sacarle la base:
  `extractVatFromGross()` en `expense.util.ts`.

Viven en ficheros distintos y con nombres explícitos justo para que nadie las
confunda. Confundirlas **no da un error**: da una cifra creíble y equivocada, que
es la peor clase de fallo con dinero. Si algún día alguien unifica los dos
módulos, esta es la razón por la que no debe.

### `analytics.util.ts` es la única autoridad sobre qué cuenta como ingreso

Y es lo más importante del módulo de Informes, por encima de cualquier gráfico:
una cifra de ingresos mal definida no da un error, da un número creíble y
equivocado, y a partir de ahí todo lo demás miente igual.

⚠️ **Una fianza NO es un ingreso, y su devolución tampoco.** Es dinero del
cliente que la empresa custodia y devuelve. El informe anterior sumaba **todo**
pago cobrado sin mirar su tipo, así que una fianza de 300 € cobrada y devuelta
contaba **600 €** de «facturación» — 300 al cobrarla y otros 300 al devolverla,
porque la devolución también es un pago con importe. La **retención** sí es
ingreso: esa no vuelve.

⚠️ **Las bases no son la misma en todo, y por eso el número lleva al lado qué
mide.** Los ingresos y los gastos se cuentan **cuando el dinero se mueve**; las
comisiones de colaborador, **cuando se devengan** aunque no estén pagadas
(decisión de Dorel, por prudencia: nunca creerse más rico de lo que uno es).
Mezclar dos criterios es legítimo mientras se diga.

⚠️ **El reparto a los propietarios es una salida más, y se cuenta ESTÉ O NO
reconocido** (`collaboratorOutgoings()`, 12 de septiembre de 2026). Desde que el
devengo se deriva, un reparto vive en su reserva cerrada hasta que un
administrador lo apunta, y eso puede tardar semanas: mirando solo
`collaboratorSales`, todo ese dinero no se restaría y Velto aparecería ganando
una parte del alquiler que no es suya. La función suma las dos fuentes y
descuenta por `reservationId` lo ya reconocido, para no contarlo dos veces. Hay
test de las tres cosas.

⚠️ **Y va en su propia línea, no fundido con las comisiones.** Son dos conceptos
que se pactan y se justifican distinto; juntos no se puede responder a «¿cuánto
me cuestan los coches que no son míos?».

⚠️ **El beneficio se calcula sobre la base SIN IVA.** Restar gastos de un importe
con IVA sin quitárselo a los ingresos infla el resultado un 21 %. Y esa base es
**estimada** —un cobro libre no tiene reserva y los cargos extra no llevan
desglose—, así que la pantalla lo dice: para lo fiscal están las facturas.

Lo pendiente de cobrar y lo pendiente de pagar van **fuera** del beneficio, en su
propia franja: es dinero que se espera, no que se tiene.

### Los gráficos son propios, y tienen reglas

Tres componentes en `shared/components/charts/` (línea, donut, barras), sin
dependencia nueva. Lo que hay que respetar al tocarlos o añadir uno:

- **Un solo eje, siempre.** Dos escalas en un mismo dibujo permiten hacer que dos
  líneas parezcan lo que uno quiera moviendo un cero.
- **Leyenda con dos o más series y tabla con los mismos números.** Un valor que
  solo se lee pasando el ratón no existe para quien imprime o va con el teclado.
- **La paleta se valida con el guion del skill `dataviz`, no a ojo.** El candidato
  `#33B39E` falló la banda de luminosidad; `#20A48F` pasa. El conjunto actual pasa
  contra el fondo oscuro (`#14181A`) y el claro.
- **El color sigue a la entidad, nunca a su posición en un ranking.**

⚠️ **El `viewBox` del gráfico de líneas sigue al ancho real, y no es cosmético.**
Con 720 unidades metidas en los 358 px de un móvil todo se reduce a la mitad —
**el texto también**: las etiquetas salían a 5 px. Igualando unidades a píxeles,
un `font-size="10"` mide 10 px en los dos sitios, y en pantalla estrecha se
enseñan **menos meses** en vez de los mismos más pequeños.

⚠️ **El elemento del componente es el que entra en la rejilla, no la figura de
dentro.** `<app-donut-chart>` es `display: inline` por defecto: la celda se
estiraba y la tarjeta no. Lo arregla `:host { display: block; height: 100% }` en
`charts.scss`.

⚠️ **Y `.chart` vive en `charts.scss`, encapsulado en los componentes de
gráfico.** Una plantilla de pantalla que se ponga `class="chart"` no lo alcanza —
la misma trampa que `.form-control`. Si una tarjeta de fuera necesita esa chapa,
la declara su propio SCSS.

### Otros utils

- `payment-summary.util.ts` — resumen financiero, derivado de la colección `payments` (source of truth)
- `expense.util.ts` — el IVA de los gastos, la mezcla con el mantenimiento y los totales
- `analytics.util.ts` — los números de Informes (arriba)
- `reservation-date.util.ts`, `acriss-code.util.ts`

### Reglas de dominio

- ⚠️ **La aseguradora, la póliza y el teléfono de asistencia son del COCHE.** Están en
  `Vehicle`, se rellenan en la ficha de cada vehículo y **no se congelan en el snapshot**:
  el contrato los lee al generarse, porque lo que hay que imprimir es la póliza vigente el
  día de la firma, no la que hubiera al crear la reserva. Nacieron como datos de empresa en
  `company-config.ts` y duraron un día: con un valor único, el segundo coche de la flota
  habría salido con la póliza del primero.
- ⚠️ **El contrato no puede remitir a un dato que no imprime.** Pasó tres veces: la póliza
  y el teléfono de asistencia («constan en Datos del vehículo» — no constaban), el nivel de
  combustible de entrega («sección Estado del vehículo», que solo existe si hay inspección
  y el contrato se firma **antes**) y la dotación, enumerada sin acreditar. Si vas a cobrar
  apoyándote en una sección, esa sección tiene que estar el día de la firma.
  **Y una cuarta**: las cláusulas remitían al «parte de entrega, que ambas partes firman»,
  un documento que no se generaba, no se entregaba y no firmaba nadie. Se resolvió el 8 de
  septiembre de 2026 por los dos lados a la vez —quitando la exigencia de firma del texto
  **y** construyendo el parte—, porque arreglar solo el texto habría dejado una remisión a
  un documento inexistente, y arreglar solo el documento, una firma que nadie iba a hacer.
  ⚠️ Al reescribir esas cláusulas, la primera redacción remitía a la sección «Conductores
  adicionales» y el PDF la titula «Conductores **autorizados** adicionales» —y solo la
  imprime si hay alguno—. **Comprueba el rótulo literal antes de citarlo**, o mejor, remite
  al contrato entero, que es cierto siempre.
- **El kilometraje se pacta o no se cobra.** `includedKmPerDay` y `extraKmPrice` se congelan
  en `pricingSnapshot` —como el precio— y se imprimen en «Precio y fianza» con su cláusula
  propia. El cargo de la devolución los lee **del snapshot, sin respaldo al vehículo**: una
  reserva sin ellos es una reserva en la que no se pactó kilometraje.
- ⚠️ **Las referencias entre cláusulas van por nombre, no por número.** `clause()` numera
  **por posición** y descarta el prefijo del título, así que insertar una cláusula renumera
  todo lo siguiente y una referencia a «la cláusula 6» se rompe en silencio.
- **Los conductores adicionales los exige el contrato, no la UI.** La cláusula 2 dice que
  solo conducen las personas «expresamente declaradas… identificadas nominalmente», así que
  `Reservation.additionalDrivers` guarda nombre, documento y carné de cada una. Se congelan
  en el contrato como snapshot, se imprimen bajo el arrendatario y **se le enseñan al
  cliente en la pantalla de firma**: su firma es el acuerdo sobre quién conduce.
  ⚠️ **Con el contrato firmado no se tocan** —el PDF sellado no se puede regenerar— y
  cambiarlos **no regenera el contrato solo**: la pantalla avisa, porque entregar un
  contrato que no nombra a quien conduce es justo lo que la cláusula prohíbe.
  ⚠️ Lo normal es elegirlos de la lista de clientes: el caso real son **cuadrillas** que
  comparten coche y ya están dadas de alta.
- Los **cargos extra solo nacen desde la inspección de devolución**. Un solo sistema, sin doble fuente. Todavía **no llevan desglose de IVA**: el contrato se genera antes de que existan.
- **Un gasto de mantenimiento se registra en `vehicleMaintenance`, no en `expenses`.** El
  módulo de Gastos **lee** su coste y lo suma; escribirlo en los dos sitios daría dos
  fuentes de verdad para el mismo euro. Es la misma regla que hace de `payments` la única
  fuente del dinero que entra.
  ⚠️ Su coste **no tiene desglose de IVA** —se teclea como un importe suelto, sin tipo— y
  por eso en Gastos el bruto no es la suma de bases más impuestos. La pantalla lo dice
  («IVA soportado · sobre 1/3»); igualar los tres números sería inventarse ese IVA.
- ⚠️ **Sin ROI no se puede facturar exento a otro Estado miembro.** VELTO no está
  todavía en el Registro de Operadores Intracomunitarios —no está ni pedido a 10
  de septiembre de 2026, y tarda meses—, y sin él la exención del art. 25 no se
  sostiene y no hay NIF-IVA con el que aplicar la inversión del sujeto pasivo.
  Es decir: `exempt_eu` y `reverse_charge` **existen en la aplicación, pasan la
  validación y la AEAT acepta su registro**, pero no se deben usar en una factura
  real todavía — a un cliente de otro Estado miembro se le factura con IVA
  español, en régimen general. **La aplicación no lo impide**: es una decisión
  pendiente, anotada en [docs/verifactu-alta.md](docs/verifactu-alta.md) § 5 ter,
  y atarla hoy a un interruptor sería inventarse cuándo llega el ROI.
- El **descuento de fidelidad** (`Client.loyaltyDiscountPercent`, máx. 30 %) se asigna a mano y es independiente de `trustLevel`, salvo que bloquear a un cliente se lo retira. Cada cambio se anota en `loyaltyDiscountHistory[]` con autor y fecha.
- Pagos: 3 acciones en UI — Registrar cobro / Devolver fianza / Retener fianza.
  ⚠️ **`delivery_fee` y `collection_fee` son la entrega y la recogida a domicilio**, y
  no son cargos extra: ver «Entrega y recogida a domicilio» más arriba.
  ⚠️ **`rental_payment` no es un concepto, es «cobrarlo todo de una vez».** No tiene fila
  sembrada propia: `distributeRentalPayment()` lo reparte entre señal y resto, en ese
  orden, y el sobrante abre fila aparte. Creando fila propia —como hacía— el dinero
  contaba como ingreso pero no para `remainingPaid`, así que **la reserva se cobraba
  entera y no se podía cerrar nunca** (D-5).
- La **fianza es editable y puede ser 0**: a los clientes conocidos no se les cobra. Una fianza a 0 nace `waived` con **motivo obligatorio** (`buildDeposit` en `deposit.util.ts` lanza si falta). No es cosmético: `isDepositSettled()` solo da por resuelta una fianza a 0 **si hay motivo**, así que sin él la reserva no se puede cerrar nunca.
- **La señal también puede ser 0, y entonces la reserva nace CONFIRMADA.**
  `buildInitialPayment()` en `payment-summary.util.ts` la crea `waived`, no
  `pending`. ⚠️ **«0,00 € pendiente» es una deuda que nadie puede cobrar**, y
  costaba dos cosas a la vez: a `confirmed` solo se llegaba **cobrando** la
  señal (`reservationStatusAfterPayment`, que corre al registrar un cobro), así
  que sin señal la reserva se quedaba `reserved` de por vida —y con ella, el
  justificante de reserva, que exige `confirmed`, no se podía emitir nunca—; y
  la ficha enseñaba «Señal 0,00 € · Pendiente» al lado de un cero que el
  operador acababa de decidir. Lo resuelve
  `reservationStatusAfterInitialChange()`, que contesta lo mismo al crear y al
  editar.
  ⚠️ **Aquí el motivo NO es obligatorio, al revés que en la fianza**, y la
  asimetría tiene razón: el de la fianza es lo único que deja cerrar la reserva
  (`isDepositSettled`), mientras que ningún guard depende de la señal — el
  precio entero sigue exigido en `remainingPayment` y `canStartPickup()` no
  entrega el coche sin cobrarlo. No se perdona dinero, se cobra más tarde.
  ⚠️ **Y lo cobrado manda sobre lo que se pida** (`initialPaymentStatus`):
  bajar a 0 una señal ya cobrada la deja `paid`, no `waived`. Decir que no se
  pidió nada cuando entraron 30 € dejaría la reserva contando una cosa y
  `payments` otra; si hay que devolverlo, eso es una devolución.
- La autorización de usuarios vive en la colección `authorizedUsers` de Firestore (doc ID = email en minúsculas, `active: true`), **no** en Firebase Console.

### Crear una reserva es una sola escritura

`commitReservationWithPayments()` mete la reserva **y sus filas de pago** en un
`writeBatch`: entra todo o no entra nada. Eran cuatro escrituras sueltas, y si fallaba
cualquiera menos la primera quedaba una reserva creada sin nada que cobrar mientras la
pantalla decía que no se había podido crear — y el operador la creaba otra vez.

El id se pide antes con `doc(collection)`, porque las filas de pago lo llevan dentro;
`addDoc` no vale, solo devuelve el id después de escribir.

⚠️ **Un concepto a 0 no genera fila** (`buildInitialPaymentRows` en el util). Una fianza
exenta no es una fianza pendiente de 0 €: es que no hay fianza, y sembrarla dejaría una
fila incobrable que impide dar la reserva por pagada.

⚠️ **Lo que el servicio rechaza viaja como clave i18n, no como frase.** Las
comprobaciones de disponibilidad lanzaban `'Vehicle no longer available…'` en inglés duro,
así que la capa de avisos no lo distinguía de un fallo cualquiera y ofrecía «Reintentar» —
que iba a fallar igual, porque hay que cambiar de coche o de fechas.

### Borrar un documento no borra sus ficheros

⚠️ **Firestore y Storage son dos servicios distintos.** Borrar el documento deja los
ficheros donde estaban, con su token de descarga vivo. En un cliente eso no es desorden:
lo que se queda en `clients/{id}/documents/` es **el DNI y el carné de una persona** cuya
ficha ya se pidió borrar.

Lo resuelve `StorageService.deleteFolder()`, conectado en vehículos, clientes y
mantenimiento; los gastos ya borraban su factura. **Storage no tiene borrado recursivo**:
lista y borra uno a uno, bajando también por los prefijos.

Dos reglas, y las dos importan:

- **Los ficheros van antes que el documento.** Si Storage falla, la ficha sigue ahí y se
  puede reintentar; al revés se pierde el rastro de qué había que borrar.
- **Un fichero que se resista no aborta el borrado**, solo se registra. Dejar la ficha a
  medio borrar es peor que quedarse con un huérfano.

⚠️ La ruta del mantenimiento lleva el vehículo dentro
(`vehicle-maintenance/{vehicleId}/{maintenanceId}/…`), así que hay que **leer el documento
antes de borrarlo**: después ya no se sabe de qué coche era.

**Qué se puede borrar, y qué no** (M-47). Las dos limitaciones son deliberadas:

- **Una reserva con contrato firmado, no.** Ese documento acredita un alquiler que
  ocurrió y `firestore.rules` prohíbe borrarlo incluso a un administrador, así que borrar
  la reserva lo dejaría apuntando al vacío. Para esas está cancelar. Borrar una reserva sí
  se lleva sus pagos, sus inspecciones y las fotos de Storage, todo en un `writeBatch`.
- **Un cliente con reservas, no.** Su nombre y su documento siguen dentro del
  `clientSnapshot` de cada reserva y de cada contrato: quitar la ficha no borraría nada,
  solo dejaría un cliente al que el histórico apunta y que ya no se puede abrir. Un
  borrado real de datos personales pasaría por **anonimizar** esos snapshots, que es otra
  tarea.

## Firestore: lo que escucha se llama `watch…` y lo que lee una vez, `get…`

⚠️ **No es estilo: es lo único que separa dos cosas que se usan distinto**, y
las dos han fallado de verdad.

**Lo que cambia desde fuera hay que escucharlo.** Quien da un cobro por bueno es
el webhook de Redsys y quien firma un contrato es el cliente en su móvil, los
dos minutos después de que el operador abriera la pantalla. Con `getDocs` la
pantalla se queda mintiendo hasta que alguien pulsa F5 — y quien acaba de ver
pagar al cliente delante no entiende por qué la aplicación dice que no. Hoy
escuchan la lista de Pagos, la ficha del pago, la ficha del contrato, la ficha
de la reserva y sus pagos, y las notas internas.

⚠️ **Un stream vivo NO se refresca volviéndolo a llamar: se vuelve a
suscribir.** `takeUntilDestroyed` corta al salir de la pantalla, **no entre
llamadas**, así que un `watch…()` invocado después de cada mutación «para
refrescar» apila un oyente de Firestore por mutación — y con él, todo lo que
haya en el `next`: en la ficha de la reserva, una reconciliación de pagos y una
escritura. Eran siete llamadas de más repartidas por tres pantallas. No hacen
falta: quien escribe es el servicio o una Cloud Function, y Firestore reemite
solo.

⚠️ **Y el método de una vez no se convierte, se deja.** Un stream vivo no
termina, así que quien espera a que **termine** se queda colgado sin decir nada:
`.toPromise()` —lo usa `sendSignedContractEmail`—, `lastValueFrom()` y, el que
más duele, un `forkJoin`, que no emite hasta que todas sus fuentes acaban; por
eso `inspection.service.ts` lleva `.pipe(first())`. (`firstValueFrom` sí
resuelve con la primera emisión y no cuelga; lo que deja es un oyente abierto
para leer una vez.)

## Firestore: `undefined` está prohibido

Firestore lanza `Cannot use 'undefined' as a Firestore value`. Hay dos defensas y conviene conocer ambas:

- **Frontend:** `client.service.ts` tiene un método privado `cleanData<T>()` que limpia recursivamente. Ojo: está duplicado ahí, no es un util compartido.
- **Functions:** `admin-guard.ts` activa `ignoreUndefinedProperties: true` en la instancia de Firestore, y `generateContractPdf.ts` tiene además `stripUndefined()` local.

Al escribir en Firestore desde código nuevo, comprueba cuál de las dos aplica.

⚠️ **Los centinelas no se pueden limpiar.** `serverTimestamp()`, `arrayUnion()` e
`increment()` son objetos con propiedades propias (`_methodName`, `_elements`). Recorrerlos
con `Object.entries()` los convierte en **un mapa normal**, y a partir de ahí Firestore o
escribe ese mapa —así se corrompieron los timestamps de los contratos (F-4)— o entra en
`_elements` y delata el `undefined` de dentro (F-31, las notas internas).

El frontend usa un único limpiador, `cleanForFirestore()` en
[firestore-clean.util.ts](src/app/shared/utils/firestore-clean.util.ts), que invierte la
regla: **solo reconstruye objetos planos de verdad**. Cualquier cosa con prototipo propio
—centinelas, `Timestamp`, `DocumentReference`, `GeoPoint`, `Date`— pasa intacta. Los tres
`cleanData` duplicados de `reservation`, `client` y `vehicle-maintenance` delegan en él.

Aun así, **lo que viaja dentro de un `arrayUnion()` tiene que nacer sin `undefined`**: el
centinela no se limpia, así que el objeto se construye ya limpio (`buildReservationNote()`).

## i18n

Tres idiomas: **es** (por defecto), **en**, **ro**. Archivos en `src/assets/i18n/`.

Las claves siguen jerarquía por módulo: `vehicles.*`, `reservations.*`, `payments.*`, `inspections.*`, `contracts.*`, `workflow.*`, `dashboard.*`, `clients.*`, `common.*`.

Las razones de bloqueo del workflow usan prefijo `workflow.*` para que el pipe `translate` las muestre sin lógica extra.

**Los tres JSON son la única fuente de verdad.** Se editan a mano; no hay generador. Existió un pipeline (`used.js` → `filter.js` → `build-schema.js` → `build-translations.js`) que mantenía una segunda copia del árbol de claves y regeneraba los JSON desde ella: las dos copias divergieron y el auditor no lo detectaba porque filtraba usadas y presentes por la misma lista blanca de módulos, así que una clave con prefijo desconocido desaparecía de ambos lados. Está retirado.

**Al añadir texto visible:** añade la clave a los tres idiomas y ejecuta `npm run i18n:audit`, que falla con código 1 si hay claves faltantes, huérfanas o desalineadas.

### Claves compuestas

Varias plantillas construyen la clave al vuelo: `'reservations.steps.' + step`, y el workflow util usa `` `reservations.timeline.${key}` ``. Esas hojas no se pueden localizar buscando el literal, así que el auditor lleva un registro explícito en `DYNAMIC_KEY_SETS` (dentro de `audit.js`) con los valores posibles de cada prefijo.

**Si añades un prefijo compuesto nuevo, regístralo ahí.** El auditor falla al detectar un prefijo sin registrar — es lo que impide que se repita el caso de los 4 pasos del asistente y los 10 hitos del timeline, que se desplegaron sin traducir mientras el auditor daba el visto bueno.

### Regla de oro de los mapas `*_LABELS`

Los `Record<Enum, string>` de `shared/models/` contienen **claves i18n, nunca texto**. Un mapa con español dentro atraviesa el pipe sin cambios y el español se cuela en la UI inglesa y rumana.

Los getters de componente que leen esos mapas (`getStatusLabel()`, etc.) resuelven la clave con `translateService.translate()`, porque las plantillas los pintan sin `| translate`.

⚠️ `TranslateService.translate()` devuelve **la propia clave** si no la encuentra, y **no hay fallback a español**: si falta en `ro.json`, el usuario rumano ve la clave en crudo.

## Cloud Functions

Desplegadas: `generateContractPdf`, `createContractSigningLink`, `cancelContractSigningLink`, `getContractForSigning` (público), `signContract` (público), `sendSignedContractEmail`, `createRedsysPaymentLink`, `redsysNotificationWebhook` (público).

También desplegadas: `generateQuotePdf`, `generateBookingConfirmationPdf`, `documentLink`
(pública), `getPaymentCheckout` (**pública**, el cliente paga desde su móvil) y
`getContractVerification` (**pública**, el QR del contrato en papel).

Y las de **facturación**: `issueInvoice`, `generateProforma`, `generateReceipt`,
`issueComplianceDeclaration`, `getComplianceStatus` y las cinco de la remisión a
la AEAT — `sendVerifactuRecords`, `sweepVerifactuRecords` (**programada**, cada
cinco minutos), `getVerifactuStatus`, `retryVerifactuRecord` y
`checkVerifactuConnection`.

⚠️ **`sweepVerifactuRecords` es la primera function programada del proyecto**, y
necesita la API de Cloud Scheduler activada. El primer despliegue la activa solo;
conviene saberlo porque es un servicio más que aparece en la factura de Google.

⚠️ **Los dos proyectos ya NO tienen las mismas functions** (verificado el 17 de
septiembre de 2026 con `gcloud functions list`, que además da la fecha de cada
una — `firebase functions:list` no la da):

| | Cuántas | Cuáles faltan |
|---|---|---|
| desarrollo | 27 | — |
| producción | **22** | `sendVerifactuRecords`, `sweepVerifactuRecords`, `getVerifactuStatus`, `retryVerifactuRecord` y `checkVerifactuConnection` |

⚠️ **Lo que falta en producción falta a propósito**: son las cinco que **hablan
con la Agencia**, y van con el guion del 1 de enero
([docs/verifactu-alta.md](docs/verifactu-alta.md) § 5 bis).

⚠️ **`issueInvoice` e `issueComplianceDeclaration` YA están allí** desde el 17 de
septiembre de 2026: producción emite facturas —y ya tiene su declaración
responsable, `verifactuDeclarations/1.0`— pero **no remite**. Emitir y remitir
son dos cosas separadas, y este es exactamente el período en que se ve.

Y **la lista de arriba no vale como inventario**: es justo el desajuste que este
fichero avisa que es fácil olvidar. Se comprueba con
`firebase functions:list --project prod`.

`documentLink` estuvo un tiempo escrita sin desplegar; ojo con que desplegarla no basta: el
rewrite `/d/**` viaja con el **hosting** y necesita su propio
`firebase deploy --only hosting`.

### Enlaces cortos para WhatsApp

La URL de Firebase Storage mide ~160 caracteres y en WhatsApp parece un intento de phishing.
`documentLink` sirve el mismo PDF desde el dominio propio a través de un rewrite de hosting:

```
https://velto-store.web.app/d/qA1b2C3d4E5f6G7h      (~46 caracteres)
```

⚠️ **No hay tabla de búsqueda ni documento en Firestore detrás.** El id **es** la ruta:

```
/d/q{id}  →  quotes/{id}/quote.pdf
/d/r{id}  →  reservations/{id}/booking-confirmation.pdf
/d/c{id}  →  receipts/{id}/receipt.pdf
```

Así el presupuesto sigue siendo tan efímero como era. El id es el secreto, igual que lo era
el token de descarga de Storage. El del presupuesto es aleatorio; el de la reserva es estable
a propósito, para que regenerar el justificante no mate el enlace que el cliente ya tiene.

⚠️ **El del recibo es aleatorio y NO el id del pago**, aunque sea un pago lo que documenta.
El id del pago es el secreto de `/pay/:paymentId`, el enlace que el cliente recibe para pagar
desde el móvil: derivando de él la ruta del recibo, cualquiera con ese enlace reenviado se
bajaría un PDF **con el nombre del cliente** — justo lo que `getPaymentCheckout` se cuida de
no revelar devolviendo solo el importe. Un identificador que ya es secreto en un sitio no se
reutiliza como dirección en otro.

Como el id aterriza directo en una ruta de Storage, `resolveDocumentPath()` **rechaza todo lo
que no sea el alfabeto URL-safe** — sin barras ni puntos, así que no se puede salir de su
carpeta ni llegar a `contracts/`. Está cubierto por tests.

El orden de los `rewrites` en `firebase.json` importa: `/d/**` va **antes** del catch-all de
la SPA, o lo captura `index.html`.

⚠️ **Si falta el rewrite, el fallo es silencioso y feo:** la ruta cae en el catch-all, se
sirve la SPA con `200`, el router no encuentra `/d/…` y el cliente **acaba en la pantalla de
login**. Un cliente al que se le pide iniciar sesión para ver su propio presupuesto.

Por eso existe además la ruta pública `d/:id` en `app.routes.ts`
([document-redirect.component.ts](src/app/features/documents/document-redirect.component.ts)),
que reenvía directamente a la function. Es el paracaídas, no el plan: convierte un rewrite
olvidado en un salto extra en vez de una pantalla de login.

**El login es solo para la agencia.** Las cuatro rutas de cliente —`sign-contract/:token`,
`d/:id`, `pay/:paymentId` y `v/:codigo`— van declaradas **antes** del bloque con
`authGuard`, así que el router las resuelve primero y el guard nunca las ve.

### Idioma de los documentos

Los tres PDF se emiten en **el idioma que tiene puesto la plataforma** cuando el operador
pulsa el botón: es el idioma en el que está hablando con el cliente. El orden de preferencia
es idioma del llamante → lo congelado en la reserva (`contractLocale`) →
`VELTO_DEFAULT_CONTRACT_LOCALE` → **español**.

⚠️ Los enums de vehículo (`fuelType`, `transmission`) llegan crudos de Firestore —`diesel`,
`manual`— y **hay que traducirlos al idioma del documento**, no pintarlos tal cual. No son
texto libre que se pueda capitalizar en el formulario: son códigos. `fuelTypeLabel()` y
`transmissionLabel()` en `pdf.ts` los resuelven en los tres idiomas.

### Identidad visual de los PDF

La referencia es **la factura que la empresa ya emite**: Gotham para marca y titulares,
etiquetas de sección en versalitas turquesa con tracking, filetes finos y un pie legal gris
repetido en cada página. Todo vive en `functions/src/contracts/brand.ts`.

⚠️ **Gotham no puede ser la fuente del cuerpo.** No tiene los diacríticos rumanos
(`ă ș ț`) **ni el símbolo `€`**. Un precio o una frase en rumano compuestos en Gotham salen
como cajas vacías, y pdf-lib **no avisa**: dibuja el hueco y sigue. Por eso `PdfBuilder`
comprueba la cobertura de glifos por cadena y cae a DejaVu cuando hace falta — la misma regla
que la app declara en `styles.scss`. Consecuencia visible: en español e inglés los titulares
salen en Gotham; en rumano, los que llevan `ș`/`ț` caen a DejaVu.

La Gotham y el logo **no se duplican** en `functions/`: `scripts/copy-fonts.js` los copia desde
`src/assets/` de la app al compilar. Rediseñar el logo actualiza los PDF en el siguiente
despliegue. El logo se dibuja como vectores con `drawSvgPath`, leyendo el SVG real.

**Los tres invariantes de maquetación están cubiertos por tests** (`documents/layout.spec.ts`,
los tres documentos × tres idiomas):

- ningún texto se solapa con otro (`assertNoOverlaps`)
- ningún glifo falta en la fuente en que se compuso (`assertNoMissingGlyphs`)
- nada se sale del margen ni invade el pie legal (`assertInsideMargins`)
- ningún titular sale cortado con puntos suspensivos

Son tests porque los cuatro han fallado de verdad: el título salía como
«CONTRATO DE ALQUILER …» y una razón social larga como «EUROCONSTRUCCIONES 2020, SOC…».
Los titulares **encogen y parten**, nunca se truncan.

⚠️ **Y una dirección se parte por sus comas, no por donde se acabe la columna.** Los valores
de `infoColumns` con `wrap` —el domicilio fiscal, la razón social del destinatario— pasan por
`wrapPreferringCommas()`: si caben, una línea; si no, el salto va **después de una coma**.
Partido por ancho salía «… 28850 Torrejón / de Ardoz (Madrid)», que corta un topónimo en dos
en un dato que es contenido obligatorio de la factura (art. 6.1.c). La coma se queda al final
de la línea: es parte del dato que tecleó el operador y no se le quitan caracteres para
maquetar.

La función vive **fuera del builder** —como `qrRects()`— para poder probarla sin cargar una
fuente: quien llama pone la medida. Y **no la usa `text()`**, a propósito: la prosa —las
cláusulas, las menciones legales, el aviso del recibo— se parte por ancho, o «Documento
informativo, / sin validez fiscal…» quedaría en líneas cortísimas.

### Los documentos que no son el contrato

`functions/src/documents/` genera el **presupuesto** (antes de que exista la reserva) y el
**justificante de reserva** (desde `confirmed`, con el contrato aún sin firmar).

⚠️ **Ninguno de los dos escribe en Firestore.** Es la regla que sostiene el diseño: son
documentos informativos, no pasos del flujo, y el workflow sigue siendo la única autoridad.
Si alguna vez uno de ellos toca `contractStatus` o el estado de la reserva, se ha abierto la
puerta a entregar un coche sin contrato firmado.

El presupuesto además **no persiste nada**: no existe el estado `quote` y el coche no se
bloquea. Lo único que queda es el PDF en Storage, que es lo que el enlace necesita.

`uploadPdf()` **reutiliza el token de descarga** si el archivo ya existe. Un token nuevo
rompería en silencio el enlace que el cliente ya tiene en su WhatsApp.

### VeriFactu: el registro se guarda, el QR calla

⚠️ **El registro de facturación se guarda desde la primera factura, aunque no se
envíe nada a la AEAT hasta 2027.** No es adelantarse: **una factura emitida no
se puede editar**, así que lo que no se guarde al emitirla no se podrá añadir
después. Lo construye `invoices/verifactu.ts` **dentro de la misma transacción
que sella la huella** y con los mismos datos; reconstruirlo luego daría un
registro parecido y no necesariamente el mismo.

Tres cosas que van dentro y que es fácil dejarse:

- **El encadenamiento necesita los CUATRO datos del anterior** —emisor, número,
  fecha y huella—, no solo la huella. La factura guardaba únicamente
  `previousHash`, y el resto habría que buscarlo por huella sobre una colección
  que no se puede editar.
- **El tipo sellado** (`tipoFacturaAeat`): entra en la huella, así que sin él no
  se puede verificar el registro. Deducirlo mal da una huella que parece válida.
- **El bloque «Sistema Informático»** es obligatorio. El productor del software
  es **la propia empresa** —autodesarrollo—, así que su NIF es el del emisor.

⚠️ **El QR y la leyenda están apagados, y siguen apagados hasta que el envío
funcione.** «Factura verificable en la sede electrónica de la AEAT» sobre una
factura que nunca se remitió manda al cliente a una sede donde su factura no
está, y lo que parece roto es la factura. Es el mismo error que la frase que
anunciaba una firma digital inexistente: **la frase y el hecho se deciden
juntos**. Lo gobierna `VELTO_VERIFACTU_ENABLED` en `functions/.env.<proyecto>`,
hoy `false` en los dos.

### La declaración responsable, y por qué la firma Velto

⚠️ **El art. 15 de la Orden HAC/1177/2024 obliga al PRODUCTOR del software, y
aquí el productor es la propia empresa.** Al ser desarrollo propio no hay
fabricante externo que declare que el sistema cumple el RD 1007/2023: VELTO
MOBILITY es a la vez obligado tributario y productor.

Está en **Ajustes › Declaración responsable**, y hace falta **una por cada
versión del sistema**. Ninguna se borra: la de una versión pasada sigue
acreditando lo que se declaró mientras esa versión estuvo emitiendo facturas, y
`firestore.rules` deniega `update` y `delete` a todos, igual que con las
facturas. El id del documento **es la versión**, así que no puede haber dos de
la misma.

⚠️ **Lo que declara sale del mismo sitio que el registro de facturación**
(`sistemaInformatico()`). Si la declaración dijera una modalidad y los registros
llevaran otra, la declaración sería falsa sin que nadie tocara nada: son el
mismo hecho contado en dos sitios. Por eso la pantalla tampoco tiene constantes
propias — la versión y el productor los sirve `getComplianceStatus`, o serían un
cuarto sitio donde escribir la versión y el primero en quedarse viejo.

**Modalidad: exclusivamente VERI\*FACTU** (`SoloVerifactu: 'S'`), decisión de
Dorel del 9 de septiembre de 2026. El campo describe **cómo es el sistema**, no
en qué punto de su despliegue está.

⚠️ **Los nombres de campo del registro son los del esquema oficial**, con su
grafía exacta (`IDFactura`, `CuotaTotal`, `Desglose > DetalleDesglose`). No es
estilo: así el XML es una **serialización directa** del objeto guardado, sin una
tabla de traducción en medio que haya que mantener y en la que un nombre mal
escrito produzca un registro que la AEAT rechaza.

**Las especificaciones están versionadas** en [docs/aeat/](docs/aeat/README.md)
—esquemas, WSDL, diseño de registro, QR y los 247 códigos de error— porque las
de la sede cambian sin dejar rastro de qué versión se usó. Ese README lleva
además qué se contrastó y qué hubo que corregir.

Falta el **envío** —XML SOAP firmado, estados, reintentos—, que no se puede dar
por bueno sin el entorno de preproducción de la AEAT.

⚠️ **Dos endpoints por entorno según el certificado**, y no son intercambiables:
`prewww1`/`www1` para certificado de **representante** —el nuestro— y
`prewww10`/`www10` para certificado de **sello**. Llamar a la que no toca da un
rechazo de autenticación que parece un problema del certificado.

⚠️ **No hay «alta» en VERI\*FACTU ni se comunica por el modelo 036**, y tampoco
sustituye a la contabilidad ni a las declaraciones: es una obligación adicional
sobre cómo funciona la aplicación. El procedimiento y lo que falta para el envío
están en [docs/verifactu-alta.md](docs/verifactu-alta.md).

⚠️ **Guardar el registro no es que la AEAT lo haya aceptado.** La integración no
está terminada hasta validar contra preproducción el XML, el encadenamiento, el
QR, las respuestas, los errores y los reenvíos. Y **producción no se toca sin
autorización expresa de Dorel**.

### El parte de entrega y el de devolución

`generateInspectionReport` produce los dos documentos a los que **el contrato
remite cuatro veces** —cláusulas 1, 2, 5 y 6— y que hasta el 8 de septiembre de
2026 no existían: la inspección se guardaba en Firestore y no había nada que
enseñar ni que entregar.

⚠️ **Las cláusulas decían «que ambas partes firman». Ahora no.** Decisión de
Dorel: hacer firmar dos veces al cliente —y a cada conductor de una cuadrilla,
que era lo que pedía la cláusula 2— es molesto en la calle, y el negocio es de
clientes conocidos. Se quitó **la firma, no el documento**: el contrato sigue
remitiendo al parte porque el kilometraje y el combustible de salida **no caben
en él**, que se firma antes de la entrega.

De ahí sale lo que gobierna este PDF:

⚠️ **Las fotografías son la prueba.** Sin firma, lo que sostiene un cargo por
combustible, kilómetros o dotación faltante es el estado del coche fotografiado
con su fecha. Por eso las fotos van dentro del documento y no son decoración, y
por eso las cláusulas dicen ahora «consemnado **y fotografiado** en el parte».

Cuatro cosas que solo se vieron mirando el PDF generado:

- **El checklist se filtra por fase.** `InspectionChecklist` es un único objeto
  para las dos inspecciones, así que un parte de **devolución** sacaba «Sin
  marcar: identidad del cliente verificada, fianza depositada, contrato
  firmado…» — comprobaciones de la entrega que en la devolución no se hacen
  porque ya se hicieron. El documento venía a decir que no se había
  identificado al cliente.
- **Los snapshots se respaldan con la reserva.** No toda inspección guardó
  `clientSnapshot` y `vehicleSnapshot`, y sin ellos el parte salía con
  «Arrendatario: —» y el vehículo en blanco: un papel que dice acreditar el
  estado de un coche entregado a una persona, sin decir de qué coche ni a quién.
- **Lo no marcado se imprime**, en gris y bajo su propio rótulo. Un parte que
  solo enseñe lo que salió bien no sirve para discutir lo que salió mal.
- ⚠️ **El enlace `/d/…` se cachea 5 minutos.** Regenerar el parte y abrirlo al
  momento devuelve el anterior; no es un fallo del PDF. Con `?v=2` o esperando
  se ve el nuevo.

El enlace es **estable** (`/d/i{inspectionId}`), como el del justificante:
regenerar el parte porque se añadió una foto no puede matar el enlace que el
cliente ya tiene. El id de la inspección no es secreto de ninguna otra ruta, así
que aquí sí se puede usar; el del recibo no podía.

**No se manda solo.** El operador genera y copia el enlace cuando el cliente lo
pide, que es lo que el contrato promete: que el parte se conserva y se pone a su
disposición.

### El recibo de cobro: todo su diseño es no parecer una factura

`generateReceipt` justifica **dinero recibido**, y esa es la única frase que hay dentro. Un
cliente que se dedujera el IVA con un recibo tendría un problema, y quien se lo dio también,
así que el documento **no reutiliza `buildInvoicePdf`**: comparte el `PdfBuilder` —la marca
es la misma— y nada más. No lleva número de serie fiscal, no desglosa IVA, no tiene bloque de
forma de pago con IBAN, y lleva impreso arriba y en negrita que no es una factura.

Tres reglas, y las tres tienen su motivo:

- ⚠️ **El importe NO viaja en la petición: se lee del pago.** `payments` es la única fuente
  de verdad del dinero que entra; aceptando la cifra que mande la pantalla, el recibo sería
  un papel firmado por la empresa diciendo que recibió algo que quizá no recibió.
- **Solo dinero que entró.** `receipt-core.ts` rechaza lo cancelado, lo no cobrado y —el caso
  que hay que acertar— **las devoluciones y retenciones de fianza**: van en la dirección
  contraria y llevan importe, así que la comprobación del importe no las caza. La misma regla
  está duplicada en `@shared/utils/receipt.util.ts` para decidir si el botón aparece, con la
  misma tabla de casos en los dos tests.
- **No escribe nada en Firestore**, como el presupuesto y la proforma.

⚠️ **Y el texto tiene que ser cierto**, que es donde fallan estos documentos. «La factura se
emitirá al finalizar el alquiler» solo se imprime si el operador marca que el cliente la ha
pedido —se factura **a petición**, así que prometerla siempre sería falso la mayoría de las
veces— y si la factura ya existe se imprime su número en vez de anunciar una futura. La
fianza lleva además su propia nota: es un depósito en garantía, no un importe del alquiler, y
no se factura nunca.

Dos cosas más que solo se vieron **mirando el PDF**, no leyendo el código: el nombre del
pagador salía sin la etiqueta «Recibido de» —que estaba escrita y traducida en los tres
idiomas sin que nadie la pintara—, y el concepto se repetía («Señal de la reserva» sobre
«Señal reserva», que es lo que la propia aplicación siembra en la fila). El detalle del
operador ahora se imprime solo si añade algo, comparado contra los titulares **en los tres
idiomas**: si no, un recibo rumano sacaba el concepto en español.

### Firma de contratos

El cliente firma **sin cuenta**: `/sign-contract/:token`, ruta pública fuera del `authGuard`. El token (256 bits URL-safe) es de un solo uso y caduca (7 días por defecto). Los tokens viven en `contractSigningTokens`, colección con reglas de Firestore que **deniegan todo acceso desde cliente** — solo el admin SDK entra.

### El contrato va firmado con el certificado FNMT

`signContract` sella el PDF con el certificado de representante de la empresa
(`sign-pdf.ts`), **después** de incrustar la firma manuscrita del cliente. Un PDF
firmado no admite cambios: cualquier cosa que se le haga después rompe la firma.

⚠️ **El hueco de la firma son 32 KB.** Empezó en 8192 y falló con *Signature exceeds
placeholder length: 11916 > 8192*: el certificado FNMT incrusta la cadena completa de la
autoridad. Al renovarlo, comprobar que sigue cabiendo.

⚠️ **La frase y la realidad se deciden juntas.** «Firmado digitalmente con certificado
digital» solo se imprime si el PDF se va a sellar de verdad (`willBeDigitallySigned`), y
**si el sellado falla el PDF se reconstruye sin ella**. Durante meses el contrato afirmó
una firma que no tenía; la primera versión de N-8 repitió el error por decidir la frase
antes de intentar sellar.

El sellado **nunca aborta la firma**: si falla, se guarda sin sellar y se registra. Perder
el sello es un problema; perder la firma que el cliente acaba de hacer, uno mucho peor.

Se usa `@signpdf/placeholder-pdf-lib` y **no** `placeholder-plain`, que arrastra
`pdfkit` → `crypto-js` con vulnerabilidades críticas sin llegar a usarse.

Lo que aporta: integridad del documento e identidad del emisor. Lo que **no**: la firma
del cliente sigue siendo un trazo en un canvas, firma electrónica simple. Sellar con el
certificado de la empresa no la convierte en cualificada.

### El QR de verificación, y qué NO promete

En la casilla del arrendador van un QR y un código legible —`VLT-8QPB-YNT4-9AXJ`— que
llevan a la ruta pública `/v/:codigo`. `getContractVerification` devuelve **cinco datos y
ninguno personal**: número de contrato, fecha de firma, matrícula, estado y huella
SHA-256. Ni nombre, ni documento, ni importe: quien escanee un contrato olvidado en un
mostrador no puede quedarse con la ficha de nadie.

⚠️ **Un QR no valida una firma electrónica.** Eso lo hace Adobe o VALIDe abriendo el PDF.
Lo que resuelve es el **papel**, donde no hay nada que abrir. Ningún texto del PDF ni de
la página puede sugerir otra cosa — es el mismo error que la frase que afirmaba una firma
inexistente, y por eso el QR **convive** con «Firmado digitalmente con certificado
digital» en vez de sustituirla: son dos hechos distintos, y si el sellado falla
desaparece la frase y el QR se queda.

Dos cosas que solo se pueden hacer en un orden:

1. **El código se decide antes de construir el PDF**, porque el QR va dentro del
   documento que después se sella y un PDF firmado no admite cambios.
2. **La huella se calcula sobre los bytes que se guardan**, después de sellar y después
   de la posible reconstrucción sin la frase. Calculada antes no coincide con ningún
   fichero real, y la página le diría al cliente que su contrato está alterado.

⚠️ **Un QR ilegible tiene la misma pinta que uno bueno.** La geometría vive en
`qrRects()`, fuera del dibujo, para que un test pueda rasterizar los rectángulos reales y
descifrarlos con un lector (`jsqr`). Un índice de fila invertido o la zona de silencio
—4 módulos— olvidada dan un cuadrado de aspecto normal que ningún móvil entiende.

El alfabeto del código no lleva `I`, `L`, `O`, `U`, `0` ni `1`: se dicta por teléfono y se
teclea desde un papel. Y el sorteo usa muestreo con rechazo, porque `byte % 30` habría
favorecido a los seis primeros símbolos.

### La remisión a la AEAT (VERI\*FACTU)

Emitir y remitir son **dos cosas separadas**, y separarlas es lo que sostiene el
resto. `issueInvoice` no llama a la Agencia: un servicio lento dejaría al
operador esperando delante de una factura con el número ya consumido, y uno
caído tumbaría la emisión por un problema de red. La factura se emite siempre; el
envío reintenta hasta conseguirlo, desde `sweepVerifactuRecords` **cada cinco
minutos** — un envío que solo ocurre al pulsar un botón depende de que alguien se
acuerde, y la norma pide remisión inmediata.

El estado vive en `verifactuSubmissions/{invoiceId}`, **fuera de la factura**: la
factura es inmutable y el envío cambia media docena de veces. La fila nace en la
misma transacción que la factura, porque escribirla después y fallar dejaría una
factura que nadie enviaría nunca.

⚠️ **El orden importa y no es el de la fecha.** Los registros van encadenados por
huella y la fecha de emisión se toma al entrar en la function, mientras la cadena
se cierra al confirmar la transacción: dos facturas emitidas a la vez pueden
llevar fechas que no respeten el orden real. Por eso la transacción escribe un
`chainIndex` sobre el mismo documento que la huella.

#### El registro que se manda se RECONSTRUYE, y la huella se comprueba

⚠️ **No se manda el registro tal y como se guardó al emitir**, y el motivo es
concreto: un registro rechazado por la AEAT **no queda registrado** y hay que
corregirlo, pero congelado dentro de una factura inmutable no se puede corregir
nunca. Pasó de verdad el 9 de septiembre de 2026.

`registroParaEnvio()` lo rehace con el código de hoy desde los campos de la
factura —que son los que de verdad son inmutables— y toma del registro sellado
solo lo que **no se puede recalcular**: el encadenamiento, el sistema informático
y el instante de generación. Recalcular el encadenamiento ataría la factura a la
última emitida; poner la versión actual del sistema diría que una factura de
marzo la emitió el software de septiembre, y esa versión es la que ampara su
declaración responsable.

Y la huella se **recalcula y se compara** con la sellada. Es lo que separa
corregir cómo se declara un dato de cambiar la factura: si un importe se hubiera
movido, el envío se para en vez de declarar un registro que no se corresponde con
el documento que tiene el cliente.

#### Un rechazo para la cola, y solo lo desbloquea una persona

Un rechazo deja la factura visible y **no se reintenta solo**: reintentar un
rechazo permanente es un bucle que gasta el límite de envíos de la Agencia sin
arreglar nada. `retryVerifactuRecord` la devuelve a la cola cuando alguien ha
resuelto la causa, y queda anotado quién.

⚠️ **El ritmo lo marca la AEAT** en cada respuesta (`TiempoEsperaEnvio`).
Adelantarse se rechaza con el `4102` y tumba el envío entero: ignorarlo no
adelanta, retrasa.

⚠️ **Un duplicado (`3000`) es una factura que YA está registrada**, no un fallo:
casi siempre porque un envío llegó y se perdió la respuesta. Se lee como
aceptada — y **su CSV no se pisa**, porque la respuesta de un duplicado no trae
CSV y escribir ese vacío borraba el acuse de la remisión buena.

#### Lo que solo se ve contra preproducción

⚠️ **Un XML válido contra el `.xsd` puede ser rechazado por lo que significa.**
Los cuatro fallos que encontró preproducción el 9 de septiembre de 2026 pasaban
la validación de esquema y ningún test los habría cogido:

- El **NIF-IVA extranjero** iba en `NIF`, que es solo para identificadores
  españoles; el resto va en `IDOtro` con su país y tipo (error `1100`).
- El **país es obligatorio** cuando el identificador no es un NIF-IVA, aunque el
  esquema lo declare opcional (error `1111`). Es el caso más común de un
  alquiler: un turista con pasaporte. Lo pide `validateInvoice()` **antes** de
  consumir número, porque después no tiene arreglo.
- El registro **congelado** no se podía corregir (arriba).
- El **QR medía 21,9 mm** y el art. 21 lo fija entre 30×30 y 40×40 mm, con el
  rótulo «QR tributario:» encima, la frase debajo y ambos a tamaño **igual o
  superior** al resto de datos de la factura. Faltaba todo eso.

El plan de pruebas, con lo comprobado y lo que falta, está en
[docs/verifactu-alta.md](docs/verifactu-alta.md) § 3 bis.

⚠️ **Hoy está activo SOLO en desarrollo**, contra preproducción
(`VELTO_VERIFACTU_ENABLED=true`, `VELTO_VERIFACTU_ENV=test`). En producción sigue
en `false` y **solo lo cambia Dorel**.

### Devolver a la tarjeta: el único camino por el que SALE dinero

⚠️ **Todo lo demás en esta aplicación registra; esto mueve.** El peor error del
resto es una cifra equivocada en una pantalla; aquí es que salgan cien euros de
la cuenta de la empresa. Y una devolución aceptada por el banco **no se deshace
con un botón**: es una llamada al comercio.

⚠️ **No es la misma integración que el cobro.** El cobro va **por formulario**:
se manda al cliente a la pasarela y vuelve. En una devolución no hay cliente
delante, así que se habla **de servidor a servidor** por la vía REST
(`/sis/rest/trataPeticionREST`, otra URL distinta de `/sis/realizarPago`). Lo que
sí se reutiliza es la firma, que es la misma HMAC_SHA256_V1 ya probada.

⚠️ **La respuesta se lee con OTRA regla.** Un cobro aceptado responde
`0000`–`0099`; una **devolución** aceptada, `0900`–`0999`. Leerla con la regla del
cobro haría que una devolución correcta pareciera un error — y lo que sigue a un
error es reintentar: dinero fuera dos veces. Comprobado contra la pasarela de
test el 14 de septiembre de 2026: el cobro dio `0000` y su devolución `0900`.

Los frenos, y ninguno sobra:

- **Permiso propio `refundPayments`**, no `deleteRecords`. Borrar destruye
  información nuestra; devolver saca dinero. Si fueran el mismo permiso, el día
  que un encargado pueda borrar una reserva de prueba heredaría la llave de la
  caja.
- **El rol se lee de Firestore, no del token**: un token emitido cuando el
  usuario era administrador sigue valiendo una hora.
- **El importe no viaja como orden**: se topa contra lo que de verdad entró,
  descontando lo ya devuelto.
- **Se RESERVA en transacción antes de llamar al banco**, y se revierte si
  rechaza. Es lo que impide que dos clics hagan dos devoluciones — la misma
  lección que costó el cobro perdido de F-32.
- **No se reintenta solo.** Un fallo posterior a la aceptación del banco es
  indistinguible de uno anterior.

⚠️ **Una devolución PARCIAL no cambia el estado del pago.** Sigue `paid` por el
resto; marcarlo `refunded` entero haría que los informes dejaran de contar un
dinero que sí entró y se quedó. Por eso `sumPaid()` **descuenta
`refundedAmount`** en vez de mirar el estado.

⚠️ **Y el pipe `date` no traga un `Timestamp` de Firestore.** Lanza
`InvalidPipeArgument` y **tumba el bloque entero**, no solo la fecha. El
`notifiedAt` de la pasarela llevaba así desde siempre y no se vio porque hasta
que hubo un cobro real con notificación el `@if` no entraba nunca.

### El cliente paga desde su móvil

`getPaymentCheckout` es **pública** y la abre el cliente en `/pay/:paymentId`, ruta
declarada **antes** del bloque con `authGuard`. El id del pago es el secreto, como en los
enlaces `/d/…`.

⚠️ **Devuelve lo mínimo**: importe, moneda, concepto y marca. Nunca el pagador, el
cliente, el vehículo ni la reserva — quien abre un enlace reenviado no debe enterarse de
con quién trabajas. Un pago ya cobrado **no genera formulario**: reenviar el enlace
después de pagar cobraría dos veces. Un id inexistente y uno cancelado responden lo mismo.

La preparación del formulario (`prepareRedsysCheckout`) la comparten la vía pública y la
del backoffice, para no duplicar la firma, el formato del pedido ni la URL del webhook.

⚠️ **Redsys solo admite POST.** Abrir `paymentUrl` con un GET lleva a una pantalla de
error del banco; durante meses fue así y ningún cobro con tarjeta pudo completarse. El
POST vive en `RedsysPaymentService.openGateway()`, compartido por las dos pantallas.

⚠️ **Lo que se lleva a la pasarela es lo PENDIENTE, no `payment.amount`**
(`outstandingAmount` en `redsys-charge-core.ts`). Con el total, un concepto de
50 € del que ya se cobraron 20 € en efectivo generaba un enlace de **50 €** y el
cliente pagaba 70 € por algo que valía 50. Y el webhook remataba poniendo
`paidAmount = payment.amount`, así que esos 20 € reales desaparecían del
registro: el dinero en el banco y en los libros no. Ahora **se suma** lo que
cobró el banco, que lo dice `Ds_Amount` dentro de los parámetros firmados; sumar
es seguro porque el webhook sale antes si el pago ya está `paid`.

⚠️ **Un COBRO aceptado es `0000`–`0099`, y el webhook comprobaba
`/^0[0-9][0-9][0-9]$/`** — que llega hasta `0999`, o sea el rango de una
**devolución** aceptada. El comentario decía «0000-0099» y el código decía otra
cosa. Con la regla ancha, el aviso de una devolución aceptada entraba por la rama
de aprobado y dejaba el pago en `paid` con 0 pendiente: la devolución se deshacía
sola en los libros con el dinero ya fuera del banco. Se comprueba además
`Ds_TransactionType`, que viaja firmado.

⚠️ **En `Ds_Merchant_Parameters` no va NINGÚN dato personal.** Ese bloque se
serializa en base64 y se le entrega **al navegador** para que lo publique, así
que lo lee cualquiera que tenga el enlace con un `atob()`. Llevaba
`Ds_Merchant_Titular` con el nombre completo del arrendatario, de modo que un
`/pay/:id` reenviado revelaba a nombre de quién está la reserva — contradiciendo
lo que `getPaymentCheckout` se cuida de cumplir por el otro lado. La firma tapa
la manipulación, no la lectura.

⚠️ **Un cobro que ya entró no se cancela.** El resumen de la reserva descarta lo
cancelado (`p.status !== 'cancelled'`), así que cancelar un pago cobrado borraba
de los libros dinero que estaba en el banco. Lo que corresponde es devolverlo, o
—si el resto no se va a cobrar— **corregir el importe** a lo que entró, que
cierra la fila sin borrar nada.

### `payment-edit.util.ts`: qué cobro se puede corregir

Un importe se teclea mal, y hasta el 15 de septiembre de 2026 la única salida era
cancelar la fila y crear otra, dejando dos apuntes donde había uno.

⚠️ **Corregir no es cobrar ni devolver:** cambia lo que se pide y **no toca
`paidAmount`**. Con 20 € cobrados de 50 corregidos a 35, el pago queda `partial`
con 15 € pendientes. Por eso no puede quedar por debajo de lo ya cobrado — eso
sería un pendiente negativo, y si hay que devolver dinero, eso es una devolución.

⚠️ **La señal, el resto y la fianza NO se corrigen desde el pago.** Son un
reparto del precio del alquiler: bajar la señal en la fila dejaría la reserva
pidiendo 50 € y el cobro 30, sin que nada las volviera a cuadrar. Eso se toca en
la edición de la reserva, que mueve las dos a la vez. La pantalla lo dice y
ofrece el salto.

⚠️ **El pedido (`Ds_Merchant_Order`) NO se regenera en cada llamada.** Es la referencia
con la que el webhook encuentra el pago, y esta misma función la invoca la pantalla que
el cliente **refresca para ver si su pago ya consta**. Regenerándolo, el aviso de Redsys
llegaba con un pedido que el documento ya no guardaba, el webhook respondía «No payment
found» y **el cobro se perdía con el dinero ya cargado en la tarjeta** (F-32, 4 de
septiembre de 2026, 1 € real).

Tres reglas, y las tres hacen falta:

- `resolveOrder()` **reutiliza** el pedido mientras no haya llegado ningún aviso para él.
  Si ya llegó —una denegación— hay que emitir uno nuevo: la pasarela rechaza un pedido ya
  procesado con **SIS0051**.
- `redsys.issuedOrders` guarda **todos** los emitidos, y el webhook busca ahí cuando el
  vigente no cuadra. Así una carrera entre pantallas no cuesta un cobro.
- Un aviso sin pago al que aplicarse **se guarda** en `redsysOrphanNotifications/{pedido}`,
  no se descarta. Puede ser dinero cobrado de verdad, y sin rastro no hay forma de saberlo
  después.

Una denegación de un pedido superado se anota pero **no** marca el pago como fallido —el
cliente pudo ser rechazado con una tarjeta y estar pagando con otra—. Aprobado sí se
aplica siempre.

### Datos de empresa

`functions/src/company-config.ts` es la única fuente. La razón social se guarda **en
mayúsculas** (`VELTO MOBILITY, S.L.`) en vez de pasarla a mayúsculas al pintar: así ninguna
plantilla se puede olvidar.

#### Marca o razón social: `brandName` por defecto

Hay **dos nombres**, y confundirlos se ve enseguida en lo que recibe el cliente:

| | Valor | Dónde |
|---|---|---|
| `brandName` | `VELTO MOBILITY` | Todo lo que le habla al cliente |
| `legalName` | `VELTO MOBILITY, S.L.` | **Solo junto al NIF** |

La regla, en una línea: **la razón social solo aparece donde la empresa comparece como
persona jurídica, es decir acompañada del NIF.** En el contrato son exactamente tres
sitios —bloque «Datos del arrendador», casilla de firma del arrendador y pie legal de cada
página— y en los tres el NIF va al lado. Todo lo demás —asunto del email, cuerpo, cabecera
de cualquier documento, metadatos del PDF, pantalla pública de firma— lleva la marca.

#### Y **dos direcciones**, por la misma razón

| | Valor | Dónde |
|---|---|---|
| `officeAddress` | `C/ María Zambrano, 4` | La **cabecera** de todos los documentos |
| `address` | `C/ Vereda del Melero, 3` | **Solo junto al NIF**, los mismos tres sitios que `legalName` |

`address` es el **domicilio social**, el del Registro Mercantil: junto al NIF y a la hoja
registral es un dato obligatorio de la S.L., y ahí no se puede sustituir. `officeAddress`
es **la oficina**, donde el cliente encuentra a alguien — y por eso va arriba, al lado del
teléfono y el correo, que siguen esa misma lógica. La cabecera llevaba la fiscal y mandaba
al cliente a una dirección donde no está la oficina (7 de septiembre de 2026).

⚠️ **`officeAddress` cae a `address` si no está configurada.** No es un parche de
compatibilidad: es que para una empresa cuya oficina es su domicilio social las dos son la
misma, y declarar dos veces lo mismo solo sirve para que un día diverjan.

El criterio es de Dorel y es de negocio, no de estilo: un cliente no sabe qué es una S.L.
ni tiene por qué saberlo, y meterlo en un «Gracias por confiar en…» suena a notaría.

⚠️ **`legalName` acaba en punto.** Cualquier plantilla que lo ponga al final de una frase
produce «Gracias por confiar en VELTO MOBILITY, S.L..». Ya pasó.

⚠️ `getContractForSigning` leía `VELTO_COMPANY_NAME` —la razón social— para la cabecera de
la pantalla de firma, y **coincidía de puro azar**: ese valor no está puesto en ningún
entorno, así que caía al literal `'VELTO MOBILITY'` escrito al lado. El día que alguien
configurase el secret, al cliente le habría salido la S.L. en la pantalla donde firma.

⚠️ **Los valores por defecto solo se aplican si el secret correspondiente NO está puesto.**
Si `VELTO_COMPANY_NAME` sigue valiendo «Velto Rent» en producción, el PDF seguirá diciendo
«Velto Rent» por mucho que el código diga otra cosa. Al cambiar datos de empresa hay que
revisar los secrets, no solo el código.

Y al revés, que es el caso de hoy: ningún `VELTO_COMPANY_*` está puesto en ningún entorno
—**ni declarado en las functions que los leen**, así que no llegarían aunque lo estuvieran—
y los documentos salen con los valores del código. Ver la tabla en «Secrets».

⚠️ **`brand.config.ts` no sirve para datos que cambien de entorno.** Se compila
dentro del bundle y la app se construye **igual** para desarrollo y producción,
así que su `email` y su `website` son los mismos en los dos. El pie de la
pantalla pública de firma llevaba `reservas@veltorent.com` escrito a mano y el
cliente de producción veía el correo de desarrollo justo debajo del botón de
firmar (F-33). Lo que distingue entorno vive en `functions/.env.<proyecto>`, y
si una pantalla lo necesita, **se lo sirve la function** — como hace ahora
`getContractForSigning` con `companyEmail`.

### Configuración por entorno: `functions/.env.<proyecto>`

Lo que **no es un secreto** pero cambia entre entornos vive en un fichero por
proyecto, que Firebase carga y sube al desplegar:

```
functions/.env.velto-store              → desarrollo
functions/.env.rentalcar-veltomobility  → producción
```

La ventaja sobre Secret Manager es la que costó descubrir: **estas variables no
hay que declararlas en ninguna function**. Llegan a `process.env` sin más, que es
justo lo que los `VELTO_COMPANY_*` nunca hicieron estando puestos como secrets.

⚠️ **`VELTO_INVOICING_ENABLED` dice si el entorno EMITE facturas**, y no es lo
mismo que `VELTO_VERIFACTU_ENABLED`, que dice si los registros se **remiten** a
la AEAT. Hoy, y esta combinación es la que importa:

| | Emite (`INVOICING`) | Remite (`VERIFACTU`) |
|---|---|---|
| desarrollo | `true` | `true`, contra **preproducción** |
| producción | **`true`** desde el 17 sep 2026 | **`false`** hasta el 1 de enero |

⚠️ **Que las dos banderas dejaran de ir juntas rompió una pantalla el mismo
día.** Ajustes decidía si consultar la remisión mirando `invoicingEnabled`, y
funcionaba **de casualidad** mientras las dos estuvieron apagadas a la vez: al
encender solo la primera, llamó a `getVerifactuStatus` —que en producción no
está desplegada— y soltó «No se pudo consultar el estado de la remisión» justo
después de emitir la declaración responsable. Por eso `getComplianceStatus`
sirve **las dos**, `invoicingEnabled` y `verifactuEnabled`. Si aparece una
tercera bandera de este tipo, la regla es la misma: **cada pregunta se contesta
con su propia bandera**, aunque hoy coincidan.

Existe porque «producción todavía no factura» era un hecho real que no estaba
escrito en ninguna parte: la pantalla ofrecía «Emitir declaración» y el módulo de
Facturas entero con las functions que los sirven **sin desplegar**, o sea botones
que no hacen nada. Y no se puede deducir de que falte la function: un callable
ausente devuelve un error, y un error significa «algo va mal», no «esto aún no
toca» — son dos cosas distintas y la pantalla tiene que distinguirlas.

Con `false`, Ajustes no ofrece emitir la declaración responsable ni consulta el
estado de la remisión, y lo explica en vez de dar un error. `issueComplianceDeclaration`
lo comprueba **también en el backend**, porque una declaración emitida no se
puede borrar y una emitida por error se queda para siempre.

Llevan `VELTO_COMPANY_EMAIL` y `VELTO_PUBLIC_BASE_URL`, **distintos a propósito**:

| | Correo | Dominio público |
|---|---|---|
| desarrollo | `reservas@veltorent.com` | `https://store.veltorent.com` |
| producción | `reservas@veltomobility.com` | `https://rentalcar.veltomobility.com` |

`VELTO_PUBLIC_BASE_URL` gobierna **las dos URL que recibe el cliente**: el enlace
de firma del contrato y los enlaces cortos `/d/…` de presupuestos y
justificantes. Sin ella, los cortos caen al dominio `.web.app` del proyecto y el
enlace de firma sale relativo para que lo complete el frontend — funcionan, pero
lo que el cliente ve por WhatsApp no es el dominio de la empresa.

⚠️ **Hay un secret `VELTO_PUBLIC_BASE_URL` en Secret Manager, en desarrollo, que
no sirve para nada.** `signingLink` y `documentLink` lo leen de `process.env`
sin declararlo, así que nunca llegó al runtime: el enlace de firma llevaba meses
saliendo relativo con el secret puesto. Manda el `.env`. El secret puede
borrarse.

⚠️ **Ese correo hace dos cosas a la vez**: es el remitente de los emails de
Resend **y** el correo impreso en el contrato y en los documentos. Cambiarlo
cambia ambas.

⚠️ **Resend solo acepta remitentes de un dominio verificado.** Si
`veltomobility.com` no está verificado en la cuenta de Resend, el envío del
contrato en producción falla con un 403 — y el 403 no dice «dominio sin
verificar», dice «Error al enviar el email (403)».

Los dos dominios **están verificados** y el envío funciona en los dos entornos:
el contrato firmado llegó a su destinatario desde producción el 5 de septiembre
de 2026.

⚠️ **Estos ficheros están en el repositorio: aquí no van credenciales.** Nada que
no puedas enseñar. Las claves siguen en Secret Manager, declaradas con
`defineSecret`.

Verificado el 29 de agosto de 2026 poniendo un valor distinguible en desarrollo:
salió impreso en el PDF, se comprobó, y se devolvió el valor bueno.

⚠️ **El `.env` forma parte del hash de despliegue.** Cambiarlo actualiza las once
functions aunque no se haya tocado una línea de código; y a la inversa, un
`Skipped (No changes detected)` en las once significa que el fichero que tienes
delante es el que está desplegado.

### Secrets

Nunca en el frontend. Se configuran con `firebase functions:secrets:set`.

⚠️ **Poner el secret no basta: hay que DECLARARLO en la function que lo usa.**
Un secret que existe en Secret Manager pero no aparece en el `secrets: [...]` de
su callable **no se monta en el runtime**, así que `process.env.EL_SECRET` sale
`undefined` y el código se va por la rama del «no está configurado». Es
silencioso desde fuera: el secret está puesto, el despliegue va bien, y la
función responde que falta configuración.

El patrón correcto son tres piezas, y las tres hacen falta:

```ts
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');       // 1. declarar

export const x = functions.https.onCall(
  { secrets: [RESEND_API_KEY] },                             // 2. montar
  async (request) => {
    const apiKey = RESEND_API_KEY.value();                   // 3. leer DENTRO
```

El paso 3 no es estilo: leer en el módulo (`const K = process.env.K`) se evalúa
antes de que el runtime resuelva los secrets (F-12).

⚠️ **Declarar un secret que no existe rompe el despliegue.** Si se añade a
`secrets: [...]`, tiene que existir **en los dos proyectos** o el deploy del que
falte se cae. Comprobar existencia sin imprimir el valor:

```bash
firebase functions:secrets:access NOMBRE --project prod >/dev/null 2>&1; echo $?   # 0 = existe
```

Inventario real (verificado el 29 de agosto de 2026; `RESEND_API_KEY` en
producción, el 5 de septiembre — antes no estaba y se puso después, así que
**comprueba antes de dar por buena una fila de esta tabla**):

| Variable | dev | prod | Declarada | Qué pasa si falta |
|---|---|---|---|---|
| `RESEND_API_KEY` | sí | sí | sí | `sendSignedContractEmail` no envía |
| `REDSYS_SECRET_KEY` | sí | sí | sí | — |
| `REDSYS_MERCHANT_CODE` / `_TERMINAL` / `_ENVIRONMENT` | sí | **no** | **no** | `createRedsysPaymentLink` dice «Redsys no está configurado» |
| `VELTO_PUBLIC_BASE_URL` | sí | **no** | **no** | enlaces de firma y cortos al dominio por defecto |
| `CONTRACT_LINK_EXPIRY_DAYS` | sí | **no** | **no** | caducidad por defecto (7 días) |
| `VELTO_COMPANY_*` | no | no | **no** | valores por defecto del código; `_EMAIL` se movió a `.env.<proyecto>` |
| `VELTO_SIGNING_CERT` | — | — | sí | el contrato **no se sella**: sale sin firma digital |
| `VELTO_SIGNING_CERT_PASSWORD` | — | — | sí | igual que el anterior |

⚠️ **El certificado de firma sí es material criptográfico.** `VELTO_SIGNING_CERT`
es el `.p12` de la FNMT **en base64** —Secret Manager guarda texto, no binario—
y su contraseña va aparte. Nunca al repositorio ni a un `.env`:

```bash
base64 -w0 certificado.p12 > cert.b64
firebase functions:secrets:set VELTO_SIGNING_CERT --project dev --data-file cert.b64
firebase functions:secrets:set VELTO_SIGNING_CERT_PASSWORD --project dev
rm cert.b64
```

Si no están puestos, `signContract` guarda el PDF **sin sellar** y el documento
**no imprime** la línea «Firmado digitalmente con certificado digital». Es
deliberado: el contrato no puede prometer una firma que no lleva.

`RESEND_FROM_EMAIL` **ya no existe**: el remitente es `companyConfig().email`, el
mismo que va impreso en los documentos. Un correo de empresa no es un secreto, y
tener dos sitios donde vivía la misma dirección solo servía para que divergieran.

Los `VELTO_COMPANY_*` nunca se llegaron a poner en ningún entorno, así que los
PDF salen con los valores por defecto de `company-config.ts`. Hoy son los
correctos; ojo con dar por hecho que un secret manda cuando quizá no está.

## Colecciones de Firestore

```
authorizedUsers  clients  contracts  contractSigningTokens  expenses
payments  reservations  settings  vehicles  inspections  vehicleMaintenance
collaborators  collaboratorSales  collaboratorInvoices  reminders
invoices  invoiceCounters  billingProfiles  verifactuDeclarations
verifactuSubmissions
```

⚠️ **`verifactuSubmissions` es la única de la facturación que se escribe muchas
veces**, y por eso está separada: la factura es inmutable y el estado de su
envío a la AEAT cambia con cada intento. Solo la escribe el backend —
`firestore.rules` deniega `create`, `update` y `delete` a todo el mundo—, porque
marcar una factura como aceptada a mano diría que está presentada ante la
Agencia cuando no lo está.

⚠️ **En `authorizedUsers` el id del documento ES el email en minúsculas**, y
`data()` **no lo incluye**. Quien lea uno tiene que añadirlo (`{ ...data, email:
snap.id }`) o se queda con un `email` vacío: es lo que hizo que la pantalla de
Ajustes dejara de reconocer al usuario en sesión y le ofreciera quitarse el
acceso a sí mismo (M-41). Mismo despiste que M-29 con `contract.id`.

⚠️ **Las dos bases de datos se vaciaron el 4 de septiembre de 2026**, por decisión de
Dorel, para empezar de cero: todas las colecciones **menos `authorizedUsers`**, en
desarrollo y en producción. Esa se salva siempre y no es un detalle: es donde vive la
autorización de acceso, y borrarla deja a todo el mundo fuera de la aplicación sin forma
de entrar a arreglarlo desde la propia app.

⚠️ **Y desarrollo se volvió a vaciar el 12 de septiembre de 2026**, esta vez
**solo `velto-store`** —producción no se tocó—, para empezar de cero con coches
de colaborador desde el principio. Otra vez todo menos `authorizedUsers`, que
conserva sus dos documentos: `veltorent@gmail.com` (admin) y `dbindea@gmail.com`
(employee, la cuenta con la que se prueban las reglas). Es lo que permitió hacer
`CollaboratorSale.kind` obligatorio: sin apuntes antiguos, no hay nada a lo que
dar compatibilidad.

⚠️ **Y producción se vació el 17 de septiembre de 2026**, por decisión de Dorel y
antes de empezar con datos reales. Tenía siete colecciones con datos —`clients`,
`contracts`, `contractSigningTokens`, `inspections`, `payments`, `reservations` y
`vehicles`— y quedó **solo `authorizedUsers`**, con su único documento
(`veltorent@gmail.com`, admin). Nunca llegó a haber `invoices` allí, que es lo
que hacía este borrado posible: una factura emitida no se borra ni se edita, así
que después del 1 de enero **esto ya no se podrá hacer**.

⚠️ **Esta vez sí se vació también Storage**, que es la mitad que se olvidó en los
borrados anteriores: siete ficheros —el contrato original y el firmado, la firma
manuscrita, un parte de inspección, un presupuesto y las dos fotos de un
vehículo—, versiones incluidas. Firestore y Storage son dos servicios distintos y
el CLI de Firebase no borra el segundo; se hizo con
`gcloud storage rm --recursive`, que sí se lleva las generaciones del versionado.
Dejar los ficheros habría sido dejar el DNI, el carné y la firma de una persona
con su token de descarga vivo y sin ninguna ficha que los nombrara.

Así que hoy están **todas vacías**, y las colecciones de arriba son las que el código
crea, no las que existen ahora mismo. `expenses` estuvo declarada en `firestore.rules`
desde el principio sin que nada la usara; desde el 4 de septiembre de 2026 la escribe el
módulo de Gastos.

⚠️ **Vaciar Firestore no vacía Storage.** Los PDF, las firmas y las fotos siguen ahí,
huérfanos y con su token de descarga vivo. Se limpian aparte, desde la consola de Firebase
o con el admin SDK; el CLI no tiene comando para ello.

## Índices de Firestore

`firestore.indexes.json` declara un índice compuesto por cada consulta que combina
`where('x','==')` con un `orderBy` de otro campo:

- `reservations`: `clientId + pickupDateTime desc` · `vehicleId + pickupDateTime desc`
- `payments`: `reservationId + createdAt asc` · `clientId + createdAt desc` · `vehicleId + createdAt desc`
- `inspections`: `reservationId + createdAt asc`
- `vehicleMaintenance`: `status + nextDueDate asc`
- `expenses`: `scope + date desc` · `vehicleId + date desc` · `reservationId + date desc`

⚠️ **Un `orderBy` deja fuera a quien no tenga ese campo.** Firestore excluye del
resultado los documentos que no lo llevan, sin avisar. `getMaintenanceByVehicle` ordenaba
por `nextDueDate` y **una reparación ya hecha sin próxima revisión programada
desaparecía de la ficha del coche** aunque estuviera guardada (M-40, 4 de septiembre de
2026). Cuando el campo por el que se ordena es opcional, se ordena en memoria.

Sin ellos la consulta **falla en tiempo de ejecución** la primera vez que se usa. Desplegar
con `firebase deploy --only firestore:indexes`.

⚠️ **El campo se declara con `order`, no con `arrayConfig`.** El fichero llevaba
`"arrayConfig": "CONTAINS"` en `clientId`, `vehicleId` y `status`, que es el índice de
`array-contains` — otra consulta distinta. Es decir: los índices declarados no servían a
ninguna de las consultas de la app, y las que funcionaban en producción lo hacían gracias a
índices creados a mano desde el enlace del error en consola, que no estaban en el repo.
Corregido el 28 de agosto de 2026, junto con el índice que faltaba de `inspections`.

## Estilo de código

- Standalone components, `skipTests: true` en los schematics
- Prettier: comillas simples, ancho 100, parser `angular` para HTML (config en `package.json`)
- SCSS; variables CSS para tema (`--bg-card`, `--text-primary`, `--border-color`, `--text-muted`)
- Servicios Firestore por feature en `features/<x>/services/`

### Controles nativos (`select`, fechas)

⚠️ **El calendario de un `input[type=date]` lo pinta el sistema operativo, no el CSS.**
Ninguna regla lo alcanza; el único mecanismo es **`color-scheme`**, declarado en `:root`
(claro) y `.dark` (oscuro) en `styles.scss`.

Con los `<select>` **eso dejó de ser cierto el 7 de septiembre de 2026**. Chrome 135+ trae
el *customizable select*: con `appearance: base-select` la lista sale del sistema y entra
en la página como `::picker(select)`, así que las `option` se estilizan como cualquier otro
elemento. Vive dentro de un `@supports` — donde no exista, el desplegable sigue siendo el
del sistema y legible gracias a `color-scheme`.

⚠️ **En móvil el desplegable del sistema es lo que se quiere.** El selector nativo de iOS
y Android —hoja a pantalla completa— es mejor que cualquier lista propia, y esta es una app
de móvil: se mejora el escritorio sin tocar el caso principal. Y el control **cerrado** no
cambia — el `::picker-icon` del navegador se esconde y se mantiene el chevron de siempre.

Tiene que ir en la clase del tema, **no** en el `<meta name="color-scheme">` de `index.html`:
el meta solo declara qué esquemas soportamos y luego sigue al sistema operativo, así que un
usuario con Windows en claro y la app en oscuro seguía viendo desplegables blancos. Era la
causa de que los selects parecieran «en bruto».

Lo que sí es nuestro —el control cerrado— se estiliza **globalmente** en `styles.scss`:
`appearance: none` + chevron SVG propio, y el icono del calendario invertido en tema oscuro.
Global a propósito: son 30 `select` y 9 campos de fecha repartidos por 13 componentes.

### Un botón que no hace nada es un fallo

⚠️ **Los botones de guardar NO se deshabilitan por datos que falten.** Solo se apagan
mientras guardan. Al pulsarlos con algo incompleto se marca el campo, se explica debajo y
—en los formularios largos— se resume junto al botón. Un botón apagado sin explicación
deja al operador pulsando sin que pase nada, que es literalmente lo que pasaba.

Las tres piezas, y las tres hacen falta:

1. **`validateX()` devuelve `FieldProblems`** —campo → clave de i18n— en
   [form-problems.util.ts](src/app/shared/utils/form-problems.util.ts). **Una sola función
   por formulario**: la misma que pinta la pantalla la llama el servicio antes de escribir.
   Dos acabarían discrepando, y entonces la pantalla deja guardar algo que el servicio
   rechaza.
2. **`<app-form-error>`** pinta el mensaje, bajo el campo o como resumen (`[summary]`).
   No decide nada: solo enseña lo que le dan.
3. **`submitted`** en el componente. Nada se marca en rojo hasta el primer intento: señalar
   un campo que el operador aún no ha tenido ocasión de rellenar es regañarle por no haber
   terminado de escribir.

El orden de las comprobaciones dentro de `validateX()` es el de los campos en la pantalla,
para que el resumen se lea de arriba abajo igual que el formulario.

⚠️ **El resumen solo en formularios largos.** En uno de tres campos con el botón al lado
repite el mensaje que ya está bajo el campo y es ruido. Va donde el campo en rojo puede
quedar fuera de la pantalla: vehículo (29 campos), cliente, inspecciones.

⚠️ **Los obligatorios llevan `class="required"` en la etiqueta**, nunca un `*` escrito a
mano. Si la etiqueta **envuelve** al campo, la clase va en el `<span>` del texto: sobre el
`<label>` el asterisco saldría debajo del input.

⚠️ **Y un botón apagado tiene que parecerlo** (M-46). El estilo global vive en
`styles.scss` y **lista las clases de botón una a una**: con la encapsulación de Angular
la regla del componente es `.btn-primary[_ngcontent-xxx]` (0,2,0) y un `button:disabled`
(0,1,1) pierde, así que el botón se queda encendido. Anteponer el elemento a la clase sube
a 0,2,1 y gana — igual que `.is-invalid`. Si creas una clase de botón nueva, añádela ahí o
volverá a verse pulsable estando deshabilitada.

### Las casillas de verificación son globales

⚠️ **`.checkbox-item` vive en `styles.scss`, y el control se estiliza por
elemento.** Son veinte casillas en cinco pantallas, y estilarlas una a una es
cómo acabaron con **cuatro nombres de clase** —`.checkbox-item`, `.check-item`,
`.check-inline`, `.checkbox-group`—, tres tamaños y dos radios distintos.

Y con una quinta que **no existía**: el «Lleva localizador GPS» de la ficha de
vehículo llevaba `class=checkbox-label`, que ningún SCSS declaraba, así que
salía como una casilla del sistema operativo al lado de otras con caja. Es el
mismo fallo que `.form-control` —compila, pasa los tests y solo se ve mirando
la pantalla—, y la razón por la que esta sí es global.

Dos variantes, y solo dos: `.multiline` alinea con la primera línea cuando el
texto es un párrafo, y `.plain` quita la caja para las casillas sueltas dentro
de una barra de acciones.

### Cada pantalla empieza por arriba

⚠️ **Angular conserva el scroll al navegar si no se le dice lo contrario.** En
un móvil eso significa abrir la entrega del coche a media página. Lo arregla
`withInMemoryScrolling({ scrollPositionRestoration: 'top' })` en
`app.config.ts`: una línea para toda la aplicación, y por eso no se había visto
— no hay ningún componente al que culpar.

Funciona porque **el scroll vive en el documento**. El día que el contenido se
meta en un contenedor con `overflow-y: auto`, el router deja de alcanzarlo y
hay que subir ese contenedor a mano.

### No perder el formulario al abrir la cámara

⚠️ **Android puede matar la pestaña mientras la cámara está abierta**, que es
lo más caro que abre un móvil. Al volver, el navegador recarga: Angular arranca
de cero y lo que el operador llevaba escrito ya no existe. No se puede impedir,
así que `FormDraftService` lo **sobrevive**: guarda el formulario cuando la
página pasa a segundo plano (`visibilitychange` + `pagehide`) y lo restaura al
volver.

Tres reglas:

- **`sessionStorage`, no `localStorage`.** El borrador muere con la pestaña: son
  datos de un cliente y no tienen por qué quedarse en el disco del móvil.
- **La clave lleva el sujeto dentro** (`pickup:<reservaId>`). Sin él, entrar en
  otra reserva restauraría datos ajenos.
- **Se limpia al guardar.** Un borrador que sobrevive a su guardado resucita un
  formulario ya archivado.

⚠️ El `DestroyRef` **se le pasa como parámetro**: `attach()` se llama desde
métodos `async`, que ya están fuera del contexto de inyección, y un `inject()`
ahí revienta en tiempo de ejecución.

Conectado en entrega, devolución y mantenimiento — los tres que abren la cámara.

### Cuando algo falla: `NotificationService`, nunca `alert()`

⚠️ **No queda ni un `alert()` ni un `confirm()` en la aplicación, y no debe volver
ninguno** (M-43, y los `confirm()` el 8 de septiembre de 2026). Los fallos de una llamada
—no la validación de campos, que es lo de arriba— se cuentan con
`notifications.error('clave.i18n')`, y salen en la pila de avisos de abajo a la derecha
que monta `<app-notifications>` en el **componente raíz**, para que las pantallas públicas
se comporten igual.

Y las preguntas de sí o no van por `ConfirmService.ask()`, que pinta
`<app-confirm-dialog>` en ese mismo componente raíz. **Los `confirm()` sobrevivieron a la
retirada de los `alert()`** —eran once— y tenían los tres defectos de siempre: los pinta el
navegador con «store.veltorent.com dice» encima, sus botones salen en el idioma del sistema
operativo aunque la pregunta esté en español, y **cuatro estaban escritos en español duro**
(«¿Eliminar esta foto?», «¿Cancelar este pago?»). El diálogo propio bloquea igual —fondo
que no deja pasar el clic, `Escape` cancela, foco en el botón que confirma— y además
distingue lo irreversible con `danger: true`, que borrar una foto y avisar de un dato que
falta no son la misma pregunta.

Cuatro reglas, todas con su motivo:

- **Un error no se retira solo**; los de éxito sí. Un error que se desvanece a los cinco
  segundos es uno que el operador se pierde, y entonces cree que la acción salió bien.
- **El mismo fallo no se apila**: tres clics en un botón roto darían tres avisos idénticos.
- **`retry` solo donde se pueda reintentar de verdad.** Un fallo de red, sí; «no hay
  importe que retener», no — ahí no ha fallado nada, falta un dato.
- **Siempre una clave i18n**, nunca texto literal. La mitad de los `alert()` estaban en
  español duro y un operador rumano leía castellano justo en el peor momento.

⚠️ **Un `catch` que solo hace `console.error` es peor que un `alert()`.** Retener y
devolver fianza lo hacían: si fallaba, el operador pulsaba, la fianza no se movía y la
pantalla no decía nada. Si una acción puede fallar, tiene que contarlo.

⚠️ **Firestore no rechaza por falta de red**: el SDK es offline-first y **encola** la
escritura, así que el `catch` ni se ejecuta y sale sola al volver la conexión. En lectura
pasa lo mismo por otro motivo: **sirve de su caché local**, así que una pantalla entera
puede cargar con todo el tráfico cortado. Para probar un camino de error hace falta algo
que rechace de verdad —un callable, un permiso denegado—; desenchufar la red no vale. Y
cortarla del todo tumba la sesión, porque el guard lee `authorizedUsers` de Firestore.

### `.form-control` NO es global — y `.btn-*` lo es solo a medias

⚠️ **La misma trampa, con los botones.** `.btn` traía el relleno y el radio, y
`.btn-primary` solo el color: un botón escrito `class="btn-primary"` en un
componente que no declarase la clase salía **como texto sobre fondo turquesa**,
sin caja ni esquinas. En la aplicación conviven las dos formas —21 con `btn`
delante y 29 sin él— y no hay forma de acordarse de cuál toca.

Desde el 9 de septiembre de 2026 la **forma** también es global, en
`.btn-primary`, `.btn-secondary`, `.btn-danger` y `.btn-ghost`. No pisa a quien
ya la declara: la regla del componente es `.btn-primary[_ngcontent-xxx]` (0,2,0)
y la global es (0,1,0). `.btn-icon` y `.btn-skip-step` quedan fuera a propósito,
porque su geometría no es esa.

Se descubrió con el botón «Emitir declaración» de Ajustes, que llevaba meses así
sin que se notara porque solo aparece cuando falta la declaración.


### `npm run spacing:audit` — la escala de espaciado

⚠️ **El problema no era un margen mal puesto: eran CUARENTA Y UN valores
distintos.** El 14 de septiembre de 2026 la aplicación declaraba 1750
espaciados con 41 valores diferentes —0,35 / 0,4 / 0,45 / 0,55 / 0,6 / 0,65 /
0,85 / 0,9 rem…—, todos casi iguales entre sí y ninguno alineado con el
siguiente. Por eso unas descripciones salían pegadas al campo y otras no, sin
que hubiera un culpable concreto al que ir.

La escala son **múltiplos de 2 px hasta 1 rem y de 4 px por encima**. El guion
lleva a la escala lo que se salga y **falla con código 1** si queda algo fuera.

⚠️ **`--fix` no mueve nada más de 2 px.** Sin ese tope, unificar deja de ser
alinear y pasa a ser recomponer: un `margin-left: 260px` que empareja con el
ancho de la barra lateral tiene su valor de escala más cercano en 96 px, y
llevarlo ahí mete el contenido debajo del menú. Lo que se pasa del tope se
**informa** para mirarlo a mano, y lo revisado va a `ACEPTADAS` con su motivo.

⚠️ **Y el ritmo vertical de los formularios es global** (`styles.scss`). Un
`.form-group` hijo directo de `.form-section` no estaba en ninguna `.form-row`,
así que se quedaba **sin margen ninguno**: es lo que hacía que la descripción de
un vehículo y la casilla de debajo se tocaran. Igual que con `.btn-primary`, no
pisa a quien ya lo declara.

### `npm run css:audit` — la clase que nadie declara

⚠️ **Es el fallo que más se repite aquí**, y siempre igual: compila, los tests
pasan, el despliegue va bien, y lo único que falla es lo que ve el operador. Ha
pasado con `.form-control`, con `.btn-primary`, con `.checkbox-label` y con las
cuatro clases de la tarjeta de mantenimiento del panel.

El guion busca clases usadas en una plantilla que **no declara nadie**, y separa
lo **roto** —ninguna clase del elemento tiene estilo— del **ruido** —hay otra
que sí, y esta solo nombra—. Hoy sale en cero. Lo revisado está anotado en
`ACEPTADAS`, dentro del propio script, con su motivo; si añades una clase que
solo nombra, va ahí, y si una empieza a tener que pintar algo, se saca.

⚠️ **Y el desbordamiento horizontal se mide, no se mira.** Recorrer las rutas a
390 px comprobando `scrollWidth > clientWidth` encontró que Facturas desbordaba
—dos declaraciones de `.invoice-row`, la segunda pisando a la primera y con ella
el media query de móvil—. Ninguna otra pantalla lo hacía.

⚠️ **Los textos de ayuda y los estados son globales desde el 12 de septiembre de
2026.** Había **once nombres** para lo mismo (`hint`, `field-hint`,
`section-hint`, `total-hint`…) en 44 sitios, y `.loading-state` usado 25 veces y
declarado 20: donde faltaba, la ayuda salía del tamaño del dato y el error **no
salía en rojo**. Los genéricos —`.hint`, `.field-hint`, `.section-hint`,
`.loading-state`, `.empty-state`, `.error-msg`— viven en `styles.scss` y **no
pisan** a quien ya los declara (0,1,0 contra 0,2,0). Los específicos se quedan
donde están.

⚠️ **`.form-control` ES global desde el 15 de septiembre de 2026.** Hasta
entonces la declaraba cada formulario —dieciocho copias— y esta misma sección
decía que así debía seguir. Eso dejaba «acordarse» como único mecanismo, y falló
por **cuarta vez** con la tarjeta de devolución: sus `input` salieron **sin caja
ni borde**, como texto suelto sobre el fondo, en una pantalla que mueve dinero.
Es la misma corrección que ya se hizo con `.btn-*` y `.checkbox-item`.

⚠️ **Y `css:audit` no lo cazaba, que es lo que lo hacía invisible.** Daba
`.form-control` por global porque `styles.scss` declara
`input.form-control.is-invalid`, que solo pinta el **estado de error** y no la
caja: una clase «declarada» que no dibuja nada es un falso negativo. Ahora la
caja está ahí de verdad, así que lo que afirma el auditor es cierto. Las
dieciocho declaraciones siguen mandando sobre lo suyo por especificidad —la del
componente lleva el atributo de encapsulación—; lo que cambia es que un
formulario nuevo ya no sale desnudo.

### `npm run rows:audit` — el formulario en escalera

⚠️ **Es la cuarta auditoría, y nace de una lista enumerada a mano que se quedó
corta.** `styles.scss` le da a cada `.form-group` un `margin-top: 1rem` para
separarlo del hermano de arriba, y esa regla **no sabe en qué dirección coloca
el contenedor**: dentro de una rejilla horizontal el margen se lo come la
columna derecha, que baja 16 px y deja la fila torcida. La corrección —anular el
margen dentro de los contenedores horizontales— traía **cinco** nombres de clase
escritos a mano, y faltaban **cuatro**: `.form-grid-inner`, `.checklist`,
`.driver-form-grid` y `.line-regime`.

El que se vio fue el primero, el 18 de septiembre de 2026: en «Estado del
vehículo» de las inspecciones, «Nivel de combustible» salía 16 px por debajo de
«Kilometraje». Lo encontró Dorel mirando la pantalla — que es exactamente lo que
la nota anterior daba por suficiente («se encuentra volviendo a medir, no
leyendo plantillas»).

El guion recorre las plantillas con un **analizador de etiquetas**, no con una
expresión regular: eso es lo que permite saber quién es el padre de cada campo,
y es la parte que se daba por imposible. De cada contenedor con dos o más campos
mira el `display` en el SCSS —`grid` coloca en horizontal, y `flex` también
salvo que declare `flex-direction: column`— y **falla con código 1** si alguno no
está exceptuado. La lista la lee del propio `styles.scss`: copiarla aquí sería
una segunda fuente de verdad.

⚠️ **Y comprueba que cada exceptuado declara `gap`.** Es la condición que hace
seguro quitar el margen: sin `gap`, al bajar de línea en móvil las filas se
tocarían.

⚠️ **Lo que no puede saber:** un contenedor cuyo `display` venga de otro sitio
—una clase heredada, un estilo en línea—. Para eso sigue valiendo mirar la
pantalla y medir con `getComputedStyle()`.

### Tema y color

**Todas las variables de color viven en `src/styles.scss`**, con dos bloques: `:root`
(claro) y `.dark`. Ahí están tanto las de superficie (`--bg-card`, `--text-primary`,
`--border-color`, `--bg-input`) como las semánticas: `--success-*`, `--warning-*`,
`--error-*`, `--info-*`, `--danger-color`.

⚠️ Un `var(--x)` sin declarar **no falla, desaparece**: el navegador descarta la
declaración entera. Las once semánticas se usaron durante meses sin existir y los badges
de estado salían sin fondo. Si añades una variable nueva, decláralas en los dos bloques.

⚠️ **Un campo de formulario se delimita con su BORDE, no con su relleno**, y ese
borde tiene su propia variable: `--border-input`. WCAG 1.4.11 pide **3:1** para
el contorno de un control, y un relleno 3:1 más claro que una tarjeta casi negra
sería gris medio — el formulario dejaría de parecer lo que es. `--border-color`
es el de las separaciones y sí puede ser sutil; son dos cosas distintas.

⚠️ **`.form-control` pintaba el relleno con `--bg-main`, el color de la
PÁGINA.** En el tema claro no se notaba —la página es gris y el campo blanco—,
pero en los **tres** temas oscuros `--bg-input` valía además exactamente lo mismo
que `--bg-main`: el campo y el fondo eran el mismo color, **1,00:1**, y lo único
que lo delimitaba era un borde a 1,33:1. En el tema casi negro eso lo dejaba
inutilizable, y lo encontró Dorel usándolo, no ninguna auditoría.

⚠️ **Y un fondo `var(--bg-card)` dentro de una tarjeta es igual de invisible**,
en todos los temas — en el claro es blanco sobre blanco. Varias de las dieciocho
copias encapsuladas de `.form-control` lo hacían.

### La aritmética de la especificidad, que es donde se falla

⚠️ **`input.form-control` NO gana a `.form-control[_ngcontent-xxx]`.** Es el
error que cuesta una iteración entera, y lo cometí:

| Selector | Cuenta | Especificidad |
|---|---|---|
| `.form-control` (global) | 1 clase | (0,1,0) |
| `.form-control[_ngcontent-xxx]` (componente) | 1 clase + 1 atributo | **(0,2,0)** |
| `input.form-control` | 1 elemento + 1 clase | (0,1,1) — **pierde** |
| `input.form-control.is-invalid` | 1 elemento + 2 clases | (0,2,1) — gana |
| `button.btn-primary:disabled` | 1 elemento + 1 clase + 1 pseudoclase | (0,2,1) — gana |

La regla en una línea: **la encapsulación de Angular vale una clase**, así que
para ganarle a una copia de componente hacen falta **dos** clases (o una clase y
una pseudoclase) más el elemento. Anteponer solo el elemento no basta, aunque lo
parezca. Cuando no hay una segunda clase real, repetirla —
`input.form-control.form-control`— es la forma legítima de llegar a (0,2,1).

⚠️ **Y se comprueba en el navegador, no se deduce.** Las dos veces que esto ha
fallado, el CSS estaba escrito y desplegado y el valor calculado seguía siendo el
viejo. `getComputedStyle()` es la única respuesta que vale.

⚠️ **Cuando un color de marca es el FONDO, su acompañante también es variable.**
`--warning-on` existe porque el ámbar cambia de tema —#9A6700 en claro, #F0B429
en oscuro— y cada uno pide lo contrario: blanco el primero (4,87:1), negro el
segundo (9,85:1). Estuvo escrito a mano con un `:root .btn-warning` y un
`.dark .btn-warning` corrigiéndolo, y **no funcionaba**: los dos correctores
miden (0,2,0), igual que el `.btn-warning[_ngcontent-xxx]` de un componente que
declare su propia copia, y en un empate manda el orden — que pone al componente
detrás. «Cancelar reserva» salía a **3,77:1** en tema claro. Con la variable, el
valor lo pone el bloque del tema y hasta una copia encapsulada sale bien.

El tema real de uso es el **oscuro**. Contraste mínimo 4,5:1 sobre `--bg-card` (#14181A).

**Los valores salen del Velto Design System**, el kit de la web pública, guardado en
[docs/design/](docs/design/) — el CSS extraído son 7,8 KB y es lo único que hay que leer.
Los neutrales son **grises fríos con tinte teal** (`--gray-950` … `--gray-50`), no la rampa
`slate` de Tailwind que había antes: sobre un azul marino el verde de marca flotaba.

⚠️ **Las rampas (`--gray-*`, `--teal-*`) no se usan directamente.** Están para que los
bloques de tema las mapeen a los nombres semánticos. Un componente que pinte con
`--gray-700` se salta el tema y no cambiará al alternar claro y oscuro.

⚠️ **'Inter' no existe en este proyecto.** Se pedía como fuente de cuerpo en tres sitios
sin cargarla en ninguno —ni `@font-face` ni Google Fonts—, así que el cuerpo llevaba años
componiéndose en la fuente del sistema mientras el CSS decía otra cosa. El cuerpo es la
fuente del sistema **a propósito**: Gotham es de titular, y aquí el cuerpo son listados a
13-14 px. La marca la ponen los titulares y el color.

### Mobile-first en la práctica

Es una app de móvil, y la regla es **recolocar, nunca ocultar**: un `display: none` dentro
de una media query que se lleve por delante un importe, un estado o una fecha es un fallo,
no una adaptación. Para eso están las áreas de rejilla.

Dos trampas de CSS que ya han roto esta app entera:

- **`min-width: 0` en los flex items que contienen texto.** El valor por defecto es `auto`,
  que impide encoger por debajo del contenido. Sin él en `.main-wrapper`, cualquier
  elemento ancho estiraba toda la aplicación y las pantallas se veían tamaño escritorio.
- **`minmax(0, 1fr)` en vez de `1fr`** en rejillas cuyas celdas llevan texto sin partir.
  Es lo que hacía que el calendario midiera 1200 px.

Prosa larga (emails, matrículas, referencias): parte en dos líneas antes que truncar con
puntos suspensivos o forzar scroll horizontal. `body` ya lleva `overflow-wrap: break-word`
y las clases `.email` / `.mono` usan `anywhere`.

## Continuidad: copias, emergencia y una sola cuenta

Dos documentos que no son de código y que conviene conocer antes de tocar nada
que afecte a producción:

- [docs/copias-de-seguridad.md](docs/copias-de-seguridad.md) — qué está
  protegido y cómo se restaura. Copias diarias y semanales, PITR, protección
  contra borrado y versionado de Storage están **activados en los dos
  proyectos** desde el 11 de septiembre de 2026.
- [docs/emergencia.md](docs/emergencia.md) — el sobre: cómo seguir alquilando
  sin la aplicación, qué parar y a quién llamar.

⚠️ **Restaurar un estado anterior reintroduce números y huellas ya consumidos.**
Si se restaura la copia del día 15 el día 20, las facturas de esos días
desaparecen de Firestore pero **existen**: el cliente tiene su PDF y la AEAT su
registro con su CSV. El contador vuelve atrás y la siguiente factura reutiliza un
número ya emitido. Ante una pérdida de datos con facturas emitidas, lo primero es
**parar la emisión**, no restaurar.

⚠️ **`veltorent@gmail.com` es el único propietario de los dos proyectos y el
único usuario de la aplicación.** Si esa cuenta se pierde no hay forma de entrar,
restaurar ni desplegar. Está anotado como la primera acción pendiente del sobre;
mientras siga así, cualquier plan de recuperación depende de una sola persona.

⚠️ **En producción, nunca `--only functions` a secas.** Hay 19 desplegadas y el
código define 26: las siete que faltan escriben facturas o hablan con la AEAT, y
no están allí hasta el 1 de enero. Un despliegue completo las subiría.

## Deuda técnica conocida

- **Redsys funciona de extremo a extremo** desde el 31 de agosto de 2026: probado contra la
  pasarela de test y **con dinero real en producción** (10 €, código de autorización
  379521). El webhook recibe, valida la firma y escribe el resultado. Comercio `361040215`,
  terminal `1`, `test` en dev y **`live`** en producción.
  ⚠️ Ese cobro se hizo desde **el botón del operador**. La pantalla pública del móvil
  llegó después y perdió un cobro real el 4 de septiembre (F-32): arreglado el mismo día,
  pero **todavía no hay un pago por esa vía que se haya registrado solo**. Una vía de
  cobro no está probada hasta que alguien paga por ella y la aplicación se entera sin
  ayuda.
- **Los cargos extra que la fianza no cubre quedan pendientes**, no cobrados. Antes nacían
  `paid` sin cobrarse y el exceso desaparecía (M-33). El reparto vive en
  `distributeRetentionAcrossCharges`, con tests.
  ⚠️ **`extrasTotal` es lo COBRADO, no lo que el cliente debe.** Pintarlo bajo la etiqueta
  «Cargos extra» ponía «0,00 €» con 145 € pendientes tres líneas más abajo (F-34). Para la
  deuda están `extrasRequired` (devengado) y `extrasPending`. Y **cerrar la reserva no los
  cobra ni los perdona**: `canCloseReservation()` no los mira, así que la pantalla pregunta
  antes con el importe delante.
- ⚠️ **`reservation.paymentSummary` es una COPIA, y las copias se quedan viejas.** La fuente
  de verdad del dinero es la colección `payments`; el resumen guardado en la reserva se
  escribe en ciertos momentos y **no falla cuando está desfasado: responde `0`**. Al añadir
  `extrasRequired`/`extrasPending`, una reserva anterior siguió enseñando «0,00 €» con 145 €
  pendientes. Si una pantalla necesita una cifra fina, que la **derive** con
  `calculateReservationPaymentSummary(payments, reservation)` en vez de leer la copia. Y al
  añadir un campo al resumen, mételo también en la comparación de
  `reconcileAfterExternalPayment()`, o la copia no se pondrá al día nunca: el resto cuadra.
- Sin lint.
- `deploy.log` y `test-contract-{en,es,ro}.pdf` están en `.gitignore` y **ya no están en el
  índice** (comprobado con `git ls-files` el 7 de septiembre de 2026). La trampa que los
  puso aquí sigue siendo cierta para el siguiente: ignorar un fichero no deja de seguir uno
  ya seguido, hace falta `git rm --cached`.
- `CREDENTIALS.md` **sí está** en `.gitignore`, junto a `*.p12`, `*.pfx`, `*.key` y
  `cert.b64`.
- ⚠️ **Dos operadores pueden reservar el mismo coche.** La disponibilidad se consulta y se
  escribe después, y entre medias cabe otra reserva. **No se puede cerrar desde el
  cliente**: el SDK web no permite consultas dentro de una transacción, solo lecturas por
  id. Haría falta una Cloud Function, donde el admin SDK sí admite `transaction.get(query)`.
  Mitigado comprobando otra vez a ras del `commit` — la ventana pasa de ~1 s a milisegundos.
