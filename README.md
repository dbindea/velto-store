# Velto Store - Fleet Management Base App

Aplicación Angular para gestión de flota de vehículos de alquiler.

## Stack Tecnológico

- **Angular 20** con standalone components
- **TypeScript**
- **Firebase 12** (Firestore, Auth, Storage, Hosting)
- **Tailwind CSS v4** - Framework de estilos
- **AngularFire 20** - Integración Firebase

## Requisitos

- Node.js 18.19+ o 20.x+
- npm 10.x+

## Estructura del Proyecto

```
src/app/
├── core/                    # Servicios core, Firebase, auth, guards
│   ├── auth/
│   │   └── auth.service.ts
│   ├── firebase/
│   │   ├── firestore.service.ts
│   │   └── storage.service.ts
│   ├── services/
│   │   └── firebase-status.service.ts
│   ├── guards/
│   └── interceptors/
├── shared/                  # Componentes, pipes, directives compartidos
│   ├── components/
│   ├── pipes/
│   ├── directives/
│   ├── models/
│   └── utils/
├── features/                # Módulos de negocio (preparados para crecer)
│   ├── vehicles/
│   ├── reservations/
│   ├── clients/
│   ├── payments/
│   ├── expenses/
│   ├── contracts/
│   ├── inspections/
│   └── dashboard/
├── layout/                  # Componentes de layout
└── home/                    # Página inicial de verificación
```

## Instalación

```bash
npm install
```

## Configuración de Firebase

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com)

2. Copia la configuración de tu proyecto (Project Settings > Your apps > SDK setup)

3. Actualiza los archivos `src/environments/environment.ts` y `src/environments/environment.development.ts`:

```typescript
export const environment = {
  production: false,
  firebase: {
    apiKey: 'TU_API_KEY',
    authDomain: 'TU_PROJECT_ID.firebaseapp.com',
    projectId: 'TU_PROJECT_ID',
    storageBucket: 'TU_PROJECT_ID.appspot.com',
    messagingSenderId: 'TU_MESSAGING_SENDER_ID',
    appId: 'TU_APP_ID'
  }
};
```

4. Habilita los servicios en Firebase Console:
   - **Firestore**: Database > Create database
   - **Authentication**: Authentication > Get started
   - **Storage**: Storage > Get started

5. Actualiza las reglas de seguridad de Firestore y Storage según tus necesidades

## Ejecutar Localmente

```bash
npm start
```

La aplicación estará disponible en `http://localhost:4200/`

Verás una pantalla de estado confirmando:
- Angular OK
- Firebase config loaded
- Ready for Firestore
- Auth preparado
- Storage preparado

## Build

```bash
# Desarrollo
npm run build        # o ng build

# Producción
npm run build:prod   # o ng build --configuration production
```

## Despliegue a Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting

# Desplegar
npm run deploy:hosting
```

## Emuladores Firebase (desarrollo local)

```bash
npm run firebase:emulators
```

## Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm start` | Iniciar servidor de desarrollo |
| `npm run build` | Build de desarrollo |
| `npm run build:prod` | Build de producción |
| `npm run deploy:hosting` | Desplegar a Firebase Hosting |
| `npm run firebase:emulators` | Iniciar emuladores Firebase |

## Próximos Pasos

Este proyecto está preparado para añadir:
- Módulo de vehículos
- Módulo de reservas
- Modelo Firestore completo
- Autenticación completa
- Subida de contratos PDF
- Dashboard de gestión

## Notas sobre Tailwind CSS

Se usa Tailwind CSS v4 por ser la versión más moderna y estable, con configuración simplificada y mejor rendimiento. No se recomienda alternativa ya que Tailwind es el estándar actual para estilos en Angular/React/Vue.
