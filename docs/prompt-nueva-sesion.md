# Prompt para abrir una sesión nueva

> Pégalo entero como primer mensaje. Está escrito para el asistente, no para
> Dorel: le dice quién es, qué leer, cómo se trabaja aquí y qué hacer primero.
>
> **Es un índice, no un resumen.** No repite lo que ya está en `CLAUDE.md` ni en
> `docs/traspaso-sesion.md` — repetirlo crearía una tercera copia que se quedaría
> vieja. Lo que sí trae es lo que **no vive en el repositorio**: cómo trabaja
> Dorel y qué se espera de ti.

---

Trabajas en **Velto Store**, el backoffice de una empresa real de alquiler de
coches en Arganda del Rey (Madrid). Angular 20 + Firebase, SPA, sin NgModules.

**Dorel** es el dueño, el único desarrollador y el único usuario. Escribe en
español y espera respuestas en español. No es un proyecto de juguete:
**producción tiene clientes, reservas, cobros y facturas de verdad** desde el 17
de septiembre de 2026.

## 1. Lee esto antes de tocar nada, en este orden

1. **`CLAUDE.md`** — entero. Es largo y cada aviso está ahí porque el fallo ya
   ocurrió una vez. No es documentación: es la memoria de los errores.
2. **`docs/traspaso-sesion.md`** — dónde quedó todo. Empieza por **§ 2
   quinquies** (los doce commits del 24 de septiembre, que tocan el camino del
   dinero) y **§ 2 ter** (qué hay sin subir y qué falta por desplegar).
3. **`docs/mejoras-pendientes.md`** — la lista viva. **M-49 y M-50 están
   cerrados** desde el 24 de septiembre de 2026; lo que queda abierto está más
   abajo en ese mismo fichero.
4. **`FUNCIONAL.md`** — el negocio, si la tarea lo toca.

⚠️ **Las cifras de esos documentos envejecen.** El estado del repositorio se
**pregunta**, no se copia:

```bash
git log --oneline origin/master..HEAD          # lo que develop tiene y produccion no
git log --oneline origin/develop..HEAD         # lo que ni siquiera esta subido
git diff --stat origin/master..HEAD -- functions/   # vacio = no hay que desplegar functions
firebase functions:list --project prod | wc -l      # tienen que ser 22
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

## 3. Cómo se verifica, y no es opcional

```bash
npm run build      # ⚠️ tsc NO valida las plantillas y strictTemplates esta activo
npm test           # 723 tests en 31 ficheros
npm run i18n:audit && npm run css:audit && npm run spacing:audit && npm run rows:audit
npm run lint       # linea base: 0 errores y 283 avisos
```

Si sale un **error** de lint, es de lo que acabas de tocar. Los 283 avisos son
deuda reconocida.

⚠️ **Y las cinco comprobaciones juntas no ven lo que ve un ojo.** El patrón de
fallo dominante de este proyecto es **código escrito, desplegado y jamás
ejecutado**: compila, pasa los tests, se despliega, y lo único que falla es lo que
ve el operador. Casi todo lo importante lo ha encontrado Dorel usando la
aplicación.

**Abre el navegador.** Hay un perfil de Playwright con sesión de administrador
abierta contra `http://localhost:4200` (Firebase de **desarrollo**). Recorre el
flujo de verdad y lee el resultado en Firestore, no en la pantalla.

Cuatro trampas al medir, todas pagadas ya:

- **Antes de arreglar una regla de CSS, comprueba que es la que gana.** Lee el
  `selectorText` **ya compilado** en `document.styleSheets`: la encapsulación de
  Angular añade un atributo **por cada elemento del selector**, no uno por regla.
- **Un hover solo está comprobado si has pasado el ratón.**
- **Al mover un fondo, mide lo que se apoya en él**: los tintes translúcidos se
  componen sobre la superficie de debajo.
- **Encoger la ventana no es un móvil**: sigue habiendo ratón.

## 4. Lo que NO se toca

- **Producción**: ni datos de prueba, ni borrados, ni despliegues sin que lo pida.
- **Las facturas emitidas**: no se editan ni se borran, nunca. Un error se
  corrige con una rectificativa.
- **Los contratos firmados**: `firestore.rules` prohíbe borrarlos incluso al
  administrador. Se archivan como `superseded`.
- **`VELTO_VERIFACTU_ENABLED` en producción**: sigue en `false` hasta el 1 de
  enero de 2027 y solo lo cambia Dorel.
- **Las cinco Cloud Functions que hablan con la AEAT** no están en producción a
  propósito. En producción, **nunca `--only functions` a secas**.

## 5. Qué hacer primero

1. Pregunta el estado del repositorio con los comandos de arriba.
2. Si hay commits sin subir a producción, **dilo** y recuerda que el merge lo
   decide él.
3. Si no te da una tarea concreta, **pregúntale**. M-49 y M-50 se cerraron el 24
   de septiembre de 2026 y el desarrollo por tandas se acabó: lo que viene ahora
   viene de él usando la aplicación en producción. Lo que sigue esperando está en
   [traspaso-sesion.md](traspaso-sesion.md) § 5 — entre otras cosas, el **Storage
   de producción sin vaciar**, que son el DNI, el carné y la firma de personas
   reales cuyas fichas ya no existen, y confirmar en un **Android de verdad** que
   el `select` ya se cierra.

⚠️ **Y una cosa que decide muchas discusiones de diseño:** Dorel quiere que la
aplicación **le vaya guiando**. Lo bloqueado se ve, sale apagado y lleva el
motivo escrito al lado; ni se esconde, ni se deja pulsar sin efecto. Sus
palabras: *«a un empleado no hay que explicarle los enrevesados»* y *«esta app
tiene que ser automática en muchos aspectos si no yo no me acuerdo»*.
