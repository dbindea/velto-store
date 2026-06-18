const fs = require('fs');
const path = require('path');
const root = 'C:/Users/dorel/workspace/velto-store/src/app';
function* walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (/\.(ts|html)$/.test(f)) yield full;
  }
}
const used = new Set();
const re = /['"]([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)['"]/g;
for (const file of walk(root)) {
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = re.exec(text))) used.add(m[1]);
}
const sorted = [...used].sort();
console.log('Total keys referenced: ' + sorted.length);
fs.writeFileSync('C:/Users/dorel/workspace/velto-store/src/assets/i18n/used-keys.txt', sorted.join('\n'));
console.log('First 80:');
sorted.slice(0, 80).forEach(k => console.log('  ' + k));
