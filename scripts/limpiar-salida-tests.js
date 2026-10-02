/**
 * Borra `dist/test-out` antes de cada `npm test`.
 *
 * ⚠️ **El builder de tests deja una carpeta POR EJECUCIÓN y no borra ninguna.**
 * `@angular/build:unit-test` compila la aplicación para poder pasar los tests y
 * escribe el resultado en `dist/test-out/<fecha>-<hash>`. Nada lo limpia: medido
 * el 2 de octubre de 2026 había **308 carpetas y 3,6 GB**, desde el 21 de
 * agosto. Para comparar, la build de verdad de la aplicación ocupa 3,7 MB — o
 * sea que el 99,9 % de `dist/` era basura de tests, y crece unos 12 MB cada vez
 * que alguien ejecuta `npm test`.
 *
 * Ese día el disco de Dorel estaba al 100 % y empezaban a fallar comandos
 * sueltos con «No space left on device», que es un error que no dice de dónde
 * viene.
 *
 * ⚠️ **Va en `pretest` y no en `posttest`.** npm solo ejecuta el `post…` si el
 * script termina bien, así que una tanda de tests que falla —justo cuando más
 * veces se repite— dejaría su carpeta para siempre.
 *
 * ⚠️ **Y es Node, no `rm -rf`.** Dorel trabaja en PowerShell 5.1 y aquí se
 * escriben comandos de shell tipo Unix por inercia; un `rm -rf` en un script de
 * `package.json` falla en su máquina y no en la mía, que es la peor forma de
 * fallar.
 *
 * No toca `dist/velto-store`, que es la build que despliega el hosting.
 */

const fs = require('node:fs');
const path = require('node:path');

const salida = path.join(__dirname, '..', 'dist', 'test-out');

if (fs.existsSync(salida)) {
  const cuantas = fs.readdirSync(salida).length;
  fs.rmSync(salida, { recursive: true, force: true });
  if (cuantas) console.log(`Limpiadas ${cuantas} salidas de tests anteriores.`);
}
