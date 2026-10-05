#!/usr/bin/env node
/**
 * Variables CSS usadas en `web/src` que no declara nadie.
 *
 * ⚠️ **Existe porque un `var()` sin declarar no se ignora: BORRA.** Es el
 * matiz que costó un fallo el 1 de octubre de 2026 y que estaba mal escrito en
 * la documentación del proyecto. Una declaración con una variable inexistente
 * es *inválida en tiempo de valor calculado*, y eso **no** es «la regla no
 * existe»: la propiedad pasa a valer `unset`, o sea su valor inicial. Y como
 * la regla sí participa en la cascada, **gana a la de debajo y la anula**.
 *
 * En la práctica: `.cal__dia--libre:hover { background: var(--bg-hover) }`
 * —un token del backoffice que aquí no existe— puso el fondo en
 * **transparente** encima del día ya elegido, que va con el texto en blanco.
 * Resultado: blanco sobre blanco, invisible, y solo al pasar el ratón. Ningún
 * build se queja, `astro check` no mira CSS y los tests tampoco.
 *
 * Es el hermano de `css:audit` del backoffice: aquel caza la clase que nadie
 * declara, este la variable.
 *
 * Uso: `npm --prefix web run vars:audit` — sale con código 1 si falta alguna.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(RAIZ, 'src');
const GLOBAL = join(SRC, 'styles', 'global.css');

/**
 * ⚠️ **Las declaradas salen del CSS global, que es donde viven los tokens.**
 * Si algún día una página declara las suyas en su propio bloque, hay que
 * añadir ese fichero aquí — y pensárselo dos veces: un token de tema que no
 * esté en los cuatro bloques de `global.css` se queda sin valor en tres temas.
 */
const declaradas = new Set(
  [...readFileSync(GLOBAL, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1])
);

/**
 * ⚠️ **Las propias de un `@keyframes` o de un `style=""` en línea no se
 * miran**, y tampoco hace falta: lo que rompe es el token de tema que no
 * existe, y esos se escriben siempre en las hojas.
 */
const archivos = [];
(function recorrer(dir) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) recorrer(ruta);
    else if (/\.(astro|css|ts)$/.test(entrada.name)) archivos.push(ruta);
  }
})(SRC);

/**
 * Quita los comentarios antes de mirar.
 *
 * ⚠️ **Sin esto el guion se caza a sí mismo**, y no es una anécdota: el sitio
 * donde más se nombra una variable rota es el comentario que explica por qué
 * se quitó. La primera ejecución señaló `--bg-hover` en la línea que cuenta
 * que `--bg-hover` no existe.
 *
 * ⚠️ **Y el `//` solo cuenta al principio de la línea**, o `https://…` se
 * comería media hoja.
 */
function sinComentarios(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const faltan = new Map();
for (const archivo of archivos) {
  const texto = sinComentarios(readFileSync(archivo, 'utf8'));
  for (const m of texto.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (declaradas.has(m[1])) continue;
    if (!faltan.has(m[1])) faltan.set(m[1], new Set());
    faltan.get(m[1]).add(relative(RAIZ, archivo));
  }
}

console.log(`Variables declaradas en global.css: ${declaradas.size}`);
console.log(`Ficheros mirados: ${archivos.length}`);

if (!faltan.size) {
  console.log('✓ Ninguna variable sin declarar.');
  process.exit(0);
}

console.error('\n✗ Variables usadas y NO declaradas:\n');
for (const [variable, donde] of faltan) {
  console.error(`  ${variable}  →  ${[...donde].join(', ')}`);
}
console.error(
  '\nUna de estas no deja la propiedad «sin efecto»: la pone a `unset` y anula\n' +
    'lo que hubiera debajo. Declárala en los cuatro bloques de tema o usa un\n' +
    'token que exista.\n'
);
process.exit(1);
