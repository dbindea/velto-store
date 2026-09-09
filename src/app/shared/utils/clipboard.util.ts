/**
 * Copiar al portapapeles, con el respaldo que hace falta de verdad.
 *
 * ⚠️ **`navigator.clipboard` no existe siempre.** No está disponible sobre HTTP
 * plano ni en algunos navegadores embebidos —el de WhatsApp, entre otros—, que
 * es justo donde se usa esto: el operador copia un enlace para pegarlo en un
 * chat. Sin el respaldo, el botón no hace nada y no lo dice.
 *
 * Vivía dentro de `ReservationDocumentService`, que es una fachada de la
 * feature de reservas. Copiar un texto no es asunto de las reservas, y el
 * recibo de cobro lo necesita desde una pantalla que no tiene ninguna.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}
