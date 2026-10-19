# El vídeo del héroe

Cómo se produce `web/public/video/carretera.mp4` y su póster, y por qué cada
decisión está donde está.

Escrito el 19 de octubre de 2026.

---

## Por qué existe

El héroe de la portada era un **rectángulo negro liso**, y en un monitor ancho
ocupaba la mitad de la primera pantalla. Lo vio Dorel con una captura: «da
impresión de página no cargada íntegramente».

La respuesta tiene dos piezas y el orden importa:

1. **El póster** es lo que resuelve el problema. Son 10 KB y el navegador los
   pinta con el primer byte.
2. **El vídeo** es el remate, y llega cuando llega.

⚠️ **Y solo en pantalla ancha.** En vertical no hay hueco negro que tapar, y el
móvil es el que paga los datos. La decisión se toma en el script de
[index.astro](../web/src/pages/index.astro), no con un `display: none` — que
**no evita la descarga**.

## El plano

[Pexels · monochrome highway traffic with passing cars](https://www.pexels.com/video/monochrome-highway-traffic-with-passing-cars-39888938/),
elegido por Dorel. Licencia Pexels: uso comercial libre, sin atribución
obligatoria.

---

## El comando

Se parte del original descargado de Pexels. El resultado es el que está en el
repositorio; esto es para poder rehacerlo.

### 1. El bucle sin costura

El plano dura más de lo que hace falta y **termina donde no empieza**, así que
en bucle da un salto. Se recorta un trozo y se funde su final con su principio:

```bash
ffmpeg -y -i original.mp4 \
  -filter_complex "\
    [0:v]trim=0:10,setpts=PTS-STARTPTS,scale=960:540,format=yuv420p[v]; \
    [v]split[a][b]; \
    [a]trim=0:9,setpts=PTS-STARTPTS[cuerpo]; \
    [b]trim=9:10,setpts=PTS-STARTPTS,format=yuva420p,fade=t=out:st=0:d=1:alpha=1[cola]; \
    [cuerpo][cola]overlay=eof_action=pass[fundido]" \
  -map "[fundido]" -an -c:v libx264 -crf 20 -pix_fmt yuv420p bucle.mp4
```

⚠️ **960×540 y no más.** El original traía una **matrícula británica legible**
(«WU70 ORY»), y cambiar de fragmento no la quitaba: está en el plano. A 960 deja
de leerse, y de paso el fichero baja a la mitad. Hoy el desenfoque lo cierra del
todo, pero la escala se queda: lo que no se publica no se puede filtrar.

### 2. La lentitud, el desenfoque y lo que se sirve

```bash
ffmpeg -y -i bucle.mp4 \
  -filter:v "setpts=PTS/0.6,minterpolate=fps=30:mi_mode=blend,gblur=sigma=5" \
  -an -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p \
  -profile:v high -level 4.0 -movflags +faststart -g 60 \
  web/public/video/carretera.mp4
```

Y el póster, **del fichero ya desenfocado**:

```bash
ffmpeg -y -ss 0 -i web/public/video/carretera.mp4 -frames:v 1 -q:v 6 \
  web/public/video/carretera-poster.jpg
```

En esta máquina ffmpeg está instalado por WinGet y **no está en el PATH**:

```
C:\Users\dorel\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin
```

---

## Las tres decisiones, y la cuenta de cada una

### La lentitud va en el FICHERO, no en `playbackRate`

⚠️ **Esto estuvo mal un día y lo cazó Dorel: «el vídeo va un poco sacadado».**

A velocidad real los coches cruzan el encuadre de lado a lado y daba vértigo, así
que se puso `v.playbackRate = 0.6` con un comentario que decía que recodificar
«obligaría a duplicar fotogramas» y que el resultado sería idéntico. Las dos
mitades eran falsas.

La cuenta: **300 fotogramas estirados a 16,6 s son 18 únicos por segundo**, y a
60 Hz el navegador repite cada uno tres o cuatro veces de refresco, de forma
desigual. Eso es el tirón — y no es un problema de la máquina, que es lo primero
que uno piensa: el vídeo va perfectamente, lo que pasa es que **no hay más
imágenes que enseñar**.

`minterpolate` las fabrica. Medido en el navegador con
`requestVideoFrameCallback`, que avisa una vez por fotograma **presentado**:

| | antes | ahora |
|---|---|---|
| fotogramas presentados por segundo | 15,6 | **29,2** |
| hueco entre fotogramas (mediana) | 50 ms | **33 ms** |
| hueco en el peor 10 % | 100 ms | **34 ms** |
| saltos de más de 50 ms | **48,7 %** | 2,1 % |

⚠️ **Modo `blend` y no `mci`.** El de movimiento compensado se inventa hacia
dónde va cada cosa, y sobre coches cruzando el encuadre deforma. `blend` funde
los dos fotogramas de origen: no inventa nada y se lee como barrido, que aquí
viene bien.

### El desenfoque va en el FICHERO, no en CSS

Lo pidió Dorel el mismo día: «de todas formas me gustaría blurarlo sí o sí».

Un `filter: blur()` en CSS habría sido la respuesta corta. Se descartó por tres
cosas, y la primera es la que decide:

- **Un filtro sobre un `<video>` se recompone en cada fotograma**, así que
  habría empeorado justo el tirón que se estaba arreglando.
- **Crea un contexto de apilado**, que es lo que acababa de romper el buscador
  (ver abajo).
- **Deja los bordes semitransparentes** —el desenfoque muestrea fuera del
  elemento—, y taparlos pide un `scale()` encima.

⚠️ **Sigma 5 y no 8.** Con 8 el coche deja de leerse como un coche y queda una
mancha; con 3 todavía se ven los tiradores de las puertas y parece vídeo mal
enfocado, no un fondo. Y hay que contar el aumento: en una ventana de 1.440 px
la caja mide 1.425 de ancho sobre un origen de 960, o sea **×1,48** — el
desenfoque que se ve es la mitad otra vez más del que se aplica.

Lo que se pierde es poder ajustarlo en un segundo: cambiarlo es volver a pasar
el comando.

### Lo que pesa

| | antes | ahora |
|---|---|---|
| vídeo | 499 KB · 10 s | **351 KB · 16,6 s** |
| póster | 14 KB | **10 KB** |

Pesa menos durando más, porque el desenfoque se lleva por delante el detalle
fino, que es justo lo que se come los bits.

---

## El velo, y por qué sigue haciendo falta

⚠️ **El titular es blanco y cae sobre el cielo, que es la parte clara del
plano.** Medido sobre el fichero que se sirve, recorriendo el bucle entero: el
píxel más claro bajo el titular vale **198** y bajo la entradilla **200**.

⚠️ **Y el desenfoque NO los baja**, que es lo que uno supone. Antes eran 196 y
192: el cielo es una masa grande y uniforme, así que promediarla no le quita
brillo. Si alguna vez se afloja el velo confiando en que el desenfoque ya
oscurece, esto es lo que lo desmiente.

Con el velo puesto, medido en la página:

| | contraste | mínimo |
|---|---|---|
| titular (72 px, negrita) | **10,3:1** | 3:1 |
| entradilla (18 px) | **6,38:1** | 4,5:1 |

⚠️ **Va de arriba abajo y no de izquierda a derecha.** La primera versión era
horizontal y arrancaba en negro opaco: el tercio izquierdo era un rectángulo
negro y el resto vídeo, o sea la pantalla partida en dos cosas distintas. Dorel
lo dijo —«se ve raro»— y lo raro era el corte, no el velo. Vertical sigue cómo
está repartida la imagen (cielo claro arriba, carretera abajo) y cómo está
repartido el texto.

⚠️ **Y no puede ser plano.** Un velo uniforme lo bastante oscuro para el texto
deja el vídeo casi negro, y entonces no hay vídeo.

---

## Lo que rompió, y cómo se arregló

⚠️ **El fondo se mandó atrás con `z-index: -1`, y para que eso no lo metiera
detrás del propio negro del `<section>` hizo falta `isolation: isolate` en
`.hero`. Eso tumbó el buscador entero.**

Aislar crea un **contexto de apilado**, y dentro se quedó encerrado el
`z-index: 2` de `.buscador` — que es justo lo que le permite pisar la sección de
abajo, porque `.buscador--flotante` lo baja medio alto con un `translateY(50%)`
y sobresale.

Lo contó Dorel así: *«El calendario de seleccionar fechas ya no funciona, no
abre el calendario»*. Y no era el calendario: **el clic nunca llegaba al campo**.
Medido con `elementFromPoint` sobre la banda del icono, devolvía
`SECTION.promesas-seccion`.

La forma sin aislar es el mismo par que ya usa `.con-humo` en `global.css`: el
fondo **sin `z-index`** y el contenido con `1`.

```css
.hero          { position: relative; }           /* y NADA de isolation */
.hero__fondo   { position: absolute; inset: 0; overflow: hidden; }
.hero > .contenedor { position: relative; z-index: 1; }
```

⚠️ **El `z-index: 1` del `.contenedor` es el que salva al buscador**, no el `2`
que él lleva dentro: al subir el contenedor sube todo lo que cuelga de él.

⚠️ **Y el síntoma no se parece a la causa.** No hay error en consola, no falla
ningún test, no hay nada torcido a la vista: solo un formulario que no responde.
Es la misma clase de fallo que el buscador ya tenía documentado en
[Buscador.astro](../web/src/components/Buscador.astro) por la lista de zonas —
y volvió por la puerta de al lado.

---

## Lo que NO se puede dar por bueno leyendo el código

Las tres cosas de este documento se comprobaron **en el navegador**, y ninguna
se habría visto de otra manera:

- el tirón, con `requestVideoFrameCallback` y midiendo antes y después contra el
  fichero viejo servido a propósito;
- el contraste, componiendo el píxel más claro del bucle con el alfa real del
  degradado en la franja que ocupa cada texto;
- el clic del calendario, con `elementFromPoint` y abriendo el panel.
