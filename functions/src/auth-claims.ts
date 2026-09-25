/**
 * Quién está autorizado, escrito DENTRO del token.
 *
 * ⚠️ **El fallo que esto cierra: «autenticado» NO era «autorizado».** La API key
 * del proyecto viaja dentro del bundle y Google sign-in está abierto, así que
 * **cualquier cuenta de Google del mundo** podía completar el login contra este
 * proyecto. La aplicación le negaba la pantalla —el guard lee `authorizedUsers`—
 * pero el **token era válido**, y `storage.rules` protegía con un simple
 * `request.auth != null` el DNI y el carné de los clientes, los contratos
 * firmados, las firmas manuscritas y los partes de inspección.
 *
 * ⚠️ **Y no se puede arreglar en las reglas de Storage, que es donde uno lo
 * busca.** Las reglas de Storage **no pueden leer Firestore**: no hay forma de
 * que consulten `authorizedUsers`. Lo traicionero es que `firestore.get()`
 * **pasa el validador de sintaxis sin un solo error** y luego deniega siempre en
 * ejecución — medido el 24 de septiembre de 2026 contra el bucket real,
 * aislando cada condición: `auth`, `token.email` y `.lower()` daban 404 (la
 * regla pasa) y las tres que tocaban Firestore, 403. **Una regla que valida no
 * es una regla que funciona.**
 *
 * Lo que sí leen las reglas de Storage son los **claims del token**. Así que la
 * autorización se escribe ahí: el backend comprueba `authorizedUsers` —que sigue
 * siendo la única fuente de verdad— y sella el resultado en el token.
 *
 * ⚠️ **El precio, y hay que conocerlo: el token dura una hora.** Quitarle el
 * acceso a alguien no surte efecto en Storage hasta que su token caduca. Es el
 * mismo problema que ya obligó a leer el rol de Firestore y no del token en las
 * devoluciones a tarjeta, y por eso `onAuthorizedUserChanged` **revoca las
 * sesiones** además de quitar el claim: eso fuerza a renovar y recorta la
 * ventana a lo que tarde el SDK en darse cuenta.
 *
 * ⚠️ **Se descartó `beforeSignIn`, que sería mejor**, porque exige activar
 * Identity Platform (GCIP) en la consola: el despliegue falla con
 * `OPERATION_NOT_ALLOWED: Blocking Functions may only be configured for GCIP
 * projects`. Aquello cerraría la puerta antes de emitir el token y protegería
 * también cualquier regla futura escrita mirando solo `auth != null`. Si algún
 * día se activa GCIP, ese es el sitio al que volver.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { firestore } from './admin-guard';

/**
 * El claim que las reglas de Storage miran. Nombre corto y propio: los claims
 * viajan en cada petición y comparten espacio con los del propio Firebase.
 */
export const CLAIM_AUTHORIZED = 'velto';

interface Autorizacion {
  autorizado: boolean;
  role?: string;
}

/**
 * La ficha de `authorizedUsers`, que es la única fuente de verdad.
 *
 * ⚠️ **El id del documento es el email EN MINÚSCULAS y `data()` no lo
 * incluye.** Es el mismo despiste que dejó a Ajustes sin reconocer al usuario en
 * sesión (M-41); aquí se busca por id, así que lo único que hay que acertar es
 * el `toLowerCase()`.
 */
async function leerAutorizacion(email: string): Promise<Autorizacion> {
  const snap = await firestore()
    .collection('authorizedUsers')
    .doc(email.toLowerCase())
    .get();
  if (!snap.exists || snap.data()?.active !== true) return { autorizado: false };
  return { autorizado: true, role: snap.data()?.role };
}

/** Escribe —o retira— el sello en el token de un usuario de Auth. */
async function sellar(uid: string, auth: Autorizacion): Promise<void> {
  await admin.auth().setCustomUserClaims(
    uid,
    auth.autorizado ? { [CLAIM_AUTHORIZED]: true, role: auth.role } : null
  );
}

/**
 * Lo llama la aplicación **nada más entrar**, y es lo que hace que el mecanismo
 * funcione desde el primer login: un usuario recién creado en Auth no tiene
 * ningún claim, así que sin esto no podría leer ni una foto.
 *
 * ⚠️ **No recibe ningún parámetro, y es deliberado.** Sella al que llama, y a
 * nadie más: aceptar un email como argumento convertiría esto en «ponle el sello
 * a quien yo diga», que es exactamente la llave que la function guarda.
 *
 * Es idempotente: se puede llamar en cada arranque sin efecto ninguno si ya
 * estaba sellado.
 */
export const syncAuthClaims = onCall(async (request: CallableRequest) => {
  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;
  if (!uid || !email) {
    throw new HttpsError('unauthenticated', 'auth.errors.notSignedIn');
  }

  const autorizacion = await leerAutorizacion(email);
  await sellar(uid, autorizacion);

  if (!autorizacion.autorizado) {
    /**
     * Se registra: es el único sitio donde queda constancia de que alguien de
     * fuera ha llegado a autenticarse. No se le cuenta al cliente por qué —
     * distinguir «no estás en la lista» de «tu cuenta está desactivada» le
     * confirma a quien prueba qué correos existen aquí.
     */
    logger.warn('Cuenta autenticada SIN autorización', { email });
  }

  /**
   * El frontend tiene que refrescar el token después (`getIdToken(true)`): el
   * claim nuevo no aparece solo en el que ya tiene en la mano.
   */
  return { authorized: autorizacion.autorizado };
});

/**
 * Mantiene el sello al día cuando la ficha cambia: alta, baja, cambio de rol.
 *
 * ⚠️ **Sin esto, quitarle el acceso a alguien no le quitaría nada.** Su claim
 * seguiría puesto hasta que volviera a entrar —que es justo lo que no va a
 * hacer— y Storage seguiría abriéndole la puerta. La ficha es la fuente de
 * verdad; esto es lo que la propaga.
 *
 * ⚠️ **Y revoca las sesiones abiertas**, que es la otra mitad: el claim vive
 * dentro de un token ya emitido que dura una hora, así que quitarlo de la cuenta
 * no caduca el que alguien tenga en la mano. `revokeRefreshTokens()` obliga a
 * renovarlo.
 */
export const onAuthorizedUserChanged = onDocumentWritten(
  'authorizedUsers/{email}',
  async (event) => {
    const email = event.params.email;
    let usuario: admin.auth.UserRecord;
    try {
      usuario = await admin.auth().getUserByEmail(email);
    } catch {
      /**
       * Todavía no ha entrado nunca, así que no existe en Auth y no hay token
       * que sellar. No es un error: `syncAuthClaims` lo sellará en su primer
       * login, que es el caso normal de un alta.
       */
      logger.info('Ficha cambiada de alguien que aún no ha entrado', { email });
      return;
    }

    const datos = event.data?.after?.data();
    const autorizacion: Autorizacion =
      datos?.active === true
        ? { autorizado: true, role: datos?.role }
        : { autorizado: false };

    await sellar(usuario.uid, autorizacion);

    if (!autorizacion.autorizado) {
      await admin.auth().revokeRefreshTokens(usuario.uid);
      logger.warn('Acceso retirado y sesiones revocadas', { email });
    }
  }
);
