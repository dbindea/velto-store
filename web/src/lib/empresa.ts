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
  /**
   * Los datos registrales, **contenido obligatorio del aviso legal** (art.
   * 10.1.b de la LSSI).
   *
   * ⚠️ **Copiados de `functions/src/company-config.ts`**, como el resto de este
   * fichero, y allí llevan a su vez una advertencia que hay que respetar: esta
   * línea sale del **pie de la factura** y sustituyó a la que el código traía
   * antes —«Tomo 45067, Folio 44, Hoja M-793170»—, que **no coincide**. Ganó la
   * factura porque es el documento que de verdad llega al cliente, pero sigue
   * mereciendo una segunda mirada con la gestoría. Si se corrige allí, se
   * corrige aquí.
   */
  registro:
    'Sociedad Limitada inscrita en el Registro Mercantil de Madrid · Hoja M-893718 · ' +
    'IRUS: 1000477431057 · Folio electrónico inscripción: 1',
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
   * ⚠️ **Y ya RECIBE, desde el 2 de octubre de 2026.** Hasta ese día esta
   * dirección solo **enviaba** —el remitente de Resend de producción, con su
   * SPF y su DKIM colgando de `send.veltomobility.com`— y **se tragaba en
   * silencio** lo que le escribieran: medido el 25 de septiembre contra 8.8.8.8
   * y 1.1.1.1, el dominio no tenía ni un registro MX. Dorel activó Email
   * Routing en Cloudflare y lo confirmó recibiendo un correo de prueba.
   *
   * Comprobado de primera mano el mismo día, que es lo que convierte esto en
   * un hecho y no en un «me han dicho que ya va»:
   *
   *     Resolve-DnsName veltomobility.com -Type MX -Server 8.8.8.8
   *     → route1/2/3.mx.cloudflare.net
   *
   * ⚠️ **Era una CONDICIÓN DE PUBLICACIÓN y ha dejado de serlo.** Un correo
   * impreso que nadie lee es peor que no poner ninguno —el cliente cree que ha
   * contactado— y esta dirección sale impresa en las dos páginas legales como
   * canal de derechos RGPD y de reclamaciones. Si algún día esos MX
   * desaparecen, la web vuelve a prometer algo que no cumple.
   */
  correo: 'reservas@veltomobility.com',
  /**
   * La ficha de Google Business Profile.
   *
   * ⚠️ **Para «alquiler de coches Arganda» esto pesa más que toda la web.** Es
   * lo que sale en el mapa, con las reseñas y el botón de cómo llegar, y la
   * mayoría de las búsquedas locales se resuelven ahí sin que nadie entre en
   * ninguna página.
   *
   * ⚠️ **Vive aquí porque lo usa el JSON-LD como `sameAs`**, que es lo que le
   * dice al buscador que la web y esa ficha son el **mismo** negocio. Sin eso
   * las trata como dos entidades que casualmente comparten nombre y dirección,
   * y los datos de las dos compiten en vez de confirmarse.
   *
   * Creada por Dorel el 2 de octubre de 2026.
   */
  fichaGoogle: 'https://maps.app.goo.gl/cAwZQU2H8s8vxUtv7',
} as const;

/**
 * El horario de la oficina, decidido por Dorel el 30 de septiembre de 2026.
 *
 * ⚠️ **Estaba sin decidir y no se podía inventar**, que es distinto de que
 * faltara: un horario inventado en los datos estructurados hace que Google
 * enseñe la ficha con «abierto ahora» a una hora en la que no hay nadie, y el
 * cliente que se planta en la puerta no vuelve. Por eso la página no lo decía
 * hasta hoy.
 *
 * ⚠️ **Es UNA sola fuente para dos formatos.** De aquí salen la tarjeta que lee
 * una persona y el `openingHoursSpecification` que lee Google. Escritos por
 * separado —un rótulo en la plantilla y un JSON-LD debajo— divergen a la
 * primera vez que alguien cambie una hora y solo se entera de uno; y el que se
 * queda viejo es el que nadie ve, que es justo el que Google lee.
 */
export const HORARIO = [
  {
    rotulo: 'Lunes a viernes',
    dias: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    /** Mañana y tarde. Dos tramos, que es lo que parte el mediodía. */
    tramos: [
      ['10:00', '14:00'],
      ['17:00', '20:00'],
    ],
  },
  { rotulo: 'Sábado', dias: ['Saturday'], tramos: [['10:00', '14:00']] },
  /**
   * ⚠️ **El domingo se enseña y NO se declara.** En la tarjeta tiene que salir
   * —«cerrado» es la respuesta a la pregunta que trae al visitante—, pero en
   * `schema.org` un día sin tramos no se declara: la especificación entiende
   * que lo que no está declarado está cerrado, y meterlo con horas a cero es la
   * forma habitual de acabar apareciendo como abierto de madrugada.
   */
  { rotulo: 'Domingo', dias: ['Sunday'], tramos: [] as string[][] },
] as const;

/**
 * ⚠️ **Fuera de horario SÍ se entrega, y hay que decirlo.** Es de Dorel, el
 * mismo día: la oficina cierra, el negocio no. Un horario a secas le dice al
 * que aterriza a las once de la noche que no hay coche para él, y es justo el
 * cliente de la entrega a domicilio.
 *
 * ⚠️ **Y no lleva precio, a propósito.** No está tarifado —se acuerda por
 * teléfono, como el resto de los desplazamientos—, y publicar una cifra aquí
 * sería comprometerse con ella igual que en `zonas.ts`. Lo que se dice es que
 * existe y que se habla, que es lo que de verdad pasa.
 */
export const ENTREGA_FUERA_DE_HORARIO =
  'Fuera de ese horario también entregamos y recogemos, incluido el domingo: ' +
  'se acuerda antes por teléfono o por WhatsApp.';

/**
 * El dominio canónico, y desde el 2 de octubre de 2026 **el único que la web
 * nombra**.
 *
 * ⚠️ Aquí ponía que `veltorent.com` sirve lo mismo y redirige. Ya no se
 * promete eso: Dorel dejó en el aire qué hacer con ese dominio —una landing
 * aparte, o soltarlo— y lo que la web no puede hacer es nombrar un sitio cuyo
 * contenido no está decidido.
 */
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
