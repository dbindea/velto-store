# Prompt para abrir una sesión nueva

> Pégalo entero como primer mensaje. Está escrito para el asistente, no para
> Dorel: le dice quién es, qué leer, cómo se trabaja aquí y qué hacer primero.
>
> **Es un índice, no un resumen.** No repite lo que ya está en `CLAUDE.md` ni en
> `docs/traspaso-sesion.md` — repetirlo crearía una tercera copia que se quedaría
> vieja. Lo que sí trae es lo que **no vive en el repositorio**: cómo trabaja
> Dorel y qué se espera de ti.
>
> Última revisión: **9 de noviembre de 2026**.

---

Trabajas en **Velto Store**, el sistema de una empresa real de alquiler de
coches en Arganda del Rey (Madrid). Son **tres proyectos en un repositorio**, y
conviene tenerlo claro desde el principio:

| | Qué es | Dónde | Build |
|---|---|---|---|
| **el backoffice** | SPA de gestión: reservas, contratos, cobros, facturas | `src/` | Angular 20 + Firebase |
| **las functions** | Cloud Functions: PDF, Redsys, AEAT, API pública | `functions/` | Node 22, tsconfig propio |
| **la web pública** | el escaparate y los formularios | `web/` | Astro 5, **sin framework de UI** |

Las tres compilan por separado y **no pueden compartir módulo**: lo común está
copiado a mano, a propósito, y cada copia lo dice en su comentario.

**Dorel** es el dueño, el único desarrollador y el único usuario. Escribe en
español y espera respuestas en español. No es un proyecto de juguete:
**producción tiene clientes, reservas, cobros y facturas de verdad** desde el 17
de septiembre de 2026.

## 1. Lee esto antes de tocar nada, en este orden

1. **`CLAUDE.md`** — entero. Es largo y cada aviso está ahí porque el fallo ya
   ocurrió una vez. No es documentación: es la memoria de los errores.
2. **`docs/traspaso-sesion.md`** — dónde quedó todo. Empieza por
   **§ 2 quinvicies** (7 de noviembre: el aviso de Telegram de las 17:00 con el
   WhatsApp de la prórroga, y el resumen diario que llevaba **dos meses**
   saliendo sin una sola entrega porque una fecha de reserva está guardada como
   **mapa**), sigue por **§ 2 ter** (qué falta por desplegar: a 9 de noviembre
   **nada**, y la sección dice cómo volver a medirlo) y **§ 5** (los huecos que
   solo puede cerrar él).
3. **`docs/mejoras-pendientes.md`** — la lista viva.
4. **`FUNCIONAL.md`** — el negocio, si la tarea lo toca.

⚠️ **Las cifras de esos documentos envejecen.** El estado se **pregunta**, no se
copia:

```bash
git log --oneline origin/master..origin/develop | wc -l   # lo que produccion no tiene
git log --oneline origin/develop..HEAD                    # lo que ni siquiera esta subido
git diff --stat origin/master..origin/develop -- functions/ firebase.json firestore.rules
firebase functions:list --project prod                    # compara NOMBRES, no cuentes a ojo
```

## 2. Cómo se trabaja aquí

**El código: hazlo entero, verifícalo, y entonces se lo enseñas.** Sus palabras:
*«si hay más código que vas a cambiar lo veo cuando ya lo tienes realizado y
cambiado, listo para subir una vez que verificas todo»*. No quiere ir aprobando
pasos intermedios.

**Lo que vive fuera del repositorio —DNS, paneles de Firebase o Cloudflare,
despliegues a producción— primero en opciones**, y esperas su decisión.

**Puedes commitear en `develop`** sin preguntar, en formato convencional
(`feat:` / `fix:` / `docs:` / `refactor:`). **`master` no se toca**: un merge a
`master` es un despliegue a producción con datos reales y lo decide él.

**Los comentarios del código explican el PORQUÉ, no el qué**, y suelen contar el
fallo que los provocó, con fecha. Escribe así: es el estilo de la casa y es lo
que hace que este proyecto no repita errores.

**Y cuando algo de lo que te pide no se sostenga, dilo y sigue construyendo.**
Ha pasado tres veces y las tres agradeció el aviso: un porcentaje que no se
puede publicar porque vive en cada coche, un «con el depósito lleno» que el
contrato contradice, y un «asegurado» que promete una cobertura opcional. La
regla de esta casa es que **una cifra creíble y equivocada es peor que un
error**.

## 3. Cómo se verifica, y no es opcional

Son **tres** suites, una por build:

```bash
npm run build && npm test                  # backoffice: 988 tests en 41 ficheros
npm --prefix functions run build && npm --prefix functions test   # 841 en 35
npm --prefix web run build && npm --prefix web test               # 126 en 10
npm --prefix web run check                 # astro check

npm run i18n:audit && npm run css:audit && npm run spacing:audit && npm run rows:audit
npm run lint    # linea base: 0 errores y 291 avisos
```

Las cifras están para comparar, no para alcanzar: lo que importa es que no bajen
y que no haya ficheros en rojo. La de **functions** es del **9 de noviembre**
—vuelta a medir ese día—; las otras tres, del **6**, y desde entonces no se ha
tocado ni `src/` ni `web/`.

⚠️ **`tsc` NO valida las plantillas y `strictTemplates` está activo**: hay que
construir. Si sale un **error** de lint, es de lo que acabas de tocar; los 291
avisos son deuda reconocida.

⚠️ **Y si una suite falla en local y pasa en el CI, compara la versión de
Node.** El portátil va por **24** y el CI por **22**: un `#!/usr/bin/env node` en
un módulo importado desde un spec rompe la carga en el primero y no en el
segundo, con un error que señala el fichero equivocado. Costó una semana de
suite roja en la web.

⚠️ **Y todo eso junto no ve lo que ve un ojo.** El patrón de fallo dominante es
**código escrito, desplegado y jamás ejecutado**: compila, pasa los tests, se
despliega, y lo único que falla es lo que ve el operador. Casi todo lo
importante lo ha encontrado Dorel usando la aplicación.

**Abre el navegador.** Hay un perfil de Playwright con sesión de administrador
contra `http://localhost:4200` (backoffice, Firebase de **desarrollo**), y la web
pública se levanta con `npm --prefix web run dev` en `http://localhost:4321`.
Recorre el flujo de verdad y lee el resultado en Firestore, no en la pantalla.

⚠️ **Y la sesión está atada al ORIGEN, puerto incluido.** El 5 de noviembre el
4200 lo tenía ocupado otro proyecto de la máquina, así que `ng serve` acabó en
otro puerto y allí **no había sesión** — y copiar el token de Firebase entre
orígenes lo bloquea el clasificador de permisos. Resultado: el calendario nuevo
se desplegó sin que nadie lo hubiera visto. Si el 4200 está ocupado, **libéralo**
(`npx kill-port 4200`, o mira qué hay escuchando) en vez de servir en otro.

Siete trampas al medir, todas pagadas ya:

- **Antes de arreglar una regla de CSS, comprueba que es la que gana.** Lee el
  `selectorText` **ya compilado** en `document.styleSheets`: Angular y Astro
  añaden un atributo **por cada elemento del selector**, no uno por regla.
- **En la cascada, el ORIGEN manda antes que la especificidad.** Cualquier
  `display` de autor le gana a la regla con la que el navegador esconde un
  `[popover]` cerrado o un `[hidden]`. Ha costado dos veces.
- **Un hover solo está comprobado si has pasado el ratón.**
- **Un clic sintético no es un clic.** No dispara el descarte automático de un
  popover ni la apertura de un control nativo.
- **Al mover un fondo, mide lo que se apoya en él**: los tintes translúcidos se
  componen sobre la superficie de debajo.
- **Encoger la ventana no es un móvil**: sigue habiendo ratón. Se emula el
  puntero por CDP.
- **Si una herramienta se cuelga, la medición que deja NO vale.** Un clic que se
  interrumpe entre `mousedown` y `pointerup` deja un panel abierto que con un
  clic real se habría cerrado. Pasó, y dio por buena una función rota.

## 4. Lo que NO se toca

- **Producción**: ni datos de prueba, ni borrados, ni despliegues sin que lo pida.
- **Las facturas emitidas**: no se editan ni se borran, nunca. Un error se
  corrige con una rectificativa.
- **Los contratos firmados**: `firestore.rules` prohíbe borrarlos incluso al
  administrador. Se archivan como `superseded`.
- **`VELTO_VERIFACTU_ENABLED` en producción**: sigue en `false` hasta el 1 de
  enero de 2027 y solo lo cambia Dorel.
- **Las cinco Cloud Functions que hablan con la AEAT** no están en producción a
  propósito. En producción, **nunca `--only functions` a secas**: allí hay **35**
  de las 40 que define el código, y un despliegue completo subiría esas cinco. La
  cifra envejece —ésta ya ha caducado cuatro veces— así que compara **nombres**,
  con `firebase functions:list --project prod --json`.
- **El orden al desplegar:** una function que cambia la **forma** de su respuesta
  va **después** del frontend que la lee; una que solo cambia comportamiento,
  antes. Los dos caminos son distintos y durante unos minutos conviven versiones
  cruzadas. El porqué, con su caso real, en CLAUDE.md.
- **Lo que la web PROMETE.** Un precio, un plazo de borrado o una cobertura
  escritos en una página son afirmaciones contrastables contra el código y
  contra Firestore. Si tocas `publicPrice()`, `CONSULTA_HORAS_POR_DEFECTO` o una
  cláusula del contrato, la página que lo cuenta se toca **el mismo día**.

## 5. Qué hacer primero

1. Pregunta el estado del repositorio con los comandos de arriba, **después de
   un `git fetch`**. Esto ha fallado dos veces seguidas por medir contra la rama
   local.
2. **Di lo que falta por desplegar, midiéndolo.** A 9 de noviembre de 2026 **no
   falta nada**: `master` en `68d10f3`, `develop` con **solo documentación** por
   delante, y las cinco functions del día 7 desplegadas en los dos entornos.
   Pero eso envejece en cuanto alguien toque algo, y un `git diff` contra
   `master` **no** dice si las functions están al día —el CI solo publica
   hosting—. Lo que lo contesta es la marca de tiempo de cada una, en
   `source.storageSource.generation` del `functions:list --json`; hay un comando
   que las ordena en [traspaso-sesion.md](traspaso-sesion.md) § 2 ter.
3. Si no te da una tarea concreta, **pregúntale**. El desarrollo por tandas se
   acabó: lo que viene sale de él usando la aplicación o mirando la web. Lo que
   sigue esperando, ordenado por lo que más vale cerrar:
   - **M-65** — al sustituir un contrato firmado, su PDF **se pisa**: el
     archivado conserva los datos y la huella, pero la ruta de Storage es fija
     por reserva. Son unas quince líneas y desplegar `generateContractPdf`, y
     hay que hacerlo **antes** de la primera sustitución real: después el
     fichero ya está pisado. Hoy no hay ninguno que sustituir —N-45 se decidió
     que no—, y por eso es fácil que se olvide.
   - **El TPV**, que avanzó pero no está concedido: dos peticiones a BBVA
     —habilitar la **preautorización** del comercio, que hoy contesta `SIS0256`,
     y el **plazo de la retención por escrito**, que la documentación de Redsys
     da como 30 días en un sitio y 7 en otro— y probar **Bizum** de punta a
     punta, que el banco **exige** para el pase a producción y ya se puede
     hacer. Todo en [tpv-bbva.md](tpv-bbva.md) § 3 bis y § 3 ter.
   - **VeriFactu: mirar el BOE en DICIEMBRE.** Decisión suya del 6 de noviembre.
     Octubre de 2028 está **anunciado y no publicado**; lo vigente sigue siendo
     el 1 de enero de 2027 para sociedades.
   - **El Storage de producción sin vaciar** (el DNI, el carné y la firma de
     personas reales cuyas fichas ya no existen).
   - Y dos cosas que decide él sobre el aviso de las 17:00: el **texto** —es el
     suyo casi literal— y si debe decir **lo que falta cobrar**; hoy no lo dice,
     y el por qué está al final de [avisos-telegram.md](avisos-telegram.md).

⚠️ **Y dos cosas que deciden muchas discusiones de diseño.**

La primera: Dorel quiere que la aplicación **le vaya guiando**. Lo bloqueado se
ve, sale apagado y lleva el motivo escrito al lado; ni se esconde, ni se deja
pulsar sin efecto. Sus palabras: *«a un empleado no hay que explicarle los
enrevesados»* y *«esta app tiene que ser automática en muchos aspectos si no yo
no me acuerdo»*.

La segunda, para la web: **recolocar, nunca ocultar.** Una tira deslizable que
esconde la última opción del menú incumple esa regla aunque técnicamente esté
ahí — lo que no se ve, no se pulsa.
