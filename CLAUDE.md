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
npm start                 # ng serve → http://localhost:4200
npm run build             # build desarrollo
npm run build:prod        # build producción
npm run deploy:hosting    # build + firebase deploy --only hosting
npm run deploy:all        # build + firebase deploy (todo)
npm run firebase:emulators

# i18n (ver sección abajo)
npm run i18n:all          # extract → schema → build → audit

# Cloud Functions
npm --prefix functions run build    # tsc + copia de fuentes TTF
npm --prefix functions run deploy
npm --prefix functions run logs
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
- `functions/src/redsys.spec.ts` — la firma `HMAC_SHA256_V1` contra un vector de referencia congelado

El builder `@angular/build:unit-test` es **experimental** en Angular 20 y avisa por consola al arrancar. `tsconfig.spec.json` usa `vitest/globals`, no jasmine.

⚠️ `functions/tsconfig.json` excluye `**/*.spec.ts` del build. No quites esa exclusión: `firebase deploy` sube todo lo que haya en `lib/`, y el bundle acabaría importando vitest en runtime.

## Lo que NO existe en este proyecto

- **No hay lint.** No hay ESLint configurado ni script `lint`.
- **El CI no despliega Cloud Functions.** Solo hosting. Las functions se despliegan a mano con `npm --prefix functions run deploy` — incluido el fix de Redsys.
- **No hay tests de componentes ni E2E.** Solo utils y lógica pura.

## Ramas y despliegue

- **`develop`** — rama de trabajo. Es donde se commitea.
- **`master`** — rama de producción. **Un push a `master` despliega automáticamente** a Firebase Hosting vía GitHub Actions.
- No existe rama `main`.
- Commits en formato convencional (`feat:` / `fix:` / `docs:` / `refactor:`).

⚠️ Merge a `master` = despliegue a producción. Confirma antes.

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
├── redsys.ts                         # createRedsysPaymentLink + webhook
└── contracts/                        # generateContractPdf, signingLink,
                                      # getContractForSigning, signContract,
                                      # sendSignedContractEmail, clauses, pdf
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

### Otros utils

- `payment-summary.util.ts` — resumen financiero, derivado de la colección `payments` (source of truth)
- `pricing.util.ts`, `reservation-date.util.ts`, `acriss-code.util.ts`

### Reglas de dominio

- Los **cargos extra solo nacen desde la inspección de devolución**. Un solo sistema, sin doble fuente.
- Pagos: 3 acciones en UI — Registrar cobro / Devolver fianza / Retener fianza.
- La autorización de usuarios vive en la colección `authorizedUsers` de Firestore (doc ID = email en minúsculas, `active: true`), **no** en Firebase Console.

## Firestore: `undefined` está prohibido

Firestore lanza `Cannot use 'undefined' as a Firestore value`. Hay dos defensas y conviene conocer ambas:

- **Frontend:** `client.service.ts` tiene un método privado `cleanData<T>()` que limpia recursivamente. Ojo: está duplicado ahí, no es un util compartido.
- **Functions:** `admin-guard.ts` activa `ignoreUndefinedProperties: true` en la instancia de Firestore, y `generateContractPdf.ts` tiene además `stripUndefined()` local.

Al escribir en Firestore desde código nuevo, comprueba cuál de las dos aplica.

## i18n

Tres idiomas: **es** (por defecto), **en**, **ro**. Archivos en `src/assets/i18n/`.

Las claves siguen jerarquía por módulo: `vehicles.*`, `reservations.*`, `payments.*`, `inspections.*`, `contracts.*`, `workflow.*`, `dashboard.*`, `clients.*`, `common.*`.

Las razones de bloqueo del workflow usan prefijo `workflow.*` para que el pipe `translate` las muestre sin lógica extra.

**Al añadir texto visible:** añade la clave a los tres idiomas y ejecuta `npm run i18n:all`. El paso `i18n:audit` detecta claves huérfanas y faltantes.

## Cloud Functions

Desplegadas: `generateContractPdf`, `createContractSigningLink`, `cancelContractSigningLink`, `getContractForSigning` (público), `signContract` (público), `sendSignedContractEmail`, `createRedsysPaymentLink`, `redsysNotificationWebhook` (público).

### Firma de contratos

El cliente firma **sin cuenta**: `/sign-contract/:token`, ruta pública fuera del `authGuard`. El token (256 bits URL-safe) es de un solo uso y caduca (7 días por defecto). Los tokens viven en `contractSigningTokens`, colección con reglas de Firestore que **deniegan todo acceso desde cliente** — solo el admin SDK entra.

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

`firestore.indexes.json` declara índices compuestos necesarios:

- `reservations`: `clientId + pickupDateTime desc`
- `reservations`: `vehicleId + pickupDateTime desc`
- `payments`: `clientId + paidAt desc`
- `vehicleMaintenance`: `vehicleId + nextDueDate desc`
- `vehicleMaintenance`: `status + nextDueDate asc`

Sin ellos, los históricos de `vehicle-detail` y `client-detail` fallan al primer uso. Desplegar con `firebase deploy --only firestore:indexes`.

⚠️ **Falta el índice de `inspections`.** `inspection.service.ts` consulta `reservationId ==` + `orderBy('createdAt')`, que exige índice compuesto y no está declarado. La colección `inspections` está vacía en producción, así que el fallo aún no se ha manifestado — aparecerá en el primer uso real del módulo.

## Estilo de código

- Standalone components, `skipTests: true` en los schematics
- Prettier: comillas simples, ancho 100, parser `angular` para HTML (config en `package.json`)
- SCSS; variables CSS para tema (`--bg-card`, `--text-primary`, `--border-color`, `--text-muted`)
- Servicios Firestore por feature en `features/<x>/services/`

## Deuda técnica conocida

- **Redsys**: la firma, el formato del `Ds_Merchant_Order` y la URL del webhook están corregidos y cubiertos por tests contra un vector de referencia. **Falta la validación end-to-end contra el entorno de test real de Redsys**, que no puede hacerse desde el repo — y las Cloud Functions hay que desplegarlas a mano para que el fix llegue a producción.
- Sin lint.
- `deploy.log` (576 KB) y `test-contract-{en,es,ro}.pdf` (~3,5 MB) están trackeados en git sin necesidad.
- `CREDENTIALS.md` no está en `.gitignore`.
- `client.service.ts` tiene un `TODO`: al borrar cliente no elimina sus documentos de Storage.
- `reservation.service.ts` tiene un `TODO`: operaciones que deberían ser transacción Firestore o Cloud Function.
