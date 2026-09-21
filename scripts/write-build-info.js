/**
 * Escribe en el código qué commit se está compilando.
 *
 * ⚠️ **Sirve para contestar una pregunta concreta: «¿estoy viendo lo último?»**
 * Hasta ahora el pie ponía `VELTO v1.0` y esa versión no se mueve nunca, así que
 * no distinguía un despliegue de otro. Y no es una duda teórica: el 21 de
 * septiembre de 2026 producción estuvo sirviendo el JavaScript nuevo con las
 * traducciones viejas por la caché de Cloudflare, y desde la pantalla no había
 * forma de saberlo.
 *
 * ## Por qué lo llama `package.json` y no el workflow
 *
 * ⚠️ **`firebase init hosting:github` REESCRIBE los workflows sin avisar** —está
 * documentado en CLAUDE.md porque ya pasó una vez y dejó producción compilando
 * contra desarrollo—. Metido en el workflow, este paso desaparecería con él y
 * nadie se enteraría: el pie seguiría pintando algo, solo que el commit de la
 * última vez que funcionó. Colgado de `build` y `build:prod`, sobrevive a esa
 * reescritura.
 *
 * ## Por qué fuera de CI escribe «local»
 *
 * ⚠️ **Para que compilar no ensucie el árbol de trabajo.** Con el SHA de verdad,
 * cada `npm run build` dejaría el fichero modificado y habría que descartarlo a
 * mano antes de cada commit — y lo que se descarta a mano acaba colándose. En CI
 * hay `GITHUB_SHA` y ahí sí se escribe el commit real, que es donde importa.
 */

const fs = require('fs');
const path = require('path');

const DESTINO = path.join(__dirname, '..', 'src', 'app', 'core', 'config', 'build-info.ts');

/**
 * El commit que se está compilando.
 *
 * En el workflow de `master`, `GITHUB_SHA` **es el commit del merge**, que es
 * justo lo que hay que poder comparar con la rama.
 */
function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  // Fuera de CI no se sella nada: ver la nota de arriba.
  return 'local';
}

/** La rama, cuando CI la dice. Sirve para distinguir desarrollo de producción. */
function rama() {
  const ref = process.env.GITHUB_REF_NAME || '';
  return ref || 'local';
}

const sha = commit();

/**
 * ⚠️ **Sin `as const`, y con el tipo escrito.** Con él, TypeScript estrecha
 * `commit` al literal que haya en el fichero —fuera de CI, `'local'`— y
 * cualquier comparación con otro valor deja la rama contraria en `never`:
 * `BUILD_INFO.commit.slice(0, 7)` deja de compilar. Y lo hace **solo en local**,
 * porque en CI el literal es un SHA: un fallo que no aparece donde se trabaja.
 */
const contenido = `/**
 * GENERADO por \`scripts/write-build-info.js\` en cada build. No se edita a mano.
 *
 * Fuera de CI vale \`local\`, para que compilar no ensucie el árbol de trabajo.
 * En CI lleva el commit real — en \`master\`, el del merge.
 */
export interface BuildInfo {
  /** El SHA que se compiló, o \`local\` fuera de CI. */
  commit: string;
  branch: string;
  /** ISO 8601. Vacío fuera de CI. */
  builtAt: string;
}

export const BUILD_INFO: BuildInfo = {
  commit: '${sha}',
  branch: '${rama()}',
  builtAt: '${sha === 'local' ? '' : new Date().toISOString()}'
};
`;

// Solo se escribe si cambia: así un build local no toca la fecha del fichero ni
// dispara a los que vigilan cambios.
const previo = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8') : '';
if (previo !== contenido) {
  fs.writeFileSync(DESTINO, contenido);
  console.log(`build-info: ${sha === 'local' ? 'local (fuera de CI)' : sha.slice(0, 7)}`);
} else {
  console.log('build-info: sin cambios');
}
