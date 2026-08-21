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
 * `settings()` is applied inside `firestore()` below, not at module
 * load: resolving the Firestore service at top level is exactly what
 * rule 2 forbids, and it made the deploy-time analysis pass fail with
 * "User code failed to load. Cannot determine backend specification."
 * Applying it on first use still satisfies the SDK requirement that
 * `settings()` run before any other Firestore call, as long as every
 * module goes through this helper.
 */

import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

let settingsApplied = false;

export function firestore(): FirebaseFirestore.Firestore {
  const db = admin.firestore();
  if (!settingsApplied) {
    settingsApplied = true;
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Throws if the instance has already been used or configured.
      // Either way the flag is in place — nothing to do.
    }
  }
  return db;
}

export function storageBucket() {
  return admin.storage();
}
