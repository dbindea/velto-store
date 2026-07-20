const fs = require('fs');
const used = new Set(fs.readFileSync('C:/Users/dorel/workspace/velto-store/src/assets/i18n/used-i18n-keys.txt', 'utf8').split('\n').filter(Boolean));
const locales = ['es', 'en', 'ro'];
const MODULES = new Set([
  'app','auth','menu','dashboard','layout','common',
  'vehicles','clients','reservations','inspections',
  'contracts','payments','workflow','photos','currentImage',
  'maintenance','timeline','brand','search','calendar','reports'
]);

// Dynamic-key prefixes used in template strings like 'foo.' + bar.
const DYNAMIC_PREFIXES = [
  'reservations.steps.'
];

function flatten(obj, prefix = '') {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    const full = prefix ? prefix + '.' + k : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, full));
    else out[full] = v;
  }
  return out;
}

for (const loc of locales) {
  const json = JSON.parse(fs.readFileSync(`C:/Users/dorel/workspace/velto-store/src/assets/i18n/${loc}.json`, 'utf8'));
  const flat = flatten(json);
  const have = new Set(Object.keys(flat).filter(k => MODULES.has(k.split('.')[0])));
  // Augment `used` with virtual leaves under dynamic prefixes.
  const usedAug = new Set(used);
  for (const prefix of DYNAMIC_PREFIXES) {
    for (const k of have) {
      if (k.startsWith(prefix)) usedAug.add(k);
    }
  }
  const orphan = [...have].filter(k => !usedAug.has(k));
  const missing = [...usedAug].filter(k => !have.has(k));
  console.log(`\n[${loc}.json]`);
  console.log('  used keys: ' + usedAug.size);
  console.log('  present (i18n): ' + have.size);
  console.log('  orphan (present but not used): ' + orphan.length);
  orphan.forEach(k => console.log('    - ' + k));
  console.log('  missing (used but not present): ' + missing.length);
  missing.forEach(k => console.log('    - ' + k));
}
