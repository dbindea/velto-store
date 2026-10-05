/**
 * El distintivo ambiental de la DGT, para la web pública.
 *
 * ⚠️ **Está duplicado respecto al componente del backoffice**, igual que los
 * colores de marca y los datos de empresa: `web/` es una build aparte y no
 * comparte módulo con la app. Si cambia un color o se añade una categoría,
 * cambia en los dos sitios — `shared/components/dgt-label` es el otro.
 *
 * ⚠️ **Se dibuja, no se descarga.** Sale en cada tarjeta de la lista: una
 * imagen por tarjeta sería una petición por tarjeta para pintar una pegatina.
 *
 * ⚠️ **Es una representación, no la pegatina oficial.** Lleva el color y la
 * letra, que es lo que se reconoce de un vistazo; no el escudo de la DGT ni el
 * texto registral.
 */
export type EtiquetaDgt = 'B' | 'C' | 'ECO' | 'ZERO';

export const ETIQUETAS_DGT: EtiquetaDgt[] = ['B', 'C', 'ECO', 'ZERO'];

/** Lo que va escrito dentro. La de cero emisiones se rotula «0». */
const TEXTO: Record<EtiquetaDgt, string> = { B: 'B', C: 'C', ECO: 'ECO', ZERO: '0' };

const COLOR: Record<EtiquetaDgt, string> = {
  B: '#E8A317',
  C: '#1E9E4A',
  ECO: '',
  ZERO: '#0B63B5'
};

/**
 * Qué permite cada distintivo, en una frase.
 *
 * ⚠️ **Dice lo que se puede hacer, no la categoría técnica.** A nadie le sirve
 * «vehículo de gasolina Euro 4»: la pregunta es si entra en Madrid y si puede
 * aparcar. Y la «B» lo dice con cuidado, porque depende del escenario de la
 * ZBE: prometer de más aquí es que el cliente se lleve una multa.
 */
export const QUE_PERMITE: Record<EtiquetaDgt, string> = {
  B: 'Entra en Madrid con limitaciones. Conviene mirar la zona de bajas emisiones antes de circular.',
  C: 'Entra en Madrid y puede aparcar en zona SER.',
  ECO: 'Entra en Madrid y aparca gratis en zona SER, con límite de tiempo.',
  ZERO: 'Entra en Madrid sin restricciones y aparca gratis en zona SER.'
};

/** El nombre que se lee al lado del dibujo y el que oye un lector de pantalla. */
export const NOMBRE: Record<EtiquetaDgt, string> = {
  B: 'Etiqueta B',
  C: 'Etiqueta C',
  ECO: 'Etiqueta ECO',
  ZERO: 'Etiqueta CERO emisiones'
};

export function esEtiquetaDgt(v: unknown): v is EtiquetaDgt {
  return typeof v === 'string' && (ETIQUETAS_DGT as string[]).includes(v);
}

/**
 * El SVG del distintivo.
 *
 * ⚠️ **El `id` del degradado lleva un sufijo**, porque en una lista hay varias
 * ECO en la misma página y dos `<linearGradient>` con el mismo `id` hacen que
 * mande el primero. Hoy se verían igual; el día que alguien cambie un color,
 * solo cambiaría la mitad de la lista.
 */
let contador = 0;
export function svgEtiqueta(et: EtiquetaDgt, lado = 28): string {
  const id = `dgt-eco-${++contador}`;
  const relleno =
    et === 'ECO'
      ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="50%" stop-color="#0B63B5"/><stop offset="50%" stop-color="#1E9E4A"/>` +
        `</linearGradient></defs><circle cx="24" cy="24" r="23" fill="url(#${id})"/>`
      : `<circle cx="24" cy="24" r="23" fill="${COLOR[et]}"/>`;
  const tam = et === 'ECO' ? 14 : 24;
  const y = et === 'ECO' ? 29 : 32;
  return (
    `<svg width="${lado}" height="${lado}" viewBox="0 0 48 48" role="img" aria-label="${NOMBRE[et]}">` +
    relleno +
    `<text x="24" y="${y}" text-anchor="middle" fill="#fff" font-family="var(--font-sans)" ` +
    `font-weight="700" font-size="${tam}">${TEXTO[et]}</text></svg>`
  );
}
