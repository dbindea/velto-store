# Velto Design System

Lo que define el aspecto de la marca, y de dónde sale.

| Fichero | Qué es |
|---|---|
| `velto-design-system.css` | La hoja de estilos del kit, extraída del bundle. **Es lo único que hay que leer** para saber qué dice el sistema: 7,8 KB de tokens |
| `velto-web-publica.html` | El kit tal cual lo entrega Claude Design: un **bundle autoextraíble** de 1,2 MB, casi todo las Gotham y los SVG del logo en base64. **Está en `.gitignore`** — Dorel lo guarda aparte, así que puede no existir en tu copia. No hace falta para nada de aquí |

⚠️ **Esto NO se compila.** Es la referencia, no una dependencia. Lo que la
aplicación usa de verdad son las variables de `src/styles.scss`, que copian las
rampas de aquí a mano.

⚠️ **Y no vuelve a `public/`.** Todo lo que hay en esa carpeta lo copia Angular
al bundle (`angular.json` → `assets`), y ese bundle es lo que Firebase publica:
ahí dentro, este fichero acabaría servido en `store.veltorent.com` y en
producción, más 1,2 MB en cada despliegue.

## Qué se ha llevado a la aplicación

De un sistema pensado para una web de marketing, a un backoffice solo viaja lo
que no cambia la estructura:

- **La rampa teal completa** y **los neutrales fríos** (`--gray-*`), que
  sustituyen a la rampa `slate` de Tailwind. Es el cambio que más se nota: los
  grises llevan un tinte teal, así que el verde de marca se asienta encima en
  vez de flotar sobre un azul marino.
- **Los colores de estado** (success / warning / danger / info) en sus dos
  versiones, clara y oscura.
- **`--ls-brand`**, el tracking de `CAR RENTAL` bajo el logotipo.

Lo que **no** se ha llevado, y por qué:

- **La escala tipográfica fluida** (`--fs-display`, `clamp()` de 44 a 72 px).
  Está pensada para una portada; un backoffice son tablas densas.
- **Gotham como fuente de cuerpo.** Sigue reservada a titulares y marca. Es una
  geométrica de titular, y el cuerpo aquí son listados a 13-14 px. Además no
  tiene `ă ș ț` ni `€`: en un PDF eso son cuadros vacíos, y en la web una mezcla
  de fuentes a media palabra.
- **La escala de espaciado y radios.** Cambiarlas toca la geometría de todas las
  pantallas, que es justo lo que se quería evitar.
