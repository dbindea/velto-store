/**
 * Formularios en escalera: campos que deberían ir al lado y salen escalonados.
 *
 * ⚠️ **El fallo que este guion persigue ya ha aparecido dos veces, igual las
 * dos.** `styles.scss` le da a cada `.form-group` un `margin-top: 1rem` para
 * separarlo del hermano de arriba, y esa regla **no sabe en qué dirección
 * coloca el contenedor**: dentro de una rejilla horizontal el margen se lo come
 * la columna derecha, que baja 16 px y deja la fila torcida. La corrección es
 * anular el margen dentro de los contenedores que colocan en horizontal, y esos
 * contenedores estaban **enumerados a mano**.
 *
 * La primera lista traía cinco y faltaban cuatro. El que se vio fue
 * `.form-grid-inner`, en «Estado del vehículo» de las inspecciones: «Nivel de
 * combustible» salía por debajo de «Kilometraje». Lo encontró Dorel mirando la
 * pantalla, porque no hay nada más que pueda encontrarlo — compila, los tests
 * pasan, `css:audit` da cero y el despliegue va bien.
 *
 *   node scripts/rows-audit.js
 *
 * Sale **1** si encuentra algo, igual que `spacing:audit`: una lista que hay que
 * acordarse de ampliar no es un mecanismo, y este guion existe justo para que no
 * haya que acordarse.
 *
 * ## Qué mira, y por qué así
 *
 * 1. Recorre las plantillas con un **analizador de etiquetas**, no con una
 *    expresión regular. Es la parte que antes se daba por imposible («los `div`
 *    anidados no se dejan buscar»), y es lo que permite saber quién es el padre
 *    de cada `.form-group`. Los bloques `@if` / `@for` de Angular no crean
 *    elementos, así que ignorarlos es correcto para el anidamiento.
 * 2. De cada contenedor con **dos o más** campos dentro, busca su `display` en
 *    el SCSS. `grid` coloca en horizontal; `flex` también, salvo que declare
 *    `flex-direction: column`.
 * 3. Si coloca en horizontal y **no está en la lista** de `styles.scss`, lo
 *    canta. La lista se lee del propio `styles.scss`: una copia aquí sería una
 *    segunda fuente de verdad, y divergiría el día que alguien añada una allí.
 * 4. Y comprueba que cada contenedor de la lista declara `gap`. Es la condición
 *    que hace **seguro** quitar el margen: sin `gap`, al bajar de línea en móvil
 *    las filas se quedarían pegadas.
 *
 * ## Lo que no puede saber
 *
 * Un contenedor cuyo `display` lo ponga otro sitio —una clase heredada, un
 * estilo en línea— se le escapa. Para eso sigue valiendo lo de siempre: mirar la
 * pantalla.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', 'src');
const GLOBAL = path.join(RAIZ, 'styles.scss');

/** Las clases cuyo ritmo vertical gobierna la regla global. */
const CAMPOS = ['form-group', 'checkbox-item'];

/** Etiquetas que no cierran: no entran en la pila de anidamiento. */
const VACIAS = new Set([
  'input', 'img', 'br', 'hr', 'meta', 'link', 'source',
  'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'
]);

// ---------------------------------------------------------------------------
// Recorrido de ficheros
// ---------------------------------------------------------------------------

function ficheros(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ficheros(p, ext, acc);
    else if (e.name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

const relativa = (p) => path.relative(path.join(__dirname, '..'), p).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// 1. Padres de campos, sacados de las plantillas
// ---------------------------------------------------------------------------

/**
 * Devuelve `Map<clase, Set<fichero>>` con los contenedores que tienen dos o más
 * campos como hijos directos.
 *
 * Solo se mira la **primera** clase del contenedor, que es la que usa la regla
 * global (`.form-row > …`). Un `class="form-section card"` cuenta como
 * `form-section`.
 */
function padresDeCampos() {
  const padres = new Map();

  for (const fichero of ficheros(path.join(RAIZ, 'app'), '.component.html')) {
    const html = fs.readFileSync(fichero, 'utf8');
    const pila = [];
    const etiqueta = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
    let m;

    while ((m = etiqueta.exec(html))) {
      const cierra = m[1] === '/';
      const tag = m[2];
      const atributos = m[3];
      const solitaria = m[4] === '/';

      if (cierra) {
        for (let i = pila.length - 1; i >= 0; i--) {
          if (pila[i].tag === tag) {
            pila.length = i;
            break;
          }
        }
        continue;
      }

      const cm = /\bclass\s*=\s*"([^"]*)"/.exec(atributos);
      const clases = cm
        ? cm[1].split(/\s+/).filter((c) => c && !c.includes('{') && !c.includes('('))
        : [];

      const padre = pila[pila.length - 1];
      if (padre && clases.some((c) => CAMPOS.includes(c))) {
        padre.campos++;
        if (padre.campos === 2 && padre.clases.length) {
          const clave = padre.clases[0];
          if (!padres.has(clave)) padres.set(clave, new Set());
          padres.get(clave).add(fichero);
        }
      }

      if (!solitaria && !VACIAS.has(tag)) pila.push({ tag, clases, campos: 0 });
    }
  }

  return padres;
}

// ---------------------------------------------------------------------------
// 2. El `display` de cada clase, sacado del SCSS
// ---------------------------------------------------------------------------

/**
 * Declaraciones por clase: `Map<clase, { display, flexDirection, gap }>`.
 *
 * Recorre el SCSS llevando la cuenta de las llaves. Las declaraciones de dentro
 * de un `@media` o un `@supports` se atribuyen a la clase que los envuelve: son
 * suyas, solo que condicionadas.
 */
function estilosPorClase() {
  const estilos = new Map();
  const fuentes = [GLOBAL, ...ficheros(path.join(RAIZ, 'app'), '.component.scss')];

  for (const fichero of fuentes) {
    const scss = quitarComentarios(fs.readFileSync(fichero, 'utf8'));
    const pila = [];
    let buffer = '';

    for (let i = 0; i < scss.length; i++) {
      const c = scss[i];

      if (c === '{') {
        pila.push(buffer.trim());
        buffer = '';
      } else if (c === '}') {
        pila.pop();
        buffer = '';
      } else if (c === ';') {
        const declaracion = buffer.trim();
        buffer = '';
        const dosPuntos = declaracion.indexOf(':');
        if (dosPuntos < 0) continue;

        const prop = declaracion.slice(0, dosPuntos).trim();
        const valor = declaracion.slice(dosPuntos + 1).trim();
        if (!['display', 'flex-direction', 'gap', 'grid-gap'].includes(prop)) continue;

        // La clase a la que pertenece: el selector más cercano que no sea una
        // regla `@`. Un `@media` no estiliza nada por sí mismo.
        for (let j = pila.length - 1; j >= 0; j--) {
          const selector = pila[j];
          if (selector.startsWith('@')) continue;
          for (const clase of clasesDestino(selector)) {
            if (!estilos.has(clase)) estilos.set(clase, {});
            const reg = estilos.get(clase);
            if (prop === 'display' && !reg.display) reg.display = valor;
            else if (prop === 'flex-direction') reg.flexDirection = valor;
            else if (prop === 'gap' || prop === 'grid-gap') reg.gap = valor;
          }
          break;
        }
      } else {
        buffer += c;
      }
    }
  }

  return estilos;
}

function quitarComentarios(scss) {
  return scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/**
 * Las clases que un selector estiliza: la **última** clase de cada parte
 * separada por comas. `.card .form-row` estiliza `.form-row`, no `.card`.
 *
 * Se descartan los selectores con `+`, `>` o `&`, que estilizan una relación y
 * no el contenedor: `& + .form-group` no dice nada del `display` de nadie.
 */
function clasesDestino(selector) {
  const salida = [];
  for (const parte of selector.split(',')) {
    const limpia = parte.trim();
    if (!limpia || limpia.includes('+') || limpia.includes('>') || limpia.includes('&')) continue;
    const ultima = limpia.split(/\s+/).pop();
    const m = /^\.([A-Za-z][\w-]*)$/.exec(ultima);
    if (m) salida.push(m[1]);
  }
  return salida;
}

/** ¿Este contenedor coloca a sus hijos en horizontal? */
function colocaEnHorizontal(estilo) {
  if (!estilo || !estilo.display) return false;
  const d = estilo.display;
  if (d.includes('grid')) return true;
  if (d.includes('flex')) return (estilo.flexDirection || 'row') !== 'column';
  return false;
}

// ---------------------------------------------------------------------------
// 3. La lista de excepciones, leída de `styles.scss`
// ---------------------------------------------------------------------------

/**
 * Los contenedores que ya anulan el margen. **Se leen del CSS**, no se copian
 * aquí: una copia sería una segunda fuente de verdad, y la primera vez que
 * discrepen nadie sabría cuál manda.
 */
function exceptuados() {
  const scss = fs.readFileSync(GLOBAL, 'utf8');
  const lista = new Set();
  const re = /\.([A-Za-z][\w-]*)\s*>\s*\.(?:form-group|checkbox-item)\s*\+\s*\.(?:form-group|checkbox-item)/g;
  let m;
  while ((m = re.exec(scss))) lista.add(m[1]);
  return lista;
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

function main() {
  const padres = padresDeCampos();
  const estilos = estilosPorClase();
  const yaEstan = exceptuados();

  const escalera = [];
  const sinGap = [];

  for (const [clase, archivos] of padres) {
    const estilo = estilos.get(clase);
    if (!colocaEnHorizontal(estilo)) continue;
    if (!yaEstan.has(clase)) {
      escalera.push({ clase, estilo, archivos: [...archivos] });
    } else if (!estilo.gap) {
      sinGap.push({ clase, archivos: [...archivos] });
    }
  }

  if (!escalera.length && !sinGap.length) {
    console.log('✓ Ningún formulario en escalera: todos los contenedores que colocan');
    console.log('  campos en horizontal anulan el margen vertical y declaran `gap`.');
    return 0;
  }

  if (escalera.length) {
    console.log('');
    console.log('✗ Contenedores que colocan campos en HORIZONTAL y no anulan el margen.');
    console.log('  La columna de la derecha baja 1rem y la fila queda en escalera.');
    console.log('');
    for (const { clase, estilo, archivos } of escalera) {
      const como = estilo.display + (estilo.flexDirection ? ` / ${estilo.flexDirection}` : '');
      console.log(`  .${clase}  (${como})`);
      for (const a of archivos) console.log(`      ${relativa(a)}`);
    }
    console.log('');
    console.log('  Arreglo: añadir en src/styles.scss, junto a `.form-row > …`:');
    for (const { clase } of escalera) {
      console.log(`    .${clase} > .form-group + .form-group,`);
      console.log(`    .${clase} > .form-group + .checkbox-item,`);
      console.log(`    .${clase} > .checkbox-item + .form-group,`);
      console.log(`    .${clase} > .checkbox-item + .checkbox-item,`);
    }
  }

  if (sinGap.length) {
    console.log('');
    console.log('✗ Contenedores exceptuados que NO declaran `gap`.');
    console.log('  Sin margen y sin gap, al bajar de línea en móvil se tocan.');
    console.log('');
    for (const { clase, archivos } of sinGap) {
      console.log(`  .${clase}`);
      for (const a of archivos) console.log(`      ${relativa(a)}`);
    }
  }

  console.log('');
  return 1;
}

process.exit(main());
