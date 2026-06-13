/**
 * Centralised lazy initialization for firebase-admin.
 *
 * Cloud Functions deploys do a static analysis pass that imports
 * every module exported by `index.ts`. If any of those modules
 * touches an admin service (`admin.firestore()`, `admin.storage()`,
 * ...) at top level, the analyzer may run before the runtime has
 * called `initializeApp()`, and Firebase will throw
 *
 *     FirebaseAppError: The default Firebase app does not exist.
 *
 * The fix is twofold:
 *   1. Only call `initializeApp()` at the top of THIS module, and
 *      only if no default app exists yet.
 *   2. Provide helpers that lazily resolve the admin services the
 *      first time they are actually used inside a function handler,
 *      never at module load.
 */

import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

export function firestore(): FirebaseFirestore.Firestore {
  return admin.firestore();
}

export function storageBucket() {
  return admin.storage();
}
