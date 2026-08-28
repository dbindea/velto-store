/**
 * Capitalisation of what the operator types into a free-text field.
 *
 * There were two private copies of this — one in the reservation wizard, one in
 * the vehicle form — and both split on spaces only, so every separator inside a
 * word was treated as part of it: "madrid-barajas" came out "Madrid-barajas"
 * and "o'brien" as "O'brien".
 *
 * ⚠️ **This is no longer a cosmetic detail of a form.** Since the quote and the
 * booking confirmation exist, the pickup location is printed on a PDF the
 * customer receives — "Aeropuerto Adolfo Suárez Madrid-barajas, Terminal 4"
 * went out like that.
 */

/**
 * Separators that start a new word. Kept in the pattern so they survive the
 * split: rebuilding the string from words alone would drop them.
 */
const WORD_BOUNDARY = /([\s\-–—/'’.]+)/;

/**
 * Title-case a free-text value, respecting hyphens, slashes and apostrophes.
 *
 * The rest of each word is lower-cased on purpose: it is what turns SHOUTED or
 * sloppy input into something printable, and it is why "S.L." typed in capitals
 * comes back as "S.L." only because each letter follows a separator.
 */
export function capitalizeWords(value: string): string {
  if (!value) return value;
  return value
    .split(WORD_BOUNDARY)
    .map(part =>
      WORD_BOUNDARY.test(part)
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join('');
}
