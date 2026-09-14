/**
 * La escala de espaciado, y quién se sale de ella.
 *
 * ⚠️ **El problema no era un margen mal puesto: eran cuarenta y un valores
 * distintos.** El 14 de septiembre de 2026 la aplicación declaraba 1750
 * espaciados con 41 valores diferentes —0,35 / 0,4 / 0,45 / 0,55 / 0,6 / 0,65 /
 * 0,85 / 0,9 rem…—, todos casi iguales entre sí y ninguno alineado con el
 * siguiente. Por eso unas descripciones salían pegadas al campo y otras no, sin
 * que hubiera un culpable concreto que arreglar.
 *
 * La escala son múltiplos de 2 px hasta 1 rem y de 4 px por encima. No es una
 * preferencia estética: es lo que hace que dos bloques escritos por separado
 * caigan en la misma rejilla sin tener que acordarse.
 *
 * Uso:
 *   node scripts/spacing-audit.js           comprueba y sale con 1 si hay algo fuera
 *   node scripts/spacing-audit.js --fix     lo lleva al valor de escala más cercano
 *
 * ⚠️ **`--fix` solo mueve a la escala, nunca reescala.** Todos los ajustes son
 * de 1,6 px o menos: lo justo para alinear, no para recomponer una pantalla.
 */

const fs = require('fs');
const path = require('path');

/** Múltiplos de 2 px hasta 1 rem, de 4 px hasta 2 y de 8 px por encima. */
const ESCALA = [
  0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875,
  1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6
];

/** Solo espaciado. `font-size`, `border-radius` y compañía no entran aquí. */
const PROPIEDADES = [
  'gap', 'row-gap', 'column-gap',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right'
];

/**
 * Lo que se queda fuera de la comprobación, con su motivo.
 *
 * ⚠️ **Un valor negativo suele ser una compensación**, no un espaciado: tira de
 * un elemento hacia fuera de su caja para alinearlo con algo. Llevarlo a la
 * escala rompería justo lo que compensa.
 */
const IGNORAR = [
  /^-/,           // compensaciones
  /^0$/           // el cero no tiene escala
];

/**
 * Lo más que `--fix` se permite mover un valor: 2 px.
 *
 * ⚠️ **Sin este tope, unificar deja de ser alinear y pasa a ser recomponer.** Un
 * `padding-bottom: 260px` que reserva sitio para una barra fija tiene el valor
 * de escala más cercano a 96 px: llevarlo ahí no arregla ningún espaciado, tapa
 * media pantalla. Lo que se pasa del tope se **informa** para mirarlo a mano, no
 * se toca.
 */
const TOPE_REM = 0.125;

function valorMasCercano(n) {
  let mejor = ESCALA[0];
  let dist = Math.abs(n - mejor);
  for (const v of ESCALA) {
    const d = Math.abs(n - v);
    // En un empate gana el menor: apretar un poco se nota menos que separar.
    if (d < dist) { mejor = v; dist = d; }
  }
  return mejor;
}

function aRem(valor) {
  const m = valor.match(/^(-?\d*\.?\d+)(rem|px|em)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === 'rem' || m[2] === 'em') return n;
  return n / 16;
}

function ficheros(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      ficheros(p, salida);
    } else if (e.name.endsWith('.scss')) {
      salida.push(p);
    }
  }
  return salida;
}

function revisar(arreglar) {
  const fuera = [];
  let corregidos = 0;

  for (const f of ficheros('src')) {
    const original = fs.readFileSync(f, 'utf8');
    let texto = original;

    texto = texto.replace(
      /([a-z-]+)(\s*:\s*)([^;{}\n]+);/g,
      (todo, prop, sep, valores) => {
        if (!PROPIEDADES.includes(prop.trim())) return todo;
        // Nada con var(), calc() ni interpolación: ahí el número no es el dato.
        if (/var\(|calc\(|#\{/.test(valores)) return todo;

        let tocado = false;
        const nuevos = valores.trim().split(/\s+/).map((v) => {
          if (IGNORAR.some((re) => re.test(v))) return v;
          const rem = aRem(v);
          if (rem === null) return v;
          if (ESCALA.includes(rem)) return v;

          const destino = valorMasCercano(rem);
          const lejos = Math.abs(rem - destino) > TOPE_REM;
          fuera.push({
            fichero: f,
            prop: prop.trim(),
            valor: v,
            destino: `${destino}rem`,
            lejos
          });
          // Lo que se pasa del tope se informa, pero no se toca: ahí ya no se
          // está alineando nada, se está cambiando el diseño.
          if (!arreglar || lejos) return v;
          tocado = true;
          corregidos++;
          return `${destino}rem`;
        });

        return tocado ? `${prop}${sep}${nuevos.join(' ')};` : todo;
      }
    );

    if (arreglar && texto !== original) fs.writeFileSync(f, texto, 'utf8');
  }

  return { fuera, corregidos };
}

const arreglar = process.argv.includes('--fix');
const { fuera, corregidos } = revisar(arreglar);

if (arreglar) {
  console.log(`Espaciados llevados a la escala: ${corregidos}`);
  process.exit(0);
}

if (!fuera.length) {
  console.log('Escala de espaciado: OK — todo cae en la rejilla.');
  process.exit(0);
}

const cerca = fuera.filter((f) => !f.lejos);
const lejos = fuera.filter((f) => f.lejos);

const agrupar = (lista) => {
  const m = new Map();
  for (const f of lista) {
    const clave = `${f.valor} → ${f.destino}`;
    m.set(clave, (m.get(clave) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`\n✗ ${fuera.length} espaciado(s) fuera de la escala, en ${
  new Set(fuera.map((f) => f.fichero)).size
} fichero(s).\n`);

if (cerca.length) {
  console.log(`  Se alinean solos (mueven 2 px o menos) — ${cerca.length}:`);
  for (const [clave, n] of agrupar(cerca)) {
    console.log(`   ${String(n).padStart(4)}   ${clave}`);
  }
  console.log('\n   npm run spacing:audit -- --fix\n');
}

if (lejos.length) {
  console.log(`  ⚠️  A MANO — ${lejos.length}: mover esto no alinea, cambia el diseño.`);
  for (const f of lejos) {
    console.log(`        ${f.fichero}  ${f.prop}: ${f.valor}  (la escala diría ${f.destino})`);
  }
  console.log('\n   Si el valor es deliberado, a IGNORAR en este fichero con su motivo.\n');
}

process.exit(1);
