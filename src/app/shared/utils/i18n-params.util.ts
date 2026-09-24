/**
 * Sustituir `{nombre}` dentro de un texto YA traducido.
 *
 * ⚠️ **El orden importa y es siempre este: traducir primero, sustituir después.**
 * El hueco `{amount}` va donde el traductor lo puso, y en rumano o en inglés no
 * está en el mismo sitio de la frase que en español. Sustituyendo sobre la clave
 * —o construyendo la frase por trozos— se acaba con un orden de palabras que
 * solo funciona en un idioma.
 *
 * Existe porque esto estaba escrito **tres veces**: en la pila de avisos
 * (`notifications.component.ts`), en el diálogo de confirmación
 * (`confirm-dialog.component.ts`) y a punto de estarlo una cuarta en los errores
 * de tarifa del formulario de vehículo. Son cuatro líneas, y ese es justamente el
 * tamaño en el que una copia se hace sin pensar y luego divergen.
 *
 * No traduce: recibe el texto resuelto. Quien traduce es `TranslateService`, que
 * es el que sabe el idioma en curso.
 */
export function interpolate(text: string, params?: Record<string, string>): string {
  if (!params) return text;
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.split(`{${name}}`).join(value),
    text
  );
}

/**
 * Una clave de i18n con sus sustituciones, para cuando el mensaje lo decide la
 * lógica y no la plantilla.
 *
 * Lo usan las comprobaciones que tienen que nombrar un dato concreto —«el tramo
 * 4-7 días»— y que por eso no caben en un `FieldProblems`, donde el valor es una
 * clave a secas.
 */
export interface TranslatableMessage {
  /** Clave de i18n. */
  key: string;
  /** Sustituciones `{nombre}` sobre el texto ya traducido. */
  params?: Record<string, string>;
}
