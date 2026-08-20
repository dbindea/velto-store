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
 *
 * Additionally we apply the `ignoreUndefinedProperties` setting on
 * the default Firestore instance.  Without it, any
 * `.set({ x: undefined, ... })` call throws
 *   "Cannot use 'undefined' as a Firestore value".
 * With it, a field that is undefined (e.g. an optional snapshot
 * like `vehicleSnapshot.version` that the contract PDF was not
 * given) is simply omitted from the write instead of crashing the
 * function.
 *
 * This is the process-wide defence for the backend.  The frontend
 * has its own, unrelated one: a private `cleanData()` helper that
 * lives only inside `client.service.ts` — it is not shared, and it
 * does not cover any other service.
 *
 * NOTE: `settings()` must run before the first Firestore call.
 * That holds as long as every module obtains Firestore through the
 * `firestore()` helper below rather than calling `admin.firestore()`
 * directly at module load.
 */

import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

// Apply global Firestore settings exactly once.  These settings are
// per-process, not per-request.
try {
  admin.firestore().settings({ ignoreUndefinedProperties: true });
} catch {
  // settings() throws if called after the first Firestore use, or
  // more than once per app (e.g. a test that hot-reloads this
  // module).  Either way the flag is already applied — ignore.
}

export function firestore(): FirebaseFirestore.Firestore {
  return admin.firestore();
}

export function storageBucket() {
  return admin.storage();
}
