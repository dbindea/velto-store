/**
 * La dirección de una ficha de coche: `/coche/renault-megane`.
 *
 * ⚠️ **Antes era el id de Firestore** —`/coche/jRfQu3ebHPe1HnWzvmrV`— y lo pidió
 * cambiar Dorel el 30 de octubre de 2026: una URL que no se puede dictar por
 * teléfono ni recordar no sirve de nada fuera de un enlace. Y para un buscador
 * es peor todavía: en la dirección de una ficha de alquiler, «renault-megane»
 * son dos palabras que alguien escribe en Google y veinte caracteres
 * aleatorios no son ninguna.
 *
 * ⚠️ **El desempate NO lleva la matrícula, y eso fue una decisión medida.** La
 * primera idea era `renault-megane-4466lkk`, y la matrícula **no está en la API
 * pública**: `mapper.ts` la excluye a propósito —clonado de placas, y en un
 * coche cedido señala el vehículo de un particular—. Usarla aquí obligaría a
 * publicarla y, peor, a dejarla **indexada en Google para siempre**, que es la
 * vía más permanente de todas. Se desempata con la **versión**, que es dato
 * público y lo natural para distinguir dos coches del mismo modelo, y si aun
 * así chocan, con un código corto sacado del id.
 *
 * ⚠️ **El reparto de slugs depende de TODA la flota, no de cada coche.** Por eso
 * la función que manda es `slugsDeFlota()` y no una `slugDeCoche()` suelta: si
 * hay dos Mégane, los dos cambian de dirección, y eso no se puede decidir
 * mirando uno solo.
 */

import type { CocheResumen } from './api';

/** Cuántos caracteres del id se usan como desempate antes de alargarlo. */
const SUFIJO_MINIMO = 4;

/**
 * Texto → trozo de URL.
 *
 * ⚠️ **Los acentos se descomponen y se tiran, no se sustituyen a mano.** Una
 * tabla de reemplazos se queda corta en cuanto aparece una `ø` o una `ł`;
 * `normalize('NFD')` separa la letra de su tilde y el filtro se lleva la tilde.
 */
export function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `Renault` + `Mégane` → `renault-megane`. Sin la versión: esa es el desempate. */
export function slugBase(coche: Pick<CocheResumen, 'brand' | 'model'>): string {
  return slugify([coche.brand, coche.model].filter(Boolean).join(' '));
}

function conVersion(coche: Pick<CocheResumen, 'brand' | 'model' | 'version'>): string {
  const base = slugBase(coche);
  const v = slugify(coche.version ?? '');
  return v ? `${base}-${v}` : base;
}

function todosDistintos(valores: string[]): boolean {
  return new Set(valores).size === valores.length;
}

/**
 * El slug de cada coche de la flota, por id.
 *
 * El reparto es **determinista**: la misma flota da siempre los mismos slugs,
 * venga como venga ordenada de la API — los grupos en conflicto se ordenan por
 * id antes de repartir. Sin eso, un despliegue podría cambiar la dirección de
 * un coche sin que nadie tocara nada.
 *
 * ⚠️ **Un coche sin marca ni modelo se queda con su id**, que es feo y es lo
 * correcto: una URL vacía o un `-` suelto sería peor, y el caso solo aparece
 * con una ficha a medio rellenar.
 */
export function slugsDeFlota(coches: CocheResumen[]): Map<string, string> {
  const salida = new Map<string, string>();
  const porBase = new Map<string, CocheResumen[]>();

  for (const c of coches) {
    const base = slugBase(c) || slugify(c.id) || c.id;
    const grupo = porBase.get(base);
    grupo ? grupo.push(c) : porBase.set(base, [c]);
  }

  for (const [base, grupo] of porBase) {
    if (grupo.length === 1) {
      salida.set(grupo[0].id, base);
      continue;
    }

    // Orden estable: el reparto no puede depender de cómo venga la lista.
    const enConflicto = [...grupo].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // 1) La versión, que es lo que de verdad distingue dos coches del mismo modelo.
    const conVer = enConflicto.map((c) => conVersion(c));
    if (todosDistintos(conVer) && conVer.every((s) => s !== base)) {
      enConflicto.forEach((c, i) => salida.set(c.id, conVer[i]));
      continue;
    }

    /*
     * 2) Y si no, un código corto del id. Se alarga hasta que no choquen:
     * cuatro caracteres bastan siempre en una flota de este tamaño, pero
     * depender de que «basta» es justo como se cuelan los fallos raros.
     */
    let largo = SUFIJO_MINIMO;
    let candidatos = enConflicto.map((c) => `${base}-${slugify(c.id).slice(0, largo)}`);
    while (!todosDistintos(candidatos) && largo < 32) {
      largo += 2;
      candidatos = enConflicto.map((c) => `${base}-${slugify(c.id).slice(0, largo)}`);
    }
    enConflicto.forEach((c, i) => salida.set(c.id, candidatos[i]));
  }

  /*
   * ⚠️ **Una última pasada por si un desempate pisa el slug de OTRO coche.**
   * Con un Mégane y un «Mégane 2019» en la flota, el desempate del primero
   * podría salir `renault-megane-2019` y chocar con la base del segundo. Es
   * rebuscado y cuesta diez líneas comprobarlo; lo que no cuesta diez líneas es
   * darse cuenta de que dos coches comparten dirección.
   */
  const vistos = new Map<string, string>();
  for (const c of coches) {
    const slug = salida.get(c.id)!;
    const duenyo = vistos.get(slug);
    if (duenyo === undefined) {
      vistos.set(slug, c.id);
      continue;
    }
    salida.set(c.id, `${slug}-${slugify(c.id).slice(0, SUFIJO_MINIMO)}`);
    vistos.set(salida.get(c.id)!, c.id);
  }

  return salida;
}

/**
 * El coche al que apunta un segmento de URL.
 *
 * ⚠️ **Acepta el slug Y el id crudo, y lo segundo no es cortesía.** Las
 * direcciones viejas —`/coche/jRfQu3ebHPe1HnWzvmrV`— están en el índice de
 * Google, en el historial de los navegadores y en cualquier WhatsApp que se
 * mandara. Dejar de resolverlas convertiría cada una en una ficha que no carga.
 */
export function cocheDeSegmento(
  coches: CocheResumen[],
  segmento: string
): CocheResumen | null {
  const porId = coches.find((c) => c.id === segmento);
  if (porId) return porId;

  const slugs = slugsDeFlota(coches);
  const encontrado = coches.find((c) => slugs.get(c.id) === segmento);
  return encontrado ?? null;
}
