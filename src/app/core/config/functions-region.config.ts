/**
 * La región donde corren las Cloud Functions, para el lado de la APLICACIÓN.
 *
 * ⚠️ **No se importa de `functions/src/global-options.ts`, y no por pereza:**
 * la app y las functions compilan con tsconfigs separados y con `rootDir`
 * explícito, así que **no pueden compartir módulo**. Importar de `../` subiría
 * la raíz común de las functions y su salida pasaría de `lib/index.js` a
 * `lib/src/index.js`, dejando el `main` del package.json apuntando a un fichero
 * que ya no existe: compila, despliega, y las functions revientan al arrancar.
 * CLAUDE.md lo explica entero en la sección de los tsconfig.
 *
 * Así que este valor **está duplicado a propósito**, como la aritmética del IVA
 * en `functions/src/contracts/pdf.ts`. Lo que no puede estar es duplicado
 * DENTRO de la app: ese era el problema.
 *
 * ⚠️ **CLAUDE.md dice que la región vive en TRES sitios y hay que moverlos a la
 * vez** —`functions/src/global-options.ts`, `app.config.ts` y el rewrite de
 * `firebase.json`—. Había un CUARTO que nadie contaba: el respaldo de los
 * enlaces cortos en `document-redirect.component.ts`, con `us-central1` escrito
 * a mano. Llevaba muerto desde la mudanza del 28 de agosto de 2026 y se
 * descubrió el 26 de septiembre: `us-central1-…` devuelve el 404 de Google en
 * HTML, `europe-west1-…` contesta la function.
 *
 * Con esta constante, los dos sitios de la app leen el mismo valor y el cuarto
 * deja de existir. Si la región se vuelve a mover, siguen siendo tres.
 */
export const FUNCTIONS_REGION = 'europe-west1';
