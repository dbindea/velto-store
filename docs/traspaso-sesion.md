# Traspaso de sesión — 22 de septiembre de 2026

> Pégalo entero al abrir la sesión nueva. Está escrito para alguien que **no ha
> visto nada de lo anterior**: dice dónde estamos, qué NO tocar, y cómo entra el
> trabajo a partir de ahora.
>
> Lo primero que hay que mirar es **§ 2 bis**, que es lo que se movió los días
> 21 y 22, y **§ 2 ter**, que dice qué hay sin subir y qué falta por desplegar.

---

## 0. LO PRIMERO: esto ya no es un proyecto en construcción

⚠️ **El 17 de septiembre de 2026 la empresa empezó a trabajar en real sobre
producción.** Es la frase más importante de este documento y lo cambia todo lo
demás.

Hasta ese día `rentalcar-veltomobility` tenía datos desechables y estaba
permitido ensuciarlo para probar. **Ya no.** Lo que hay dentro son clientes,
reservas, cobros y facturas de verdad.

Lo que eso significa, en concreto:

| | Antes | Ahora |
|---|---|---|
| Cambiar la forma de un documento | se cambiaba y se borraban los datos | **campos aditivos y migración** |
| Renombrar un campo | en sitio | **tres despliegues**: escribir, migrar, borrar |
| Borrar una colección en producción | se hizo tres veces | **no** |
| Probar | valía producción | **solo `velto-store`** |

La regla larga, con sus motivos, está en CLAUDE.md § «Los datos de producción YA
SON REALES». Y hay un matiz que se olvida: **lo congelado no se migra**. Los
snapshots —`pricingSnapshot`, `ownerShareSnapshot`, `clientSnapshot`, el del
contrato— son histórico, y el código nuevo tiene que saber leer los viejos. Eso
no es un parche de compatibilidad: es la razón de ser de un snapshot.

---

## 1. Qué es esto

**Velto Store** — SPA de gestión de flota de alquiler. Angular 20 + Firebase.
Negocio real, pequeño: 2–10 coches en Torrejón de Ardoz. Se opera **desde el
móvil, en la calle**. El dueño se llama **Dorel** y es quien programa.

Lee **`CLAUDE.md`** entero antes de tocar nada: es largo y cada aviso está ahí
porque el fallo ya ocurrió. Y **`FUNCIONAL.md`** para el negocio.

Dos entornos, dos proyectos: `velto-store` (desarrollo, rama `develop`,
`store.veltorent.com`) y `rentalcar-veltomobility` (producción, rama `master`,
`rentalcar.veltomobility.com`).

---

## 2. Dónde quedó todo el 17 de septiembre

Fue un día largo y conviene saber qué se movió, porque casi todo fue en
producción.

**Producción se vació entera** antes de empezar en real: siete colecciones y los
siete ficheros de Storage, versiones incluidas. Quedó solo `authorizedUsers` con
`veltorent@gmail.com`. Fue el último borrado; ya no se puede repetir.

**Se desplegaron a producción** las cinco functions que se habían quedado atrás
—`generateContractPdf` con el archivado de contratos, `getContractVerification`
con el estado `superseded`, y las tres de Redsys con el importe pendiente, el
nombre del cliente fuera del base64 y la devolución que ya no se lee como
cobro—. Verificadas: las dos públicas responden bien.

**Y producción empezó a facturar.** `VELTO_INVOICING_ENABLED=true`,
`issueInvoice` e `issueComplianceDeclaration` desplegadas, y la declaración
responsable emitida (`verifactuDeclarations/1.0`). La primera factura será
`2026/0001`.

⚠️ **Emite pero NO remite.** `VELTO_VERIFACTU_ENABLED` sigue en `false`: los
registros se guardan con cada factura y no se envían a la AEAT hasta el 1 de
enero de 2027. Es legal —la obligación no empieza hasta entonces— y es lo que
mantiene apagados el QR y la leyenda, que es lo correcto mientras la sede no
tenga esas facturas.

**Estado de las functions** (verificado ese día): producción **22**, desarrollo
**27**. Las cinco que faltan son las que hablan con la Agencia, y faltan a
propósito.

**Reglas e índices de producción: al día.** Comprobado descargando el ruleset
desplegado y comparándolo — `firestore.rules` solo difiere en un comentario,
`storage.rules` es idéntico y los 13 índices declarados están los 13. La
advertencia de traspasos anteriores («las reglas nuevas están solo en
desarrollo») **ya no aplica**.

---

## 2 bis. Lo que se movió el 21 y el 22 de septiembre

Todo esto salió de **Dorel usando la aplicación en producción**, que es el modo
de trabajo que anunciaba el § 3. Ni una sola de estas cosas la encontró un test.
Van de más importante a menos.

**La ITV y el seguro ahora BLOQUEAN el alquiler** (`fd0db71`). Es una reversión
de una decisión escrita —antes solo avisaban— y el motivo es de Dorel: *«esta
app tiene que ser automática en muchos aspectos si no yo no me acuerdo»*. La
raya nueva es **qué impide circular**: `itv` y `insurance` bloquean, y el resto
de mantenimientos siguen avisando. Se compara contra la **fecha de devolución** y
por días. Lo miran los tres caminos por los que sale un coche —el buscador, el
servicio que crea o edita, y el parte de entrega— con una sola consulta
(`VehicleMaintenanceService.blockingFor()`) y la regla pura aparte
(`blockingMaintenance()`, con tests). **No admite excepción de workflow** y la
pantalla no ofrece «Saltar este paso».

⚠️ **El recordatorio de 7 días que pedía ya existía**: el correo de las 9:00
avisa con 30 días y la pantalla de Eventos con 7. Lo que faltaba no era el aviso,
era que tuviera consecuencias. Conviene saberlo para no construirlo otra vez.

**Un coche alquilado hoy ya se puede reservar para otras fechas** (`713ffe4`).
Fallo de producción: un coche alquilado hasta el 26 salía como «no está
disponible en la flota» al pedirlo para el 1 de octubre. El estado es un hecho de
hoy; la disponibilidad es una pregunta sobre un rango. Y el estado **sí se mueve
solo** —lo ponen los dos partes de inspección—, cosa que CLAUDE.md negaba.

**Calendario y reloj propios en escritorio** (`8dd487d`). El panel de un
`input[type=date]` lo dibuja el navegador y no hay CSS que lo alcance, así que
hay uno nuestro: `DatePickerDirective` + `DatePickerPanelComponent`, con la
aritmética aparte y 21 tests. **En móvil sigue mandando el nativo**, y el campo
sigue siendo un `input[type=date]` de verdad — quitar la directiva de los
`imports` lo devuelve todo a como estaba sin tocar una plantilla.

**ESLint, que no existía** (`4755be8`). `npm run lint`, con las reglas escogidas
a mano y su motivo escrito en `eslint.config.mjs`. Queda en **0 errores y 283
avisos**: los avisos son deuda reconocida —107 promesas sin esperar y 172 de
accesibilidad en plantillas—, así que **si sale un error nuevo es de lo que
acabas de tocar**. Encontró un parámetro que mentía
(`getUpcomingMaintenance(withinDays, withinKm)` decía filtrar por kilómetros y no
lo hacía) y tres `@Output()` con nombre de evento del DOM.

**Y seis arreglos de pantalla**, todos vistos por Dorel y todos verificados en el
navegador antes de darlos por buenos (`3602dbf`, `7c1015b`, `a5dbf63`,
`f1b7611`):

- Los **iconos de fecha y hora no se veían en tema oscuro**: un `filter: invert()`
  escrito antes de que existiera `color-scheme` los estaba oscureciendo.
- El **menú «Más» no se cerraba** al elegir una opción: el panel vivía dentro del
  botón que lo abre y el clic lo reabría al propagarse. Ahora **la navegación
  cierra todos los menús**.
- Los **filtros de Inspecciones** se salían de su caja en el móvil.
- La **papelera de conductores** salía pegada arriba en vez de centrada.
- Los **botones de cobro** no estaban «pegados»: estaban **sin estilo**, porque
  `.charge-actions` se había escrito dentro de `.refund-card` y los botones viven
  en otra tarjeta.
- El **subtítulo de Pagos explicaba el botón en vez del título**, porque a esa
  cabecera le faltaba el `display: flex`.
- Y **los `select` del móvil**: el *customizable select* entraba también en
  Android —`@supports` dice si el navegador *puede*, no si *conviene*— y el
  desplegable había dejado de cerrarse al tocar fuera. Ahora el bloque vive
  dentro de `@media (hover: hover) and (pointer: fine)`.

⚠️ **Dos de esos seis son la misma trampa y va a volver: una clase declarada que
NO se aplica**, porque el antepasado no la envuelve o porque la regla vive donde
no toca. `css:audit` **no la caza** —para él la clase está declarada— y lo único
que la distingue es `getComputedStyle()` en la pantalla de verdad.

---

## 2 quater. Lo que se movió el 23 de septiembre

Otra tanda salida de **Dorel usando la aplicación**, en un solo mensaje con ocho
peticiones. Ninguna la habría encontrado un test. De más importante a menos.

**La fecha del mantenimiento sí se deja borrar, y el fallo no estaba donde
parecía.** Dorel lo contó como «la fecha no me la permite borrar»; el campo se
vaciaba perfectamente y lo que fallaba era **la escritura**: el limpiador de
Firestore descarta `undefined` y `null`, y un `updateDoc` **sin la clave deja
intacto lo que hubiera**. Al recargar, la fecha volvía. Y no era una fecha: eran
los **diez** campos opcionales del mantenimiento, más otros tres en **Gastos**,
que nadie había mirado. Ahora un campo presente y vacío viaja como
`deleteField()`. Verificado de punta a punta con una recarga completa contra
Firestore.

**El aspa para vaciar un campo**, que Dorel pidió señalando la de Android.
`ClearInputDirective`, por tipo de campo y sin atributo que recordar, en 27
componentes. Se dibuja como **fondo del propio campo** —cero elementos nuevos,
cero riesgo de romper la maquetación de decenas de formularios— y en los campos
de fecha va **a la izquierda del calendario**, en una banda contigua del mismo
ancho. La aritmética está aparte y con tests, por la misma razón que el QR: un
aspa que no se puede pulsar tiene la misma pinta que una buena.

**La fianza ya se puede bajar a 0 borrando.** Al vaciar con retroceso se reponía
sola al valor por defecto, porque el manejador trataba «vacío» como «ilegible».
Son **tres** estados y no dos —sin tocar, con importe, y vacío— y hacía falta una
bandera aparte. El mismo fallo estaba en el precio acordado, donde vaciar «540»
para escribir «200» dejaba **540200**.

**Nueve campos que no normalizaban lo que se teclea**, todos nacidos fuera del
formulario al que pertenecen: el alta rápida de propietario («Daniel defoe»), el
DNI del alta rápida de cliente, la aseguradora, los conductores de la edición de
reserva, el DNI y el carné de los del detalle, el NIF del colaborador, y el
domicilio y el NIF del destinatario de una factura. Ojo: **el asistente de
creación no tiene conductores adicionales**; el campo que Dorel señaló es el de
la pantalla de edición.

**El lugar de recogida y el de devolución nacen escritos** («Oficinas Velto -
Arganda», `APP_DEFAULTS.DEFAULT_RENTAL_LOCATION`) **y ahora se pueden editar**.
Lo segundo es consecuencia de lo primero: hasta ese día no se podían corregir en
ninguna parte, y era inocuo porque el campo solía ir vacío; con defecto puesto,
**todas** las reservas llevan una frase impresa en el presupuesto, el
justificante y el contrato. Van en la lista de campos impresos de
`requiresNewContract()`.

**El formulario de mantenimiento, reordenado**: primero «Nuevo recordatorio»
—que es lo que de verdad hace algo: dispara el correo de las 9:00 y la fila de
Eventos— y debajo «Realización (opcional)». Y un aviso ámbar al vaciar la fecha
de una ITV o un seguro, porque eso **devuelve el coche a la flota en silencio**:
es el reverso de la reversión del día 21 y no lo había visto nadie.

**Y tres cosas de colocación**: el menú lateral reordenado por uso (dashboard,
reservas, eventos, calendario, coches, clientes, informes, y detrás el resto),
que gobierna también la barra del móvil desde el mismo array; la lista de
Reservas abierta en **«Todas»**, porque una lista recortada no se lee como un
filtro puesto sino como que no hay más; y el justificante y la factura movidos al
**final** de la ficha de reserva, que es cuando el cliente los pide.

⚠️ **Lo que conviene recordar de esta tanda**, porque va a volver: **vaciar un
campo en pantalla no es vaciarlo en Firestore**. Era un caso raro mientras había
que borrar a mano carácter a carácter; con un aspa en cada campo está a un toque,
y cualquier servicio con campos opcionales editables lo tiene.

**Y lo que encontró la revisión del propio cambio**, que es lo más instructivo:

- **Cancelar `pointerdown` no cancela el `click`** —Pointer Events solo suprime
  los eventos de compatibilidad de ratón—, y en un `input[type=date]` el `click`
  es lo que abre la hoja del sistema. O sea que en el móvil el aspa habría
  vaciado la fecha y abierto el calendario encima pidiendo la que se acababa de
  quitar. **Probado con ratón no salía**: en escritorio el panel propio escucha
  `mousedown`, que sí se suprime. Una comprobación con ratón no dice nada del
  caso táctil cuando lo que se prueba es quién abre un control nativo.
- **El desplazamiento del aspa seguía al tipo del campo y tiene que seguir a
  quién pinta el calendario.** Con el dedo el icono lo pone el navegador, al
  final de la caja de contenido, así que el relleno lo empuja hacia dentro: el
  aspa acababa a su derecha y la zona pulsable montada encima.
- **En Informes vaciar el filtro de fechas dejaba el campo en blanco y los
  números en el rango viejo** — y en blanco para siempre, porque `[value]` es de
  una vía y la expresión no cambiaba. Estaba así desde siempre; lo destapó poder
  vaciar.
- **`capitalizeWords()` degradaba las direcciones españolas**: «2ºA» salía
  «2ºa» y «(MADRID)», «(madrid)», porque capitalizaba desde el carácter 0 y ahí
  había un dígito o un paréntesis. Ahora empieza en la primera letra **con
  caja** —ojo, «º» es letra para Unicode y no tiene caja—. Salió al aplicarla al
  domicilio fiscal del destinatario de una factura, que es un documento que no
  se puede corregir.

---

## 2 ter. Qué hay sin subir y qué falta por desplegar

Medido el 22 de septiembre al cerrar la sesión. **No te fíes de las cifras, que
envejecen — vuelve a preguntarlo:**

```bash
git log --oneline origin/master..HEAD     # lo que develop tiene y produccion no
git log --oneline origin/develop..HEAD    # lo que ni siquiera esta subido
git diff --stat origin/master..HEAD -- functions/   # vacio = no hay que desplegar functions
```

Ese día: **`develop` al día con `origin/develop`**, con **11 commits que NO están
en producción** — los diez de § 2 bis más el de esta documentación —, y
`origin/master` en `0d32ba4` (21 de septiembre).

⚠️ **NO hace falta desplegar Cloud Functions.** Comprobado con el tercer comando:
de los 66 ficheros que cambian entre producción y `develop`, **ninguno está en
`functions/`**. Un merge a `master` despliega hosting por CI y con eso está todo.
Es la excepción, no la regla: normalmente hay que mirarlo.

Para ponerlo en producción: que Dorel lo revise, merge a `master`, y **comprobar
en el pie de la aplicación que el commit que se está ejecutando es el del
merge** — para eso se puso (`98436c5`). Ojo con la caché de Cloudflare: el
dominio propio puede seguir sirviendo lo viejo un rato, y quien dice la verdad es
`rentalcar-veltomobility.web.app`.

⚠️ **Y una advertencia de historial: Dorel commitea y sube en paralelo mientras
yo trabajo.** El día 22, tres commits míos que estaban sin subir aparecieron en
`origin/develop` a mitad de sesión, y una documentación mía se subió con el
mensaje «claude» tres segundos después de crearse. **Antes de enmendar nada,
comprobar si ya está en el remoto** (`git log origin/develop..HEAD`): enmendar un
commit ya publicado obliga a un force-push, y aquí eso no se hace.

---

## 3. Cómo entra el trabajo a partir de ahora

El desarrollo por tandas se cierra aquí. Lo que venga vendrá de **Dorel
trabajando en producción**: un fallo que le salga, algo que le estorbe, o una
funcionalidad que eche en falta con clientes delante.

Cuando llegue uno de esos, el orden que ha funcionado:

1. **Reproducirlo, no imaginarlo.** El patrón de fallo dominante aquí es código
   escrito y nunca ejecutado; el segundo es código que sí se ejecutó pero en el
   otro entorno.
2. **Preguntarse si es de producción o del código.** El 17 de septiembre, un
   «User code failed to load» del despliegue no era el código —cargaba en 1,2 s—
   sino la máquina ocupada; y un «No se pudo consultar el estado de la remisión»
   sí era el código, pero no donde parecía.
3. **Arreglarlo en `develop`, probarlo en desarrollo, y luego a `master`.** El
   CI despliega hosting; **las functions van a mano**.
4. ⚠️ **Los despliegues de functions a producción los lanza Dorel.** A mí me los
   bloquea el clasificador de permisos, así que lo que hago es dejarle el
   comando exacto, con `--only` explícito y por tandas.

---

## 4. Lo que NO se toca

- **Producción no se usa para probar.** Ni una reserva de prueba, ni un cobro:
  allí Redsys está en `live` y cobra de verdad.
- **No se borran colecciones en producción.** Nunca más.
- **`invoices` es inmutable.** `update` y `delete` denegados a todo el mundo,
  administrador incluido. Un error se corrige con una rectificativa.
- **La declaración responsable tampoco se borra.** Hay una por versión del
  sistema y ya existe la 1.0.
- **`VELTO_VERIFACTU_ENABLED` en producción solo lo enciende Dorel**, con el
  guion del 1 de enero delante.
- **`veltorent@gmail.com`** es el único propietario de los dos proyectos y el
  único usuario. Si se pierde esa cuenta no hay forma de entrar, restaurar ni
  desplegar. Sigue siendo el primer punto pendiente del sobre
  ([emergencia.md](emergencia.md)).

---

## 5. Lo que queda pendiente

La lista viva está en [mejoras-pendientes.md](mejoras-pendientes.md). Lo que hay
que tener en la cabeza al retomar:

**Con fecha, y es lo único con fecha:** el guion del 1 de enero de 2027
([verifactu-alta.md](verifactu-alta.md) § 5 bis). Incluye un paso nuevo —el 3
bis— que no existía y que lo crea haber empezado a facturar antes: **qué se hace
con las facturas de 2026** cuando se encienda la remisión. El barrido se lleva
todas las filas pendientes **sin filtro de fecha**, así que si no se decide
nada, en enero intentará remitir meses de facturas que nunca estuvieron
obligadas. Las dos salidas están escritas y **hay que probarlas contra
preproducción desde desarrollo, antes de enero**.

**Decisiones de Dorel, sin prisa:** el turquesa `#20A48F` como texto se queda en
3,10:1 y hace falta 4,5:1 —haría falta un tono propio para texto—; la fianza
automática a clientes conocidos (M-21); y consultar VIES antes de emitir, que
hoy no se hace y una factura con un NIF-IVA que la AEAT no reconozca no se puede
remitir nunca.

**Deuda técnica que ahora sí puede morder:** Informes se trae seis colecciones
enteras y filtra en memoria —es lo primero que se rompe cuando crezcan los
datos—; y dos operadores pueden reservar el mismo coche, reducido a milisegundos
pero no cerrado. Lo del lint **ya no aplica**: existe desde el 22 de septiembre.

**Sin cerrar desde hace tiempo:** un cobro por la vía pública del móvil que se
registre solo en **producción**. En desarrollo ya ocurrió; una vía de cobro no
está probada hasta que alguien paga por ella y la aplicación se entera sin
ayuda.

### Lo que dejó abierto la sesión del 22 de septiembre

Tres cosas que hay que retomar, y ninguna es código a medias:

1. ⚠️ **Confirmar en un Android de verdad que el `select` ya se cierra.** El
   arreglo está verificado emulando el puntero por CDP —`base-select` con ratón,
   `none` con dedo— pero **nadie lo ha abierto en un teléfono**. Es lo primero
   que hay que preguntarle a Dorel al retomar.
2. **El redirigir `store.veltomobility.com` → `rentalcar.veltomobility.com`.**
   Decidido: solo redirección, las URL del cliente no cambian. Se hace **en el
   panel de Cloudflare** (registro `A` a `192.0.2.1` proxado + una Redirect Rule)
   o, si se prefiere todo en Google, añadiendo el dominio en Firebase Hosting con
   la opción de redirigir. **No hay nada que programar** y no está hecho.
   ⚠️ Añadir un dominio es reversible; **retirar el viejo no**: los contratos
   firmados llevan impreso un QR que apunta a `/v/…` del dominio con el que se
   generaron.
3. **Los 283 avisos del lint.** Son deuda reconocida, no ruido: 107 promesas sin
   esperar —la mayoría a propósito— y 172 de accesibilidad en plantillas (47
   `<div (click)>` que no se alcanzan con el teclado). Se repasan por tandas y
   **entonces** se suben a `error`.

Y dos cosas menores que quedaron sin ejercitar en su pantalla real, por no haber
datos en desarrollo: el panel de **fecha y hora juntas** (solo existe en editar
reserva; se probó el mismo código cambiándole el tipo a otro campo) y la
**galería de fotos**, cuyo `(closed)` se renombró y se comprobó por grep y por
compilación pero no abriendo una foto.

---

## 6. Cómo se trabaja aquí

Esto no es estilo, es lo que hace que la aplicación no mienta:

1. **Antes de dar algo por bueno**: `npm run build` (comprueba las plantillas,
   cosa que `tsc --noEmit` no hace), `npm test`, `npm --prefix functions test`,
   `npm run lint` y las cuatro auditorías — `i18n:audit`, `css:audit`,
   `spacing:audit` y `rows:audit`. Hoy el lint queda en **0 errores**: si sale
   uno, es de lo que acabas de tocar.
2. **Y además abrir la pantalla.** El patrón de fallo dominante es **código
   escrito y nunca ejecutado**. Los fallos más caros de septiembre no los habría
   cazado ninguna auditoría — y los seis del día 22 los encontró Dorel mirando,
   no un test.
3. **Mirar también el móvil**, a 390 px. Es una aplicación de móvil.
   ⚠️ **Y encoger la ventana NO es un móvil.** Una ventana estrecha sigue
   teniendo ratón: `pointer: fine` sigue siendo verdad. Para lo que dependa del
   dedo hay que emular el puntero (`Emulation.setTouchEmulationEnabled` por CDP),
   que es lo que destapó lo de los `select`.
4. **Medir, no deducir.** Vale para el CSS —`getComputedStyle` es la única
   respuesta buena, y la especificidad de Angular engaña— y vale para los
   despliegues: el 17 de septiembre, dos errores seguidos acusaban al código y
   ninguno era del código.
   ⚠️ **Y «declarado» no es «aplicado».** Dos veces en el mismo día: una clase
   escrita bajo un antepasado que no la envuelve no pinta nada, y el auditor de
   CSS la da por buena porque existe.
5. **El texto y el hecho se deciden juntos.** Ha mordido cinco veces: el
   contrato afirmaba una firma que no tenía, el presupuesto decía «IVA incluido»
   sobre un desglose que lo sumaba…
6. **Nada de texto en español dentro del código.** Todo clave i18n, en los tres
   idiomas.
7. **Un botón que no hace nada es un fallo**, y un permiso denegado se explica.
8. **Cada pregunta se contesta con su propia bandera**, aunque hoy dos coincidan.
   Es la lección de `invoicingEnabled` contra `verifactuEnabled`: coincidieron
   durante meses y el día que se separaron rompieron una pantalla.
9. **Commits en español**, formato convencional, contando **por qué**. Se puede
   commitear en `develop`; **`master` necesita el visto bueno de Dorel**, y
   ahora con más razón: merge a `master` es desplegar sobre datos reales.

⚠️ **Y lo más importante de todo:** cuando algo no cuadre, **decirlo**. La regla
de esta casa es que una cifra creíble y equivocada es peor que un error.
