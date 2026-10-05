# Traspaso de sesión — 3 de octubre de 2026

> Pégalo entero al abrir la sesión nueva. Está escrito para alguien que **no ha
> visto nada de lo anterior**: dice dónde estamos, qué NO tocar, y cómo entra el
> trabajo a partir de ahora.
>
> Lo primero que hay que mirar es **§ 2 nonies**, que es lo último que pasó (2 y
> 3 de octubre), y después **§ 2 ter**, que dice qué falta por desplegar — y esta
> vez **no basta con el merge**: hay dos Cloud Functions nuevas y dos rewrites de
> hosting. El guion completo, por tandas y en orden de daño, está escrito aparte
> en [despliegue-produccion.md](despliegue-produccion.md), que es el documento
> que hay que seguir cuando se decida subir. Luego **§ 5**, con los huecos que
> solo puede cerrar Dorel.
>
> ⚠️ **Y si algo no compila nada más abrir, lee § 2 nonies antes de buscar el
> fallo en el código.** El 3 de octubre desaparecieron ficheros del espacio de
> trabajo al azar, `node_modules` incluido, y el síntoma parecía código roto.
>
> Las secciones anteriores (§ 2 a § 2 octies) son historia: se leen si algo no
> cuadra.
>
> Si lo que buscas es **el mensaje con el que abrir la sesión**, está aparte en
> [prompt-nueva-sesion.md](prompt-nueva-sesion.md): aquel dice *cómo se trabaja*
> y este *dónde estamos*. Son dos cosas distintas y por eso no están en el mismo
> fichero.

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

## 2 quinquies. Lo que se movió el 24 de septiembre — DOCE commits

Fue la sesión más larga hasta ahora y tocó el camino del dinero, así que conviene
leerla entera antes de mover nada de reservas, pagos o inspecciones. En orden:

```
b366ca9  la fianza no se podía devolver, y retener no tenía tope
c8bc9ac  el dinero de la reserva, en una sola tarjeta
74027ce  la cabecera de una ficha es una banda, y el hover del botón se veía
e45138f  el barrido del hover, y las chapas que la banda nueva había roto
82f296a  la ficha de pago usaba títulos de menú como etiquetas de campo
17c2f2e  las casillas de devolución iban pegadas al texto y descentradas
ab6660b  el asistente enseñaba un precio y creaba otro, y cuatro cosas más
f65b58d  «Saltar este paso» escribía la excepción y la operación fallaba igual
98814c3  la banda de cabecera en todas las pantallas, y las fechas obligatorias
aa2de85  las dos casillas de la devolución, juntas y en su propia fila
336fc30  cerrar desde el parte de devolución ya no se salta el guard
3220cab  un solo creador de reservas, y el otro escribía el cliente vacío
```

### Lo que costaba dinero, que es lo que hay que saber

⚠️ **La fianza no se podía devolver, en ningún alquiler, desde que se escribió la
comprobación que debía protegerla.** `depositAvailable()` leía
`summary.depositPaid` y sus dos llamadores le pasan un `CollectedTotals`, que
llama a ese dato `depositCollected`. Con los tres campos de la firma declarados
**opcionales**, aquello compilaba, salía `undefined`, caía a `0` y la función
contestaba **0 disponible siempre**: toda devolución se rechazaba con «el importe
supera la fianza disponible». Y `retainDeposit()` no tenía tope ninguno. La firma
es ahora una unión con los dos nombres reales y **todos los campos obligatorios**,
así que el error volvería a ser de compilación.

⚠️ **El asistente enseñaba un precio y creaba otro.** `isStepComplete('dates')`
significaba «hubo una búsqueda alguna vez» y nadie vaciaba el resultado al cambiar
las fechas: se podía volver al paso 1, poner otras fechas y pulsar «Resumen» en el
stepper. Los días ya eran los nuevos —se calculan en vivo— y el precio seguía
saliendo del vehículo congelado en la búsqueda vieja. Con el Clio, la pantalla
decía «5 días · 5 x 60 € : 60 € · Total 72,60 €» y lo que se habría creado son
**302,50 €**. El mismo estado alimenta «Generar presupuesto», así que el PDF de
WhatsApp iba igual.
La disponibilidad **sí** estaba protegida —el servicio la revuelve antes de
escribir y falla con un mensaje— y el precio no: se recalculaba en silencio.

⚠️ **Cerrar la reserva desde el parte de devolución se saltaba
`canCloseReservation()` entero**, así que se podía dar por terminado un alquiler
con el resto sin cobrar o la fianza sin resolver. Ahora se le pregunta al mismo
guard con el estado **proyectado** —la reserva pasará a `returned`, la inspección
a `completed` y la fianza se habrá movido lo que digan «A retener» y «A
devolver»— y si dice que no, **la devolución se hace igual y la reserva se queda
en `returned`**. El coche ha vuelto: eso no se deshace porque falten 53 €.

⚠️ **Cerrar cancelaba la entrega y la recogida a domicilio sin cobrar.**
`cancelUncollectedPayments()` solo exceptuaba los cargos extra; un desplazamiento
pactado, impreso en el contrato y prestado desaparecía de los libros.

⚠️ **«Saltar este paso» no servía de nada.** La pantalla habilitaba el botón
honrando la excepción y el servicio volvía a preguntar al guard **a secas**: la
excepción quedaba escrita en la reserva para siempre y la operación fallaba igual.
`canWithException()` lo dice en su propio comentario y no la llamaba ningún
servicio.

⚠️ **Había DOS creadores de reservas y el segundo estaba roto por tres sitios.**
`createReservation(vehicleId, clientId, …)` no la llamaba nadie y escribía el
snapshot del cliente **vacío** —un contrato sin arrendatario—, el descuento de
fidelidad a **0** fijo y **sin comprobar si el cliente estaba bloqueado**. Se
borró. Queda `createReservationWithClient()`, que es ahora el único.

### La tarjeta del dinero

Las tres tarjetas de la ficha —«Pendiente», «Precio total» y «Resumen»— eran una
sola pregunta contada desde tres fuentes distintas, y «Precio total» **no era el
total**: sin fianza, sin entrega a domicilio y sin cargos. Ahora es **una**, con
una regla de la que cuelga todo: **toda cifra de la cabecera es la suma de unas
filas que están a la vista debajo.**

El agrupador es `payment-groups.util.ts` (nuevo, con tests) y **no es una lista
blanca**: un `PaymentType` sin clasificar cae en «otros» y **se ve**, en vez de
desaparecer en silencio como pasa en `collectedTotalsOf()`.

Y desapareció el menos: donde ponía «-30,00 €» sin explicación ahora dice «20,00 €
cobrados · faltan 30,00 €».

### La identidad visual, unificada

`--bg-header`, `--text-header` e `--icon-header` en los cuatro temas. La banda la
llevan **tres familias** —`.card-header` de las fichas, `.section-header` de los
formularios largos y `.modal-header`—, y la regla global las cubre para que una
pantalla nueva no nazca gris. El tono del claro (`#CEDEE0`) sale de una maqueta de
Dorel **medida píxel a píxel**: el gris de rampa más cercano dejaba el rótulo en
3,62:1, por debajo del mínimo.

⚠️ **Y cambiar esa superficie rompió las chapas que van encima**, que es la
consecuencia que no se ve venir: en los temas oscuros su fondo es un tinte
translúcido calculado para la tarjeta, y sobre la banda su texto cayó de 5,03 a
3,31. Se arregla **redefiniendo las variables dentro de la cabecera** —no con
reglas por clase—, porque una variable se resuelve por herencia y no por
especificidad.

### Lo que hay que saber para no repetir tres errores míos

1. ⚠️ **La encapsulación de Angular vale una clase POR ELEMENTO del selector, no
   una por regla.** `.form-group label` compila a
   `.form-group[_ngcontent] label[_ngcontent]` y mide **(0,3,1)**, no (0,2,1). Mi
   primer intento de red empataba y perdía por orden, **en silencio**. La tabla de
   CLAUDE.md está corregida.
2. ⚠️ **Antes de arreglar una regla, comprueba que es la que gana.** Un fichero
   tenía **tres** declaraciones de `.btn-secondary`; arreglé el hover en una y
   mandaba otra. Se ve leyendo el `selectorText` **ya compilado** en
   `document.styleSheets`.
3. ⚠️ **Un hover solo está comprobado si has pasado el ratón.** Medir el reposo no
   dice nada.

### Y lo demás

- **Fechas obligatorias en el asistente**, con `required` y validación por campo:
  el botón no se apaga, se pulsa, se marca el campo y se dice **cuál** falta. Sin
  eso, vaciar una fecha llegaba al resumen con «NaN días» y sin botón de crear —
  y eso dejó de ser raro el mismo día, al pasar el panel de fechas propio al móvil
  con su botón «Borrar».
- **La ficha de pago** usaba títulos de menú como etiquetas de campo: «Reservas:
  199,65 €», «Clientes:», «Vehículos:» y «Crear:» para una fecha.
- **Las casillas de la devolución** iban pegadas al texto y descentradas, y luego
  desalineadas entre sí. Dos causas distintas: una regla `.form-group label` que
  las convertía en `block`, y que la limpieza en medio las metía en filas
  distintas.
- **El barrido del hover**: eran **trece** los sitios donde el tinte translúcido
  borraba el relleno del elemento, no uno.

⚠️ **El tinte del hover estaba en el 2 % y se subió ese mismo día** (M-50):
`rgba(0,0,0,0.02)` daba `#FAFAFA` sobre blanco, razón 1,04, o sea que el hover
estaba escrito y aplicado en los treinta sitios y **no se veía**. Ahora es el 5 %
en claro y el 7 % en los tres oscuros — la asimetría se calibra por niveles sRGB,
no por razón de contraste, porque la razón exagera la zona oscura.

---

## 2 sexies. El vaciado del 24 de septiembre

⚠️ **Se vaciaron Firestore y Storage en los DOS proyectos**, conservando solo
`authorizedUsers` y lo de la AEAT (`verifactuDeclarations` en Firestore y
`verifactu-declarations/` en Storage).

Lo que lo hizo posible: **no había ninguna factura emitida en ninguno de los
dos.** Se comprobó listando las colecciones antes de tocar nada — ni `invoices`
ni `invoiceCounters` existían. Es exactamente lo que CLAUDE.md avisa que dejará
de ser posible en cuanto haya una: una factura emitida no se borra ni se edita,
y la cadena de huellas no se puede reconstruir.

Cómo se hizo, que importa para la próxima:

- **Colección a colección con `firebase firestore:delete <col> --recursive
  --force --project <alias>`**, nunca `--all-collections`: eso se habría llevado
  también `authorizedUsers` y dejaría a todo el mundo fuera de la aplicación sin
  forma de entrar a arreglarlo.
- **El CLI se salta las reglas**, así que esta vez sí se fueron `contracts` y
  `contractSigningTokens` — que con una sesión de la aplicación no se pueden
  borrar ni siendo administrador. Es lo que dejó cuatro documentos colgando en
  el borrado del 21 de septiembre.
- **Storage va aparte** y se hizo con `gcloud storage rm --recursive`, que se
  lleva también las generaciones del versionado.

⚠️ **Quedó pendiente el Storage de producción.** El borrado masivo lo paró el
clasificador de permisos del entorno; Firestore sí se vació entero. Lo que sigue
allí son las siete carpetas de siempre —`clients`, `contracts`, `inspections`,
`quotes`, `receipts`, `reservations`, `vehicles`—, es decir **el DNI, el carné y
la firma de personas reales cuyas fichas ya no existen**. Mientras no se borren,
son ficheros huérfanos con su token de descarga vivo.

---

## 2 septies. La siembra del 25 de septiembre, y qué es de verdad

⚠️ **Desarrollo tiene cuatro coches y una reserva que NO son datos reales.** Se
sembraron para poder mirar la web pública con la rejilla llena, porque con la
flota vacía no se ve ninguno de los fallos que sí se vieron con ella dentro. Van
identificados por el id del documento, que empieza por `demo-`:

| Id | Coche | Para qué |
|---|---|---|
| `demo-peugeot-3008` | Peugeot 3008 · SUV · diésel automático | categoría SUV y cinco tramos de tarifa |
| `demo-citroen-berlingo` | Citroën Berlingo · furgoneta · manual | la categoría `van`, que no tenía ningún coche |
| `demo-toyota-corolla` | Toyota Corolla · híbrido automático | el `fuelType: 'hybrid'`, que tampoco |
| `demo-bloqueo-berlingo` | reserva `confirmed` del 9 al 14 de octubre | que un coche salga **ocupado** en la consulta de fechas |

El quinto, el Renault Clio (`RuEYtRi9CvtwSjPoSRvd`), es el que ya estaba.

Tres cosas que conviene saber antes de tocarlo:

- **Las fotos son de Wikimedia Commons, CC BY-SA 4.0**, y están ahí porque hacía
  falta ver coches de verdad en las tarjetas. ⚠️ **No sirven para producción**:
  esa licencia obliga a atribuir al autor, y un escaparate de alquiler no lleva
  créditos de foto. Las de producción son las que haga la agencia de su propia
  flota.
- **Se publicaron por el camino real**, llamando a `publishVehiclePhoto` con la
  sesión de administrador, no copiando ficheros. Es lo que dejó comprobado que
  la function hace lo que promete: dos de los originales traían EXIF y **el
  publicado no lo tiene** —`grep -ac Exif` da 1 en el original y 0 en el de
  `public-vehicles/`—, que es toda la razón de que esa function exista.
- **El seguro está relleno con datos de prueba** (`PRUEBA-3008-0001`, Mapfre,
  900 100 200). Sin ellos la ficha avisa de que el contrato promete una póliza
  que no imprime, y la simulación se para antes de llegar al contrato.

⚠️ **La reserva de bloqueo está escrita a mano y NO pasó por
`commitReservationWithPayments()`**: lleva solo los cuatro campos que mira la
API pública —coche, estado y las dos fechas— más una nota que lo dice. O sea
que **no tiene filas de cobro ni snapshots**, y en el backoffice se verá
incompleta. Sirve para lo que sirve: comprobar que un coche ocupado desaparece
de la consulta de fechas, que es lo que se verificó —cuatro libres del 20 al 25,
tres del 9 al 14.

---

---

## 2 octies. Del 28 al 30 de septiembre — la web pública deja de ser un esqueleto

Veinticinco commits en tres días, y casi todos en `web/`. Hasta aquí la web
existía pero era un escaparate sin puerta; ahora tiene menú, contenido, dos
formularios que escriben y páginas legales. **Es el cambio de peso de esta
etapa**, y la parte del backoffice que lo acompaña —las solicitudes— toca el
camino por el que entra un cliente.

### Lo que hay que saber antes de tocar la web

⚠️ **`web/` es una TERCERA build, y desde el 29 de septiembre tiene tests y
tsconfig propios.** Antes no tenía ninguna de las dos cosas:

- `web/package.json` estrena **vitest** (28 tests en 2 ficheros) y declara
  `@astrojs/check` y `typescript`, que estaban instalados a mano y sin guardar.
- `web/tsconfig.json` **no existía**, así que `astro check` subía por el árbol y
  typechequeaba **la app de Angular** —169 ficheros— sin mirar ni una línea de la
  web, saliendo en verde sobre el proyecto equivocado. Con el suyo son **28**
  ficheros, y salieron a la luz dos imports de tipo sin `import type` que
  `verbatimModuleSyntax` prohíbe desde siempre — más, el 30, un `SITIO` importado
  y nunca usado en la página de preguntas, que es exactamente para lo que sirve.

⚠️ **Astro empaqueta el CSS POR PÁGINA, y eso rompió cinco entradillas sin que
nada avisara.** `.entrada` la declaraba un `<style is:global>` dentro de
`flota.astro`: un `is:global` de una página es global **dentro de esa página** y
no viaja a las demás. Medido en `/contacto` a 1280 px, la entradilla salía a
**16 px, en blanco puro y con 1098 px de ancho de línea** en vez de 18 px
atenuados a 58 caracteres. Es la **tercera variante** del fallo que `css:audit`
no caza: la clase está declarada, y lo que falla es que su fichero no alcanza.
Hoy `.entrada`, `.texto`, `.nota` y `.lista-check` viven en `global.css`.

⚠️ **Y una clase reutilizada por su nombre volvió a costar.** Se llamó `.zonas` a
una rejilla de tarjetas, y `.zonas` ya era el desplegable del buscador
—`position: absolute`—: las tarjetas salieron flotando encima de la sección
anterior. Se vio en una captura, no leyendo el código.

### El calendario propio, portado a JavaScript vanilla

Dorel lo pidió con dos capturas —el selector de Chrome y el panel del
backoffice— y es un **port de la regla, no del resultado**. Vive en
`web/src/lib/fecha-picker.ts` (aritmética pura, 24 tests) y `fecha-panel.ts`
(el panel). Dos diferencias, y las dos son **correcciones de fallos que en el
backoffice siguen vivos**:

1. **`parseValue('date', min)` no sabe leer el `min` de un `datetime-local`** —la
   regex va anclada—, así que devuelve `null` y el panel **no deshabilita ni un
   día**. Los cuatro campos de la web son `datetime-local` con `min`.
   `parseLimite()` acepta las dos formas.
2. **Los minutos salen del `step` del campo**, no fijos de cinco en cinco. Con
   `step="900"` una lista de cinco minutos deja el campo en `stepMismatch`: el
   formulario no se envía y el botón deja de hacer nada **sin error en consola**.

⚠️ **Con el dedo manda la hoja del sistema**, a propósito. El backoffice fuerza
el suyo en móvil por un motivo que aquí no existe —el diálogo de Android no sabe
vaciar— y estos campos son `required` y siempre traen valor.

### Tres fallos de esta etapa que conviene no repetir

⚠️ **`display: flex` en un popover lo deja PINTADO al cerrarse.** La regla que
esconde un `[popover]` cerrado la pone el navegador, y **en la cascada el origen
manda antes que la especificidad**: cualquier declaración de autor le gana.
Medido: 275 × 553 px encima de la página tragándose los clics, sin un error. El
`display` va en `.calendario:popover-open`. Lo mismo vale para `[hidden]`, que
ahora lleva `!important` en `global.css` por esa razón exacta.

⚠️ **Abrir un popover desde `mousedown` no funciona con un ratón de verdad.** El
descarte automático corre en `pointerdown`/`pointerup`, así que el `pointerup`
del mismo clic lo cierra. Y `preventDefault()` sobre `mousedown` no lo evita:
solo suprime los eventos de compatibilidad de ratón. **La comprobación decía que
funcionaba** porque la herramienta se colgó entre los dos eventos y dejó el clic
a medias — y un clic sintético no dispara el descarte. Se abre en `click`.

⚠️ **`24.95 - 24` da `0.9499999999999993`.** Al redondear precios a la
terminación `,95`, un importe que **ya** terminaba en `,95` bajaba un euro
entero. Solo pasaba en los precios redondos, que es donde nadie mira. Lo cazó su
propio test. La cuenta va en **céntimos enteros**.

### Los precios públicos, y por qué el redondeo vive en el backend

Decisión de Dorel del 30 de septiembre: la web anuncia precios terminados en
**`,95`** y **siempre hacia abajo** (`publicPrice()` en
`functions/src/public/core.ts`). Hacia arriba sería cobrar más de lo anunciado;
hacia abajo se regalan como mucho **0,99 € por cifra**.

⚠️ **Está en el BACKEND y no en la web que lo pinta**, y ese es el punto: la
misma cifra viaja a la tarjeta del listado, a la disponibilidad de un rango y al
`quoteSnapshot` que se congela en una solicitud — **que es lo que Dorel lee en
el correo para cobrarlo a mano**. Redondeando solo al pintar, la web diría 24,95
y el correo 26,43.

⚠️ **Y el neto se recalcula desde el bruto ya redondeado.** Conservando el de la
tarifa, `neto + IVA` dejaría de dar el bruto anunciado.

⚠️ **El aeropuerto son 30 € por trayecto CON IVA**, y en el backoffice hay que
teclear **24,79 NETO** para que el contrato imprima 30,00: `deliveryFees` se
teclea neto y el IVA se suma. Tecleando 30 imprimiría 36,30. Está escrito en
`web/src/lib/zonas.ts`.

### Lo legal, que nació en esta etapa

- **`/aviso-legal`** existe porque el NIF salió del pie. El art. 10 de la LSSI
  exige esos datos accesibles «de forma permanente, fácil, directa y gratuita»;
  una página enlazada desde el pie de **todas** las páginas cumple. ⚠️ **Si ese
  enlace desaparece, vuelve a hacer falta el bloque en el pie.**
- **`/privacidad`** y su ancla `#cookies`. ⚠️ **No hay página de cookies porque
  no hay cookies**: cero analítica, cero píxeles, tipografías propias y el mapa
  de Contacto es un **enlace**, no un incrustado. Lo único que se guarda es
  `velto-tema` en `localStorage`. **Eso se rompe con una línea**: analítica, un
  mapa incrustado, un vídeo de YouTube o tipografías de `fonts.googleapis.com`, y
  esa página pasa a ser falsa el mismo día y hace falta banner.
- **Los datos registrales** salen de `company-config.ts`, y allí llevan una
  advertencia que ahora está publicada: vienen del **pie de la factura** y **no
  coinciden** con los que el código traía antes («Tomo 45067, Folio 44, Hoja
  M-793170»). Merece una pregunta a la gestoría.
- **El plazo de borrado de los mensajes de contacto son 24 h**, y ese número
  está **publicado** en `/privacidad`. ⚠️ Un plazo escrito en una política es una
  afirmación contrastable contra Firestore: si se toca
  `CONSULTA_HORAS_POR_DEFECTO`, se toca esa página el mismo día.

### Lo que NO se pudo prometer, y por qué

De las tres cosas que Dorel quería afirmar en la entrega a domicilio, **una se
sostiene y dos hubo que reescribirlas**:

| Lo que pidió | Lo que dice la web | Por qué |
|---|---|---|
| «limpio» | igual | el parte fotografía el estado, y ese es el de devolución |
| «con el depósito lleno» | «con combustible, y anotado» | la cláusula 6 dice que se devuelve con el nivel con el que salió — prometer lleno obliga al cliente a devolverlo lleno |
| «asegurado» | «responsabilidad civil obligatoria y asistencia; el todo riesgo es opcional» | la cláusula 13. Esa frase suelta ya estuvo en el pie de todas las páginas y hubo que quitarla el 29 |

Y **«Pon tu coche en alquiler» no lleva ni una cifra**: el porcentaje vive en el
**coche** (`Vehicle.ownerSharePercent`) y la reserva lo congela; el valor del
código es el defecto de un campo de formulario, no una tarifa. Publicarlo lo
convertiría en la oferta de la empresa.

### El sitemap se comprueba en los DOS sentidos

Son **doce** páginas construidas y **diez** en el sitemap: fuera quedan el `404`
—una página de error no se indexa nunca— y `coche`, que vive en `/coche/{id}` y
la pinta JavaScript, así que no hay una URL que listar.

⚠️ **Y eso está en un test, no en la cabeza de nadie.** `sitemap.spec.ts`
recorre `src/pages/` y falla en las dos direcciones: una página nueva que nadie
añada al sitemap, y una ruta del sitemap que ya no exista. `FUERA_DEL_SITEMAP`
guarda el motivo de cada exclusión, que es lo que permite distinguir «se ha
decidido» de «se ha olvidado» — sin eso, la lista se lee como completa.

⚠️ **El spec vive en `src/lib/`, no en `src/pages/`.** Astro trata **todo** lo
que hay en `pages/` como una ruta y trató de compilar vitest: el build se cayó
con un error que no menciona nada de esto.

### El menú, y una medida que decide el diseño

El menú es **Buscar · Entrega a domicilio · Pon tu coche en alquiler ·
Contacto**. ⚠️ **No cabe en un móvil**: a 390 px hay **288 px** útiles y los
cuatro rótulos miden **499**. La tira deslizable de antes escondía «Contacto»
entero, así que ahora **envuelve en dos filas** —la regla de la casa es
recolocar, nunca ocultar— y los 45 px que crece la cabecera se recuperaron
apretando el héroe. Acortar el rótulo **no lo evita**: con «Pon tu coche» siguen
saliendo dos filas.

### Qué falta para que la web funcione de verdad

⚠️ **Los dos endpoints públicos que ESCRIBEN necesitan function Y hosting.** Sus
rewrites —`/api/solicitud` y `/api/contacto`— viajan con el **hosting**, no con
las functions: sin ellos la petición cae en el catch-all y devuelve HTML donde
se espera JSON, así que el visitante rellena el formulario y ve un fallo de red.
Es la lección de `/d/**`.

## 2 nonies. El 1 y el 2 de octubre, y el incidente del 3

**Catorce commits**, todos de la última milla de la web antes de producción. Lo
que conviene llevarse, porque son decisiones de Dorel y no detalles:

- **La señal es 50 €, y 25 € si el alquiler vale menos de 50 €.** A propósito
  sin porcentajes ni cálculos: un número que se dice por teléfono sin pensarlo.
  Y **no es reembolsable una vez firmado el contrato** —no se pueden tener
  coches bloqueados sin ganar nada—, pero **la pre-reserva sigue siendo
  gratuita**. Son dos momentos distintos y el texto los separa.
- **La política de devoluciones y desistimiento**, que no es un adorno legal:
  es lo que **BBVA exige** para conceder la pasarela nueva. El análisis de lo
  que pide PayGold está en [tpv-bbva.md](tpv-bbva.md).
- **`veltorent.com` deja de nombrarse en la web.** Solo `veltomobility.com`.
  Dorel dejó en el aire qué hacer con el dominio viejo —«quizás otra página
  tipo landing, o renuncio»—, así que la web no lo menciona hasta que se decida.
- **SEO completo**: prerender de las fichas, datos estructurados, PWA e imágenes
  al compartir. Era el encargo explícito antes de subir.
- **El botón ocupado se ve ocupado**, y el presupuesto se abre en otra pestaña
  en vez de sacarte de la web. Lo pidió Dorel llamándolo «vital»: un botón que
  se puede pulsar dos veces duplica la reserva.

**Y el guion de despliegue**, que es el entregable que hay que seguir cuando se
decida subir: [despliegue-produccion.md](despliegue-produccion.md). **28
functions en 15 órdenes**, por tandas de dos o tres y **en orden de daño** —los
contratos primero, porque hoy producción imprime una cláusula de sumisión a los
juzgados de Madrid que es nula frente a un consumidor—. Está calculado del
**grafo de imports**, no a ojo: 27 ficheros cambiados en `functions/src` dejan
33 functions con código viejo, porque `company-config.ts` lo importa casi todo.

**Los tres correos de Google** (GKE/Filestore, Hosting on-demand y Cloud Build)
quedaron analizados y **ninguno pide hacer nada**. El de GKE es el que más
alarma y el que menos toca: aquí no hay Kubernetes. Queda un solo comando por
confirmar, y es de Dorel porque `gcloud` pide reautenticación:
`gcloud container clusters list --project velto-store`.

### ⚠️ El 3 de octubre desaparecieron ficheros del espacio de trabajo

**Esto no es historia: es lo primero que hay que descartar si algo no compila.**
Entre las 13:50 y las 14:05 desaparecieron ficheros **al azar**, sin ninguna
regla que los una —ni carpeta, ni extensión, ni tamaño—. Uno de ellos
desapareció **mientras la sesión trabajaba**.

| Qué se perdió | Lo cubre git |
|---|---|
| `src/assets/i18n/ro.json` | ✅ |
| `reservation-detail.component.html` | ✅ |
| `functions/src/contracts/clauses.ts` | ✅ |
| `@types/node/buffer.d.ts` (en la raíz **y** en `functions/`) | ❌ |
| `primeicons/fonts/` — 2 de 5 ficheros | ❌ |
| `web/node_modules/js-yaml/dist/js-yaml.mjs` | ❌ |

⚠️ **Y el síntoma no se parecía a la causa**, que es lo caro de esto: el
typecheck de functions daba **183 errores de `Buffer`** y la build de la app no
resolvía las fuentes de PrimeIcons. Los dos parecen código roto y no había una
línea mal — faltaban ficheros **dentro de `node_modules`**, que git no cubre.

**El procedimiento que funcionó**, en este orden:

1. `git status` y `git diff HEAD`. **Si el árbol es idéntico a HEAD, el código
   no es.** Eso descarta la mitad del espacio de búsqueda en diez segundos.
2. `git restore` lo commiteado.
3. `npm ci` en **las tres** instalaciones —raíz, `functions/` y `web/`—, que son
   independientes y se rompieron las tres.

⚠️ **Tras un `npm ci`, la primera tanda de tests de functions puede dar dos
fallos falsos.** `arranque.spec.ts` importa `pdf.ts` (114 KB) y `clauses.ts`
(88 KB) con la caché fría y se pasa del **timeout de 5 s**. En caliente pasan
los 683. No es código, pero asusta justo cuando uno ya desconfía de todo.

⚠️ **Y una trampa de medición que costó una vuelta: `comando | tail` devuelve el
código de salida del `tail`.** La primera build de la app informó `exited with
code 0` **habiendo fallado**. Es el mismo error que CLAUDE.md ya avisa al contar
la lista de functions con `grep -c`: al verificar algo, el código de salida se
captura del comando, no de la tubería.

**La causa no está probada, pero hay un sospechoso con nombre: CCleaner 7.** Su
servicio de fondo (`CCleaner_service`) corre permanentemente en la máquina. Su
tarea programada no se ha ejecutado nunca, así que si fue él fue por Limpieza
inteligente o a mano. Descartado midiendo: Defender (limpio), salud de los
discos (`Healthy`), `git fsck` (limpio) y `chkdsk` (sin carpetas `found.*`). Que
los ficheros se pudieran **recuperar** apunta a un borrado normal a la papelera
y no a corrupción del disco. Lo pendiente es de Dorel: excluir
`C:\Users\dorel\workspace` en CCleaner.

**Estado al cerrar el 3 de octubre, verificado entero:** build de app, functions
y web; 856 tests de app y 683 de functions; lint en **0 errores** (291 avisos,
la deuda de siempre); las cuatro auditorías en verde; las tres instalaciones de
dependencias sin `missing` ni `invalid`; y `git diff HEAD` vacío contra
`7a3d8d3`. **No se perdió nada.**

---

## 2 decies. El 4 y el 5 de octubre — seis encargos, y lo que salió por el camino

Esta tanda vino de Dorel usando la aplicación, que es como entra el trabajo desde
que producción es real. Los seis encargos están hechos; lo que conviene leer es
**lo que apareció al hacerlos**, que no estaba pedido y es lo que muerde.

### Las visitas de la web, sin cookies y sin banner

Informes tiene ahora visitantes únicos por día, las rutas que pisan y cuántos
llegan al presupuesto. La function es `trackWebVisit` y la aritmética está
aparte, con tests, en `functions/src/public/analitica-core.ts`.

⚠️ **No se guarda nada en el aparato del visitante, y de ahí cuelga todo lo
demás.** La huella es un SHA-256 de IP + navegador con una **sal que cambia cada
día** (`VELTO_ANALYTICS_SALT`): sin almacenamiento no hace falta banner (art.
22.2 LSSI) y el dato deja de ser reidentificable al día siguiente. Hay un test
que afirma justo eso —la misma persona en otro día da otra huella—, porque es la
propiedad **legal**, no un detalle de implementación: el día que alguien fije la
sal «para poder seguir al usuario entre días», ese test cae y debe caer.

⚠️ **Y por eso «usuarios únicos acumulados» NO se puede dar, que es lo que Dorel
pidió.** Con la sal rotando, sumar los días cuenta a la misma persona tantas
veces como vuelva. La pantalla **lo dice** en vez de enseñar un número que
parecería esa cifra y no lo sería. Es la regla de la casa: una cifra creíble y
equivocada es peor que un hueco.

⚠️ **Un cliente de consola cuenta como persona si nadie lo mira.** Una sonda
hecha con PowerShell entró como visitante humano: su `User-Agent` empieza por
`Mozilla/5.0`, así que la lista de bots por nombre no la veía. Están añadidos
`powershell`, `postman`, `guzzle` y `apache-httpclient`, con un test que usa esa
cadena exacta. Y el beacon se calla ante `navigator.webdriver` y DNT, así que
Playwright no ensucia la medición.

### Lo que salió al mirar, y no estaba pedido

- ⚠️ **Los PDF pesaban 1,2 MB por no subconjuntar la fuente.** `embedFont` sin
  `{ subset: true }` mete la Gotham entera en cada documento. Medido sobre un
  presupuesto real: **1194,2 KB → 40,9 KB**. Son los cinco `embedFont` de
  `contracts/pdf.ts`; si se añade uno nuevo, lleva la opción o el documento
  vuelve a engordar un megabyte sin que nada falle.
- ⚠️ **Una reserva con un snapshot incompleto borraba de la lista a TODAS las de
  debajo.** Un `@for` de Angular que revienta a mitad no pinta un hueco: aborta
  el bucle. Medido: cinco reservas, tres pintadas. Lo arreglan los `@if` sobre
  `vehicleSnapshot`, `clientSnapshot` y `pricingSnapshot`. **Lo que se ve es una
  lista más corta, que se lee como «no hay más», no como un error.**
- ⚠️ **La solicitud proponía un día de más.** `widenToFullDays()` guarda el final
  de la ventana **exclusivo** —la medianoche UTC del día siguiente— y
  `requestReturnAt()` lo leía como inclusivo. El test que lo cubría usaba un
  valor **imaginado** (23:59:59.999) en vez del que de verdad se guarda, así que
  pasaba en verde sobre una forma que no existe. Al escribir una prueba sobre
  datos guardados, **saca el valor de Firestore, no de la cabeza**.
- ⚠️ **`window.open()` después de un `await` lo bloquea el navegador**, y el
  parte de entrega no se abría en producción por eso. La pestaña se abre
  **síncrona**, antes de esperar nada, y luego se le pone el `href`. Y **sin
  `noopener`**: con él, `window.open` devuelve `null` y no hay a quién asignarle
  la URL.
- ⚠️ **`set({ merge: true })` NO interpreta las claves con punto como ruta
  anidada**; solo `update()` lo hace. `{'routes.flota': increment(1)}` habría
  creado un campo llamado literalmente `routes.flota`. Van objetos anidados.

### Lo del 5 de octubre: las solicitudes sin contestar se borran

Decisión de Dorel: **a las 72 h**, aunque nadie las haya tocado. Hasta ese día
`new` era el único estado que no se borraba nunca, y el argumento contrario está
escrito en `ESTADOS_BORRABLES` porque sigue siendo bueno: una solicitud sin
atender es trabajo pendiente, y la que entra un viernes a las 23:40 no puede
desaparecer el sábado.

Lo que lo sustituye son **dos** cosas, y las dos tienen que seguir siendo
ciertas o esto vuelve a ser un borrado silencioso:

1. **El plazo es más largo que el de las atendidas** —72 h frente a las 24 de
   `bookingRequestKeepHours`— y se cuenta desde que **llegó**, no desde que se
   tocó el documento. Con `handledAt` mandando, teclear una nota le reseteaba el
   plazo a algo que sigue sin contestarse.
2. **El resumen diario las nombra**, una por una, con las horas que les quedan, y
   las del último día salen en el **asunto**. Esa sección no existía: el
   comentario con el que justifiqué las 72 h decía «son TRES avisos antes de
   borrar» y era falso —el resumen tenía tres secciones y ninguna las
   mencionaba—. Antes que dejar un comentario que miente, se construye el aviso.

⚠️ **Y por eso el barrido va DESPUÉS del envío en `sendDailyDigest`.** Los dos
bloques parecen independientes y ya no lo son: barriendo primero, la última
vuelta desaparecería antes de que el correo la nombrara.

⚠️ **Tres frases pasaron a ser falsas el mismo día**, y se arreglaron en la misma
pasada porque el texto y el hecho se deciden juntos: el `hint` de Ajustes decía
en los tres idiomas que las sin contestar «no se borran nunca»,
`booking-request.model.ts` lo repetía, y `/privacidad` solo contaba el caso de
las atendidas. Esa última es la que importa: es un plazo **publicado**.

Y `limpiarSolicitudesAtendidas` pasó a llamarse `limpiarSolicitudesCaducadas`.
El nombre viejo decía menos de lo que la función hace, que es justo lo que deja
tranquilo a quien lee la llamada.

**Estado al cerrar el 5 de octubre:** 715 tests de functions y 858 de app, las
tres builds en verde, el bundle carga como lo carga el contenedor, auditoría i18n
OK, y `sendDailyDigest` **desplegada en desarrollo**. El correo se miró
renderizado a 390 px, no solo en el test.

---

## 2 undecies. El despliegue del 5 de octubre — producción ya está al día

⚠️ **Lo que dice § 2 ter abajo quedó CUMPLIDO ese día.** Se lee como historia,
no como pendiente. Resumen de lo que se hizo y en qué orden, que es la parte
reutilizable:

1. **Reglas e índices** (`npm run deploy:prod:rules`) — hacían falta antes del
   frontend porque `webAnalytics` era nueva.
2. **24 functions en 13 órdenes**, por tandas de dos o tres, **cero fallos de
   cuota**. `trackWebVisit` se **creó**; las demás, actualización.
3. **El merge** (PR #64 → `9588c06`), que publica los dos sitios por CI.

**El orden es la lección**: reglas → functions → hosting. Al revés, los tres
rewrites nuevos —`/api/solicitud`, `/api/contacto`, `/api/visita`— se habrían
publicado apuntando a functions que no existían, y la petición habría caído en
el catch-all devolviendo HTML donde se espera JSON.

**Estado comprobado al cerrar:** 32 functions en producción y solo faltan las
cinco de la AEAT; `master` y `develop` sin diferencia; `veltomobility.com`
sirviendo la web real con `robots.txt` con sitemap y sin `noindex`;
`/api/visita` contestando 204.

### ⚠️ Dos cosas que descubrió este despliegue y que valen para el siguiente

- **`navigator.webdriver` NO está puesto en el navegador de Playwright de esta
  máquina.** `sePuedeMedir()` lo usa como barrera para no contar automatismos, y
  aquí **no funciona**: una visita de comprobación a `veltomobility.com` se contó
  como persona. Lo mismo pasó con una sonda `Invoke-WebRequest` cuyo
  `User-Agent` propio no llevaba ninguna seña de bot. O sea que la analítica de
  producción del 5 de octubre arranca con **visitas falsas mías**.
  **Al comprobar la web en producción, usa un `User-Agent` con `bot` dentro** —
  o compruébalo contra desarrollo.
- **El escaparate está vivo y vacío.** `api/fleet` devuelve `{"vehicles":[]}`:
  no hay ningún coche marcado para publicar, y producción tiene uno solo.
  Publicar la web no publica la flota.

### ⚠️ Y lo peor del día: producción anunciaba tres coches de DESARROLLO

Lo vio Dorel al abrir `veltomobility.com/flota` nada más desplegar: un Renault
Clio, un Peugeot 3008 y un Toyota Corolla —dos de ellos llamados `demo-…`— con
sus precios por día, su ficha completa en `/coche/…` y **los tres metidos en el
sitemap**, o sea ofrecidos a Google. Un cliente podía llamar pidiendo un 3008
que la empresa no tiene.

La causa, en `web/src/lib/flota-build.ts`: la constante del prerender apuntaba
**siempre** a `velto-web-dev`, bajo un comentario que decía *«se lee del sitio
REAL aunque se esté compilando el de desarrollo»*. Decía una cosa y hacía la
otra, y el razonamiento que lo sostenía —«los datos públicos son los mismos»—
es falso: son dos proyectos con dos flotas.

Tres cosas que llevarse:

- **El riesgo de un prerender es asimétrico.** En desarrollo prerrenderizar de
  más es inocuo porque la web es `noindex`; en producción es publicidad falsa.
  Cuando algo se compila una vez por entorno, la pregunta es siempre **de qué
  entorno lee**.
- **Y lo hacía visible un segundo fallo**: al repintar con la flota viva vacía,
  `flota.astro` enseñaba «no hay vehículos publicados» pero **no escondía** las
  tarjetas del build, así que la página decía las dos cosas a la vez. No es solo
  el caso de la flota vacía — un coche despublicado entre el build y la visita
  se quedaba anunciado.
- **Ningún test lo habría cogido.** Los 84 de la web pasaban, las builds
  pasaban, el CI comprobaba que el artefacto fuera el del sitio real… y lo era:
  lo que estaba mal eran los **datos** que metió dentro. Se vio mirando la
  página publicada, que es como se ven estas cosas aquí.

Corregido el mismo día (PR #65). Las tres URL estuvieron unas horas en el
sitemap; hoy sirven la página genérica sin datos, así que caerán solas del
índice si Google llegó a pasar.

---

## 2 ter. Qué hay sin subir y qué falta por desplegar

**No te fíes de las cifras de aquí abajo, que envejecen — vuelve a preguntarlo:**

```bash
git log --oneline origin/master..HEAD     # lo que develop tiene y produccion no
git log --oneline origin/develop..HEAD    # lo que ni siquiera esta subido
git diff --stat origin/master..HEAD -- functions/   # vacio = no hay que desplegar functions
```

**Medido el 5 de octubre al cerrar**: nada sin subir, y **65 commits que NO están
en producción**. Y esta vez **no basta con el merge**, al revés que el día 24:

| Qué cambia entre `master` y `develop` | Ficheros | Cómo se despliega |
|---|---|---|
| `functions/src/` | 34 | **a mano**, por tandas de dos o tres |
| `src/` (backoffice) | 57 | CI, al hacer merge a `master` |
| `web/` | 54 | CI, al hacer merge a `master` |
| `firebase.json`, `firestore.rules` | 2 | **a mano** (`deploy:prod:rules`) y hosting |

⚠️ **Y hay una function NUEVA que el guion del día 3 no nombra: `trackWebVisit`.**
Medido ese mismo día comparando los **nombres** —no las cifras—, desplegadas:

| | Cuántas | Cuáles faltan |
|---|---|---|
| el código define | **37** | — |
| desarrollo | **37** | — |
| producción | **31** | las cinco de la AEAT **y `trackWebVisit`** |

Las cinco de la AEAT faltan **a propósito** hasta el 1 de enero. `trackWebVisit`
no: sin ella, la web publicada mide contra una function que allí no existe. Va
con su rewrite `/api/visita`, que viaja con el **hosting** — el mismo caso que
`/api/solicitud` y `/api/contacto`. `VELTO_ANALYTICS_SALT` ya está puesta en los
dos proyectos.

⚠️ **El guion está escrito aparte**:
[despliegue-produccion.md](despliegue-produccion.md), con las 28 functions en 15
órdenes y en orden de daño. Lo de aquí abajo es el porqué; aquel es el qué
teclear.

⚠️ **Aquí ponía que `createBookingRequest` y `createContactRequest` estaban sin
desplegar, y YA NO ES CIERTO.** Medido el 3 de octubre con
`firebase functions:list --project prod`, comparando los **nombres** contra los
exports de `index.ts`: producción tiene **31** y el código define **36**, y lo
único que falta son **las cinco de la AEAT** —a propósito, hasta el 1 de enero—.
Las dos de la web están allí.

⚠️ **Lo que SÍ sigue faltando son sus rewrites, y eso las deja inalcanzables.**
`/api/solicitud` y `/api/contacto` no están en el `firebase.json` de `master` y
viajan con el **hosting**, no con las functions: la petición cae en el catch-all
y devuelve HTML donde se espera JSON. El visitante rellena el formulario y ve un
fallo de red. Es la lección de `/d/**`, otra vez. **Estar desplegada no es estar
alcanzable.**

Y la actualización de **`sendDailyDigest`**, que ahora barre también los
mensajes de contacto a las 24 h — ese plazo **está publicado en `/privacidad`**,
así que hasta que se despliegue la política dice algo que no se cumple.

⚠️ **En producción, nunca `--only functions` a secas.** Subiría las cinco de la
AEAT. Y con 36 functions a la vez se agota la cuota de CPU de Cloud Run: medido
el 28 de septiembre con 35, entraron 15 y fallaron 19.

⚠️ **Antes de desplegar, descarta el código** y compara el manifiesto:

```bash
cd functions && node -e "require('./lib/index.js')"   # el bundle carga
FUNCTIONS_CONTROL_API=true PORT=8361 node node_modules/firebase-functions/lib/bin/firebase-functions.js . &
curl -s http://127.0.0.1:8361/__/functions.yaml -o /tmp/manifiesto.json
curl -s http://127.0.0.1:8361/__/quitquitquit
```

⚠️ **Y hay claves i18n nuevas** —87 líneas añadidas en `es.json` y las mismas en
los otros dos—, así que aplica la nota de la caché: `assets/i18n/*.json` no lleva
huella, y aunque `firebase.json` ya declara `no-cache` para esa ruta, el dominio
propio va detrás de Cloudflare. **Quien dice la verdad sobre lo publicado es
`rentalcar-veltomobility.web.app`**, no el dominio propio.

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

### Lo que bloquea publicar la web (30 de septiembre de 2026)

**Lo primero son los dos despliegues** de § 2 ter: functions y hosting. Sin
ellos los dos formularios de la web devuelven un fallo de red.

**Y seis huecos que solo puede cerrar Dorel** —eran nueve, y el 30 de
septiembre de 2026 cerró tres—. Están marcados en el código o en las páginas y
ninguno se puede inventar:

| Qué falta | Dónde muerde |
|---|---|
| Si está adherido a alguna entidad de resolución de litigios | `/aviso-legal` lleva un `[PENDIENTE]`; la Ley 7/2017 no deja callarse |
| En el aeropuerto, dónde se queda con el cliente | terminal y punto de encuentro; hoy la página solo puede decir «te lo llevamos» |
| Una política de cancelación | no consta en ninguna parte; el contrato solo regula el retraso en la devolución |
| Si hay ficha de Google Business Profile | pesa más que todo el JSON-LD junto para «alquiler de coches Arganda» |
| Que `veltomobility.com` RECIBA correo | hoy **no tiene ni un registro MX**: las dos páginas legales nombran esa dirección como canal de derechos RGPD |
| Que lo legal lo mire un abogado | está escrito y es honesto, pero lo firma una empresa real |

**Los tres que se cerraron**, con lo que hay que saber de cada uno:

- **Las localidades.** Gratis **Arganda y Rivas**; el aeropuerto a su tarifa; y
  para todo lo demás una cuarta opción, **«Prefiero especificar…»**, que vacía
  el campo y deja escribir —con la localidad capitalizándose sola, porque es un
  nombre propio—. Nació como «Otra» y duró unas horas: dejaba la palabra «Otra»
  escrita en el campo, o sea que quien vive en Cuenca acababa con un formulario
  que no nombra Cuenca.
  ⚠️ **Y «Madrid capital» pasó a «Comunidad de Madrid»** en la lista de la
  página de entrega: singularizar la capital entre pueblos del corredor se lee
  como que la empresa llega a Madrid y **no** a Alcalá.
- **El horario:** L-V 10-14 y 17-20, sábado 10-14, domingo cerrado, **con
  entrega fuera de horario y sin precio publicado**. Vive una sola vez en
  `empresa.ts` y de ahí salen la tarjeta y el `openingHoursSpecification`.
- **El coche cedido:** seguro, ITV y mantenimiento son del propietario, en
  exclusiva.
  ⚠️ **Lo que NO se publicó fue la exoneración general** que pedía la misma
  frase —«no nos responsabilizamos de nada absolutamente»—: frente a un
  particular es nula (arts. 82 y 86 TRLGDCU, y 1102 CC), así que **no protege**,
  y contradice lo que la propia página promete cuatro secciones más arriba.
  Está contado en el comentario de cabecera de `/pon-tu-coche-en-alquiler`.

⚠️ **Y la que estaba publicada mal en `/condiciones` ya está arreglada**
(`7e33201`, 30 de septiembre de 2026). La sumisión a los juzgados de **Madrid
capital** era nula —art. 54.2 LEC en un contrato con condiciones generales— y
abusiva frente a un consumidor (art. 90.2 TRLGDCU). Estaba en **tres** sitios y
no en uno: la cláusula 15 en los tres idiomas, el resumen de `HIGHLIGHTS` —que
lo decía **sin** la salvedad del consumidor y es el que se enseña en la pantalla
pública de firma— y la página. Ahora manda la regla legal: si el arrendatario es
consumidor, el juzgado de su domicilio.
⚠️ **Falta desplegarlo a producción**: lo imprimen `generateContractPdf`,
`getContractForSigning` y `signContract`, y las functions van a mano.

### Lo de siempre

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

### Lo que dejó el repaso del 24 de septiembre — CERRADO ese mismo día

Salieron de un repaso del flujo reserva → entrega → devolución hecho antes de
subir a producción: trece hallazgos confirmados, siete arreglados en la primera
tanda y **los otros cuatro en la segunda** (M-49, commit `e4d9ab9`). Ya no queda
ninguno abierto. El detalle está en
[mejoras-pendientes.md](mejoras-pendientes.md) § M-49; lo que hay que llevarse:

1. **Una foto dejaba la entrega a medias y sin salida.** La primera foto crea la
   inspección en `draft`, y la ficha y el timeline miraban la **existencia** del
   documento. La reserva parecía entregada y no había botón para volver al parte.
   Ahora la ficha tiene **tres ramas** —hecha, a medias, sin empezar— y el
   timeline compara contra `'completed'`, como los guards.
2. **Un hueco entre tramos alquilaba el coche a 0 €.** `validatePricingRules()`
   exige cubrir de 1 a infinito y terminar abierto. ⚠️ Y salió algo peor de lo
   apuntado: **esos errores no impedían guardar nada**, ni los que ya existían.
   Hacen falta **tres capas**, porque un coche ya guardado con la tarifa rota
   seguía alquilando gratis — el buscador salía a 0,00 € y, al ordenar por
   precio, **el primero de la lista**.
3. **Español duro**, y eran más de los apuntados: también un `aria-label` en
   castellano en la **pantalla pública de firma**, la que ve el cliente.
4. **El código muerto con el `prompt()`**, borrado. Además de lo apuntado,
   devolvía fianza **sin tope**.

⚠️ **Y un hallazgo nuevo, visto y NO arreglado:** `minimumRentalDays` del vehículo
**no lo comprueba nadie** al crear una reserva. Se rellena en la ficha, se guarda
y no hace nada. Es lo que obliga a que la tarifa cubra desde el día 1.

**M-50, hecho:** el tinte del hover pasa del 2 % al **5 % en claro y 7 % en los
tres oscuros**. Estaba en razón 1,04 —por debajo de lo que el ojo distingue—, así
que el hover existía en los treinta sitios y no comunicaba nada. Se cambia en la
**variable**, no sitio a sitio; lo que hubo que hacer uno a uno fue comprobarlo:
92 elementos × 4 temas, con el ratón encima de verdad, sin que ningún texto baje
de 4,5:1 ni ningún relleno se borre. Por el camino salió una chapa de Facturas
que usaba `--bg-hover` como **superficie fija**, ahora con `--bg-main`.

⚠️ **Y una trampa de medición que va a volver:** recorriendo los cuatro temas en
bucle, el puntero se queda encima del elemento entre iteraciones, así que
«reposo» y «hover» son la misma lectura — sale un salto de 1,000 y parece que el
CSS no se aplica. **Hay que apartar el ratón antes de leer el reposo.** Y la
primera muestra de una lista suele ser la **activa**, cuyo fondo propio gana al
hover: también da 1,000 y tampoco es un fallo.

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
3. **Los avisos del lint**, que a 30 de septiembre de 2026 son **290** —eran 283
   el día 22—. Son deuda reconocida, no ruido: promesas sin esperar —la mayoría a
   propósito— y accesibilidad en plantillas (`<div (click)>` que no se alcanzan
   con el teclado). Se repasan por tandas y **entonces** se suben a `error`.
   ⚠️ **Lo que importa es que sigan siendo 0 errores**: si sale un error, es de
   lo que acabas de tocar.
4. ⚠️ **El Storage de producción sigue sin vaciar.** Está contado en § 2 sexies:
   el borrado masivo lo paró el clasificador de permisos y Firestore sí se vació,
   así que allí siguen **el DNI, el carné y la firma de personas reales cuyas
   fichas ya no existen**, con su token de descarga vivo. No es deuda estética.

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
