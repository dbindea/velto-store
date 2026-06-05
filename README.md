# Velto Store - Fleet Management App

Aplicación Angular para gestión de flota de vehículos de alquiler.

## Stack Tecnológico

- **Angular 20** con standalone components
- **TypeScript**
- **Firebase 12** (Auth, Firestore, Storage)
- **Tailwind CSS v4**
- **PrimeIcons** - Librería de iconos
- **AngularFire 20**
- **Netlify** (hosting)

### Por qué PrimeIcons

Se usa PrimeIcons por ser la librería de iconos más compatible con Angular, mantener coherencia visual con el ecosistema PrimeNG, ofrecer iconos limpios y profesionales, y no requerir configuración adicional compleja.

## Requisitos

- Node.js 18.19+ o 20.x+
- npm 10.x+

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

## Despliegue en Netlify

### Configuración

El proyecto incluye `netlify.toml` con la configuración correcta para Angular SPA:

```toml
[build]
  command = "npm run build"
  publish = "dist/velto-store/browser"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Desplegar

1. Conecta tu repositorio en [Netlify](https://netlify.com)
2. Netlify detectará automáticamente la configuración
3. O usa CLI:

```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod
```

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
│   ├── clients/
│   ├── contracts/
│   ├── dashboard/
│   ├── expenses/
│   ├── inspections/
│   ├── payments/
│   ├── reports/
│   ├── reservations/
│   ├── settings/
│   └── vehicles/
├── layout/
│   └── private-layout/               # Layout principal con sidebar
├── login/                            # Pantalla de login
└── shared/
    ├── components/
    │   └── language-selector/      # Selector de idioma
    ├── models/
    │   └── authorized-user.model.ts
    └── pipes/
        └── translate.pipe.ts         # Pipe para traducciones
```

## Reglas de Seguridad

### Firestore Rules

Las reglas están en `firestore.rules`. Resumen:

- Solo usuarios autenticados y autorizados pueden leer/escribir datos
- La colección `authorizedUsers` permite lectura solo al propio usuario
- Solo admins pueden modificar `authorizedUsers`
- Todas las demás colecciones requieren autorización

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

## Próximos Pasos

Este proyecto está preparado para añadir:

- Módulo de vehículos
- Módulo de reservas
- Modelo Firestore completo
- Subida de contratos PDF
- Dashboard de gestión
