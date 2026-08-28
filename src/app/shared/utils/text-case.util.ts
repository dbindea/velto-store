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
 * A word the operator capitalised deliberately: it has upper AND lower case in
 * it, like `dCi`, `TCe`, `BlueHDi`, `GTLine`. Left exactly as typed.
 *
 * All-caps words are not exempt — SHOUTED input is the thing this is here to
 * tame — and neither are all-lower ones, which are the normal case.
 */
function isDeliberatelyMixedCase(word: string): boolean {
  return /\p{Lu}/u.test(word.slice(1)) && /\p{Ll}/u.test(word);
}

/**
 * Title-case a free-text value, respecting hyphens, slashes and apostrophes.
 *
 * The rest of each word is lower-cased on purpose: it is what turns SHOUTED or
 * sloppy input into something printable. The exception is a word that already
 * mixes cases — the version of a car is full of them, and «Sport Tourer
 * Business **Dci** 115» is not how Renault writes it.
 */
export function capitalizeWords(value: string): string {
  if (!value) return value;
  return value
    .split(WORD_BOUNDARY)
    .map(part => {
      if (WORD_BOUNDARY.test(part)) return part;
      if (isDeliberatelyMixedCase(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

/** Upper case, no spaces: plates, VIN, ID and licence numbers. */
export function toReference(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '');
}

/**
 * Rewrite an input's value as the operator types, **without losing the caret**.
 *
 * Assigning to `input.value` moves the caret to the end. Every field that
 * capitalised or upper-cased on `(input)` did exactly that, so correcting a
 * typo in the middle of a plate — 1234ABC, fix the 3 — jumped you to the end
 * and the next keystroke landed in the wrong place. On a phone, where you tap
 * to position the caret, it made those fields feel broken.
 *
 * The new caret is found by transforming the text *before* the caret and
 * measuring it: that survives transforms that drop characters (the spaces in a
 * VIN) as well as the ones that only change case.
 */
export function transformInput(
  input: HTMLInputElement,
  transform: (value: string) => string
): string {
  const previous = input.value;
  const next = transform(previous);
  if (next === previous) return next;

  const caret = input.selectionStart ?? previous.length;
  const nextCaret = transform(previous.slice(0, caret)).length;

  input.value = next;
  // Only when the field has focus: setting the range on a background input
  // steals it in some browsers.
  if (document.activeElement === input) {
    input.setSelectionRange(nextCaret, nextCaret);
  }
  return next;
}
