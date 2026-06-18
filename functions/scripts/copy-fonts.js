// Copy TTF font files from src/ to lib/ after tsc runs.
// pdf.ts loads them at runtime from the directory next to its compiled file.
//
// Run via: npm run build:fonts
// (called automatically by npm run build)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'contracts');
const LIB = path.join(ROOT, 'lib', 'contracts');

if (!fs.existsSync(LIB)) {
  fs.mkdirSync(LIB, { recursive: true });
}

const fonts = [
  'DejaVuSans.ttf',
  'DejaVuSans-Bold.ttf',
  'DejaVuSans-Oblique.ttf'
];

let copied = 0;
for (const name of fonts) {
  const from = path.join(SRC, name);
  const to = path.join(LIB, name);
  if (!fs.existsSync(from)) {
    console.warn('Font not found, skipping:', from);
    continue;
  }
  fs.copyFileSync(from, to);
  copied += 1;
}
console.log('Copied ' + copied + ' TTF font(s) to lib/contracts/');
