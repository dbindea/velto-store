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

### Los datos todavía se pueden borrar — NO escribas parches de compatibilidad

⚠️ **Vigente desde el 29 de agosto de 2026 y hasta que Dorel diga lo contrario.**
Aunque `rentalcar-veltomobility` sea el entorno de producción, sus datos **aún
son desechables**: se pueden borrar colecciones, cambiar índices, renombrar
campos y cambiar la forma de un documento sin migración.

Por tanto, y esto es lo importante:

- **No se escribe código para leer datos viejos.** Nada de `campo ?? valorAntiguo`,
  ni ramas «si no tiene X, entonces era el formato anterior», ni banderas
  congeladas por documento. Eso fue `tariffIncludesVat`, y costó más quitarlo
  que ponerlo.
- Si una forma tiene que cambiar: se cambia, se borran los datos y se vuelven a
  crear. Es más barato y deja el código limpio.
- Todo se prueba antes en `velto-store`.

Cuando Dorel avise de que los datos ya son reales, esta sección se sustituye por
la regla contraria: campos solo aditivos, migración en despliegues separados y
nunca renombrar en sitio.

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
└── documents/                        # presupuesto y justificante de reserva
                                      # (documents-pdf, storage, los 2 callables)
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
firmado» del workflow.

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

### Otros utils

- `payment-summary.util.ts` — resumen financiero, derivado de la colección `payments` (source of truth)
- `expense.util.ts` — el IVA de los gastos, la mezcla con el mantenimiento y los totales
- `reservation-date.util.ts`, `acriss-code.util.ts`

### Reglas de dominio

- Los **cargos extra solo nacen desde la inspección de devolución**. Un solo sistema, sin doble fuente. Todavía **no llevan desglose de IVA**: el contrato se genera antes de que existan.
- **Un gasto de mantenimiento se registra en `vehicleMaintenance`, no en `expenses`.** El
  módulo de Gastos **lee** su coste y lo suma; escribirlo en los dos sitios daría dos
  fuentes de verdad para el mismo euro. Es la misma regla que hace de `payments` la única
  fuente del dinero que entra.
  ⚠️ Su coste **no tiene desglose de IVA** —se teclea como un importe suelto, sin tipo— y
  por eso en Gastos el bruto no es la suma de bases más impuestos. La pantalla lo dice
  («IVA soportado · sobre 1/3»); igualar los tres números sería inventarse ese IVA.
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

También desplegadas: `generateQuotePdf`, `generateBookingConfirmationPdf`, `documentLink`
(pública), `getPaymentCheckout` (**pública**, el cliente paga desde su móvil) y
`getContractVerification` (**pública**, el QR del contrato en papel).

Son **trece functions, y las trece están vivas en los dos proyectos** (verificado el 4 de
septiembre de 2026). `documentLink` estuvo un tiempo escrita sin desplegar; ojo con que
desplegarla no basta: el rewrite `/d/**` viaja con el **hosting** y necesita su propio
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
```

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

### `.form-control` NO es global

⚠️ Cada formulario **declara su propia `.form-control`** en su SCSS. No está en
`styles.scss`, aunque lo parezca por lo repetida que está. Si un componente nuevo la usa
sin declararla, sus `input` y `textarea` salen **sin caja ni borde**, como texto suelto
sobre el fondo — mientras los `select` de al lado se ven perfectos, porque a esos sí los
estiliza `styles.scss`. Compila, pasa los tests y solo se ve mirando la pantalla.

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
- `deploy.log` (576 KB) y `test-contract-{en,es,ro}.pdf` (~3,5 MB) están trackeados en git sin necesidad.
- `CREDENTIALS.md` no está en `.gitignore`, aunque sí lo están `*.p12`, `*.pfx`, `*.key` y
  `cert.b64` desde el 4 de septiembre de 2026.
- `client.service.ts` tiene un `TODO`: al borrar cliente no elimina sus documentos de Storage.
  ⚠️ Es el mismo agujero que dejó **ficheros huérfanos en Storage** al vaciar las bases de
  datos el 4 de septiembre de 2026: borrar el documento no se lleva lo que subió.
- `reservation.service.ts` tiene un `TODO`: operaciones que deberían ser transacción Firestore o Cloud Function.
