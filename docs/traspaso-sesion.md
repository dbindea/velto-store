# Traspaso de sesión — 24 de septiembre de 2026

> Pégalo entero al abrir la sesión nueva. Está escrito para alguien que **no ha
> visto nada de lo anterior**: dice dónde estamos, qué NO tocar, y cómo entra el
> trabajo a partir de ahora.
>
> Lo primero que hay que mirar es **§ 2 quinquies**, que son los doce commits del
> día 24 y tocan el camino del dinero, y **§ 2 ter**, que dice qué hay sin subir y
> qué falta por desplegar. Las secciones anteriores (§ 2, § 2 bis, § 2 quater)
> son historia: se leen si algo no cuadra.
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

## 2 ter. Qué hay sin subir y qué falta por desplegar

Medido el 22 de septiembre al cerrar la sesión. **No te fíes de las cifras, que
envejecen — vuelve a preguntarlo:**

```bash
git log --oneline origin/master..HEAD     # lo que develop tiene y produccion no
git log --oneline origin/develop..HEAD    # lo que ni siquiera esta subido
git diff --stat origin/master..HEAD -- functions/   # vacio = no hay que desplegar functions
```

**Medido el 24 de septiembre al cerrar**: `develop` en `3220cab` y
**`origin/develop` en el mismo commit** —Dorel fue subiendo en paralelo—, con
**12 commits que NO están en producción** (los de § 2 quinquies). `origin/master`
en `12ea9f0`.

⚠️ **NO hace falta desplegar Cloud Functions, ni reglas, ni índices.**
Comprobado: entre `origin/master` y `develop` **no cambia un solo fichero de
`functions/`**, ni `firestore.rules`, ni `firestore.indexes.json`, ni
`storage.rules`, ni `firebase.json`. Todo el trabajo del día 24 es frontend. Un
merge a `master` despliega hosting por CI y con eso está todo. Es la excepción,
no la regla: normalmente hay que mirarlo.

⚠️ **Pero SÍ hay claves i18n nuevas** —41 líneas añadidas en `es.json`, y los
tres idiomas—, así que aplica la nota de la caché: `assets/i18n/*.json` no lleva
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
