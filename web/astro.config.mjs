// @ts-check
import { defineConfig } from 'astro/config';

/**
 * La web pública de Velto.
 *
 * ⚠️ **Estática, y los datos se piden al cargar.** No hay renderizado en
 * servidor a propósito: la flota y las fichas las sirve `/api/*` —tres Cloud
 * Functions con lista blanca— y el navegador las pide al abrir la página. Así
 * **publicar un coche desde el backoffice se ve al momento**, sin redesplegar
 * nada. Con las fichas generadas en el build, añadir un coche no aparecería
 * hasta el siguiente despliegue, y esa es una queja segura el primer día.
 *
 * Lo que sí posiciona —la portada, las condiciones, el contacto, dónde
 * estamos— es HTML de verdad desde el primer byte.
 *
 * ⚠️ **`site` es `veltomobility.com`, el canónico.** `veltorent.com` sirve el
 * mismo sitio y redirige; sin un canónico declarado, dos dominios con el mismo
 * contenido se reparten el posicionamiento en vez de sumarlo.
 */
export default defineConfig({
  site: 'https://veltomobility.com',
  /**
   * ⚠️ **Sin barra final en las URL.** Firebase Hosting sirve `/flota` y
   * `/flota/` como la misma página, pero si el sitio enlaza a una forma y el
   * canónico declara la otra, cada página acaba indexada dos veces.
   */
  trailingSlash: 'never',
  build: {
    // `/flota` → `flota.html`, no `flota/index.html`. Es lo que casa con
    // `cleanUrls` de Firebase Hosting.
    format: 'file',
  },
});
