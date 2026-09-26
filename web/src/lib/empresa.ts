/**
 * Los datos de la empresa, para la web pública.
 *
 * ⚠️ **Copiados a mano de `functions/src/company-config.ts`.** No se pueden
 * importar: son tres builds distintos con tres tsconfig, igual que la app y las
 * functions. Si cambian allí, cambian aquí.
 *
 * ⚠️ **Y la regla de los dos nombres se respeta también aquí**, que es donde más
 * se nota: la **marca** en todo lo que le habla al cliente, y la **razón social
 * solo junto al NIF** —el pie legal—. Un cliente no sabe qué es una S.L. ni
 * tiene por qué saberlo, y meterlo en un titular suena a notaría.
 */
export const EMPRESA = {
  /** Lo que ve el cliente en cualquier sitio salvo el pie legal. */
  marca: 'VELTO MOBILITY',
  /** Solo junto al NIF. Ojo: **acaba en punto**, así que nunca al final de una frase. */
  razonSocial: 'VELTO MOBILITY, S.L.',
  nif: 'B88866900',
  /** El domicilio social, del Registro Mercantil. Solo junto al NIF. */
  domicilioSocial: 'C/ Vereda del Melero, 3 · 28500 Arganda del Rey (Madrid)',
  /** La oficina: donde el cliente encuentra a alguien. Es la que se enseña. */
  oficina: 'C/ María Zambrano, 4 · 28500 Arganda del Rey (Madrid)',
  /** Partida en dos, para poder titular con la calle y dejar la ciudad debajo. */
  oficinaCalle: 'Calle María Zambrano, 4',
  oficinaCiudad: '28500 Arganda del Rey (Madrid)',
  telefono: '+34 623 766 181',
  /** Sin espacios ni signos, para el enlace de WhatsApp. */
  telefonoWhatsapp: '34623766181',
  /**
   * ⚠️ **El del dominio de la web, y eso obliga a que `veltomobility.com`
   * RECIBA correo.** Aquí ponía `reservas@veltorent.com` —el de desarrollo
   * según la tabla de `functions/.env.<proyecto>`— y se habría publicado tal
   * cual: la web se construye **idéntica** para los dos entornos (los tres
   * workflows corren `npm --prefix web run build`, y en `web/src` no hay ni un
   * `import.meta.env` de dominio ni ningún `.env`). Es exactamente F-33, el
   * correo de desarrollo impreso bajo el botón de firmar de producción.
   *
   * ⚠️ **Y escribir el bueno NO basta: esta dirección todavía NO RECIBE.**
   * Medido el 25 de septiembre de 2026 contra 8.8.8.8 y 1.1.1.1:
   * `veltomobility.com` **no tiene ni un registro MX** —solo SOA—, mientras
   * `veltorent.com` sí tiene los tres `routeN.mx.cloudflare.net` de Cloudflare
   * Email Routing. O sea que hoy esta dirección **envía** —el remitente de
   * Resend de producción ya es esta, con su SPF y su DKIM colgando de
   * `send.veltomobility.com`— y **se traga en silencio** lo que le escriban.
   *
   * ⚠️ **Por eso es una CONDICIÓN DE PUBLICACIÓN, no una tarea suelta:** antes
   * de que la web se sirva en `veltomobility.com` hay que activar Email Routing
   * en Cloudflare para ese dominio. Se comprueba así, y tiene que devolver tres
   * líneas:
   *
   *     nslookup -type=MX veltomobility.com 8.8.8.8
   *
   * Si el día de publicar siguen sin aparecer, la salida es volver a
   * `reservas@veltorent.com` —que sí recibe— antes de conectar el dominio. Un
   * correo impreso que nadie lee es peor que no poner ninguno: el cliente cree
   * que ha contactado.
   */
  correo: 'reservas@veltomobility.com',
} as const;

/** El dominio canónico. `veltorent.com` sirve lo mismo y redirige aquí. */
export const SITIO = 'https://veltomobility.com';

/**
 * Si esta compilación es la del sitio de verdad.
 *
 * ⚠️ **Existe porque la web se construye IGUAL para los dos entornos**, y hay
 * una cosa que no puede salir igual: el sitio de desarrollo **no se indexa**.
 * Hoy `velto-web-dev.web.app` se sirve con `Allow: /` y con un `<link
 * canonical>` que apunta a producción, o sea que le está ofreciendo a Google un
 * duplicado del escaparate — y dos copias del mismo contenido **reparten**
 * posicionamiento en vez de sumarlo, que es justo lo que el canónico existe
 * para evitar.
 *
 * ⚠️ **Se decide por MODO DE COMPILACIÓN, no por el dominio en tiempo de
 * ejecución.** Un `location.hostname` lo resolvería el navegador después de
 * cargar, y un rastreador que no ejecute JavaScript se llevaría la página sin
 * la marca. Esto se resuelve al compilar y viaja en el HTML.
 *
 * `astro build` usa el modo `production` por defecto, así que **el modo por
 * defecto NO sirve para distinguir**: el sitio de verdad se compila con
 * `npm run build:prod`, que pasa `--mode live`. Quien lo llama es el workflow
 * de `master`; `develop` y los PR usan `build` a secas.
 */
export const ES_SITIO_REAL = import.meta.env.MODE === 'live';
