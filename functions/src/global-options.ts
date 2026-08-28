/**
 * Opciones que se aplican a TODAS las functions.
 *
 * ⚠️ **Este módulo tiene que evaluarse antes que cualquier módulo que defina
 * una function.** `setGlobalOptions` solo afecta a lo que se declara después
 * de llamarlo, y los `export ... from './redsys'` de `index.ts` son
 * declaraciones de import: se evalúan antes que cualquier sentencia escrita en
 * ese fichero. Por eso esto vive aquí y `index.ts` lo importa en su primera
 * línea, y no es una llamada suelta al principio de `index.ts` — ahí llegaría
 * tarde y las functions se desplegarían en la región por defecto sin que
 * nadie se enterara.
 *
 * **Región: `europe-west1`.** Firestore y Storage están en `eur3`, que es
 * multirregión europea, y `europe-west1` (Bélgica) está dentro. Hasta el 28 de
 * agosto de 2026 las functions corrían en `us-central1`: cada PDF cruzaba el
 * Atlántico dos veces —leer la reserva, escribir el documento— y los datos
 * personales de los contratos se procesaban en Estados Unidos aunque se
 * guardaran en Europa.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

export const FUNCTIONS_REGION = 'europe-west1';

setGlobalOptions({ region: FUNCTIONS_REGION });
