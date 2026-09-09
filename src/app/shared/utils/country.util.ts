/**
 * Los países, para el destinatario de una factura extranjera.
 *
 * ⚠️ **Los nombres NO están en los JSON de i18n, y es deliberado.** Son
 * doscientos y pico países por tres idiomas: setecientas cadenas que nadie va a
 * revisar, que el auditor daría por buenas con solo copiarlas del español, y que
 * habría que mantener cuando cambie un nombre. `Intl.DisplayNames` las trae del
 * navegador ya traducidas y actualizadas — es exactamente el caso para el que
 * existe.
 *
 * Lo que sí vive aquí son los **códigos**, que son el dato: ISO 3166-1 alfa-2,
 * que es lo que pide `CodigoPais` en el registro de facturación.
 */

/**
 * ISO 3166-1 alfa-2.
 *
 * ⚠️ El registro de facturación usa **estos**, no los prefijos de NIF-IVA: ahí
 * Grecia es `GR` y no `EL`. Son dos catálogos distintos que se parecen, y por
 * eso los prefijos de NIF-IVA viven aparte, en `invoice.util.ts`.
 */
const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
  'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE ' +
  'EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
  'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC ' +
  'LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
  'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO ' +
  'TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

export interface CountryOption {
  code: string;
  name: string;
}

/**
 * Los países con su nombre en el idioma pedido, ya ordenados.
 *
 * ⚠️ **Ordenados con `localeCompare`, no con `<`.** «Alemania» y «Andorra» se
 * ordenan igual de las dos formas, pero «Ámbito» y «Austria» no: sin el
 * comparador del idioma, los acentos se van al final de la lista.
 *
 * Si el navegador no trae `Intl.DisplayNames` —no debería pasar, pero no cuesta
 * nada— se queda el código, que sigue siendo utilizable.
 */
export function countryOptions(locale: string): CountryOption[] {
  const codes = CODES.split(' ');
  let nombre: (code: string) => string;
  try {
    const display = new Intl.DisplayNames([locale], { type: 'region' });
    nombre = (code) => display.of(code) || code;
  } catch {
    nombre = (code) => code;
  }
  return codes
    .map((code) => ({ code, name: nombre(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** El nombre de un país, para pintarlo suelto. */
export function countryName(code: string, locale: string): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}
