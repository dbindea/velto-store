/**
 * DESARROLLO — proyecto `velto-store`.
 *
 * Es el fichero por defecto: lo usan `ng serve` y `ng build --configuration
 * development`. La configuración `production` de `angular.json` lo sustituye
 * por `environment.production.ts`.
 *
 * ⚠️ Hasta el 28 de agosto de 2026 esto estaba al revés: la build de
 * producción metía el fichero de desarrollo, y este —marcado `production:
 * true`— era el que servía `ng serve`. Daba igual mientras los dos apuntaban al
 * mismo proyecto de Firebase; con dos proyectos habría desplegado la web de
 * producción contra la base de datos de desarrollo.
 */
export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyCN34whfIFd6EqbOrCAi4HqiR2N4kVrC7s',
    authDomain: 'velto-store.firebaseapp.com',
    projectId: 'velto-store',
    storageBucket: 'velto-store.firebasestorage.app',
    messagingSenderId: '611339546245',
    appId: '1:611339546245:web:c15344927adffc3a8c03ec',
  },
};
