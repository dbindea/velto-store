// scripts/translations.js
//
// Reads the canonical schema, migrates existing translations, fills missing
// keys from a curated dictionary (es/en/ro), and writes the final files.
//
// Run:  node src/assets/i18n/build-translations.js

const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/dorel/workspace/velto-store/src/assets/i18n';

// ---------------------------------------------------------------------------
// Curated translations for keys the previous locale files were missing.
// Only keys that were NOT in the old es/en/ro files are listed here.
// ---------------------------------------------------------------------------

const T = {
  // common
  'common.create': { es: 'Crear', en: 'Create', ro: 'Creează' },

  // currentImage
  'currentImage.url': { es: 'URL de imagen actual', en: 'Current image URL', ro: 'URL imagine curentă' },

  // inspections.cleanliness (extra)
  'inspections.cleanliness.normal':  { es: 'Normal', en: 'Normal', ro: 'Normal' },
  'inspections.cleanliness.veryDirty': { es: 'Muy sucio', en: 'Very dirty', ro: 'Foarte murdar' },

  // inspections.fuel
  'inspections.fuel.empty':         { es: 'Vacío',         en: 'Empty',          ro: 'Gol' },
  'inspections.fuel.quarter':       { es: '1/4',           en: '1/4',            ro: '1/4' },
  'inspections.fuel.half':          { es: '1/2',           en: '1/2',            ro: '1/2' },
  'inspections.fuel.threeQuarters': { es: '3/4',           en: '3/4',            ro: '3/4' },
  'inspections.fuel.full':          { es: 'Lleno',         en: 'Full',           ro: 'Plin' },

  // inspections.photos categories
  'inspections.photos.front':     { es: 'Frontal',         en: 'Front',          ro: 'Față' },
  'inspections.photos.rear':      { es: 'Trasera',         en: 'Rear',           ro: 'Spate' },
  'inspections.photos.leftSide':  { es: 'Lateral izquierdo', en: 'Left side',    ro: 'Partea stângă' },
  'inspections.photos.rightSide': { es: 'Lateral derecho', en: 'Right side',     ro: 'Partea dreaptă' },
  'inspections.photos.interior':  { es: 'Interior',        en: 'Interior',       ro: 'Interior' },
  'inspections.photos.dashboard': { es: 'Cuadro',          en: 'Dashboard',      ro: 'Bord' },
  'inspections.photos.fuel':      { es: 'Combustible',     en: 'Fuel',           ro: 'Combustibil' },
  'inspections.photos.damage':    { es: 'Daño',            en: 'Damage',         ro: 'Deteriorare' },
  'inspections.photos.other':     { es: 'Otro',            en: 'Other',          ro: 'Altul' },

  // inspections.damages
  'inspections.damages.areaFront':     { es: 'Frontal',         en: 'Front',       ro: 'Față' },
  'inspections.damages.areaRear':      { es: 'Trasera',         en: 'Rear',        ro: 'Spate' },
  'inspections.damages.areaLeftSide':  { es: 'Lateral izquierdo', en: 'Left side', ro: 'Stânga' },
  'inspections.damages.areaRightSide': { es: 'Lateral derecho',  en: 'Right side', ro: 'Dreapta' },
  'inspections.damages.areaRoof':      { es: 'Techo',           en: 'Roof',        ro: 'Acoperiș' },
  'inspections.damages.areaInterior':  { es: 'Interior',        en: 'Interior',    ro: 'Interior' },
  'inspections.damages.areaWheels':    { es: 'Ruedas',          en: 'Wheels',      ro: 'Roți' },
  'inspections.damages.areaWindows':   { es: 'Ventanas',        en: 'Windows',     ro: 'Geamuri' },
  'inspections.damages.areaOther':     { es: 'Otro',            en: 'Other',       ro: 'Altul' },
  'inspections.damages.minor':         { es: 'Leve',            en: 'Minor',       ro: 'Minor' },
  'inspections.damages.medium':        { es: 'Medio',           en: 'Medium',      ro: 'Mediu' },
  'inspections.damages.serious':       { es: 'Grave',           en: 'Serious',     ro: 'Grav' },

  // inspections type labels
  'inspections.pickup': { es: 'Entrega',  en: 'Pickup',  ro: 'Predare' },
  'inspections.return': { es: 'Devolución', en: 'Return', ro: 'Returnare' },

  // reservations
  'reservations.actions.close':          { es: 'Cerrar reserva',     en: 'Close reservation', ro: 'Închide rezervarea' },
  'reservations.actions.viewReservation':{ es: 'Ver reserva',        en: 'View reservation',  ro: 'Vezi rezervarea' },

  // contracts (sign page)
  'contracts.sign.invalid': { es: 'Enlace no válido o contrato no encontrado.', en: 'Invalid link or contract not found.', ro: 'Link nevalid sau contract negăsit.' },
  'contracts.sign.highlightsTitle': { es: 'Lo principal a tener en cuenta', en: 'What you need to know', ro: 'Ce trebuie să știți' }
};

// ---------------------------------------------------------------------------
// 1. Load existing locale files (each flat-mapped).
// 2. Load canonical schema and flatten it.
// 3. For every schema leaf: pick from existing > T dict > identity placeholder.
// 4. Emit final JSON files keyed by schema structure.
// ---------------------------------------------------------------------------

function flatten(node, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(node || {})) {
    const full = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, full, out);
    else out[full] = v;
  }
  return out;
}

function unflatten(flat) {
  const root = {};
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return root;
}

// Pull the schema by extracting the object literal from build-schema.js.
const schemaCode = fs.readFileSync(path.join(ROOT, 'build-schema.js'), 'utf8');
const SCHEMA_START = schemaCode.indexOf('const SCHEMA = {');
{
  let depth = 0;
  let endIdx = -1;
  for (let i = SCHEMA_START + 'const SCHEMA = '.length; i < schemaCode.length; i++) {
    if (schemaCode[i] === '{') depth++;
    else if (schemaCode[i] === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  var schemaLiteral = schemaCode.slice(SCHEMA_START + 'const SCHEMA = '.length, endIdx + 1);
}
const SCHEMA = (new Function('return (' + schemaLiteral + ');'))();
const schemaLeaves = flatten(SCHEMA);

const used = fs.readFileSync(path.join(ROOT, 'used-i18n-keys.txt'), 'utf8')
  .split('\n').filter(Boolean);

function migrate(locale, existing) {
  const result = {};
  const missing = [];
  for (const k of used) {
    if (!(k in schemaLeaves)) {
      // key is in used but not schema — shouldn't happen because schema is validated
      continue;
    }
    if (existing[k] != null) {
      result[k] = existing[k];
    } else if (T[k] && T[k][locale]) {
      result[k] = T[k][locale];
    } else {
      missing.push(k);
      result[k] = k; // placeholder, will be flagged below
    }
  }
  if (missing.length) {
    console.warn('[' + locale + '] still missing translations for ' + missing.length + ' keys:');
    missing.forEach(k => console.warn('  - ' + k + ' (using key as placeholder)'));
  }
  return result;
}

function stripExisting(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return {};
  return flatten(JSON.parse(fs.readFileSync(p, 'utf8')));
}

const existing = {
  es: stripExisting('es.json'),
  en: stripExisting('en.json'),
  ro: stripExisting('ro.json')
};

const built = {
  es: migrate('es', existing.es),
  en: migrate('en', existing.en),
  ro: migrate('ro', existing.ro)
};

for (const loc of ['es', 'en', 'ro']) {
  const out = unflatten(built[loc]);
  const final = JSON.stringify(out, null, 2) + '\n';
  fs.writeFileSync(path.join(ROOT, loc + '.json'), final);
  console.log('Wrote ' + loc + '.json  (' + Object.keys(built[loc]).length + ' leaves)');
}

// Verify every locale has the same leaf count.
const counts = Object.fromEntries(Object.entries(built).map(([k, v]) => [k, Object.keys(v).length]));
console.log('Counts:', counts);
