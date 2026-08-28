/**
 * PRODUCCIÓN — proyecto `rentalcar-veltomobility`.
 *
 * Lo mete la configuración `production` de `angular.json`, que es la que usan
 * `npm run build` y `npm run build:prod`.
 *
 * Firestore en `eur3`, igual que desarrollo.
 */
export const environment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyAZucSbN7Z-S7xDVcNV4QL0C2bIVxgBufs',
    authDomain: 'rentalcar-veltomobility.firebaseapp.com',
    projectId: 'rentalcar-veltomobility',
    storageBucket: 'rentalcar-veltomobility.firebasestorage.app',
    messagingSenderId: '143795044768',
    appId: '1:143795044768:web:ea79f936cfc4afb877a4c5',
  },
};
