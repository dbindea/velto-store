import { describe, expect, it } from 'vitest';
import { CONTRACT_CLAUSES, pickBundle, withoutVatMentions } from './clauses';
import { chargesVat } from './pdf';
import type { ContractLocale } from './contract-types';

/**
 * Un contrato sin IVA no puede mencionar el IVA.
 *
 * ⚠️ **Este test existe porque el recorte puede fallar EN SILENCIO.** La
 * mención vive dentro de una frase legal larga y se quita por sustitución
 * literal; el día que alguien reescriba la cláusula de precio, el fragmento
 * dejará de encontrarse y `withoutVatMentions()` devolverá el articulado tal
 * cual — sin error, sin aviso, y con el contrato de un cliente al que no se le
 * cobra IVA remitiendo a un «IVA aplicable» que el desglose ya no imprime.
 *
 * Es el patrón que este proyecto ya conoce con nombre propio: F-36, la frase
 * «los precios incluyen IVA» que sobrevivió al cambio de convención porque
 * ningún test comprueba que un texto sea **cierto**, solo que quepa.
 *
 * Aquí sí se comprueba, y se comprueba en los tres idiomas.
 */

const LOCALES: ContractLocale[] = ['es', 'en', 'ro'];

/** Cómo se nombra el impuesto en cada idioma, tal y como aparece en el texto. */
const MENCIONES: Record<ContractLocale, RegExp> = {
  es: /\bIVA\b/,
  en: /\bVAT\b/,
  ro: /\bTVA\b/
};

function textoEntero(locale: ContractLocale, sinIva: boolean): string {
  const { bundle } = pickBundle(CONTRACT_CLAUSES, locale);
  const usado = sinIva ? withoutVatMentions(bundle, locale) : bundle;
  return [
    ...usado.highlights,
    usado.acknowledgement,
    ...usado.footerNotes,
    ...usado.clauses.flatMap((c) => [c.title, ...c.body])
  ].join('\n');
}

describe('articulado sin IVA', () => {
  for (const locale of LOCALES) {
    it(`${locale}: el articulado normal SÍ menciona el impuesto`, () => {
      // Si esto falla, el fragmento cambió de sitio y el recorte de abajo ya no
      // está quitando nada: pasaría «por no encontrar nada que quitar».
      expect(textoEntero(locale, false)).toMatch(MENCIONES[locale]);
    });

    it(`${locale}: recortado no queda ni una mención`, () => {
      expect(textoEntero(locale, true)).not.toMatch(MENCIONES[locale]);
    });

    it(`${locale}: el recorte deja una frase bien formada`, () => {
      // La enumeración no puede quedar con una coma huérfana ni con dos
      // espacios donde estaba el fragmento: el cliente lee esto.
      const texto = textoEntero(locale, true);
      expect(texto).not.toMatch(/,\s*,/);
      expect(texto).not.toMatch(/ {2}/);
      expect(texto).not.toMatch(/,\s*\)/);
    });

    it(`${locale}: solo se toca la mención, nada más`, () => {
      const con = textoEntero(locale, false);
      const sin = textoEntero(locale, true);
      // El recorte quita unos pocos caracteres de una sola frase. Si la
      // diferencia fuera grande, la sustitución estaría mordiendo otra cosa.
      expect(con.length - sin.length).toBeGreaterThan(0);
      expect(con.length - sin.length).toBeLessThan(40);
    });
  }
});

describe('chargesVat — la señal con la que se decide', () => {
  it('un tipo de 0 apaga las menciones', () => {
    expect(chargesVat({ vatRate: 0 })).toBe(false);
  });

  it('un tipo normal las deja', () => {
    expect(chargesVat({ vatRate: 0.21 })).toBe(true);
  });

  /**
   * ⚠️ **Ausencia no es exención.** Una reserva antigua sin `vatRate` lleva IVA
   * al tipo general; leerla como exenta imprimiría un contrato sin impuesto
   * para un alquiler que sí lo repercutió. Misma regla que en la app.
   */
  it('sin tipo guardado manda el general', () => {
    expect(chargesVat({})).toBe(true);
    expect(chargesVat({ vatRate: undefined })).toBe(true);
    expect(chargesVat({ vatRate: null })).toBe(true);
  });
});
