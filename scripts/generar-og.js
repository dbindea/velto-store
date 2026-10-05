/**
 * La imagen que se ve al compartir un enlace de la web (`og:image`).
 *
 * ⚠️ **No había ninguna, y el canal principal de esta empresa es WhatsApp.**
 * Cada enlace que Velto manda —o que un cliente reenvía— salía como una tarjeta
 * de texto sin imagen, que es la forma más pobre de aparecer y la que menos se
 * pulsa. Medido el 2 de octubre de 2026: cero etiquetas `og:image` en las once
 * páginas.
 *
 * ⚠️ **Tiene que ser PNG o JPG: WhatsApp y Facebook NO aceptan SVG**, y en
 * `web/public/brand/` solo había SVG. Por eso esto existe en vez de un
 * `<meta>` apuntando al logo.
 *
 * ⚠️ **Se compone solo con los TRAZOS del logo, sin una sola letra.** La
 * tentación es escribir «Alquiler de coches en Arganda» dentro de la imagen, y
 * eso obliga a que la tipografía esté instalada donde se genere: en esta
 * máquina Gotham no está, así que el texto saldría en otra fuente o en blanco
 * —y en blanco no falla nada, que es lo peor—. El texto de la tarjeta lo pone
 * `og:title`, que además se puede traducir y cambiar sin regenerar nada.
 *
 * ⚠️ **1200×630 no es un tamaño cualquiera**: es la proporción 1,91:1 que
 * piden Facebook, WhatsApp, LinkedIn y X. Con otra, el recorte lo decide cada
 * uno y el logo se parte.
 *
 * Se ejecuta a mano cuando cambie la marca:
 *
 *     node scripts/generar-og.js
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const LOGO = path.join(RAIZ, 'src', 'assets', 'brand', 'logo-on-dark.svg');
const SALIDA = path.join(RAIZ, 'web', 'public', 'brand', 'og.png');

const ANCHO = 1200;
const ALTO = 630;

/** Los dos colores de la marca. Copiados, como todo lo que `web/` comparte. */
const NEGRO = '#000000';
const TURQUESA = '#20A48F';

async function main() {
  /*
   * `sharp` vive en `functions/`: es la única parte del repositorio que ya lo
   * tiene, y no hace falta una dependencia más en la raíz para una imagen que
   * se genera cuando cambia el logo.
   */
  const sharp = require(path.join(RAIZ, 'functions', 'node_modules', 'sharp'));

  const logo = fs.readFileSync(LOGO, 'utf8');

  /*
   * El logo mide 1133,86 × 311,81. Se lleva al 46 % del ancho y se centra
   * ópticamente un poco por encima del medio: un logotipo centrado
   * geométricamente en una caja apaisada se ve caído.
   */
  const anchoLogo = Math.round(ANCHO * 0.46);
  const altoLogo = Math.round((anchoLogo * 311.81) / 1133.86);

  const logoPng = await sharp(Buffer.from(logo))
    .resize(anchoLogo, altoLogo, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  /*
   * ⚠️ **La barra turquesa abajo no es decoración: es lo que hace reconocible
   * la tarjeta a tamaño de miniatura.** En la lista de un chat, la imagen se ve
   * a 80 px y el logotipo blanco sobre negro no se distingue de cualquier otro;
   * la franja de color sí.
   */
  const fondo = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}">` +
      `<rect width="${ANCHO}" height="${ALTO}" fill="${NEGRO}"/>` +
      `<rect x="0" y="${ALTO - 14}" width="${ANCHO}" height="14" fill="${TURQUESA}"/>` +
      `</svg>`
  );

  await sharp(fondo)
    .composite([
      {
        input: logoPng,
        left: Math.round((ANCHO - anchoLogo) / 2),
        top: Math.round((ALTO - altoLogo) / 2 - 18),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(SALIDA);

  const { size } = fs.statSync(SALIDA);
  console.log(`${path.relative(RAIZ, SALIDA)} — ${ANCHO}×${ALTO}, ${(size / 1024).toFixed(1)} kB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
