# Velto Store - Fleet Management App

Aplicación Angular para gestión de flota de vehículos de alquiler.

## Stack Tecnológico

- **Angular 20** con standalone components
- **TypeScript**
- **Firebase 12** (Auth, Firestore, Storage, Hosting)
- **Tailwind CSS v4**
- **PrimeIcons** - Librería de iconos
- **AngularFire 20**

### Por qué PrimeIcons

Se usa PrimeIcons por ser la librería de iconos más compatible con Angular, mantener coherencia visual con el ecosistema PrimeNG, ofrecer iconos limpios y profesionales, y no requerir configuración adicional compleja.

## Requisitos

- Node.js 18.19+ o 20.x+
- npm 10.x+
- Firebase CLI (`npm install -g firebase-tools`)

## Instalación

```bash
npm install
```

## Configuración de Firebase

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com)

2. Copia la configuración de tu proyecto (Project Settings > Your apps > SDK setup)

3. Actualiza los archivos `src/environments/environment.ts` y `src/environments/environment.development.ts`

4. Habilita los servicios en Firebase Console:
   - **Firestore**: Database > Create database
   - **Authentication**: Authentication > Get started
   - **Storage**: Storage > Get started

## Despliegue en Firebase Hosting

### Configuración actual

El proyecto ya está configurado para desplegar en Firebase Hosting:
- `firebase.json` - Configuración de Hosting, Firestore y Storage
- `.firebaserc` - Apunta al proyecto `velto-store`
- `dist/velto-store/browser` - Carpeta de salida del build Angular

### Desplegar

```bash
# Login en Firebase
firebase login

# Deploy solo hosting (frontend)
npm run deploy:hosting

# Deploy completo (hosting + firestore + storage)
npm run deploy:all

# Deploy desde cero
npm run deploy
```

### Probar localmente con emuladores

```bash
# Solo hosting
npm run serve:hosting

# Todos los servicios
npm run firebase:emulators
```

### Configurar dominio propio

1. Ve a Firebase Console > Hosting
2. Conecta tu dominio personalizado
3. Configura los registros DNS sugeridos
4. Espera la verificación SSL

## Autenticación con Google

### 1. Habilitar Google Auth en Firebase Console

1. Ve a **Authentication** > **Sign-in method**
2. Haz clic en **Google**
3. Habilita el toggle
4. Selecciona un correo de soporte (cualquiera)
5. Guarda

### 2. Agregar usuario autorizado en Firestore

La autorización se gestiona desde Firestore, no desde Firebase Console.

1. Ve a **Firestore Database**
2. Crea una colección: `authorizedUsers`
3. Crea un documento con el **ID igual al email en minúsculas** (ej: `admin@gmail.com`)
4. Agrega los datos:

```json
{
  "email": "admin@gmail.com",
  "active": true,
  "role": "admin",
  "displayName": "Administrador"
}
```

## Internacionalización (i18n)

El proyecto incluye sistema de traducciones para:
- **Español** (por defecto)
- **Română**
- **English**

### Archivos de idioma

```
src/assets/i18n/
├── es.json
├── ro.json
└── en.json
```

### Cambiar idioma

El selector de idioma está en el header de la aplicación. El idioma seleccionado se guarda en `localStorage`.

## Ejecutar Localmente

```bash
npm start
```

La aplicación estará disponible en `http://localhost:4200/`

### Flujo de login

1. Usuario no autenticado → redirige a `/login`
2. Usuario pulsa "Entrar con Google"
3. Si email está en `authorizedUsers` con `active: true` → entra a `/dashboard`
4. Si email no está autorizado → logout + mensaje de acceso denegado
5. Desde cualquier ruta interna sin autorización → redirige a login

## Iconos

Se usa **PrimeIcons**. Los iconos se usan directamente con clases CSS:

```html
<i class="pi pi-home"></i>
<i class="pi pi-calendar"></i>
<i class="pi pi-car"></i>
```

## Build

```bash
# Desarrollo
npm run build

# Producción
npm run build:prod
```

## Estructura del Proyecto

```
src/app/
├── core/
│   ├── auth/
│   │   └── auth.service.ts           # Firebase Auth + autorización
│   ├── guards/
│   │   ├── auth.guard.ts            # Protege rutas privadas
│   │   └── public.guard.ts          # Evita acceso a login si ya está auth
│   ├── i18n/
│   │   └── translate.service.ts      # Servicio de traducciones
│   ├── theme/
│   │   └── theme.service.ts         # Servicio de tema (dark/light)
│   └── services/
│       └── firebase-status.service.ts
├── features/
│   ├── calendar/
│   ├── clients/                     # CRUD + documentos + histórico de pagos
│   ├── contracts/                   # PDF + signing link + email Resend
│   ├── dashboard/                   # Tarjetas accionables por día
│   ├── expenses/
│   ├── inspections/                 # Pickup + return + fotos + cargos extra
│   ├── payments/                    # Pagos manuales + Redsys
│   ├── reports/
│   ├── reservations/                # List + create 4 pasos + detail + workflow
│   ├── settings/
│   └── vehicles/                    # CRUD + fotos + histórico de reservas
├── layout/
│   └── private-layout/               # Layout principal con sidebar
├── login/                            # Pantalla de login
└── shared/
    ├── components/
    │   ├── image-gallery/            # Lightbox para fotos
    │   ├── language-selector/        # Selector de idioma
    │   └── photo-upload-buttons/      # Cámara (móvil) + galería, mobile-first
    ├── models/
    │   ├── authorized-user.model.ts
    │   ├── client.model.ts
    │   ├── contract.model.ts
    │   ├── inspection.model.ts
    │   ├── payment.model.ts
    │   ├── reservation.model.ts
    │   └── vehicle.model.ts
    ├── pipes/
    │   └── translate.pipe.ts
    └── utils/
        ├── acriss-code.util.ts
        ├── payment-summary.util.ts   # Cálculo del resumen financiero
        ├── pricing.util.ts
        ├── reservation-date.util.ts
        └── reservation-workflow.util.ts # Guards de flujo (canStartPickup, etc.)
```

## Flujo de producción

El orden canónico del alquiler está modelado en `reservation-workflow.util.ts`:

```
Presupuesto
  → Reserva                 (reservationStatus: reserved)
  → Cliente
  → Pago señal              (paymentStatus: partial → paid)
  → Contrato PDF            (contractStatus: generated)
  → Link de firma           (contractStatus: pending_signature)
  → Firma del cliente       (contractStatus: signed)
  → Pago resto + fianza     (paymentStatus: paid, deposit.paidAmount > 0)
  → Entrega (inspección)    (reservationStatus: delivered)
  → Devolución (inspección) (reservationStatus: returned)
  → Cargos extra + fianza   (resolved)
  → Cierre reserva          (reservationStatus: closed)
```

Los `canStartPickup`, `canStartReturn`, `canCloseReservation`, etc. del workflow util son la única fuente de verdad. La UI los usa para deshabilitar botones y los servicios los invocan antes de mutar estado (defensa en profundidad).

Excepciones documentadas: si un operador necesita saltarse un paso, debe llamar `buildWorkflowException(action, reason, createdBy)` con motivo obligatorio (mínimo 3 caracteres) y se persiste en `reservation.workflowExceptions[]`. El util permite la acción solo si existe una excepción registrada para esa acción.

## Módulos clave

- **Dashboard**: muestra tarjetas accionables (señal pendiente, firma pendiente, entregas/devoluciones de hoy, fianzas abiertas, vehículos en alquiler, flota disponible). Las tarjetas sin contenido se ocultan automáticamente.

- **Vehículos**: CRUD + fotos (cámara/galería en móvil) + status modal (available / rented / maintenance / out_of_service) + histórico de reservas agrupado en Próximas / En curso / Pasadas / Canceladas.

- **Clientes**: CRUD + documentos (DNI, carnet, etc.) + trust level + histórico de pagos con resumen por categoría (alquiler / fianzas / extras).

- **Reservas**: creación en 4 pasos (fechas → vehículo → cliente → resumen), listado con filtros, detalle con todas las secciones (vehículo, cliente, contrato, pagos, inspecciones), botón "Cerrar reserva" solo si `canCloseReservation` lo permite, chip "Siguiente acción" en cabecera.

- **Pagos**: 3 acciones en la UI (Registrar cobro / Devolver fianza / Retener fianza). Los cargos extra solo nacen desde la inspección de devolución (un solo sistema, sin doble fuente). Resumen calculado desde la colección `payments` (source of truth).

- **Inspecciones**: pickup y return con checklists, fotos por categoría, daños, cargos extra, decisión de devolver/retenir fianza. La entrada directa por URL se bloquea con un banner si no cumple el workflow.

- **Contratos**: PDF generado por Cloud Function, link de firma de un solo uso (token 256-bit, expiración 7 días), página pública sin auth, envío por email con Resend.

## Internacionalización

Tres idiomas (es/en/ro) en `src/assets/i18n/`. Las claves siguen la jerarquía por módulo (`vehicles.*`, `reservations.*`, `payments.*`, `inspections.*`, `contracts.*`, `workflow.*`, `dashboard.*`, `clients.*`, `vehicles.*`). Las razones de bloqueo del workflow util usan prefijo `workflow.*` para que el pipe `translate` las muestre sin lógica adicional.

## Arquitectura Firebase

```
Firebase Hosting (Frontend)
├── Angular App
└── Rutas SPA (todas → index.html)

Firebase Backend
├── Authentication (Google Auth)
├── Firestore (base de datos en tiempo real)
├── Storage (archivos: vehículos, contratos, etc.)
└── Cloud Functions (futuro) - prepara con: firebase init functions
```

## Reglas de Seguridad

### Firestore Rules

Las reglas están en `firestore.rules`. Resumen:

- Solo usuarios autenticados y autorizados pueden leer/escribir datos
- La colección `authorizedUsers` permite lectura solo al propio usuario
- Solo admins pueden modificar `authorizedUsers`
- Todas las demás colecciones requieren autorización
- La colección `contractSigningTokens` **niega todo acceso directo** a clientes. Solo Cloud Functions (admin SDK) puede leer/escribir tokens; la página pública de firma valida el token vía HTTPS callable.

### Firestore Indexes

`firestore.indexes.json` declara los índices compuestos necesarios:

- `reservations`: `clientId + pickupDateTime desc`
- `reservations`: `vehicleId + pickupDateTime desc`
- `payments`: `clientId + paidAt desc`

Despliega con `firebase deploy --only firestore:indexes`. Sin estos índices, los queries de histórico en `vehicle-detail` y `client-detail` fallan con error de índice al primer uso.

### Storage Rules

Las reglas están en `storage.rules`. Resumen:

- Solo usuarios autenticados pueden subir/descargar archivos
- Archivos organizados en: `vehicles/`, `clients/`, `contracts/`, `inspections/`

## Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm start` | Iniciar servidor de desarrollo |
| `npm run build` | Build de desarrollo |
| `npm run build:prod` | Build de producción |
| `npm run deploy` | Build + deploy hosting |
| `npm run deploy:hosting` | Build + deploy solo hosting |
| `npm run deploy:all` | Build + deploy completo |
| `npm run serve:hosting` | Probar hosting local con build |
| `npm run firebase:emulators` | Iniciar emuladores Firebase |

## Futuros enhancements

### Cloud Functions

El proyecto está preparado para añadir Cloud Functions en el futuro:

```bash
firebase init functions
```

Esto permitirá implementar:
- APIs backend personalizadas
- Webhooks para integraciones
- Processing asíncrono (reservas, notificaciones)
- Scheduler jobs (limpieza, reportes)

### Autres integraciones

- Push notifications con Firebase Cloud Messaging
- Analytics con Firebase Analytics
- Crashlytics para monitoring de errores
- Remote Config para feature flags

## Contratos y firma

El módulo **Contratos** permite generar, firmar y enviar contratos de
alquiler al cliente sin que el cliente necesite cuenta en la app.

### Flujo

1. Desde el detalle de una reserva, el operador pulsa **Generar contrato**.
   El backend (`generateContractPdf`) construye un PDF (datos de la
   reserva, cliente, vehículo, fechas, fianza, condiciones) y lo sube a
   `contracts/{reservationId}/contract-original.pdf`.
2. El operador pulsa **Generar link de firma**. Se crea un token
   aleatorio de un solo uso (`createContractSigningLink`) con caducidad
   por defecto de 7 días. El contrato pasa a `pending_signature` y la
   reserva actualiza su `contractStatus`.
3. El operador **copia el link** y lo envía al cliente por el canal que
   prefiera (WhatsApp, email, SMS).
4. El cliente abre `https://<host>/sign-contract/{token}` desde su
   móvil **sin iniciar sesión**. La página (`SignContractComponent`)
   llama a `getContractForSigning` (Cloud Function pública) y muestra
   un resumen del contrato, un PDF embebido y un canvas de firma
   (`SignaturePadComponent`).
5. El cliente firma, marca la aceptación y pulsa **Firmar contrato**.
   Se llama a `signContract` (Cloud Function pública) que guarda la
   imagen de la firma, regenera el PDF con la firma incrustada y
   marca el token como usado. El contrato pasa a `signed`.
6. El operador pulsa **Enviar por email**. Se llama a
   `sendSignedContractEmail` que envía el contrato firmado al cliente
   usando **Resend** (con el PDF adjunto).

### Decisiones de seguridad

- La página pública `/sign-contract/:token` no requiere auth, pero el
  token (256 bits URL-safe) es la única credencial válida. Es
  aleatorio, no reutilizable y caduca.
- Los tokens viven en la colección `contractSigningTokens` con reglas
  de Firestore que deniegan cualquier acceso cliente. Solo las
  Cloud Functions (admin SDK) pueden leerlos o escribirlos.
- La clave de **Resend** (`RESEND_API_KEY`) nunca entra al frontend.
  Vive en `firebase functions:secrets` y solo se usa en el runtime
  de Cloud Functions.
- El PDF y la firma se almacenan en `contracts/{reservationId}/` con
  Storage rules que solo permiten acceso a usuarios autenticados.

### Variables de entorno / secrets

Configura los secrets del proyecto:

```bash
# Resend
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set RESEND_FROM_EMAIL   # default: reservas@veltorent.com

# Datos de la empresa (opcional, con defaults)
firebase functions:secrets:set VELTO_COMPANY_NAME      # default: Velto Rent
firebase functions:secrets:set VELTO_COMPANY_EMAIL     # default: reservas@veltorent.com
firebase functions:secrets:set VELTO_COMPANY_PHONE
firebase functions:secrets:set VELTO_COMPANY_ADDRESS

# URL pública usada para construir links absolutos en el email
firebase functions:secrets:set VELTO_PUBLIC_BASE_URL   # ej: https://velto-store.web.app

# Caducidad del link de firma (en días, default 7)
firebase functions:secrets:set CONTRACT_LINK_EXPIRY_DAYS
```

### Despliegue de las Cloud Functions

```bash
cd functions
npm install
npm run build
firebase deploy --only functions
```

Funciones desplegadas:

- `generateContractPdf` (auth)
- `createContractSigningLink` (auth)
- `cancelContractSigningLink` (auth)
- `getContractForSigning` (público, token)
- `signContract` (público, token)
- `sendSignedContractEmail` (auth)
- `createRedsysPaymentLink` (auth, skeleton)
- `redsysNotificationWebhook` (público, skeleton)

### Envío manual por WhatsApp

El link de firma se puede **copiar** desde la app y pegar en una
conversación de WhatsApp. El envío automático por WhatsApp está
previsto para una iteración futura.

### Roadmap

- Firma electrónica avanzada / DocuSign (no implementado en esta iteración).
- WhatsApp Business API con plantilla pre-aprobada.
- OCR de DNI / carnet para auto-rellenar cliente.
- Generación de facturas.