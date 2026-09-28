/**
 * Lo que NO se puede cargar al arrancar.
 *
 * El contenedor de Cloud Functions evalúa `index.ts` **entero** en cada
 * arranque en frío, y `index.ts` reexporta las 34 functions. O sea que la
 * cadena de imports de la más pesada la paga también la más ligera: una
 * petición de `/api/fleet` desde la web pública llegó a cargar `pdf-lib`,
 * `fontkit`, `sharp` y el certificado de la AEAT antes de contestar con una
 * lista de coches.
 *
 * Medido el 28 de septiembre de 2026: **921 módulos y 886–1433 ms** antes,
 * **432 módulos y 361–449 ms** después de mover a `await import()` todo lo que
 * solo usa un camino concreto.
 *
 * ⚠️ **Este test existe porque el arreglo se deshace escribiendo una línea.**
 * Un `import { PDFDocument } from 'pdf-lib'` en un fichero que `index.ts`
 * alcanza compila, pasa los tests, despliega bien y **no se nota**: lo único
 * que cambia es que cada arranque en frío vuelve a tardar el triple. No hay
 * ningún síntoma que lleve hasta aquí.
 *
 * ⚠️ **Y mira el CÓDIGO FUENTE, no el bundle**, a propósito. Comprobarlo
 * cargando `lib/index.js` exigiría haber compilado antes —`npm test` es
 * `vitest run` a secas— y arrancaría de verdad el SDK de administración. Lo
 * que se recorre aquí es el grafo de imports **estáticos** desde `index.ts`:
 * un `await import()` no es una arista, que es justo lo que hace falta
 * distinguir.
 *
 * ⚠️ **El precio de mirar el fuente: un import que TypeScript ELIDE se cuenta
 * como si cargara.** Si todas las ligaduras de un `import { X } from 'dep'`
 * quedan sin usar como valor, el compilador no emite `require` y la dependencia
 * no llega a cargarse — pero aquí sale señalada. Es un falso positivo **y se ha
 * dejado así**: ese import no carga hoy y volverá a cargar en cuanto alguien
 * use `X` arriba, así que lo que hay es una línea que engaña al que la lee. Lo
 * que el test pide es borrarla o escribirla `import type`, que es lo correcto
 * en los dos casos.
 *
 * No es hipotético: al escribir este test, `compliance-declaration.ts` tenía
 * `import { PDFDocument } from 'pdf-lib'` **y** el `await import('pdf-lib')`
 * dentro de la función. El fichero parecía cargar pdf-lib al arrancar y no lo
 * hacía, y la medición en runtime decía lo contrario que el fuente.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve, relative } from 'path';

const SRC = resolve(__dirname);

/**
 * Lo que no puede estar en el camino de arranque, con lo que cuesta cada una
 * medido con `require` en frío.
 *
 * `fast-xml-parser` **no está en la lista y es deliberado**: son 9 ms y un solo
 * módulo, y vive en `verifactu-respuesta.ts` junto a `desenlaceDe()`, que sí
 * hace falta al arrancar. Separarlos sería partir en dos un módulo de la AEAT
 * con sus tests para ahorrar nueve milisegundos.
 */
const PROHIBIDAS: Array<{ nombre: string; ms: number }> = [
  { nombre: 'pdf-lib', ms: 187 },
  { nombre: 'fontkit', ms: 209 },
  { nombre: 'sharp', ms: 65 },
  { nombre: 'node-forge', ms: 46 },
  { nombre: 'qrcode-generator', ms: 6 },
  { nombre: '@signpdf/signpdf', ms: 184 },
  { nombre: '@signpdf/signer-p12', ms: 0 },
  { nombre: '@signpdf/placeholder-pdf-lib', ms: 0 }
];

/**
 * Los barrels de `firebase-functions`.
 *
 * ⚠️ **Cargan los proveedores de TODOS los tipos de trigger**, incluida la base
 * de datos en tiempo real —que esta aplicación no usa— por 340 ms y 407
 * módulos, frente a 270 y 380 pidiendo solo los subpaths que se usan. No basta
 * con mirar `index.ts`: el barrel entraba por `global-options.ts` y por un
 * `import { logger } from 'firebase-functions/v2'` repetido en cuatro
 * ficheros, así que la comprobación es sobre **todo** `src/`.
 */
const BARRELS = ['firebase-functions', 'firebase-functions/v2'];

/** Quita comentarios de línea sin tragarse el `//` de una URL. */
function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * Los especificadores que el fichero importa de forma **estática**.
 *
 * Se descartan dos cosas que no emiten `require`: los `import type` y los
 * `await import()`. Y se acumulan las líneas hasta el `from '…'`, porque un
 * import con varios miembros ocupa varias.
 */
function importsEstaticos(codigo: string): string[] {
  const fuera: string[] = [];
  let acumulado = '';

  for (const linea of codigo.split('\n')) {
    if (esComentario(linea)) continue;

    if (!acumulado) {
      const t = linea.trimStart();
      if (!/^(import|export)\b/.test(t)) continue;
      acumulado = t;
    } else {
      acumulado += ' ' + linea.trim();
    }

    const m = acumulado.match(/from\s+'([^']+)'/);
    if (!m) {
      // Un import de efecto (`import './x';`) no lleva `from`.
      const solo = acumulado.match(/^import\s+'([^']+)'\s*;/);
      if (solo) {
        fuera.push(solo[1]);
        acumulado = '';
      } else if (acumulado.includes(';')) {
        acumulado = '';
      }
      continue;
    }

    // `import type X from` / `export type { X } from` no emiten nada.
    if (!/^(import|export)\s+type\b/.test(acumulado)) fuera.push(m[1]);
    acumulado = '';
  }

  return fuera;
}

/** Resuelve `'./x'` al fichero de `src/` que es. */
function resolverRelativo(desde: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(desde), spec);
  for (const candidato of [base + '.ts', join(base, 'index.ts')]) {
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

/** Los ficheros que `index.ts` alcanza SIN pasar por un `await import()`. */
function alcanzablesAlArrancar(): Map<string, string[]> {
  const vistos = new Map<string, string[]>();
  const cola = [join(SRC, 'index.ts')];

  while (cola.length) {
    const f = cola.pop() as string;
    if (vistos.has(f)) continue;
    const specs = importsEstaticos(readFileSync(f, 'utf8'));
    vistos.set(f, specs);
    for (const s of specs) {
      const hijo = resolverRelativo(f, s);
      if (hijo) cola.push(hijo);
    }
  }

  return vistos;
}

/** Todos los `.ts` de `src/` que no son tests. */
function todosLosFuentes(): string[] {
  const { readdirSync } = require('fs') as typeof import('fs');
  const fuera: string[] = [];
  (function recorrer(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) fuera.push(p);
    }
  })(SRC);
  return fuera;
}

const corto = (f: string) => relative(SRC, f).replace(/\\/g, '/');

describe('el camino de arranque', () => {
  const grafo = alcanzablesAlArrancar();

  it('alcanza index.ts y sus reexports', () => {
    // Un fallo aquí significa que el recorrido está roto, no que el código lo esté.
    expect(grafo.size).toBeGreaterThan(20);
    expect([...grafo.keys()].map(corto)).toContain('index.ts');
  });

  it.each(PROHIBIDAS)('no carga $nombre al arrancar ($ms ms)', ({ nombre }) => {
    const culpables = [...grafo.entries()]
      .filter(([, specs]) => specs.some((s) => s === nombre || s.startsWith(nombre + '/')))
      .map(([f]) => corto(f));

    expect(
      culpables,
      `${nombre} se importa de forma estática desde ${culpables.join(', ')}. ` +
        `Si ese módulo solo lo usa un camino concreto, la forma es ` +
        `\`const { X } = await import('…')\` dentro de la función que lo usa.`
    ).toEqual([]);
  });

  it.each(BARRELS)('ningún fichero importa el barrel %s', (barrel) => {
    const culpables = todosLosFuentes()
      .filter((f) => importsEstaticos(readFileSync(f, 'utf8')).includes(barrel))
      .map(corto);

    expect(
      culpables,
      `${culpables.join(', ')} importa el barrel '${barrel}'. Usa el subpath: ` +
        `'firebase-functions/v2/https', '/v2/scheduler', '/v2/firestore', ` +
        `'/v2/options', '/params' o '/logger'.`
    ).toEqual([]);
  });
});

/**
 * Cada import perezoso resuelve y entrega lo que desestructura.
 *
 * ⚠️ **Es la otra mitad del trabajo, y la que puede costar caro.** Mover algo a
 * `await import()` lo saca del arranque, así que un especificador mal escrito
 * **ya no falla al arrancar**: falla la primera vez que alguien genera un PDF o
 * firma un contrato, en producción, con el cliente delante. El compilador
 * comprueba los nombres, pero no que el módulo que Node carga sea el que
 * TypeScript miró — que es exactamente lo que pasó con `sharp`, cuyos tipos
 * declaran la variante ESM mientras su `main` es la CommonJS.
 */
const SITIOS_PEREZOSOS: Array<{ desde: string; spec: string; nombres: string[] }> = (() => {
  const fuera: Array<{ desde: string; spec: string; nombres: string[] }> = [];
  for (const f of todosLosFuentes()) {
    const codigo = readFileSync(f, 'utf8');
    const re =
      /const\s*\{([^}]+)\}\s*=\s*(?:await\s+import|require)\s*\(\s*\n?\s*'([^']+)'\s*\n?\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(codigo))) {
      fuera.push({
        desde: corto(f),
        spec: m[2],
        nombres: m[1]
          .split(',')
          .map((s) => s.trim().split(':')[0].trim())
          .filter(Boolean)
      });
    }
  }
  return fuera;
})();

describe('los imports perezosos', () => {
  it('hay los que se esperan', () => {
    // Si el recorrido dejara de encontrarlos, los `it.each` de abajo pasarían
    // por no comprobar nada.
    expect(SITIOS_PEREZOSOS.length).toBeGreaterThan(15);
  });

  it.each(SITIOS_PEREZOSOS)(
    '$desde carga $spec y encuentra lo que pide',
    async ({ desde, spec, nombres }) => {
      /**
       * ⚠️ **Se carga con `import()` y no con `require()`.** Aquí se están
       * cargando ficheros `.ts` sin compilar: el resolutor de Node solo prueba
       * `.js`, `.json` y `.node`, así que un `require('./receipt-pdf')` falla
       * con «Cannot find module» aunque la ruta sea exacta. Quien sabe
       * transformar TypeScript es vitest, y solo por esta vía.
       *
       * ⚠️ Y la ruta relativa va contra la carpeta del fichero **que importa**,
       * no contra `src/`, o `../contracts/pdf` se pierde.
       */
      const mod = spec.startsWith('.')
        ? await import(/* @vite-ignore */ resolve(SRC, dirname(desde), spec) + '.ts')
        : await import(/* @vite-ignore */ spec);

      for (const n of nombres) {
        expect(mod, `${spec} no exporta ${n}`).toHaveProperty(n);
        expect(mod[n], `${spec}.${n} es undefined`).toBeDefined();
      }
    }
  );
});

describe('el recorrido de imports', () => {
  // Sin esto el test de arriba pasaría por no encontrar nada, que es el modo
  // de fallo de cualquier comprobación escrita en negativo.
  it('distingue un import estático de un `await import()`', () => {
    const codigo = [
      "import { a } from './estatico';",
      "import type { T } from './solo-tipo';",
      "export { b } from './reexportado';",
      'async function f() {',
      "  const { c } = await import('./perezoso');",
      '}',
      "// import { d } from './comentado';",
      "import {\n  e,\n  g\n} from './multilinea';"
    ].join('\n');

    expect(importsEstaticos(codigo)).toEqual(['./estatico', './reexportado', './multilinea']);
  });

  it('no confunde el // de una URL con un comentario', () => {
    const codigo = ["const u = 'https://ejemplo.com';", "import { a } from './x';"].join('\n');
    expect(importsEstaticos(codigo)).toEqual(['./x']);
  });
});
