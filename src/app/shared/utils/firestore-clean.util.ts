/**
 * Stripping `undefined` out of a payload before it reaches Firestore.
 *
 * Firestore throws `Unsupported field value: undefined`, so every write needs
 * this. The subtlety — and it has bitten this project twice — is WHAT MUST NOT
 * BE TOUCHED on the way.
 *
 * A Firestore sentinel (`serverTimestamp()`, `arrayUnion()`, `increment()`) is
 * an object with ordinary enumerable properties:
 *
 *     arrayUnion(note)      → { _methodName: 'arrayUnion', _elements: [note] }
 *     serverTimestamp()     → { _methodName: 'serverTimestamp' }
 *
 * Rebuild one with `Object.entries()` and it stops being a sentinel: it becomes
 * a plain map. Firestore then either writes that map literally — which is how
 * contract timestamps ended up as `{}` (F-4) — or walks into `_elements` and
 * reports the `undefined` hiding inside, which is how adding an internal note
 * to a reservation started failing.
 *
 * So the rule here is inverted from the obvious one: **only genuine plain
 * objects are rebuilt.** Anything with its own prototype — sentinels,
 * `Timestamp`, `DocumentReference`, `GeoPoint`, `Date`, `Bytes` — is passed
 * through untouched, and stays whatever it was.
 */

import { FieldValue } from '@angular/fire/firestore';

export interface CleanForFirestoreOptions {
  /**
   * Drop `null` as well as `undefined`.
   *
   * `null` is a value Firestore accepts and sometimes the one we mean, so this
   * is opt-in. It exists because two services already behaved this way and
   * changing that silently would be a behaviour change, not a fix.
   */
  stripNulls?: boolean;
}

/** True for `{}` / `new Object()` — not for a class instance. */
function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively remove `undefined` (and optionally `null`) from a Firestore
 * payload, leaving sentinels and native Firestore types alone.
 */
export function cleanForFirestore<T>(value: T, options: CleanForFirestoreOptions = {}): T {
  return clean(value, options) as T;
}

function clean(value: unknown, options: CleanForFirestoreOptions): unknown {
  // Explicit, even though the prototype check below would also catch it: this
  // is the case the whole file exists for, and it should be impossible to
  // remove by accident.
  if (value instanceof FieldValue) return value;

  if (Array.isArray(value)) {
    // Firestore rejects `undefined` inside arrays too, and there is no way to
    // represent a hole — so those entries are dropped.
    return value
      .filter((item) => item !== undefined && (!options.stripNulls || item !== null))
      .map((item) => clean(item, options));
  }

  if (!isPlainObject(value)) return value;

  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    if (options.stripNulls && entry === null) continue;
    cleaned[key] = clean(entry, options);
  }
  return cleaned;
}
