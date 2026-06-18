const fs = require('fs');
const text = fs.readFileSync('C:/Users/dorel/workspace/velto-store/src/assets/i18n/used-keys.txt', 'utf8');
const lines = text.split('\n').filter(Boolean);
// Heuristic: a key is an i18n key if its first segment is one of these modules.
const MODULES = new Set([
  'app', 'auth', 'menu', 'dashboard', 'layout', 'common',
  'vehicles', 'clients', 'reservations', 'inspections',
  'contracts', 'payments', 'workflow', 'photos', 'currentImage'
]);
const filtered = lines.filter(k => MODULES.has(k.split('.')[0]));
const unique = [...new Set(filtered)].sort();
console.log('Total likely-i18n keys referenced in src/app: ' + unique.length);
fs.writeFileSync('C:/Users/dorel/workspace/velto-store/src/assets/i18n/used-i18n-keys.txt', unique.join('\n'));
console.log('Saved.');
