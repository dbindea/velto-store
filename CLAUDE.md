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

# Cloud Functions
npm --prefix functions run build      # tsc + copia de fuentes TTF
npm --prefix functions run logs:dev   # o logs:prod
```

**Typecheck sin compilar** (lo más rápido para validar un cambio):

```bash
npx tsc -p tsconfig.app.json --noEmit
cd functions && npx tsc --noEmit
```

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

El builder `@angular/build:unit-test` es **experimental** en Angular 20 y avisa por consola al arrancar. `tsconfig.spec.json` usa `vitest/globals`, no jasmine.

⚠️ `functions/tsconfig.json` excluye `**/*.spec.ts` del build. No quites esa exclusión: `firebase deploy` sube todo lo que haya en `lib/`, y el bundle acabaría importando vitest en runtime.

## Lo que NO existe en este proyecto

- **No hay lint.** No hay ESLint configurado ni script `lint`.
- **El CI no despliega Cloud Functions.** Solo hosting. Van a mano y con destino explícito: `npm run deploy:dev:functions` o `deploy:prod:functions`. Es el punto más frágil de los dos entornos — es fácil arreglar algo en uno y olvidarlo en el otro.
- **No hay tests de componentes ni E2E.** Solo utils y lógica pura.

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

⚠️ **Las dos configuraciones producen bundle optimizado.** La diferencia no es
cuánto optimizan, es a qué proyecto apuntan. `development` (sin `--configuration`
propia en los scripts) es solo para `ng serve`.

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

### Los datos de producción son sagrados

Desde que `rentalcar-veltomobility` tiene datos reales, un cambio de forma ya no se puede
hacer como se hizo con `tariffIncludesVat`, que se borró de un día para otro
porque la base se iba a vaciar. La regla pasa a ser:

- Los campos **solo se añaden**. Nunca se renombra ni se reutiliza uno existente.
- Si una forma tiene que cambiar: escribir el campo nuevo → seguir leyendo el
  viejo → migrar los documentos → quitar la lectura vieja. En despliegues
  separados, no en uno.
- Todo se prueba antes en `velto-store` con datos de `velto-store`.

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
├── contracts/                        # generateContractPdf, signingLink,
│                                     # getContractForSigning, signContract,
│                                     # sendSignedContractEmail, clauses, pdf
└── documents/                        # presupuesto y justificante de reserva
                                      # (documents-pdf, storage, los 2 callables)
```

`expenses` y `settings` son **placeholders**: componentes con template inline que solo muestran `common.moduleInProgress`.

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

> Hubo un `tariffIncludesVat` que congelaba también la **dirección**, porque las reservas
> anteriores al 27 de agosto de 2026 se guardaron con el IVA incluido. Se retiró el 28 de
> agosto, al borrar los datos de producción y empezar de cero: ya no existe ninguna reserva
> inclusiva. Si algún día vuelve a haberlas, el parche está en el historial de git.

La constante y la aritmética están **duplicadas en `functions/src/contracts/pdf.ts`** a
propósito: app y functions compilan con tsconfigs separados y no pueden compartir módulo.
Si cambia el tipo, se cambia en los dos sitios.

⚠️ **Redondea el dinero derivado.** `108.9 - 50` es `58.900000000000006`: el asistente lo
enseñaba tal cual y lo sembraba así en la fila de pago. Todo importe calculado pasa por
`roundMoney()` antes de mostrarse o escribirse.

### Otros utils

- `payment-summary.util.ts` — resumen financiero, derivado de la colección `payments` (source of truth)
- `reservation-date.util.ts`, `acriss-code.util.ts`

### Reglas de dominio

- Los **cargos extra solo nacen desde la inspección de devolución**. Un solo sistema, sin doble fuente. Todavía **no llevan desglose de IVA**: el contrato se genera antes de que existan.
- El **descuento de fidelidad** (`Client.loyaltyDiscountPercent`, máx. 30 %) se asigna a mano y es independiente de `trustLevel`, salvo que bloquear a un cliente se lo retira. Cada cambio se anota en `loyaltyDiscountHistory[]` con autor y fecha.
- Pagos: 3 acciones en UI — Registrar cobro / Devolver fianza / Retener fianza.
- La **fianza es editable y puede ser 0**: a los clientes conocidos no se les cobra. Una fianza a 0 nace `waived` con **motivo obligatorio** (`buildDeposit` en `deposit.util.ts` lanza si falta). No es cosmético: `isDepositSettled()` solo da por resuelta una fianza a 0 **si hay motivo**, así que sin él la reserva no se puede cerrar nunca.
- La autorización de usuarios vive en la colección `authorizedUsers` de Firestore (doc ID = email en minúsculas, `active: true`), **no** en Firebase Console.

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

También desplegadas: `generateQuotePdf` y `generateBookingConfirmationPdf`.

**Escrita pero SIN desplegar:** `documentLink` (pública) — necesita además `firebase deploy --only hosting` porque depende de un rewrite.

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
```

Así el presupuesto sigue siendo tan efímero como era. El id es el secreto, igual que lo era
el token de descarga de Storage. El del presupuesto es aleatorio; el de la reserva es estable
a propósito, para que regenerar el justificante no mate el enlace que el cliente ya tiene.

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

**El login es solo para la agencia.** Las dos rutas de cliente —`sign-contract/:token` y
`d/:id`— van declaradas **antes** del bloque con `authGuard`, así que el router las resuelve
primero y el guard nunca las ve.

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

### Firma de contratos

El cliente firma **sin cuenta**: `/sign-contract/:token`, ruta pública fuera del `authGuard`. El token (256 bits URL-safe) es de un solo uso y caduca (7 días por defecto). Los tokens viven en `contractSigningTokens`, colección con reglas de Firestore que **deniegan todo acceso desde cliente** — solo el admin SDK entra.

### Datos de empresa

`functions/src/company-config.ts` es la única fuente. La razón social se guarda **en
mayúsculas** (`VELTO MOBILITY, S.L.`) en vez de pasarla a mayúsculas al pintar: así ninguna
plantilla se puede olvidar.

⚠️ **Los valores por defecto solo se aplican si el secret correspondiente NO está puesto.**
Si `VELTO_COMPANY_NAME` sigue valiendo «Velto Rent» en producción, el PDF seguirá diciendo
«Velto Rent» por mucho que el código diga otra cosa. Al cambiar datos de empresa hay que
revisar los secrets, no solo el código.

### Secrets

Nunca en el frontend. Se configuran con `firebase functions:secrets:set`:

```
RESEND_API_KEY, RESEND_FROM_EMAIL
REDSYS_SECRET_KEY, REDSYS_MERCHANT_CODE, REDSYS_TERMINAL, REDSYS_ENVIRONMENT
VELTO_COMPANY_NAME / _EMAIL / _PHONE / _ADDRESS
VELTO_PUBLIC_BASE_URL, CONTRACT_LINK_EXPIRY_DAYS
```

## Colecciones de Firestore

Verificadas contra el proyecto `velto-store` en producción:

```
authorizedUsers  clients  contracts  contractSigningTokens
payments  reservations  vehicles
```

No hay colección para `expenses` — coherente con que el módulo sea un placeholder.

## Índices de Firestore

`firestore.indexes.json` declara un índice compuesto por cada consulta que combina
`where('x','==')` con un `orderBy` de otro campo:

- `reservations`: `clientId + pickupDateTime desc` · `vehicleId + pickupDateTime desc`
- `payments`: `reservationId + createdAt asc` · `clientId + createdAt desc` · `vehicleId + createdAt desc`
- `inspections`: `reservationId + createdAt asc`
- `vehicleMaintenance`: `vehicleId + nextDueDate desc` · `status + nextDueDate asc`

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

⚠️ **La lista desplegable de un `<select>` y el calendario de un `input[type=date]` los pinta
el sistema operativo, no el CSS.** Ninguna regla los alcanza. El único mecanismo es
**`color-scheme`**, declarado en `:root` (claro) y `.dark` (oscuro) en `styles.scss`.

Tiene que ir en la clase del tema, **no** en el `<meta name="color-scheme">` de `index.html`:
el meta solo declara qué esquemas soportamos y luego sigue al sistema operativo, así que un
usuario con Windows en claro y la app en oscuro seguía viendo desplegables blancos. Era la
causa de que los selects parecieran «en bruto».

Lo que sí es nuestro —el control cerrado— se estiliza **globalmente** en `styles.scss`:
`appearance: none` + chevron SVG propio, y el icono del calendario invertido en tema oscuro.
Global a propósito: son 30 `select` y 9 campos de fecha repartidos por 13 componentes.

### Tema y color

**Todas las variables de color viven en `src/styles.scss`**, con dos bloques: `:root`
(claro) y `.dark`. Ahí están tanto las de superficie (`--bg-card`, `--text-primary`,
`--border-color`, `--bg-input`) como las semánticas: `--success-*`, `--warning-*`,
`--error-*`, `--info-*`, `--danger-color`.

⚠️ Un `var(--x)` sin declarar **no falla, desaparece**: el navegador descarta la
declaración entera. Las once semánticas se usaron durante meses sin existir y los badges
de estado salían sin fondo. Si añades una variable nueva, decláralas en los dos bloques.

El tema real de uso es el **oscuro**. Contraste mínimo 4,5:1 sobre `--bg-card` (#1e293b).

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

## Deuda técnica conocida

- **Redsys**: la firma, el formato del `Ds_Merchant_Order` y la URL del webhook están corregidos y cubiertos por tests contra un vector de referencia. **Falta la validación end-to-end contra el entorno de test real de Redsys**, que no puede hacerse desde el repo — y las Cloud Functions hay que desplegarlas a mano para que el fix llegue a producción.
- Sin lint.
- `deploy.log` (576 KB) y `test-contract-{en,es,ro}.pdf` (~3,5 MB) están trackeados en git sin necesidad.
- `CREDENTIALS.md` no está en `.gitignore`.
- `client.service.ts` tiene un `TODO`: al borrar cliente no elimina sus documentos de Storage.
- `reservation.service.ts` tiene un `TODO`: operaciones que deberían ser transacción Firestore o Cloud Function.
