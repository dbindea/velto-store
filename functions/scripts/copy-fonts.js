// Copy the runtime assets the PDF renderer needs from src/ to lib/ after tsc.
// pdf.ts loads them from the directory next to its own compiled file.
//
// Run via: npm run build:fonts  (called automatically by npm run build)
//
// Two families, on purpose:
//
//   DejaVu Sans — body text. Covers Romanian (ă ș ț) and the euro sign.
//   Gotham      — brand font, headings only. It has NEITHER the Romanian
//                 diacritics NOR "€", so it can never be the body font; the
//                 renderer falls back to DejaVu per string when a glyph is
//                 missing. Same rule the web app follows in styles.scss.
//
// Gotham and the logo are NOT duplicated into functions/: they are read from
// the app's own assets, so the PDFs follow whatever the brand files say.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const LIB = path.join(ROOT, 'lib', 'contracts');

if (!fs.existsSync(LIB)) {
  fs.mkdirSync(LIB, { recursive: true });
}

/** [source file, destination name] */
const ASSETS = [
  [path.join(ROOT, 'src', 'contracts', 'DejaVuSans.ttf'), 'DejaVuSans.ttf'],
  [path.join(ROOT, 'src', 'contracts', 'DejaVuSans-Bold.ttf'), 'DejaVuSans-Bold.ttf'],
  [path.join(ROOT, 'src', 'contracts', 'DejaVuSans-Oblique.ttf'), 'DejaVuSans-Oblique.ttf'],
  [path.join(REPO, 'src', 'assets', 'fonts', 'GothamBold.ttf'), 'GothamBold.ttf'],
  [path.join(REPO, 'src', 'assets', 'fonts', 'GothamMedium.ttf'), 'GothamMedium.ttf'],
  [path.join(REPO, 'src', 'assets', 'brand', 'logo-on-light.svg'), 'logo-on-light.svg']
];

let copied = 0;
const missing = [];
for (const [from, name] of ASSETS) {
  if (!fs.existsSync(from)) {
    missing.push(from);
    continue;
  }
  fs.copyFileSync(from, path.join(LIB, name));
  copied += 1;
}

console.log(`Copied ${copied} PDF asset(s) to lib/contracts/`);
if (missing.length) {
  // A missing Gotham or logo degrades gracefully (DejaVu, no logo); a missing
  // DejaVu does not, so make the noise loud enough to notice either way.
  console.warn('MISSING PDF assets:\n  ' + missing.join('\n  '));
}
