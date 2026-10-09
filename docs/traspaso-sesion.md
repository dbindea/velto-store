# Traspaso de sesión — 8 de octubre de 2026

> Pégalo entero al abrir la sesión nueva. Está escrito para alguien que **no ha
> visto nada de lo anterior**: dice dónde estamos, qué NO tocar, y cómo entra el
> trabajo a partir de ahora.
>
> **Orden de lectura:** **§ 2 sexdecies**, que es lo último que pasó (8 de
> octubre: el precio anunciado contra el cobrado, desplegado a producción);
> después **§ 2 ter**, que dice qué falta por desplegar — hoy **nada**, y por eso
> esa sección empieza por cómo volver a medirlo en vez de por una lista; y luego
> **§ 5**, con los huecos que solo puede cerrar Dorel, que son los únicos que
> siguen abiertos de verdad.
>
> ⚠️ **No hay nada pendiente de subir.** `master` y `develop` están
> sincronizados y producción corre el código de hoy. Si vas a empezar algo,
> empiezas de limpio.
>
> ⚠️ **Y si algo no compila nada más abrir, lee § 2 nonies antes de buscar el
> fallo en el código.** El 3 de octubre desaparecieron ficheros del espacio de
> trabajo al azar, `node_modules` incluido, y el síntoma parecía código roto.
>
> Las secciones anteriores (§ 2 a § 2 quindecies) son historia: se leen si algo
> no cuadra.
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

### ⚠️ Las Cloud Functions corren en UTC y el negocio está en Madrid (PR #67)

El fallo más caro del día, y llegó a un cliente. Una pre-reserva real pidió las
**10:00**; el correo le dijo **00:00**, el presupuesto en PDF **12:00** y una
devolución **el 26** de un coche que se devolvía el 25. Tres cifras para el mismo
instante y ninguna era la suya.

Tres fallos encadenados, y el primero es el que hay que recordar:

1. **`new Date(y, m, d, h, min)` construye la fecha en la zona DEL PROCESO**, y
   el contenedor es UTC. Las 10:00 de Madrid entraban como 10:00 UTC, o sea las
   12:00. El PDF fija `Europe/Madrid` y era **fiel a un instante que ya estaba
   mal** — por eso parecía que el fallo estaba en el PDF.
2. El correo formateaba con `getDate()`/`getHours()`, que vuelven a leer UTC: el
   mensaje decía una hora y el PDF adjunto **a ese mismo mensaje**, otra.
3. Y el correo imprimía `pickupDate`/`returnDate`, que son la **ventana de
   disponibilidad** —00:00 y final **exclusivo**—, no la recogida ni la
   devolución.

Lo resuelve [`functions/src/zona.ts`](../functions/src/zona.ts), con la vuelta
doble que hacen falta los dos domingos del cambio de hora. **`daily-digest.ts`
tenía una copia de esa aritmética** y pasa a usar la compartida: dos versiones de
un cálculo de horario de verano es exactamente cómo nace el siguiente fallo.

⚠️ **Y al escribir el respaldo salió otra trampa: `toDate()` CAE A HOY.** Ante
cualquier cosa que no sabe leer devuelve la fecha actual —a propósito, para que
un documento corrupto no tumbe una vista con el pipe `date`—, así que un
`isNaN()` detrás **nunca salta**. Donde el respaldo honesto es otro, hay que
reconocer las formas a mano y devolver `null`. Es la misma regla que la web
pública ya aplica en `public/core.ts`.

**La regla práctica:** si una fecha la teclea una persona y la lee otra, no la
construyas ni la imprimas con los métodos locales del proceso. Hay un módulo
para eso.

### Y un segundo «escrito y nunca recorrido», el mismo día (PR #66)

El esqueleto de carga de `/reservar` —tres tarjetas grises, añadidas el 3 de
octubre con un argumento correcto: la pantalla pasaba 3,1 s en blanco en 3G
lento— se escribió **dentro de `#resultado`**, que está `hidden` justo mientras
se busca. Destaparlo no hacía nada porque su antepasado seguía oculto, así que
lo único que veía el visitante era la línea de texto «Buscando coches libres…».

Nadie lo detectó en un mes: compila, despliega y el código que lo destapa se
ejecuta. **Se vio cuando Dorel pidió que ese texto se notara más** y hubo que ir
a mirar por qué estaba tan solo en la página.

Lo sustituye una tarjeta con las tres barras del isotipo corriendo por una vía,
que vive **fuera** de `#resultado`. Y de paso salió **otra vez** la trampa de
`--divider`: el asfalto de esa vía iba con esa variable, que en los temas
oscuros vale lo mismo que la tarjeta — la carretera existía y no se veía. Es
exactamente lo que ya había pasado con el esqueleto, y volvió a cazarlo mirar la
pantalla, no leer el fichero.

Ese mismo PR mete **«Nuestra flota» en el menú**, que obligó a mover el corte de
plegado de 1039 a 1199 px. El número está medido y razonado en `Base.astro`: si
alguien añade o alarga un rótulo, **hay que volver a medirlo**.

---

## 2 duodecies. El 6 y el 7 de octubre — la tarifa deja de ser escalones

### La curva de precios, que es el cambio de fondo

Las tarifas eran **tramos** —1-1, 3-5, 6-10…— con un precio por día dentro de
cada uno, y eso tiene un defecto que se ve con los números de Dorel: **15 días
costaban 1.125 € y 16 días, 1.120 €**. Un día más y el alquiler sale más barato.
No es un caso rebuscado: pasa en cada salto de tramo, porque el precio por día
baja de golpe y multiplica a todos los días anteriores.

Lo sustituye una **curva por duración** en
[`rental-curve.util.ts`](../src/app/shared/utils/rental-curve.util.ts): seis
puntos de referencia (1, 3, 7, 14, 21 y 30 días) con su multiplicador sobre la
tarifa base, e **interpolación lineal** entre ellos. Dos invariantes, probados
día a día sobre 120 días × 3 tarifas base:

- **El total nunca baja al añadir un día.**
- **La media por día nunca sube al añadir un día.**

⚠️ **`pricePerDay` pasa a ser la MEDIA, no una tarifa de tramo.** Lo que se
cobra es `curveTotal()`; el por-día es derivado y solo sirve para enseñarlo. Si
algo vuelve a multiplicar `pricePerDay × días`, vuelve el escalón.

⚠️ **Y está DUPLICADA en `functions/src/public/rental-curve.ts`**, a propósito,
como el IVA: la app y las functions no pueden compartir módulo. Si cambian los
puntos, se cambian en los dos sitios.

### Lo demás del 6 de octubre

- ⚠️ **El formulario de vehículo PERDÍA tres campos al guardar.** No cargaba
  `environmentalLabel`, `publicHighlight` ni `publicDescription`, así que abrir
  una ficha y guardarla los borraba. Es el patrón de siempre: campos que nacen
  después del formulario y nadie añade al cargador.
- **El resumen diario avisaba catorce veces** de un mismo vencimiento. Ahora
  `entraEnElResumen()` avisa **el día que se abre el plazo y la víspera**, y
  siempre lo ya vencido.
- **El prefijo `(DEV)`** en el asunto de todo correo que no salga de producción
  ([`functions/src/entorno.ts`](../functions/src/entorno.ts)).
- **Las fichas de coche no declaraban las medidas de su foto**, así que WhatsApp
  tenía que descargarla para decidir el tamaño de la tarjeta y a veces no
  pintaba nada: `og:image:width/height/type` y `og:image:secure_url`.

### ⚠️ El prefijo (DEV) estaba ESCRITO y no llegaba: faltaba desplegar

Dorel siguió recibiendo correos sin él. La causa no era el código: de las seis
functions que mandan correo, a desarrollo solo se habían desplegado **dos** — y
el prefijo se había subido a **producción**, donde por diseño no hace nada.

Hoy los **cinco** envíos reales pasan por `asuntoDeCorreo()` —el resumen diario,
el contrato firmado y los tres de `public/api.ts`— y también la **vista previa**
de Ajustes, que enseñaba el asunto sin prefijo: una vista previa que no coincide
con lo que sale es peor que no tenerla, porque es justo donde se va a
comprobarlo.

**La lección es la de siempre, con otra cara:** *una function editada no es una
function desplegada*, y **desplegar al entorno equivocado se parece mucho a no
desplegar**.

### El calendario del móvil (7 de octubre)

Encargo de Dorel: ver el mes completo en la pantalla, elegir hora **sin
minutos**, un botón **«Seleccionar»**, y el mismo panel en el backoffice y en la
web pública.

- **Con el dedo el panel es una hoja pegada abajo**, a todo el ancho y con tope
  de 480 px. Colgando del campo medía unos 550 px y se recortaba contra la
  pantalla: las dos últimas semanas del mes y el pie había que buscarlos
  desplazando **dentro** del panel.
- ⚠️ **Lo decide el PUNTERO, no el ancho.** Es la frontera de `base-select`: un
  teléfono en horizontal mide 844 px de ancho y 390 de alto, así que un corte
  por ancho da el panel de escritorio justo donde menos cabe.
- ⚠️ **Y lo decide JavaScript, no una media query**, porque quien coloca el
  panel es JavaScript: `place()` y `colocar()` escriben `top`/`left` **en
  línea** y eso gana a cualquier regla. La salida temprana de esas dos funciones
  es lo que hace que la hoja funcione.
- **Las 24 horas en rejilla de 6 × 4**, sin nada que recorrer. Y el pie se queda
  **pegajoso**: medido en un iPhone SE —375×553 útiles— la hoja no cabe y
  «Seleccionar» quedaba por debajo del borde.
- **Fuera los minutos**, y el minuto se escribe **0 siempre**: dejando el que
  trajera el campo, unas 10:35 se quedarían en 11:35 sin forma de cambiarlo.

Tres cosas que aparecieron al mirarlo de cerca, y que valen más que el encargo:

- ⚠️ **El panel del backoffice IGNORABA el `min` de los `datetime-local`.** Lo
  leía con `parseValue('date', …)`, cuyo patrón va **anclado**, así que un
  `min="2026-10-07T00:00"` no casaba y salía `null`: **ninguna celda bloqueada**.
  En el asistente de reservas se podía elegir una recogida en el pasado, y lo
  único que lo cazaba era la validación del navegador con el panel ya cerrado.
  La web lo tenía resuelto desde el principio y lo **documentaba como un fallo
  vivo en el backoffice** — nadie fue a arreglarlo. Hoy lo hace
  `parseLimitValue()`, con tests.
- ⚠️ **La web no centraba la hora elegida al abrir.** `centrarHoras()` se
  llamaba dentro de `pintar()`, **antes** de `showPopover()`, y hasta ese momento
  el panel está en `display: none`: `clientHeight` vale 0 y la columna se queda
  arriba. Medido con las 10:00 puestas, se abría enseñando de la 00 a la 05 y sin
  una hora marcada a la vista.
- ⚠️ **La ficha de la hora se pintó primero con `--bg-main`**, que queda a
  **1,085** de la tarjeta en los temas oscuros: el fondo estaba puesto y no
  comunicaba nada. Es el mismo error que el tinte del hover al 2 %. Con
  `--bg-input`, 1,12 en claro y 1,34 en oscuro — medido en los dos proyectos.

⚠️ **Cómo se comprobó, que es reutilizable:** modo dispositivo por CDP
(`Emulation.setDeviceMetricsOverride` con `mobile: true` + `setTouchEmulationEnabled`)
a 390×780, 360×640 y 375×553, midiendo con `getBoundingClientRect()` que la
rejilla del mes cae entera dentro de la ventana y que el pie se ve.
⚠️ **Las CAPTURAS mienten bajo emulación**: `page.screenshot({ scale: 'css' })`
vuelve a tocar las métricas del dispositivo, así que en pantallas pequeñas sale
la página **sin** emular y el panel aparece colocado de otra forma, o no aparece.
Lo que vale es la medida.

⚠️ **Y para probar el backoffice en local hace falta sesión.** El perfil de
Playwright la tiene para `store.veltorent.com`, no para `localhost`. Se copia:
leer el objeto de `indexedDB.firebaseLocalStorageDb` → `firebaseLocalStorage` en
el dominio y escribirlo en el local. Es el mismo proyecto de Firebase, así que
el token vale.

### Y la segunda vuelta, el mismo día: escritorio, horas y animación

Dorel lo probó y pidió cuatro cosas más. Las tres primeras son del calendario:

- **Las horas ponen «10:00» y no «10»**, a 12 px. Debajo de una rejilla del 1 al
  31, veinticuatro números del 00 al 23 se leen como más días.
  ⚠️ **Y a 14 px NO cabía: la ficha se partía en dos renglones** y salía de
  50 px en vez de 44. No se veía como un desbordamiento —`scrollWidth`
  cuadraba—, se veía como una fila más alta que la del otro proyecto. Van las
  tres cosas juntas: 12 px, relleno lateral mínimo y `nowrap`.
- **El panel del móvil es ya también el de escritorio.** Además del gusto
  —«realmente queda muy bien»— tiene un motivo: colgando del campo, con la
  rejilla grande mide unos 670 px y en un portátil de 768 px de alto no cabe ni
  arriba ni abajo. `prefersSheetLayout()` y `esHoja()` devuelven `true`, con
  `place()` y `colocar()` detrás como punto de vuelta.
- **Abre y cierra en 0,4 s**, deslizando desde abajo. Y las dos
  implementaciones son necesariamente distintas:
  ⚠️ **En la web es un `popover` y lo hace el CSS**: `@starting-style` —única
  forma de darle a un elemento recién mostrado un estado del que partir— más
  `overlay` y `display` con **`allow-discrete`**, que es lo que lo mantiene en
  el top layer mientras se va. Sin eso la salida no se ve: desaparece de golpe y
  la opacidad anima algo que ya no está.
  ⚠️ **En el backoffice el panel se CREA y se DESTRUYE**, así que no hay estado
  anterior desde el que transitar y una `transition` no se dispararía nunca: va
  con `@keyframes`, y la directiva espera a que termine la salida antes de
  destruirlo. Suelta la referencia **antes** de esperar, para que volver a
  pulsar abra uno nuevo en vez de alternar contra un panel que se muere.
  ⚠️ **La duración está en DOS sitios** —el CSS y `DURACION_SALIDA_MS`— y no hay
  forma de que sea uno. Si cambia una, cambia la otra.

Y la cuarta: **la carretera de «Buscando coches libres…» se queda sin asfalto**,
en los dos sitios donde se usa, porque la clase es la misma. El filete gris
existía para que las barras se leyeran como marcas de una vía; mirándolo, lo que
dice que es un recorrido es el movimiento.

### Y la tercera vuelta — lo que aclaró qué quería decir «el mismo calendario»

Otras cinco, y la primera explica por qué este apartado tiene tres vueltas:

- ⚠️ **«El mismo tipo de calendario del móvil» era el ASPECTO, no la
  colocación.** La vuelta anterior lo leyó como «la hoja también en
  escritorio», y al verlo pidió lo contrario: más pequeño y colgando del campo.
  Así que ahora están separados y conviene no volver a mezclarlos: **el diseño**
  —rejilla del mes, horas en fichas, botón de aceptar— vive fuera de `--hoja` y
  `.is-sheet`, y **la colocación** la decide el puntero. En escritorio el panel
  mide **340×489**, un 29 % menos que la hoja de 480×688.
- ⚠️ **El hover de «Seleccionar» lo dejaba ilegible, y es el fallo de siempre**:
  una regla agrupada con `background: var(--gray-800)` **borraba el relleno de
  marca** y dejaba el rótulo —que va sobre turquesa— sobre gris oscuro. Ahora el
  hover es su propio color. Medido: 6,77 → 8,08 en la web. La regla completa
  está en CLAUDE.md desde los trece sitios del 24 de septiembre, y aun así
  volvió a aparecer en cuanto se escribió un botón de marca nuevo.
- **La mano solo sobre el icono del campo**, no sobre todo el `input`: con
  `cursor: pointer` en el campo se diría que no se puede escribir en él. La
  enciende un `mousemove` en la propia web, como ya hace el aspa de vaciar.
- ⚠️ **Al desplazar, el panel SIGUE a la página en vez de cerrarse.** Se
  reaplica el **desfase** medido al abrir, no se vuelve a colocar: la colocación
  elige si el panel va encima o debajo según lo que quepa, así que llamarla en
  cada fotograma lo haría saltar de un lado a otro del campo a media lectura. Va
  por `requestAnimationFrame`; al **redimensionar** sí se cierra, porque ahí
  cambia lo que cabe.
- ⚠️ **De 00:00 a 06:00 no se ofrece ninguna hora** (`FIRST_HOUR` / `PRIMERA_HORA`
  = 7). A esas horas no hay nadie en la oficina. Es una regla de negocio con la
  lista **escrita en los dos proyectos**, así que tiene test en los dos: el día
  que una cambie sin la otra, el visitante pediría en la web una hora que el
  backoffice no ofrece. Y recorta lo que se **ofrece**, no lo que se puede
  guardar — una reserva antigua de madrugada se sigue leyendo y editando.

Y se borró el centrado de la hora elegida en los dos, que dejó de hacer falta al
pasar las horas a una rejilla que cabe entera. Sus dos trampas —nada de
`scrollIntoView()`, y medir por rectángulos y no por `offsetTop`— quedan
contadas en el hueco que dejó.

## 2 terdecies. El despliegue del 7 de octubre — producción al día otra vez

Autorizado por Dorel. El orden, que es la parte reutilizable:

1. **Diez functions a mano**, en cinco tandas de una a tres, con 30 s entre
   tandas: `sendDailyDigest`, `previewDailyDigest`, `sendSignedContractEmail`,
   `publishVehiclePhoto`, `unpublishVehiclePhoto`, `publicVehicles`,
   `publicVehicleDetail`, `checkPublicAvailability`, `createBookingRequest`,
   `createContactRequest`. **Cero fallos de cuota.** Ninguna era nueva.
2. **El merge** (PR #70), que publica los dos sitios por CI.

⚠️ **Y la lección del día: `master` tenía la curva de tarifas desde la PR #69 y
producción seguía cobrando por tramos.** El CI despliega **solo hosting**, así
que un merge deja el frontend nuevo hablando con functions viejas. O sea que
«está en master» no quiere decir «está desplegado», y para saber qué functions
van viejas **no sirve** `git diff origin/master..origin/develop`: hay que diffear
desde el commit del último despliegue de functions.

**Comprobado al cerrar, contra `veltomobility.com`:** la curva calculando de 1 a
35 días con el total que nunca baja y la media que nunca sube —15 días 523,93 €
y 16 días 548,72 €, que era el salto que había que matar—; el calendario a
340×489 con ratón y 390×639 con dedo, horas de 07:00 a 23:00 y los nueve días
pasados bloqueados; la carretera de carga sin asfalto; y **32 functions, sin
ninguna de la AEAT**.

⚠️ **Y un test flojo que llevaba días fallando al azar.** `arranque.spec.ts`
caía una de cada cuatro tandas con «Test timed out in 5000ms» en
`generateContractPdf → ./pdf` y `getContractForSigning → ./clauses`. No era el
import: son justo los módulos pesados que se sacaron del arranque, y vitest los
transforma al vuelo —medido con la máquina cargada: 5,1 s y 8,0 s—. Plazo a
30 s. **Un test que falla a veces se deja de mirar**, y ese es el que avisa de
que un import perezoso mal escrito revienta la primera vez que alguien genera un
PDF, no al arrancar.

## 2 quaterdecies. El 8 de octubre — las tarifas redondas y el PDF que bajaba carpeta

Dos encargos de Dorel, y entre medias apareció el fallo que más importa de los
tres.

### ⚠️ El «desde X €/día» del escaparate NO era el precio que cobraba

La tarjeta de cada coche publicaba el `pricePerDay` **tecleado en el tramo**,
mientras el presupuesto sale de la **curva**. Mientras la tabla se rellenó sola
los dos coincidían; en cuanto alguien teclea un tramo a mano, dejan de hacerlo.
Medido en producción ese día, con los cinco coches publicados:

| Coche | La tarjeta | El presupuesto |
|---|---|---|
| Dacia Duster | 29,95 €/día desde 16 días | **37,68** (+26 %) |
| Renault Kadjar | 35,95 €/día desde 16 días | **41,50** (+15 %) |
| Ford Custom | 71,95 €/día desde 31 días | **54,45** (−24 %) |

Las dos direcciones son malas, y la web promete «precio final desde el primer
clic»: una decepciona al elegir fechas y la otra regala dinero. Lo arregla
`precioDesde()` calculando con **la misma curva** que el presupuesto, así que no
pueden discrepar por construcción.

⚠️ **Y el tramo se elige por el que EMPIEZA MÁS TARDE**, no por el precio
tecleado: `cheapestRule()` pasa a ser `longestRule()`. La curva es monótona, el
suelo está donde empieza el último tramo, y eso no depende de lo que nadie
escriba. Con números a mano, «el más barato» puede ser un tramo intermedio — y
en producción lo era en dos de cinco coches.

Queda una diferencia de **menos del 1 %** entre la tarjeta y el presupuesto, y es
inevitable: `publicPrice()` redondea a `,95` **hacia abajo** (regla del 30 de
septiembre) y lo hace dos veces sobre magnitudes distintas —el precio por día de
la tarjeta y el total del presupuesto—. 35,95 contra 36,29 en el Clio.

### Las tarifas se proponen en múltiplos de 5

«Que no me recomiende 32,5 tampoco 44; mejor 30 y 45». Lo hace
`roundToRateStep()`, y **el empate baja** —32,50 va a 30, que es su ejemplo—
porque subir el precio propuesto es subírselo a un cliente sin que nadie lo haya
decidido.

⚠️ **`Math.round()` no vale**: en JavaScript los empates van **hacia arriba**, así
que 32,50 habría salido 35.

⚠️ **Redondea lo que se PROPONE, no lo que se cobra.** El total lo sigue
calculando `curveTotal()` al céntimo. Y por eso había que arreglar antes el
«desde»: publicando la tabla, el redondeo habría metido hasta 2,50 €/día de
error en una cifra que ya mentía.

⚠️ **Consecuencia que se ve y es correcta:** dos tramos seguidos pueden quedar con
el mismo número. Con base 55, el de 16–30 días y el de 31+ salen los dos a 25 €
porque las medias reales son 27,3 y 27,5. No rompe nada —la tabla ya no decide
dinero— pero conviene no leerlo como un fallo.

### Un PDF se descargaba como una CARPETA

Lo contó Dorel bajando un justificante de producción: le bajaba la carpeta, la
subcarpeta y el fichero. Storage **no manda `Content-Disposition`**, así que el
navegador saca el nombre de la ruta de la URL y trata cada barra como un
directorio.

⚠️ **Y el `triggerDownload()` del backoffice solo tapaba DOS botones.** Baja el
fichero a un blob y le pone el nombre a mano, sí, pero no cubre los enlaces
`target="_blank"` de las otras siete pantallas, ni el botón de guardar del visor
de PDF del navegador, ni —sobre todo— el enlace `/d/…` que recibe el cliente por
WhatsApp.

Por eso el arreglo va en los **metadatos del objeto** y no en el frontend: diez
sitios de subida, los nueve documentos, y todas las vías a la vez.
`documents/nombre-descarga.ts` compone el nombre con las mismas reglas que
`storage-name.util.ts` de la app —`_` separa campos, `-` une palabras, solo
ASCII— y traduce la palabra del documento, porque **lo que se descarga lo lee
una persona**.

⚠️ **`inline` y no `attachment`**, o los botones de «Abrir» dejarían de abrir:
pasarían a bajar un fichero.

⚠️ **Solo vale para lo que se suba A PARTIR DE AHORA.** Un justificante de agosto
seguirá bajando mal hasta que alguien lo regenere. No se tocan en masa los
metadatos de ficheros de producción para arreglar un nombre.

⚠️ **Y el compilador cazó que `contentDisposition` no va donde yo lo había
puesto, pero solo en UNO de los dos sitios.** En `uploadPdf()` estaba arriba,
junto a `contentType`, detrás de un `...(cond ? {} : {})` — y **el spread de un
objeto condicional se salta la comprobación de propiedades de más**, así que
compilaba y la cabecera no se habría puesto nunca. Va dentro de `metadata`, y
escrito sin spread para que un error sea un error.

## 2 quindecies. El 8 de octubre, segunda parte — la auditoría de SEO

Dorel preguntó dos cosas: si hay que desplegar al dar de alta un coche, y qué
mejoraría del SEO. La primera se contesta midiendo y la respuesta tiene matiz.

### ⚠️ Sí hace falta desplegar, pero solo para WhatsApp y para Google

|  | ¿Se ve sin desplegar? |
|---|---|
| Un cliente que abre la web | **sí**, al momento: lo trae el JavaScript |
| La vista previa de WhatsApp | **no**: foto y título genéricos |
| Google | **no**: ni HTML propio ni entrada en el sitemap |

Y con un **cambio de tarifa** pasa lo mismo en un sitio que no es obvio: el
precio de la web y del presupuesto es siempre el de ahora, pero el
`og:description` lleva el precio **dentro** —«…desde 50,95 € al día…»—, así que
la tarjeta de WhatsApp enseña el viejo hasta el siguiente despliegue.

Por eso el despliegue de producción tiene ahora **`workflow_dispatch`** —un botón
en Actions— y un **`schedule` a las 04:15 UTC**: el botón solo sirve si alguien
se acuerda.

### Lo que la auditoría encontró, y lo que NO

⚠️ **Lo primero que hay que decir es lo que ya estaba bien**, porque es la mitad
del valor de una auditoría: LCP de **288–448 ms** en móvil, **CLS 0**, 79–105 kB
por página; `AutoRental` completo con horarios y zonas, `Car` + `Offer` con
precio por día, `FAQPage`, migas; `canonical`, `lang`, Open Graph,
`twitter:card`, sitemap, `robots.txt`, **`alt` en todas las imágenes** y un solo
`<h1>` por página. Y las rutas inexistentes dan **404 de verdad**.

⚠️ **Y una corrección mía: llegué a medir «canonical: false» en las 16
páginas.** Era falso — mi expresión regular pedía el grupo 1 de un patrón sin
grupos. **Una medición también se comprueba**, sobre todo cuando dice que algo
muy básico está roto en todas partes a la vez.

Lo que sí había:

- **La franja de la flota de la PORTADA estaba vacía hasta que corría el
  JavaScript.** La sección existía con su `<div id="lista" hidden>`, así que la
  portada servía **cero enlaces a fichas y cero nombres de coche** mientras
  `/flota` servía los cinco. Mismo agujero que se tapó en `/flota` el 2 de
  octubre; aquí se quedó sin tapar.
  ⚠️ **Y al prerrenderizarla aparece el fallo hermano**: hay que **esconder** la
  lista cuando la API dice que no hay coches, o las tarjetas del build se quedan
  debajo del aviso. Pero **no** cuando la API *falla*: ahí lo prerrenderizado es
  la mejor información que hay. «No hay» y «no he podido preguntar» no son lo
  mismo, y esa asimetría es deliberada.
- ⚠️ **`/coche/<cualquier-cosa>` respondía 200 y era indexable**, un *soft 404*
  del que se pueden generar infinitos escribiendo cualquier cosa. El 404 de
  verdad lo dan las rutas normales; `/coche/**` está **reescrito**, así que el
  servidor no puede saberlo — solo la API, y para entonces el HTML ya salió.
  ⚠️ Se desindexa **solo cuando la API dice que no existe, nunca cuando falla**:
  un corte de red de dos minutos marcaría `noindex` fichas de coches reales, y
  eso no se deshace al volver la red sino cuando Google vuelva a pasar.
- **La misma URL tenía DOS títulos**: 85 caracteres en el HTML y otro distinto
  escrito por el JavaScript. Ahora los compone `web/src/lib/seo.ts`, que llaman
  los dos — y los dos siguen haciendo falta, porque un coche sin HTML propio
  solo tiene el título que le ponga el JavaScript.

### El formato del título lo propuso Dorel, y es mejor

`{coche} - alquiler de coches en Arganda del Rey | Velto`. Tiene razón en lo que
importa: la frase que se teclea es **«alquiler de coches en Arganda»**, y
«Dacia Duster de alquiler en Arganda» la parte en dos.

De su propuesta literal cambian dos cosas, las dos medidas: la suya con
«| Velto Mobility» mide **66** y Google corta en 60 —se perdía justo el final—, y
«alquiler **de** coches» con el «de», que es como se dice y como se busca.

⚠️ **Y el título baja una escalera, no se trunca.** Cortar por la letra 60 parte
la palabra por la que se compite. Se sacrifica en orden: la versión del coche,
la marca, «del Rey», y solo al final se recorta por palabras enteras. Con la
frase completa, **la versión ya casi nunca cabe** — y no se pierde nada, sigue
en el `<h1>` y en la descripción.

## 2 sexdecies. El 8 de octubre, tercera parte — lo anunciado nunca por debajo de lo cobrado

**Desplegado a producción el mismo día** (merge `1e94123` + las tres functions
públicas por nombre). Lo que lo arrancó fue una pregunta de Dorel sobre la ficha
del Kadjar —«creo que hay tarifa desde 16 días, no desde 31»— y lo que salió
detrás fueron **tres incumplimientos de la misma regla**, los tres con dinero:

1. **El «desde» anunciaba por debajo de lo que se cobra, en los cinco coches
   publicados.** El Kadjar decía «desde 32,95 €/día» y su alquiler más barato
   sale a **33,27**. Entre 0,27 y 0,50 € al día.
2. **Convertir una solicitud de la web cobraba 0,57 € de más.** La web promete
   1.030,95 € por un Kadjar de 31 días —el total redondeado a la baja, que es lo
   que el cliente vio y lo que sale en el correo— y el asistente recalculaba
   desde la curva: 1.031,52 €.
3. **El «desde» no estaba en el día que decía.** Se calculaba donde empieza el
   último tramo, y la curva sigue bajando hasta el 31. El Peugeot 3008 —tramo
   final en el 16— decía «desde 59,95 €/día» y ese coche baja a **47,80**.

El marco lo puso Dorel y es el que gobierna los tres: *«imagínate que un abogado
que ve la web busca fallos para demandarme por precios engañosos; lo que me
importa es que el precio desde sea real y se pueda cumplir. Incluso prefiero
cobrar un poquito menos de lo que anuncio»*.

**Lo que está escrito en CLAUDE.md** («Lo que se ANUNCIA nunca puede quedar por
debajo de lo que se COBRA»), y aquí solo lo que hace falta para retomarlo:

- `aTerminacionArriba()` + `publicPriceDesde()` — el «desde» redondea a `,95`
  **hacia arriba**; el total de un presupuesto sigue redondeando **hacia abajo**.
  Parecen incoherentes y dicen lo mismo.
- `sueloPorDia()` — el suelo está en `LONG_STAY_FROM_DAYS`, no donde empieza el
  último tramo. La usan `lowestPricePerDay()` y el `precioDesde()` del mapper,
  que antes repetían el cálculo y estaban mal los dos.
- `promisedPriceCeiling()` — el precio prometido se acuerda como **techo**: si el
  descuento de fidelidad del cliente deja la tarifa por debajo, manda la tarifa.
  Caduca al cambiar de coche o de fechas y sobrevive al cambio de cliente.
- La **tabla de tramos** de la ficha del coche enseña debajo lo que se cobra de
  verdad (`curveRangeForTier()`). Es lo que destapó todo: «16-30 días: 30 €/día»
  son **34,31 → 27,50**.

⚠️ **Lo que queda abierto y lo decide Dorel: la terminación `,95` del «desde» se
pasa hasta 0,99 €/día.** El Corolla anuncia 30,95 y cobra 30,22 — un 2,4 %. Es
la dirección segura y es su decisión del 30 de septiembre («precios tipo desde
24,95»), pero si prefiere que el coche se vea tan barato como es, el «desde»
puede ir al céntimo. Es una línea.

⚠️ **Y el control de los tests está comprobado, no supuesto.** Revirtiendo cada
arreglo, su test falla con los números reales: «con 16 días se cobran 41,50 €/día
y se anuncian 40,95», y `{ porDia: 49.28, dias: 16 }` en vez de
`{ porDia: 39.5, dias: 31 }`. Un test de propiedad que nadie ha visto fallar no
prueba nada.

## 2 septdecies. El 8 de octubre, cuarta parte — el nombre del PDF que recibe el cliente

**Desplegado a producción el 9 de octubre de 2026** (merge `f9d9078` + la
function por nombre: `Successful update operation`, y el CI de hosting en verde).

Salió **midiendo el estado**, no buscándolo: al comprobar qué functions corren
código viejo, `documentLink` aparecía tocada por `4d8561f` —el commit de «los PDF
bajan como fichero»— y el § 2 ter decía que a esas tres solo les faltaba el
refactor de imports. Tirando del hilo, el fallo no era de despliegue sino del
arreglo mismo.

⚠️ **El arreglo del PDF que bajaba como carpeta dejaba fuera justo la vía que
decía arreglar «sobre todo»: el enlace `/d/…` que recibe el cliente.**
`documentLink` no redirige a Storage —lee el fichero y lo escribe ella—, así que
la cabecera que vale es la suya, y escribía cuatro nombres fijos que **pisaban**
el metadato del objeto:

| lo que el objeto trae dentro | lo que el cliente se bajaba |
|---|---|
| `Justificante_1234JKL_Marius-Ionescu-Pavel.pdf` | `reserva.pdf` |
| `Presupuesto_4466LKK_Andreea-Mitoseriu.pdf` | `presupuesto.pdf` |
| `Rezervare_1234JKL_Ana-Ionescu.pdf` (rumano) | `reserva.pdf`, en español |

Hoy `nombreDeDescarga()` **lee** el nombre del metadato en vez de componerlo, que
es lo que impide que las dos vías discrepen y lo que trae gratis el idioma: quien
generó el PDF ya eligió la palabra con `palabraDocumento(tipo, locale)`.
Recomponerlo aquí pediría ir a Firestore por la matrícula y el cliente, y este
endpoint **no tiene nada detrás** a propósito. El detalle está en CLAUDE.md, bajo
«El nombre del fichero lo pone el OBJETO»; lo que hace falta para retomarlo:

- El **respaldo** —objetos subidos antes del 7 de octubre, sin metadato— es la
  palabra del tipo a secas (`Justificante.pdf`) y va en **español**: de un objeto
  sin metadato no se sabe en qué idioma se emitió el PDF.
- `getMetadata()` sustituye a `exists()`: los metadatos hacen falta igualmente y
  pedirlos ya contesta si el objeto está. **Un 404 de ahí es «no está» y
  cualquier otro fallo sale como 500**, que es el riesgo real del cambio y por eso
  se midió en vivo.
- El `filename` **se sanea** aunque venga de nuestros metadatos: un CRLF en un
  `res.setHeader()` es una inyección de cabecera y Node tumba la petición con un
  500 — el cliente vería un error al abrir su enlace.

⚠️ **Verificado de punta a punta en desarrollo, que es lo que lo cierra.** Se
generó el justificante de verdad desde el backoffice (`ng serve` en el **4201**,
porque el 4200 lo ocupaba otro proyecto) y se midió la cabecera por las tres
vías: el enlace corto con el rewrite, la function directa y Storage. Las tres
dicen `inline; filename="Justificante_1234JKL_Marius-Ionescu-Pavel.pdf"`. Y los
caminos de error, contra la function desplegada: inexistente **404**, prefijo
desconocido **404**, `qfoo.bar` **404**, `POST` **405**.

⚠️ **El control de los tests está comprobado.** Volviendo a ignorar el metadato,
fallan **cuatro** con los nombres reales: «expected 'Justificante.pdf' to be
'Justificante_1234JKL_Marius-Ionescu-Pavel.pdf'». Un test que nadie ha visto
fallar no prueba nada.

Y dos cosas del entorno que salieron en la misma pasada:

⚠️ **`curl.exe` ya no hace HTTPS en esta máquina** — le falta el `ca-bundle.crt`
desde el incidente del 3 de octubre y devuelve `000` con salida 77, que se lee
como «el dominio no responde». La vía está en la tabla de PowerShell de
CLAUDE.md: `CURL_SSL_BACKEND=schannel`, o `Invoke-WebRequest` cuando hay que leer
una cabecera.

⚠️ **El código define 37 functions, no 36.** La cifra llevaba mal un tiempo en
los dos ficheros. Lo que la contesta es el manifiesto de descubrimiento; un regex
sobre `index.ts` da **41 o 24** según por dónde se equivoque con los comentarios.

## 2 ter. Qué hay sin subir y qué falta por desplegar

**Medido el 8 de octubre de 2026, después del despliegue: NO FALTA NADA.**
`master` y `develop` están sincronizados y producción corre el código de hoy.

**No te fíes de esta frase — vuelve a preguntarlo, porque envejece cada sesión:**

```bash
git log --oneline origin/master..HEAD                # develop por delante de produccion
git log --oneline origin/develop..HEAD               # lo que ni siquiera esta subido
git diff --stat origin/master..HEAD -- functions/    # vacio = no hay que desplegar functions
```

⚠️ **Y mídelo desde el último despliegue de FUNCTIONS, no desde `master`.** El
CI solo publica hosting, así que un merge puede dejar el frontend nuevo contra
functions viejas sin que ningún `git diff` contra `master` lo diga. Lo que lo
contesta de verdad es la marca de tiempo de cada una:

```bash
npx firebase functions:list --project prod --json > fn.json
# source.storageSource.generation son MICROsegundos: /1000 da la fecha
```

### El estado medido

**Vuelto a medir el 9 de octubre de 2026, después de desplegar: NO FALTA NADA.**

| | |
|---|---|
| functions en producción | **32** de las **37** que define el código |
| cuáles faltan | **solo las cinco de la AEAT**, a propósito hasta el 1 de enero |
| `master` vs `develop` | sincronizados (`f9d9078`) |
| `documentLink` | desplegada el **9 de octubre**; ya no corre la del 21 de septiembre |
| rewrites de la web | los **cuatro** responden |
| suites | 904 · 758 · 98, las cuatro auditorías OK, lint 0 errores / 291 avisos |

El `/d/**` de producción se comprobó sin tocar ni un dato: un id inexistente da
**404 con `Content-Length: 23`** —que son exactamente los caracteres de
«Documento no encontrado», el texto que escribe la function— y un `POST`, **405**.
Lo que delataría un rewrite ausente es el **200** que da cualquier otra ruta, que
es el catch-all de la SPA.

Los rewrites se comprueban con un `POST` de cuerpo vacío, que es lo que separa
uno que existe de uno que no: `/api/solicitud` y `/api/contacto` dan
**`400 application/json`** —llegan a su function y ella los rechaza—,
`/api/fleet` da 405 porque es de GET y `/api/visita` 204. **Lo que delataría un
rewrite ausente es `200 text/html`.**

✅ **`documentLink` ya está en producción** (9 de octubre de 2026), con el
arreglo del nombre del PDF del enlace corto — § 2 septdecies.
⚠️ **Pero solo arregla los documentos NUEVOS.** Los justificantes y presupuestos
que ya estaban generados en producción no llevan metadato, así que pasan de
`reserva.pdf` a `Justificante.pdf` —mejor, pero sin matrícula ni cliente— hasta
que se regeneren desde su ficha, que es un clic. Los metadatos de ficheros de
producción no se tocan en masa: mucho riesgo para muy poco.

⚠️ **Y las otras DOS siguen corriendo código anterior al 28 de septiembre**:
`syncAuthClaims` y `onAuthorizedUserChanged`, desplegadas el 25. Lo único que les
falta es el refactor de imports (`0194ec0`), que es de **arranque en frío y no de
comportamiento** —el manifiesto de descubrimiento salió idéntico—, así que no
corrigen ningún fallo: solo arrancan más lentas y con más memoria. Se ponen al
día cuando toque otra tanda.

> Aquí ponía que las **tres** estaban igual y que a las tres «solo les falta el
> refactor de imports». Era verdad para dos y falso para `documentLink`: el
> commit `4d8561f` tocó `storage.ts`, del que depende, y al tirar de ese hilo
> salió que el arreglo del nombre ni siquiera llegaba a esa vía. Una lista de
> «esto es menor» conviene volver a comprobarla antes de creérsela.

> Aquí había media página diciendo qué faltaba por subir: catorce functions, el
> merge, los dos rewrites, `trackWebVisit`, la cláusula de jurisdicción. **Todo
> eso se desplegó** entre el 5 y el 8 de octubre. Es la cuarta vez que esta
> sección se queda vieja, y por eso ahora empieza por cómo volver a medirla en
> vez de por una lista.

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

### Lo que bloqueaba publicar la web — quedan DOS, no seis

⚠️ **Medido el 9 de octubre de 2026, y esta tabla llevaba cuatro filas de
más.** Dorel avisó de que «muchas de esas cosas ya están hechas», y al
comprobarlas una a una lo estaban: eran nueve, luego seis, y hoy son **dos**.
La web ya está publicada, así que los dos despliegues que encabezaban esta
sección tampoco faltan.

| Qué falta | Dónde muerde |
|---|---|
| Si hay ficha de Google Business Profile | pesa más que todo el JSON-LD junto para «alquiler de coches Arganda». **No se puede medir desde aquí** |
| Que lo legal lo mire un abogado | está escrito y es honesto, pero lo firma una empresa real |

**Los cuatro que se cerraron, con cómo se comprobó cada uno** —porque la próxima
vez la pregunta será la misma:

- **La resolución de litigios.** Ya no hay ningún `[PENDIENTE]` publicado:
  `/aviso-legal` está escrito como **no adherido**, que es el estado por
  defecto, informando de la existencia de entidades acreditadas porque el
  título III de la Ley 7/2017 obliga a informar **aunque no se esté adherido**.
  ⚠️ Y **no** enlaza la plataforma europea de ODR, que dejó de operar el 20 de
  julio de 2025 (Reglamento (UE) 2024/3228): ese enlace, obligatorio durante
  años, hoy está muerto. Si aparece en una plantilla copiada, está vieja.
- **El aeropuerto.** `/entrega-a-domicilio` dice Barajas con suplemento fijo y
  el punto de encuentro en la zona de **Salidas**, y ⚠️ **no nombra una terminal
  concreta a propósito**: poner un número mandaría a alguien a la T1 cuando
  aterriza en la T4, que a ciertas horas es media hora de tren. Lo dice el
  cliente al reservar.
- **La política de cancelación.** Existe `/devoluciones` desde el 2 de octubre
  de 2026 —antes estaba a medias dentro de `/condiciones`—, y lo más importante
  de la página es que **no hay desistimiento**: no es una licencia que se tome
  Velto, es el art. 103.l del TRLGDCU, que excluye el alquiler de vehículos con
  fecha de ejecución determinada.
- **El correo entrante.** `veltomobility.com` **ya recibe**: tiene los tres MX
  de Cloudflare Email Routing (`route1/2/3.mx.cloudflare.net`), igual que
  `veltorent.com`. Se comprueba con `Resolve-DnsName veltomobility.com -Type MX
  -Server 8.8.8.8`. Aquí ponía «no tiene ni un registro MX», y era lo que
  dejaba sin canal los derechos RGPD que nombran las dos páginas legales.

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
✅ **Ya está en producción.** Aquí ponía que faltaba desplegarlo, y había
caducado: el commit es del 30 de septiembre y las tres functions que lo imprimen
se subieron después —`getContractForSigning` el 3 de octubre,
`generateContractPdf` y `signContract` el día 8—. Medido el 8 de octubre con la
marca de tiempo de cada una (`source.storageSource.generation`), que es lo único
que contesta esto: las functions van a mano y ningún `git diff` contra `master`
lo dice.

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

**Deuda técnica que ahora sí puede morder:** Informes se trae **cinco**
colecciones enteras y filtra en memoria —`payments`, `reservations`, `vehicles`,
`expenses` y `vehicleMaintenance`; solo `collaboratorSales` va con un `where`—, y
es lo primero que se rompe cuando crezcan los datos. Lo del lint **ya no
aplica**: existe desde el 22 de septiembre.

✅ **Y la carrera de dos operadores sobre el mismo coche está CERRADA, por
decisión de Dorel del 9 de octubre de 2026**: «nunca se va a dar, lo puedes dar
por válido por mi parte». Y tiene razón por donde importa — es el **único
usuario** de la aplicación, así que el escenario pide dos personas que no
existen. Queda escrito para que nadie lo reabra como fallo, y con su condición
dentro: **el día que entre a trabajar un segundo operador, esto vuelve a la
lista**. Lo que sigue siendo cierto es el diagnóstico técnico —el SDK web no
permite consultas dentro de una transacción, así que haría falta una Cloud
Function con el admin SDK— y la mitigación que ya está puesta: la segunda
comprobación a ras del `commit`, que deja la ventana en milisegundos.

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
2. ✅ **`store.veltomobility.com` YA redirige** a
   `rentalcar.veltomobility.com`. Medido el 9 de octubre de 2026: **301 Moved
   Permanently**. Aquí ponía «no está hecho» y la tabla de dominios de CLAUDE.md
   ya lo daba por bueno desde el 5 de octubre — dos sitios diciendo cosas
   distintas del mismo hecho, que es lo que pasa con un inventario escrito a
   mano. Lo que sigue valiendo es el aviso: añadir un dominio es reversible y
   **retirar el viejo no**, porque los contratos firmados llevan impreso un QR
   que apunta a `/v/…` del dominio con el que se generaron.
3. **Los avisos del lint**, que a 9 de octubre de 2026 son **291** —eran 290 el
   día 30 y 283 el 22—. Son deuda reconocida, no ruido: promesas sin esperar —la
   mayoría a propósito— y accesibilidad en plantillas (`<div (click)>` que no se
   alcanzan con el teclado). Se repasan por tandas y **entonces** se suben a
   `error`.
   ⚠️ **Lo que importa es que sigan siendo 0 errores**: si sale un error, es de
   lo que acabas de tocar.
4. ✅ **El Storage de producción ya NO tiene huérfanos.** Aquí ponía que seguían
   allí «el DNI, el carné y la firma de personas reales cuyas fichas ya no
   existen». Comprobado carpeta por carpeta el 9 de octubre de 2026 contra la
   consola —que es por donde se puede, porque `gcloud` pide reautenticación
   interactiva y el MCP de Firebase no conecta—: las tres que llevan datos
   personales **cuadran una a una** con Firestore.

   | Carpeta | En Storage | En Firestore |
   |---|---|---|
   | `clients/` | 1 (`HgyWic6A…`) | ese mismo, y es el único cliente |
   | `contracts/` | 1 (`KamNxLhL…`) | ese mismo, y es el único contrato |
   | `inspections/` | 1 (`VRRlkUPJ…`) | esa misma |

   ⚠️ **`quotes/` tiene tres carpetas sin documento detrás, y eso es correcto**:
   un presupuesto **no persiste nada** en Firestore por diseño, así que no hay
   ficha con la que cuadrarlo. Lo que sí conviene saber es que esos PDF llevan
   dentro el nombre del cliente y su precio, su enlace `/d/q…` es el secreto —y
   **no caducan nunca**. Si algún día estorba, eso es una limpieza por fecha, no
   un huérfano.

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
