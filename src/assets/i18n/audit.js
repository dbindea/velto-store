/**
 * i18n audit for velto-store.
 *
 * The es/en/ro JSON files are the single source of truth. This script only
 * reads them and reports; it never writes. Run it with `npm run i18n:audit`.
 *
 * It replaces an earlier four-script pipeline (used.js -> filter.js ->
 * build-schema.js -> build-translations.js) that kept a second, hand-written
 * copy of the key tree in build-schema.js and regenerated the JSON files from
 * it. The two copies drifted, and because the old audit filtered BOTH the used
 * keys and the present keys through the same module allow-list, any key with an
 * unlisted prefix vanished from both sides and could never be reported missing.
 * It reported a clean bill of health while the UI showed raw keys.
 *
 * What is checked:
 *
 *   1. MISSING   — a key referenced from src/app that no locale file defines.
 *                  At runtime TranslateService returns the key itself, so the
 *                  user sees `vehicles.status.rented` on screen.
 *   2. ORPHAN    — a key defined in es.json that nothing references.
 *   3. PARITY    — es.json is the reference. en/ro must have exactly the same
 *                  key set, otherwise those users fall back to the raw key
 *                  (there is no Spanish fallback in TranslateService).
 *   4. UNTRANSLATED — en/ro values byte-identical to Spanish. Reported as a
 *                  warning only: "Premium", "SUV" and "Mini" are legitimately
 *                  identical across the three languages.
 *
 * Exit code is 1 when 1, 2 or 3 fail, so CI can gate on it.
 */

const fs = require('fs');
const path = require('path');

const I18N_DIR = __dirname;
const APP_DIR = path.resolve(__dirname, '../../app');
const LOCALES = ['es', 'en', 'ro'];
const REFERENCE = 'es';

function* walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|html)$/.test(entry)) yield full;
  }
}

function flatten(obj, prefix = '') {
  const out = {};
  for (const key of Object.keys(obj || {})) {
    const full = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, full));
    } else {
      out[full] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collect the keys the app actually references.
// ---------------------------------------------------------------------------

// `'x.y' | translate` in templates.
const RE_PIPE = /['"]([^'"]+)['"]\s*\|\s*translate/g;
// `translateService.translate('x.y')` in components.
const RE_SERVICE = /\.translate\(\s*['"]([^'"]+)['"]/g;
// Values of the *_LABELS maps, which hold keys rather than display text.
const RE_LABEL_VALUE = /:\s*'([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)'/g;
// Prefixes built at runtime, e.g. `'clients.trustLevel.' + level`.
const RE_DYNAMIC_PREFIX = /['"]([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*\.)['"]\s*\+/g;
// Same idea via template literal: `reservations.timeline.${key}`.
const RE_DYNAMIC_TEMPLATE = /`([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*\.)\$\{/g;
// Any dotted string literal. Deliberately loose.
const RE_ANY_LITERAL = /['"]([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)['"]/g;

// Two sets on purpose, because the two questions need opposite biases:
//
//   `referenced`  — only patterns that are certainly i18n keys. Used for the
//                   MISSING check, where a false positive would fail the build
//                   over something that was never a key.
//   `anyLiteral`  — every dotted literal in the codebase. Used for the ORPHAN
//                   check, where a false negative would delete a key that IS
//                   used through a call shape we did not anticipate, such as
//                   `deny('workflow.cancelled')` in reservation-workflow.util.
const referenced = new Set();
const anyLiteral = new Set();
const dynamicPrefixes = new Set();

for (const file of walk(APP_DIR)) {
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = RE_PIPE.exec(text))) referenced.add(m[1]);
  while ((m = RE_SERVICE.exec(text))) referenced.add(m[1]);
  while ((m = RE_LABEL_VALUE.exec(text))) referenced.add(m[1]);
  while ((m = RE_DYNAMIC_PREFIX.exec(text))) dynamicPrefixes.add(m[1]);
  while ((m = RE_DYNAMIC_TEMPLATE.exec(text))) dynamicPrefixes.add(m[1]);
  while ((m = RE_ANY_LITERAL.exec(text))) anyLiteral.add(m[1]);
}

/**
 * Expected leaves for every composed key, e.g. `'reservations.steps.' + step`.
 *
 * A composed key cannot be matched literally, so without this registry the
 * audit can only tell that the PREFIX is used — never that the leaves exist.
 * That blind spot is why the four wizard step labels and the ten timeline
 * milestones shipped missing while the audit reported a clean run.
 *
 * The value lists mirror the TypeScript unions that feed each site. When one of
 * those unions gains a member, add it here too; the check below fails on any
 * prefix found in the code that is not registered, so a new composed key cannot
 * be introduced without declaring its leaves.
 */
const DYNAMIC_KEY_SETS = {
  // reservation.model.ts › ReservationStatus
  'reservations.status.': ['reserved', 'confirmed', 'delivered', 'returned', 'closed', 'cancelled'],
  // reservation-create.component.ts › Step
  'reservations.steps.': ['dates', 'vehicle', 'client', 'summary'],
  // reservation-workflow.util.ts › TimelineStepKey
  'reservations.timeline.': [
    'reservationCreated',
    'initialPaymentPaid',
    'contractGenerated',
    'contractSigned',
    'remainingPaymentPaid',
    'depositPaid',
    'pickupCompleted',
    'returnCompleted',
    'depositSettled',
    'reservationClosed'
  ],
  // client.model.ts › ClientDocumentType
  'clients.documentTypes.': ['dni', 'nie', 'passport', 'other'],
  // client.model.ts › ClientTrustLevel
  'clients.trustLevel.': ['new', 'known', 'regular', 'risk', 'blocked'],
  // vehicle-maintenance.model.ts › MaintenanceType
  'maintenance.type.': [
    'oilChange',
    'tires',
    'itv',
    'insurance',
    'generalRevision',
    'brakes',
    'battery',
    'breakdown',
    'cleaning',
    'other'
  ]
};

// A key under a dynamic prefix counts as referenced: the leaf is only known at
// runtime, so it cannot be matched literally.
const coveredByPrefix = (key) => [...dynamicPrefixes].some((p) => key.startsWith(p));

// ---------------------------------------------------------------------------
// Load locales and report.
// ---------------------------------------------------------------------------

const flat = {};
for (const locale of LOCALES) {
  flat[locale] = flatten(JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${locale}.json`), 'utf8')));
}

let failed = false;
const list = (items, limit = 30) =>
  items
    .slice(0, limit)
    .map((k) => `      - ${k}`)
    .join('\n') + (items.length > limit ? `\n      … y ${items.length - limit} más` : '');

console.log(`Claves referenciadas desde src/app: ${referenced.size}`);
console.log(`Prefijos dinámicos: ${[...dynamicPrefixes].sort().join(', ') || '(ninguno)'}\n`);

// 1. Missing
for (const locale of LOCALES) {
  const missing = [...referenced].filter((k) => !(k in flat[locale])).sort();
  if (missing.length) {
    failed = true;
    console.log(`  ✗ ${locale}.json — ${missing.length} claves FALTAN (el usuario verá la clave en crudo)`);
    console.log(list(missing));
  } else {
    console.log(`  ✓ ${locale}.json — no falta ninguna clave referenciada`);
  }
}

// 1b. Composed keys: every registered prefix must have every leaf, in every
//     locale. And every prefix found in the code must be registered.
console.log('');
const unregistered = [...dynamicPrefixes].filter((p) => !(p in DYNAMIC_KEY_SETS)).sort();
if (unregistered.length) {
  failed = true;
  console.log(`  ✗ Prefijos compuestos SIN REGISTRAR en DYNAMIC_KEY_SETS (audit.js):`);
  console.log(list(unregistered));
  console.log(`      Declara sus valores posibles o el auditor no puede verificar sus hojas.`);
}

let composedOk = true;
for (const [prefix, values] of Object.entries(DYNAMIC_KEY_SETS)) {
  for (const locale of LOCALES) {
    const missing = values.filter((v) => !(prefix + v in flat[locale])).sort();
    if (missing.length) {
      failed = true;
      composedOk = false;
      console.log(`  ✗ ${locale}.json — ${prefix}* sin hojas: ${missing.join(', ')}`);
    }
  }
}
if (composedOk && !unregistered.length) {
  const total = Object.values(DYNAMIC_KEY_SETS).reduce((n, v) => n + v.length, 0);
  console.log(`  ✓ claves compuestas — ${total} hojas presentes en los tres idiomas`);
}

// 2. Orphans (against the reference locale)
const orphans = Object.keys(flat[REFERENCE])
  .filter((k) => !anyLiteral.has(k) && !coveredByPrefix(k))
  .sort();
if (orphans.length) {
  failed = true;
  console.log(`\n  ✗ ${REFERENCE}.json — ${orphans.length} claves HUÉRFANAS (definidas pero sin usar)`);
  console.log(list(orphans));
} else {
  console.log(`\n  ✓ ${REFERENCE}.json — sin claves huérfanas`);
}

// 3. Parity against the reference locale
const referenceKeys = new Set(Object.keys(flat[REFERENCE]));
for (const locale of LOCALES.filter((l) => l !== REFERENCE)) {
  const localeKeys = new Set(Object.keys(flat[locale]));
  const missing = [...referenceKeys].filter((k) => !localeKeys.has(k)).sort();
  const extra = [...localeKeys].filter((k) => !referenceKeys.has(k)).sort();
  if (missing.length || extra.length) {
    failed = true;
    console.log(`\n  ✗ ${locale}.json — desalineado con ${REFERENCE}.json: faltan ${missing.length}, sobran ${extra.length}`);
    if (missing.length) console.log(list(missing));
    if (extra.length) console.log(list(extra));
  } else {
    console.log(`  ✓ ${locale}.json — misma estructura que ${REFERENCE}.json`);
  }
}

// 3b. Placeholder values: a leaf whose value IS its own key. TranslateService
//     finds it and returns it, so the raw key is rendered on screen with no
//     error anywhere — `contracts.sign.highlightsTitle` shipped like this and
//     was only caught by looking at the signing page.
for (const locale of LOCALES) {
  const selfReferential = Object.keys(flat[locale])
    .filter((k) => flat[locale][k] === k)
    .sort();
  if (selfReferential.length) {
    failed = true;
    console.log(`\n  ✗ ${locale}.json — ${selfReferential.length} valores son su propia clave (marcador sin traducir)`);
    console.log(list(selfReferential));
  }
}

// 4. Untranslated values (warning only)
console.log('');
for (const locale of LOCALES.filter((l) => l !== REFERENCE)) {
  const same = Object.keys(flat[locale]).filter(
    (k) =>
      k in flat[REFERENCE] &&
      typeof flat[locale][k] === 'string' &&
      flat[locale][k] === flat[REFERENCE][k] &&
      flat[REFERENCE][k].length > 3
  );
  console.log(`  · ${locale}.json — ${same.length} valores idénticos al español (revisar, algunos son correctos)`);
}

console.log('');
if (failed) {
  console.log('Auditoría i18n: FALLA');
  process.exit(1);
}
console.log('Auditoría i18n: OK');
