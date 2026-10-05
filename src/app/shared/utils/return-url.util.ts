/**
 * A dónde volver después de entrar.
 *
 * ⚠️ **Existe porque un enlace profundo se perdía al pasar por el login.** El
 * guard mandaba a `/login` sin guardar a dónde ibas y el login navegaba siempre
 * a `/dashboard`: abrir desde el correo el aviso de una solicitud —sin sesión, o
 * en otro navegador— dejaba al operador en el panel, sin decirle por qué ni qué
 * había pasado con el enlace que acababa de pulsar. Lo contó Dorel el 29 de
 * septiembre de 2026, y no es de Solicitudes: le pasa a **cualquier** enlace del
 * backoffice que alguien reciba por correo o por WhatsApp.
 */

/** A dónde se va quien entra sin traer destino. */
export const DEFAULT_LANDING = '/dashboard';

/**
 * ¿Se puede volver a esta URL sin abrir un agujero?
 *
 * ⚠️ **Un destino que llega por la barra de direcciones es entrada de fuera.**
 * Sin comprobarlo, `…/login?returnUrl=https://otro-sitio` convierte el login de
 * la empresa en un trampolín: el usuario ve el dominio de siempre, entra con su
 * cuenta de Google y acaba en una página ajena con toda la pinta de ser la
 * nuestra. Es la clase de fallo que solo se explota una vez y se explota bien.
 *
 * Por eso la regla es blanca y no negra: **solo pasa una ruta interna**, la que
 * empieza por una sola barra. Se rechaza en concreto:
 *
 * - `https://…` y cualquier cosa con esquema, incluido `javascript:`.
 * - `//otro-sitio`, que el navegador resuelve como **absoluta** heredando el
 *   protocolo — es el caso que se cuela cuando uno solo comprueba «empieza por
 *   barra».
 * - `/\otro-sitio`, que Chrome y Firefox tratan igual que el anterior.
 * - `/login`, o entrar dejaría al operador otra vez en la pantalla de entrar.
 */
export function safeReturnUrl(candidate: unknown): string {
  if (typeof candidate !== 'string') return DEFAULT_LANDING;

  const url = candidate.trim();
  if (!url.startsWith('/')) return DEFAULT_LANDING;
  if (url.startsWith('//') || url.startsWith('/\\')) return DEFAULT_LANDING;

  // `/login`, `/login?x=1` y `/login/loquesea` — pero no `/loginx`.
  if (url === '/login' || /^\/login[/?#]/.test(url)) return DEFAULT_LANDING;

  return url;
}
