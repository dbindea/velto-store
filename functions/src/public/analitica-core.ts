/**
 * Medir las visitas de la web pública **sin cookies y sin banner**.
 *
 * ⚠️ **La política de privacidad dice que esta web no lleva cookies, y tiene
 * que seguir siendo verdad.** El art. 22.2 de la LSSI solo exige consentimiento
 * para almacenar información en el terminal o acceder a la ya almacenada: aquí
 * **no se guarda nada en el dispositivo** —ni cookie, ni `localStorage`, ni un
 * identificador—, así que no hace falta banner. Lo que sí hay es tratamiento de
 * datos personales (la IP), y eso va declarado en la política con su interés
 * legítimo.
 *
 * ⚠️ **La IP y el navegador NO se guardan nunca, ni siquiera un momento.** Lo
 * único que se escribe es un hash, y la sal con la que se calcula **cambia cada
 * día**. Eso es lo que impide reconstruir a una persona de un día para otro: al
 * cambiar la sal, el hash de ayer y el de hoy del mismo visitante no se parecen
 * en nada.
 *
 * ⚠️ **Y ese es también el motivo de que NO haya «únicos acumulados».** Dorel
 * los pidió; con la sal rotando es imposible por construcción, que es justo la
 * propiedad que permite no pedir consentimiento. Un identificador que aguante
 * meses es exactamente lo que obliga a poner banner. Hay únicos **por día**, y
 * la suma de los días **no** es el número de personas distintas: quien vuelve
 * el martes cuenta otra vez. La pantalla lo dice.
 */

import { createHash } from 'node:crypto';

/**
 * Lo que delata a un bot en su propio nombre.
 *
 * ⚠️ **Esto es la segunda barrera, no la primera.** La primera es que la
 * medición la dispara **JavaScript**: un rastreador que solo baja el HTML
 * —que es lo que hacen los de scraping y casi todos los de IA— no llega a
 * llamar nunca. Esta lista recoge a los que sí ejecutan.
 *
 * ⚠️ **Y se mira en minúsculas y por trozo**, no por igualdad: los agentes
 * traen versión y sistema dentro, así que comparar cadenas enteras no acierta
 * ni una.
 */
const SENAS_DE_BOT = [
  'bot', 'crawl', 'spider', 'slurp', 'scrap', 'fetch', 'curl', 'wget',
  'python', 'java/', 'go-http', 'okhttp', 'axios', 'headless', 'phantom',
  'puppeteer', 'playwright', 'selenium', 'lighthouse', 'pagespeed',
  'gptbot', 'claudebot', 'ccbot', 'perplexity', 'bytespider', 'ahrefs',
  'semrush', 'mj12', 'dotbot', 'petalbot', 'applebot', 'facebookexternalhit',
  'preview', 'monitor', 'uptime', 'pingdom', 'probe',
  /**
   * ⚠️ **Los clientes HTTP de consola, que no se anuncian como bots.** Esta
   * tanda se añadió porque una sonda mía con `Invoke-WebRequest` **se contó
   * como visitante**: PowerShell manda un agente con pinta de navegador
   * —empieza por `Mozilla/5.0`— y ninguna de las señas de arriba aparecía. Es
   * la prueba de que esta lista es la barrera DÉBIL: la fuerte es que la señal
   * la dispare JavaScript, y por eso lo que entra por aquí a mano se cuela.
   */
  'powershell', 'httpclient', 'libwww', 'restsharp', 'postman', 'insomnia',
  'http_request', 'urllib', 'httpie', 'guzzle', 'apache-httpclient'
];

/** ¿El que llama dice ser un programa? */
export function pareceBot(userAgent: string | undefined): boolean {
  const ua = (userAgent || '').toLowerCase();
  // Sin agente no se cuenta: un navegador siempre manda uno.
  if (!ua.trim()) return true;
  return SENAS_DE_BOT.some(s => ua.includes(s));
}

/**
 * El día al que se apunta la visita, en horario de Madrid.
 *
 * ⚠️ **Y no en UTC**, que es donde corre la function. Con UTC, todo lo que pasa
 * entre medianoche y las 2:00 de Madrid se apuntaría al día anterior: en verano
 * son dos horas de visitas en el día que no es, y el informe diario no cuadra
 * con lo que Dorel vio en pantalla.
 */
export function diaDeMadrid(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(ahora);
}

/**
 * La huella del visitante para ese día.
 *
 * ⚠️ **Lleva el día dentro, y eso ES la rotación de la sal.** Misma IP y mismo
 * navegador dan huellas distintas el lunes y el martes, así que no se puede
 * seguir a nadie entre días ni aunque se tenga la base delante.
 *
 * ⚠️ **Y lleva un secreto delante.** Sin él, el espacio de IPs es tan pequeño
 * que cualquiera con la lista de hashes podría probarlas todas y deshacerlo;
 * con él, hay que conocer el secreto. Es lo que convierte el hash en
 * seudónimo de verdad y no en un disfraz.
 */
export function huellaVisitante(
  ip: string,
  userAgent: string,
  dia: string,
  secreto: string
): string {
  return createHash('sha256')
    .update(`${secreto}|${dia}|${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * La IP del visitante detrás de Firebase Hosting.
 *
 * ⚠️ **`x-forwarded-for` trae una LISTA**, no una dirección: el cliente, y
 * detrás cada proxy por el que pasó. La del visitante es la **primera**. Con la
 * última se estaría contando el proxy de Google, y todas las visitas saldrían
 * como un mismo visitante.
 */
export function ipDelVisitante(cabecera: string | undefined, respaldo?: string): string {
  const primera = (cabecera || '').split(',')[0]?.trim();
  return primera || respaldo || 'desconocida';
}

/**
 * Las rutas que se cuentan, y cómo se normalizan.
 *
 * ⚠️ **Lista blanca y no lo que mande el cliente.** Este endpoint es público:
 * sin normalizar, cualquiera podría llenar el documento del día con miles de
 * claves inventadas —un campo por ruta falsa— hasta reventar el límite de un
 * millón de bytes por documento de Firestore y dejar la medición rota.
 *
 * ⚠️ **Y la ficha de coche se agrupa en `/coche`**, sin el id. Interesa cuánta
 * gente mira fichas, no espiar qué coche concreto mira cada visitante: con el
 * id dentro, el documento del día tendría una clave por coche y se acercaría al
 * seguimiento individual, que es justo lo que esto evita.
 */
const RUTAS = [
  '/', '/flota', '/coche', '/reservar', '/contacto', '/entrega-a-domicilio',
  '/pon-tu-coche-en-alquiler', '/preguntas-frecuentes', '/condiciones',
  '/devoluciones', '/privacidad', '/aviso-legal'
];

export function normalizaRuta(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor) return null;
  // Fuera la query y el ancla: no aportan y pueden traer datos del visitante.
  const limpia = valor.split('?')[0].split('#')[0];
  if (limpia.startsWith('/coche/')) return '/coche';
  const sinBarra = limpia.length > 1 && limpia.endsWith('/') ? limpia.slice(0, -1) : limpia;
  return RUTAS.includes(sinBarra) ? sinBarra : null;
}

/**
 * Los hitos del embudo. También lista blanca, por lo mismo.
 *
 * - `precios`  — ha visto precios de verdad: llegó a `/reservar` con fechas.
 * - `ficha`    — ha abierto la ficha de un coche concreto.
 * - `cotizacion` — ha abierto el formulario de pre-reserva, con su importe
 *   delante. Es el «llegaron a la cotización» que pidió Dorel.
 */
export const HITOS = ['precios', 'ficha', 'cotizacion'] as const;
export type Hito = (typeof HITOS)[number];

export function normalizaHito(valor: unknown): Hito | null {
  return typeof valor === 'string' && (HITOS as readonly string[]).includes(valor)
    ? (valor as Hito)
    : null;
}
