/**
 * Clases de CSS que una plantilla usa y **nadie declara**.
 *
 * ⚠️ Es el fallo que más se ha repetido en este proyecto, y siempre igual: el
 * código compila, los tests pasan, el despliegue va bien, y lo único que falla
 * es lo que ve el operador. Ya ha pasado con `.form-control` (inputs sin caja),
 * con `.btn-primary` (texto sobre fondo turquesa, sin botón), con
 * `.checkbox-label` (una casilla del sistema entre otras con caja) y con
 * `dashboard-card` (la tarjeta de mantenimiento sin fondo ni relleno).
 *
 * La causa es siempre la misma: **la encapsulación de Angular**. Una clase
 * declarada en el SCSS de otro componente no alcanza a esta plantilla, y una
 * clase que no declara nadie no da error en ninguna parte.
 *
 *   node scripts/css-audit.js
 *
 * Sale 1 si encuentra algo. No es perfecto —ver «lo que no puede saber»— así
 * que **avisa, no falla el build**: la lista se lee, no se obedece.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', 'src');

/** Prefijos de terceros y utilidades: no los declara nuestro SCSS y está bien. */
const AJENAS = [
  /^pi(-|$)/, // PrimeIcons
  /^ng-/, // Angular
  /^cdk-/,
  /^fa(-|$)/
];

/** Clases de Tailwind: las genera el motor, no un SCSS nuestro. */
const TAILWIND =
  /^(flex|grid|hidden|block|inline|w-|h-|m[trblxy]?-|p[trblxy]?-|gap-|text-|bg-|border|rounded|items-|justify-|absolute|relative|fixed|sticky|z-|overflow-|min-|max-|top-|left-|right-|bottom-|space-|col-|row-|order-|opacity-|shadow|cursor-|select-|truncate|sr-only)/;

function ficheros(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ficheros(p, ext, acc);
    else if (ext.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

/**
 * Las clases que **declara** un SCSS.
 *
 * Se buscan en todo el fichero y no solo a principio de línea: las variantes
 * anidadas (`&.fleet-card`) y las descendientes (`.card .list-title`) cuentan
 * igual, y son justo las que un `grep` ingenuo se deja.
 */
function declaradas(scss) {
  const limpio = scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return new Set([...limpio.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
}

/**
 * Las clases que **usa** una plantilla, con sus compañeras de elemento.
 *
 * ⚠️ **Las compañeras son lo que separa «roto» de «ruido»**, y sin eso la lista
 * no sirve. `class="section-card drivers-card"` con `.drivers-card` sin declarar
 * no rompe nada: la caja la pone `.section-card`, y la otra es un nombre para
 * poder encontrarla. Lo que sí rompe es `class="form-card"` a secas cuando
 * `.form-card` no existe: ahí no hay nada detrás y el formulario sale desnudo.
 */
function usadas(html) {
  const out = new Map(); // clase → { linea, companeras }
  const lineas = html.split('\n');
  lineas.forEach((linea, i) => {
    // class="a b c" — se ignoran las interpoladas, que no se pueden saber.
    for (const m of linea.matchAll(/\sclass="([^"{}]*)"/g)) {
      const grupo = m[1].split(/\s+/).filter(Boolean);
      for (const c of grupo) {
        if (!out.has(c)) out.set(c, { linea: i + 1, companeras: grupo.filter((x) => x !== c) });
      }
    }
    // [class.mi-clase]="expr" — siempre es un modificador sobre algo que ya está.
    for (const m of linea.matchAll(/\[class\.([\w-]+)\]/g)) {
      if (!out.has(m[1])) out.set(m[1], { linea: i + 1, companeras: ['(modificador)'] });
    }
  });
  return out;
}

// --- Lo global: `styles.scss` alcanza a todas las plantillas ---------------
const GLOBALES = new Set();
for (const f of ficheros(RAIZ, ['.scss']).filter((f) => !f.includes(path.sep + 'app' + path.sep))) {
  for (const c of declaradas(fs.readFileSync(f, 'utf8'))) GLOBALES.add(c);
}

// Los SCSS compartidos que un componente puede importar con `styleUrl`.
const COMPARTIDOS = new Map();
for (const f of ficheros(path.join(RAIZ, 'app'), ['.scss'])) {
  COMPARTIDOS.set(path.resolve(f), declaradas(fs.readFileSync(f, 'utf8')));
}

const hallazgos = [];

for (const html of ficheros(path.join(RAIZ, 'app'), ['.html'])) {
  // El SCSS del componente: mismo nombre, o el que diga su `styleUrl`.
  const ts = html.replace(/\.html$/, '.ts');
  const propias = new Set();
  const suScss = html.replace(/\.html$/, '.scss');
  if (fs.existsSync(suScss)) {
    for (const c of COMPARTIDOS.get(path.resolve(suScss)) || []) propias.add(c);
  }
  if (fs.existsSync(ts)) {
    const fuente = fs.readFileSync(ts, 'utf8');
    for (const m of fuente.matchAll(/styleUrls?:\s*\[?\s*['"]([^'"]+)['"]/g)) {
      const ruta = path.resolve(path.dirname(ts), m[1]);
      for (const c of COMPARTIDOS.get(ruta) || []) propias.add(c);
    }
  }

  const conocida = (c) =>
    GLOBALES.has(c) || propias.has(c) || AJENAS.some((r) => r.test(c)) || TAILWIND.test(c);

  for (const [clase, { linea, companeras }] of usadas(fs.readFileSync(html, 'utf8'))) {
    if (conocida(clase)) continue;
    // Si alguna compañera del mismo elemento sí está declarada, la pinta la pone
    // ella: esta clase es un nombre, no un estilo que falte.
    const respaldada = companeras.some((c) => conocida(c));
    hallazgos.push({
      fichero: path.relative(path.join(__dirname, '..'), html),
      linea,
      clase,
      grave: !respaldada,
      companeras
    });
  }
}

const graves = hallazgos.filter((h) => h.grave);
const leves = hallazgos.filter((h) => !h.grave);

if (!hallazgos.length) {
  console.log('✓ Ninguna clase huérfana: todo lo que se usa lo declara alguien.');
  process.exit(0);
}

const listar = (lista) => {
  const porFichero = new Map();
  for (const h of lista) porFichero.set(h.fichero, [...(porFichero.get(h.fichero) || []), h]);
  for (const [f, items] of [...porFichero].sort()) {
    console.log(`  ${f}`);
    for (const h of items) {
      const con = h.companeras.length ? `   (con: ${h.companeras.join(' ')})` : '';
      console.log(`      línea ${h.linea}: .${h.clase}${con}`);
    }
  }
};

if (graves.length) {
  console.log(`\n❌ ${graves.length} clase(s) SIN NADA DETRÁS — el elemento sale desnudo:\n`);
  listar(graves);
}
if (leves.length) {
  console.log(
    `\n·  ${leves.length} clase(s) sin estilo propio, pero el elemento lleva otra que sí lo tiene.` +
      `\n   No rompen nada: son nombres para poder encontrar el elemento. Se listan por si acaso.\n`
  );
  listar(leves);
}
console.log(`
  Lo que esto NO puede saber: clases construidas al vuelo, las que vengan de un
  componente hijo con \`::ng-deep\`, y las de Tailwind que no encajen en el patrón
  de arriba. Revisa la lista antes de creerla; lo que sea un falso positivo, se
  añade a AJENAS o a TAILWIND en este fichero.
`);
process.exit(graves.length ? 1 : 0);
