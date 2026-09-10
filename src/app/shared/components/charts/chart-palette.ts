/**
 * La paleta de los gráficos.
 *
 * ⚠️ **Validada, no elegida a ojo.** Los cinco tonos pasan las seis
 * comprobaciones —banda de luminosidad, suelo de croma, separación para daltonismo,
 * suelo de visión normal y contraste— **contra las dos superficies reales**: el
 * blanco del tema claro y el `#14181A` del oscuro, que es el que se usa a diario.
 *
 * El primer intento usaba `--teal-400` (#33B39E) y **falló** la banda de
 * luminosidad; `--teal-500` la pasa. Eso es justo lo que no se puede decidir
 * mirando: dos verdes que parecen igual de válidos y solo uno lo es.
 *
 * ⚠️ **El orden es fijo y no se cicla.** Un color va con lo que representa, no
 * con su puesto: si mañana desaparece una vía de cobro, las demás no se
 * repintan. Y no hay una sexta: con más de cinco clases el gráfico deja de
 * leerse y lo que sobra se agrupa en «Otros».
 */
export const CHART_CATEGORICAL = [
  '#20A48F', // teal de marca
  '#3987e5', // azul
  '#d95926', // naranja
  '#9085e9', // violeta
  '#c98500' // ámbar
] as const;

/**
 * El color del año anterior en la comparación.
 *
 * ⚠️ **Gris a propósito, no un sexto color.** El año pasado es la referencia
 * contra la que se lee el actual, no una serie que compita con él: dándole hue
 * propio, la vista salta entre dos líneas igual de fuertes y se pierde cuál es
 * la que importa.
 */
export const CHART_REFERENCE = '#7C868A';

/** Los tonos de la tinta y la rejilla, que van con el tema y no con la serie. */
export const CHART_INK = {
  grid: 'var(--border-color)',
  axis: 'var(--text-muted)',
  label: 'var(--text-muted)',
  value: 'var(--text-primary)'
} as const;
