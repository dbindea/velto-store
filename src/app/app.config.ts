import {
  ApplicationConfig,
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { getApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getFunctions, provideFunctions } from '@angular/fire/functions';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

/**
 * Numbers and dates are formatted Spanish-style.
 *
 * Angular defaults to `en-US`, so the pipes printed «423.50 €» and, worse,
 * «9,200 km» — which a Spanish reader parses as nine-point-two. The PDFs have
 * always formatted per document language; the screen did not.
 *
 * ⚠️ `LOCALE_ID` is fixed at bootstrap, so this does NOT follow the language
 * selector. Spanish and Romanian share the convention (1.234,56); an operator
 * working in English will see Spanish-style numbers. That trade is deliberate:
 * the fleet, the invoices and the day-to-day operator are Spanish.
 */
registerLocaleData(localeEs);

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: 'es' },
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    /**
     * ⚠️ **Cada pantalla empieza por arriba.**
     *
     * Angular **conserva** la posición del scroll al navegar si no se le dice
     * lo contrario, y en un móvil eso significa abrir la entrega del coche a
     * media página: el operador tiene que subir a mano para empezar por el
     * principio de un formulario que no ha visto todavía. Pasaba en la
     * inspección, en las tarifas de un vehículo y en cualquier pantalla larga
     * a la que se llegara desde otra pantalla larga.
     *
     * Es una línea y arregla toda la aplicación de golpe, que es justamente el
     * motivo por el que no se había visto: no hay ningún componente al que
     * culpar.
     *
     * `anchorScrolling` va con ella para que un enlace con `#fragmento` siga
     * llevando a su sitio en vez de al principio.
     */
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled'
      })
    ),
    provideHttpClient(),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => getFirestore()),
    provideAuth(() => getAuth()),
    provideStorage(() => getStorage()),
    // ⚠️ La región va explícita. `getFunctions()` sin argumentos apunta a
    // us-central1, que es el defecto del SDK y NO donde están desplegadas:
    // corren en europe-west1, junto a Firestore y Storage. Sin esto, cada
    // callable —generar contrato, presupuesto, link de firma— falla con un
    // 404 que parece un problema de permisos y no lo es.
    //
    // Tiene que coincidir con `FUNCTIONS_REGION` de
    // functions/src/global-options.ts y con la región del rewrite /d/** de
    // firebase.json. Las tres se mueven juntas.
    provideFunctions(() => getFunctions(getApp(), 'europe-west1'))
  ]
};
