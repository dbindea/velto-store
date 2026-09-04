# Pruebas de módulos — 21 de agosto de 2026

Recorrido de todos los módulos con Playwright sobre el servidor de desarrollo,
autenticado con una cuenta real contra el Firebase de producción.

**Resultado:** 8 fallos encontrados, 7 corregidos en código, 1 pendiente de una
acción tuya (desplegar reglas).

---

## F-1 · Las reglas de Firestore desplegadas no incluyen `vehicleMaintenance`

**Gravedad:** alta · **Estado:** ⚠️ pendiente de despliegue

El dashboard consulta la colección `vehicleMaintenance` y recibe
`FirebaseError: Missing or insufficient permissions`.

`firestore.rules` en el repositorio **sí** declara el bloque, pero las reglas
vivas en producción no lo tienen: se comprobó leyendo las reglas desplegadas
directamente del proyecto. El CI solo despliega hosting, así que el fichero
nunca llegó.

Mismo riesgo latente con los índices compuestos declarados para esa colección.

**Corrección:** no es código. Requiere ejecutar

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

---

## F-2 · El dashboard mostraba «Todo al día» cuando la carga fallaba

**Gravedad:** alta · **Estado:** ✅ corregido

Consecuencia de F-1, y peor que su causa. Las cuatro consultas del dashboard
compartían un único `try`. Al fallar la cuarta (mantenimiento), el `catch`
hacía `cards = []` y **descartaba reservas, contratos y vehículos que ya habían
cargado bien**. La plantilla entonces caía en el estado vacío y anunciaba
«Todo al día — No hay acciones pendientes».

Un operador leería que no tiene nada que hacer cuando en realidad no se había
cargado nada.

**Corrección:** la consulta de mantenimiento se aísla en su propio `try`; se
añaden los estados `partialFailure` y `loadFailed`, y la plantilla evalúa el
fallo **antes** que el estado vacío.

---

## F-3 · Recargar o entrar por enlace directo cerraba la sesión

**Gravedad:** alta · **Estado:** ✅ corregido

Ir directamente a cualquier ruta privada redirigía a `/login` pese a tener
sesión válida.

Dos causas encadenadas:

1. `initAuthListener()` estaba definido en `AuthService` y **nadie lo llamaba**.
   El estado de autorización solo se rellenaba durante `loginWithGoogle()`, así
   que tras recargar era `null` para siempre.
2. Los guards leían `isAuthorized()` justo después de la primera emisión del
   usuario, sin esperar a que terminara la consulta a `authorizedUsers`.

**Corrección:** nuevo `authorizedState$` en `AuthService`, que solo emite cuando
la sesión persistida **y** la consulta de autorización han resuelto. Ambos
guards lo consumen. Se elimina el `initAuthListener()` muerto.

---

## F-4 · `stripUndefined()` corrompía los timestamps de los contratos

**Gravedad:** alta · **Estado:** ✅ corregido (datos existentes sin reparar)

La lista de contratos lanzaba
`InvalidPipeArgument: Unable to convert "Invalid Date" into a date`.

Leyendo el documento real en Firestore: `createdAt` y `generatedAt` estaban
guardados como **mapas vacíos** en vez de timestamps.

El culpable era `stripUndefined()` en `generateContractPdf.ts`. Reconstruía cada
objeto con `Object.entries()`, y un `FieldValue.serverTimestamp()` es un objeto
**sin propiedades enumerables propias**: se aplanaba a `{}`.

Era además redundante — `ignoreUndefinedProperties` en `admin-guard.ts` ya
resuelve el problema original de los `undefined`, y a diferencia del helper
respeta centinelas, Timestamps y referencias.

**Corrección:** helper eliminado. Se deja un comentario explicando por qué no
debe reintroducirse una limpieza genérica en profundidad sobre payloads de
Firestore.

⚠️ **Los contratos ya escritos siguen con los campos corruptos.** Requiere un
script de reparación o regenerar esos contratos.

---

## F-5 · `toDate()` devolvía `Invalid Date` y tumbaba la vista

**Gravedad:** media · **Estado:** ✅ corregido

El último recurso de `toDate()` era `new Date(valor)`. Con un objeto da
`Invalid Date`, que el pipe `date` de Angular rechaza con un error de runtime
que deja la vista en blanco — no solo el campo.

**Corrección:** se reconoce también `_seconds` (formato del admin SDK) y se
valida el resultado antes de devolverlo.

---

## F-6 · Los conceptos de pago se pintaban en crudo

**Gravedad:** media · **Estado:** ✅ corregido

En Pagos y en el detalle de reserva aparecía `initial_payment` y
`remaining_payment` tal cual, sin traducir, en los tres idiomas.

`concept` es texto libre del operador, pero los documentos existentes guardan
ahí el tipo crudo, y las plantillas lo pintaban directamente.

**Corrección:** nuevo pipe compartido `paymentConcept` que usa el `concept` solo
cuando aporta algo distinto del tipo, y si no cae a la etiqueta traducida.
Sustituye seis usos repartidos por cuatro componentes.

---

## F-7 · El estado de la fianza se mostraba sin traducir

**Gravedad:** media · **Estado:** ✅ corregido

El detalle de reserva hacía `{{ reservation.deposit.status }}`: valor crudo de
Firestore. Se veía «Pending» en inglés con la app en español.

No existía mapa de etiquetas para ese estado.

**Corrección:** nuevo `RESERVATION_DEPOSIT_STATUS_LABELS` con sus 6 valores, y
las claves añadidas a los tres idiomas.

---

## F-8 · La duración se leía al revés

**Gravedad:** baja · **Estado:** ✅ corregido

La cabecera del detalle de reserva mostraba «días: 32» en vez de «32 días»: el
orden de la clave y el valor estaba invertido respecto a cómo se hace en el
resto de la vista.

---

## F-9 · Pestañas del vehículo en inglés

**Gravedad:** baja · **Estado:** ✅ corregido

«Info», «Features» y «Photos» estaban escritas a mano en inglés en la ficha del
vehículo, junto a «Tarifas» y «Mantenimiento» en español. La clave
`vehicles.tabs.photos` ya existía y la plantilla la ignoraba.

---

## F-10 · Escribir el lugar de devolución lanzaba una excepción

**Gravedad:** alta · **Estado:** ✅ corregido

`onReturnLocationInput()` estaba escrito para un evento DOM
(`event.target.value`) pero se enlazaba con `(ngModelChange)`, que emite el
**valor**, no un evento. Cada pulsación lanzaba
`Cannot read properties of undefined (reading 'value')`.

El handler equivalente de la recogida sí tenía la firma correcta: era una
inconsistencia entre dos campos hermanos.

---

## F-11 · Se podía devolver una fianza nunca cobrada

**Gravedad:** alta · **Estado:** ✅ corregido

Con la fianza a 0 € de 150 €, los botones «Devolver total» y «Retener» estaban
habilitados. No consultaban el workflow **en absoluto**: ni el componente
exponía `canRefundDeposit` / `canRetainDeposit`, ni la plantilla tenía
`[disabled]`.

Es una violación directa de la regla central del proyecto —bloquear en UI y
validar en servicio— en la única acción que mueve dinero hacia fuera.

**Corrección:** ambos botones consultan ahora el workflow y muestran el motivo
del bloqueo.

---

## F-12 · El despliegue de Cloud Functions estaba roto

**Gravedad:** alta · **Estado:** ✅ corregido

`firebase deploy --only functions` fallaba con *«User code failed to load.
Cannot determine backend specification»*.

Causa: `admin-guard.ts` aplicaba `settings({ ignoreUndefinedProperties: true })`
resolviendo Firestore **en carga de módulo**, que es justo lo que la cabecera de
ese mismo fichero prohíbe. El análisis previo al despliegue no lo soportaba.

**Corrección:** el `settings()` se aplica dentro del helper perezoso
`firestore()`, en el primer uso. Sigue cumpliendo el requisito del SDK de
ejecutarse antes de cualquier otra llamada a Firestore.

---

## F-13 · Textos en español escritos a mano en 11 plantillas

**Gravedad:** media · **Estado:** ✅ corregido

Barrido de literales con acentos fuera de `| translate`. Nunca se traducían:
«No hay información del carnet de conducir», «Estado del vehículo»,
«¿Estás seguro de que quieres cancelar esta reserva?», «Teléfono:»,
«Vehículo:», «Matrícula:», «Año:», «Pagos», «No hay fotos todavía»,
«Devuelta»/«Retenida».

---

## F-14 · El contrato que firma el cliente llevaba la hora equivocada

**Gravedad:** alta · **Estado:** ✅ corregido y desplegado

La reserva se creó con recogida a las **12:00**. La página pública de firma
mostraba **10:00**, y el PDF se generaba igual.

Causa: `pdf.ts` y `getContractForSigning.ts` formateaban con `toLocaleString`
**sin `timeZone`**. Cloud Functions corre con `TZ=UTC`, y Madrid en septiembre
es UTC+2, así que todo contrato salía dos horas antes.

Es el documento legalmente vinculante, con la hora de recogida mal.

**Corrección:** zona fijada a `Europe/Madrid`, configurable con
`VELTO_TIME_ZONE`. Verificado tras desplegar: la página de firma ya muestra
12:00.

---

## F-15 · Sin actualización en tiempo real

**Gravedad:** alta · **Estado:** ✅ corregido

`getContractByReservation` y `getReservationById` usaban `getDocs()` /
`getDoc()`: lecturas puntuales. Consecuencias reales observadas:

- Al generar el link de firma, Firestore pasaba a `pending_signature` mientras
  la pantalla seguía diciendo «Generado».
- Con el cliente firmando en su móvil, la pantalla del operador **no cambiaba
  en absoluto** hasta recargar a mano.

**Corrección:** ambas pasan a `onSnapshot`, con `takeUntilDestroyed` para cerrar
el listener. Las colecciones relacionadas se cargan solo en la primera emisión,
para no refetchear pagos e inspecciones en cada cambio de campo.

Verificado con dos pestañas: firmar en la pública actualiza la del operador sin
recargar.

---

## F-16 · Una traducción cuyo valor era su propia clave

**Gravedad:** media · **Estado:** ✅ corregido

La página de firma mostraba `contracts.sign.highlightsTitle` en crudo. La clave
**existía** en los tres idiomas, pero su valor era literalmente el texto de la
clave — un marcador que dejó el antiguo generador.

El auditor no podía detectarlo: la clave está presente y `translate()` la
encuentra, así que devuelve ese texto sin error en ninguna parte.

**Corrección:** traducida, y el auditor ahora falla si el valor de una clave es
su propio nombre.

---

## F-17 · «días: 7» en la página pública de firma

**Gravedad:** baja · **Estado:** ✅ corregido

El mismo orden invertido de F-8, en la pantalla que ve el cliente. Se añade
`reservations.fields.duration` para la etiqueta, dejando `totalDays` como
unidad: «Duración: 7 días».

---

## F-18 · La «siguiente acción» apuntaba hacia atrás

**Gravedad:** media · **Estado:** ✅ corregido, con tests

Con todo pagado y el contrato firmado, la reserva anunciaba «Siguiente acción:
El contrato ya está firmado» en lugar de «Iniciar entrega».

`getReservationNextRequiredAction` devolvía el motivo del **primer guard que
decía que no**. Pero un guard también dice que no cuando su paso ya está hecho,
así que un paso completado se reportaba como si fuera lo pendiente. Confundía
«bloqueado porque falta algo» con «bloqueado porque ya está hecho».

**Corrección:** recorre el orden canónico saltando los pasos ya completados; si
el siguiente está permitido nombra la acción, y si está bloqueado explica qué
falta. Cubierto con 6 tests nuevos (30 en total).

---

## F-19 · El formulario de inspección se quedaba colgado

**Gravedad:** alta · **Estado:** ✅ corregido

«Iniciar entrega» dejaba la pantalla en «Cargando…» para siempre.

Regresión introducida al arreglar F-15: al convertir `getContractByReservation`
en un `onSnapshot` vivo, los tres sitios que hacían `await ... .toPromise()`
dejaron de resolver, porque un stream vivo **nunca completa**.

**Corrección:** `firstValueFrom(obs.pipe(first()))` en los tres puntos. De paso
cierra el listener, que en dos de ellos quedaba abierto indefinidamente.

Lección: convertir una lectura puntual en suscripción viva obliga a revisar
todos los `await` sobre ese observable.

---

## F-20 · Etiquetas mal en la inspección de devolución

**Gravedad:** baja · **Estado:** ✅ corregido

- «días: 7 días» — tercera aparición del orden invertido.
- «Reservas: 350.00 €» — usaba `reservations.title`, el nombre del módulo, como
  etiqueta de un importe. Ahora «Total alquiler».
- «Fianza cobrada» estaba escrito a mano en la plantilla.

---

## F-21 · El lugar de devolución solo copiaba la primera letra

**Gravedad:** media · **Estado:** ✅ corregido
**Reportado por Dorel**, no detectado en la pasada automática.

Al escribir «Arganda» en «Lugar de recogida», el campo «Lugar de devolución»
se quedaba en «A».

El autorrelleno estaba guardado por `if (!this.returnLocation)` — «copia solo
si está vacío». Como corre en **cada pulsación**, la primera tecla copiaba la
«A» y a partir de la segunda el campo ya no estaba vacío, así que dejaba de
copiarse.

La condición quería saber si el operador había escrito en el campo de
devolución, no si el campo tenía texto en ese instante.

**Corrección:** una bandera `returnLocationEdited` que se activa cuando el
operador escribe en el campo de devolución. Vaciarlo reanuda el espejo, para no
obligar a reescribirlo entero tras un borrado accidental.

Verificado en navegador escribiendo letra a letra: ambos campos quedan en
«Arganda Del Rey», y al editar la devolución deja de pisarse.

---

# Pasada móvil — 26 de agosto de 2026

Revisión completa en simulador de teléfono (viewport 360 × 800, equivalente a
un Samsung S25) sobre datos reales de producción, con el tema oscuro activo.
El punto de partida era el síntoma reportado: **varias pantallas se veían «como
en desktop» y había que alejar el zoom para leerlas**.

## F-22 · Once variables de color no existían

**Gravedad:** alta · **Estado:** ✅ corregido

`--warning-color`, `--warning-bg`, `--success-color`, `--success-bg`,
`--error-color`, `--error-bg`, `--info-color`, `--info-bg`, `--danger-color`,
`--bg-input` y `--accent-color-rgb` se usaban **261 veces** repartidas por todo
el CSS de la aplicación y **no estaban declaradas en ninguna parte**.

Un `var()` sin valor y sin *fallback* hace que el navegador descarte la
declaración entera. Consecuencia visible: todos los badges de estado se
pintaban sin fondo, los importes pendientes salían del color del texto normal
en vez de ámbar, y los avisos no se distinguían del resto.

Se detectó comparando las variables usadas en `src/**/*.scss` contra las
declaradas en `styles.scss`, y se confirmó en el navegador leyendo
`getComputedStyle(document.documentElement)`.

**Corrección:** las once quedan declaradas en `src/styles.scss`, con dos
paletas. La de tema claro usa tintas oscuras sobre fondos suaves; la de tema
oscuro usa tintas claras (`#4ade80`, `#fbbf24`, `#f87171`, `#60a5fa`) sobre
rellenos translúcidos, porque los pares del tema claro son ilegibles sobre
superficies de pizarra.

## F-23 · La app entera se ensanchaba hasta su elemento más ancho

**Gravedad:** alta · **Estado:** ✅ corregido

**Esta es la causa raíz del «se ve como en desktop».**

`.main-wrapper` es un *flex item* de `.app-layout`. Los flex items nacen con
`min-width: auto`, es decir, **se niegan a encogerse por debajo del ancho
intrínseco de su contenido**. Cualquier cosa ancha dentro de una página —la
rejilla del calendario, un nombre largo, una fila de pestañas— estiraba el
contenedor, y todas las páginas de dentro heredaban ese ancho.

Medido en el detalle de cliente: `scrollWidth` de **723 px** en un viewport de
360. El usuario solo podía leerlo alejando el zoom.

**Corrección:** `min-width: 0` en `.main-wrapper`. El armazón queda exactamente
del ancho del viewport y lo que de verdad no cabe hace su propio scroll dentro
de su contenedor. Tras el cambio, las once rutas dan `scrollWidth === clientWidth`.

## F-24 · Información crítica oculta con `display: none` en móvil

**Gravedad:** alta · **Estado:** ✅ corregido

Patrón repetido en seis pantallas: en vez de recolocar la información al
estrecharse la pantalla, se ocultaba. Lo que desaparecía en un teléfono:

| Pantalla | Se ocultaba |
|---|---|
| Lista de reservas | **cliente y fechas** — quedaba coche y precio |
| Lista de pagos | **importe, pendiente, estado, método y fecha** |
| Pagos de una reserva | **todos los importes** |
| Lista de inspecciones | estado (borrador / completada / cancelada) |
| Detalle de cliente | fechas del histórico e importes de sus pagos |
| Lista de clientes | nivel de confianza, incluido `blocked` |

Es decir: la pantalla de pagos no mostraba dinero y la de reservas no mostraba
a quién ni cuándo, justo en el dispositivo desde el que se opera.

**Corrección:** cada bloque se reorganiza en lugar de esconderse, con áreas de
rejilla donde hacía falta para que el importe y el estado que lo califica
queden juntos. Solo siguen ocultos los elementos decorativos —la flecha de
«ver detalle» y el botón-ojo de la tarjeta de vehículo—, porque la tarjeta
entera ya es el área pulsable.

## F-25 · El calendario medía 1200 px

**Gravedad:** alta · **Estado:** ✅ corregido

`grid-template-columns: repeat(7, 1fr)`. Un `1fr` equivale a
`minmax(auto, 1fr)`, y ese `auto` toma como mínimo el ancho de contenido: los
nombres de cliente con `white-space: nowrap` dentro de las celdas fijaban el
suelo de cada columna. Resultado: **1199 px** de rejilla en una pantalla de 360.

**Corrección:** `repeat(7, minmax(0, 1fr))` y, por debajo de 640 px, las barras
se reducen a franjas de color de 7 px sin texto. La ocupación del mes y la
continuidad de cada alquiler se siguen leyendo de un vistazo, y el detalle se
abre pulsando el día, que es el gesto que la propia pantalla ya anuncia.

## F-26 · El dashboard rompía el pipe `date`

**Gravedad:** media · **Estado:** ✅ corregido

`NG02100: Unable to convert "[object Object]" into a date`. Dos plantillas del
dashboard pasaban el Timestamp de Firestore crudo a `| date`, en lugar de
convertirlo con el `toDateSafe()` que el propio componente ya tenía y usaba en
otras cuatro líneas. La tarjeta de entregas mostraba la etiqueta «Hora» sin
hora al lado, y la consola arrancaba con un error.

**Corrección:** `toDateSafe()` en las dos líneas. Dashboard con 0 errores.

## F-27 · La barra de navegación tapaba el botón de acción

**Gravedad:** media · **Estado:** ✅ corregido

La barra inferior es `position: fixed`, y el hueco reservado bajo el contenido
(`5rem`) no llegaba a cubrirla del todo. El último botón de una página quedaba
por debajo: «Buscar disponibilidad», al final del formulario de nueva reserva,
era **físicamente impulsable** — Playwright lo confirmó al informar de que la
barra interceptaba el evento.

**Corrección:** el hueco pasa a `calc(5.5rem + env(safe-area-inset-bottom))`, y
la propia barra respeta el *inset* inferior de los teléfonos con indicador de
inicio.

## F-28 · Español escrito a mano en el detalle de reserva

**Gravedad:** media · **Estado:** ✅ corregido

Mismo problema que F-13 pero en código en vez de plantilla: `Pagado:`,
`Cancelar` (dos veces), `No hay pagos registrados para esta reserva`,
`plazas`, `maletas`, y un `{{ 'payments.fields.amount' | translate }}
depositada` que concatenaba una traducción con una palabra suelta en español y
producía «Importe depositada».

**Corrección:** todos pasan por `translate`. Se añade `payments.summary.depositHeld`
(«Fianza depositada» / «Deposit held» / «Garanție depusă») a los tres idiomas.

---

---

# Pasada de verificación — 27 de agosto de 2026

Sobre el código ya desplegado, con el dev server de :4200 contra el Firebase de
producción.

## F-29 · Los `select` se quedaron sin flecha

**Gravedad:** media · **Estado:** ✅ corregido

El estilo global nuevo hacía `appearance: none` —para sustituir la flecha del
sistema por un chevron propio— pero **once hojas de componente declaran
`background:` en sus selects**, el shorthand, que reinicia `background-image` a
`none`. Su `.filter-select[_ngcontent-…]` (0-2-0) gana a un `select` pelado
(0-0-1).

Resultado: la flecha nativa quitada, la nuestra pisada, **desplegables sin
ninguna flecha**. Peor que el punto de partida.

Pasó `tsc`, pasó el build y pasaron los 134 tests. Solo se ve abriendo la
página y leyendo `getComputedStyle`.

**Corrección:** `!important` acotado al chevron y al hueco que necesita
(`background-image`, `-repeat`, `-position`, `-size` y `padding-right`). Los
colores siguen siendo del componente. Verificado: `backgroundImage` distinto de
`none` y `padding-right: 33.6px` en los selects reales.

## F-30 · El enlace de presupuesto pedía login al cliente

**Gravedad:** alta · **Estado:** ✅ mitigado en código · ⚠️ pendiente de desplegar hosting

Reportado por Dorel: al abrir `https://velto-store.web.app/d/q06fa82e4da5d421d`
la página pedía iniciar sesión.

**No era permisos ni dominio.** El rewrite `/d/**` no está desplegado, así que
la ruta cae en el catch-all de la SPA, Angular no encuentra `/d/…`, y el
`authGuard` manda a `/login`. Medido con el mismo id:

| Vía | Resultado |
|---|---|
| `velto-store.web.app/d/q06fa…` | `200 text/html` → SPA → login |
| function directa | `200 application/pdf`, 1,2 MB, `%PDF-` |

El PDF llevaba todo el rato ahí. Lo que faltaba era enrutarlo.

**Corrección:** además de desplegar hosting, se añade la ruta pública `d/:id`
que reenvía a la function. Un rewrite olvidado pasa a costar un salto extra en
vez de enseñarle una pantalla de login a un cliente. Declarada **antes** del
bloque con `authGuard`, igual que `sign-contract/:token`.

## F-31 · Añadir una nota interna fallaba con `undefined`

**Gravedad:** alta · **Estado:** ✅ corregido
**Reportado por Dorel.**

```
Function updateDoc() called with invalid data.
Unsupported field value: undefined (found in document reservations/vCwvSzOFfUnRP9pWrBMy)
```

Dos fallos encadenados:

1. `createdBy` y `createdByEmail` se asignaban como `undefined` cuando el
   usuario autorizado no tiene `displayName` o `email`.
2. Y el motivo de que `cleanData()` no lo salvara: la nota viaja dentro de
   `arrayUnion()`, y **el limpiador reconstruía el centinela**. Un centinela
   tiene propiedades propias (`_methodName`, `_elements`), así que
   `Object.entries()` lo convertía en un mapa normal; Firestore entraba en
   `_elements` y encontraba el `undefined`.

El segundo era el peligroso: aunque no hubiera `undefined`, el `arrayUnion`
degradado a mapa habría **sobrescrito** `internalNotes` en vez de añadir. Misma
familia que F-4.

**Corrección:** un único `cleanForFirestore()` compartido que invierte la
regla —solo reconstruye objetos planos, todo lo que tenga prototipo propio pasa
intacto—, y `buildReservationNote()`, que construye la nota sin `undefined`
porque el centinela no se puede limpiar. Los tres `cleanData` duplicados
delegan en él. 20 tests nuevos.

**De regalo:** el mismo `cleanData` corrompía los `serverTimestamp()` de
`vehicle-maintenance.service.ts`. No había saltado porque la colección sigue
vacía en producción.

## F-32 · La nota se guardaba pero no aparecía hasta recargar

**Gravedad:** media · **Estado:** ✅ corregido

Al destapar F-31 se vio el siguiente: la nota se escribía bien y el panel
seguía diciendo «0».

`sortedNotes` es un `computed()` que leía `this.notes`, un `@Input()` normal.
**Un `computed` solo reacciona a señales**: leer una propiedad corriente no
registra dependencia, así que la lista se calculaba una vez y nunca más. El
operador no veía nada al añadir la nota, lo que invita a escribirla dos veces.

**Corrección:** `input()` de señal en vez de `@Input()`.

Y al arreglarlo apareció un tercero: el panel además añadía la nota
**optimistamente** a la lista, lo que ahora competía con el `onSnapshot` vivo y
la mostraba **duplicada** (solo en pantalla; en Firestore había una). Se retira
el añadido optimista: la reserva es una suscripción viva desde F-15 y Firestore
devuelve la nota sola.

Verificado en el navegador: 2 → 3 notas, la nueva arriba, sin duplicado, sin
recargar y con el campo vaciado.

## Verificado en esta pasada

| Comprobación | Resultado |
|---|---|
| `color-scheme: dark` aplicado en runtime | ✅ los desplegables y el calendario siguen el tema de la app, no el del SO |
| Chevron propio en los `select` | ✅ tras corregir F-29 |
| Fianza editable a 0 | ✅ pide motivo, «Crear reserva» se deshabilita y se rehabilita al rellenarlo |
| Presupuesto contra la function desplegada | ✅ generado, 1,2 MB |
| Enlace corto (function directa) | ✅ `200 application/pdf`, empieza por `%PDF-` |
| Enlace corto (vía hosting) | ✅ tras desplegar hosting: `200 application/pdf` |
| Longitud del enlace | 47 car. frente a 168 de la URL de Storage |
| Móvil 360 × 800 | ✅ sin desbordamiento horizontal |
| Errores de consola | 0 |

---

# Rediseño del contrato y cambio de IVA — 27 de agosto de 2026 (tarde)

Cambios pedidos por Dorel sobre el PDF, más el giro en el cálculo del IVA.
Todo **verificado renderizando el contrato** en español y rumano: 0 solapes,
0 glifos ausentes, 0 desbordes de margen, y el contrato bajó de **9 a 8
páginas** por el condensado.

## C-1 · El IVA cambia de dirección

**La tarifa pasa a ser NETA y el IVA se suma encima.** Un coche a 30 €/día son
30 € de base y el cliente paga 36,30 €. El motivo es comercial: el número
redondo es el que se negocia, y quien no quiere factura paga justo ese neto.

Es lo contrario de como estaba, así que:

- La dirección se **congela por reserva** en `pricingSnapshot.tariffIncludesVat`.
  **Ausente significa inclusivo**, que es como se crearon todas las reservas
  anteriores. `vatBreakdownOf()` es quien decide, en app y en functions.
- `resolveRentalPrice()` trabaja **en neto** hasta el final: tarifa, descuento
  de fidelidad y precio acordado son todos base imponible. Solo `finalPrice`
  es lo que paga el cliente.
- El campo editable del asistente es ahora el **neto**.
- Se añade `pricingSnapshot.netPrice`.
- La fianza **no** cambia: sigue sin IVA.

⚠️ **Consecuencia con dinero detrás:** las tarifas existentes no se tocaron, así
que lo cobrado por el mismo alquiler **sube un 21 %**. Anotado el primero en
[mejoras-pendientes.md](mejoras-pendientes.md).

### C-1b · El input mostraba el bruto con la etiqueta «sin IVA»

Encontrado probando en el navegador, no por los tests. La etiqueta decía
«Precio sin IVA» pero el input seguía enlazado a `finalPrice` (el bruto),
mientras que lo tecleado se interpretaba como neto: **un 21 % de desfase
silencioso** en cuanto alguien tocara el precio. Corregido y verificado — el
campo muestra 280 sobre 40 €/día × 7 días, y el total 338,80 €.

## C-2 · Tipografía del contrato

| | Antes | Ahora |
|---|---|---|
| Filas de datos | 9,5 pt | 8,2 pt |
| Columnas de cabecera | 9 pt | 8,2 pt |
| Totales | 9,5 / 14 pt | 8,8 pt |
| Puntos del resumen | 11,5 pt | 9,2 pt |

DejaVu es una fuente ancha y a los tamaños antiguos se desparramaba.

## C-3 · Jerarquía de REUNIDOS invertida

Estaba al revés: el título era **más pequeño** que el subtítulo, y este más
pequeño que el campo. Ahora desciende, medido sobre el PDF real:

| Elemento | Tamaño |
|---|---|
| REUNIDOS (sección) | 9,5 pt |
| Arrendatario (subsección) | 8,8 pt |
| Nombre y apellidos (campo) | 8,2 pt |

## C-4 · Título en una sola línea

«CONTRATO DE ALQUILER DE VEHÍCULO SIN CONDUCTOR» partía en dos porque el ajuste
automático tenía el suelo en 15 pt. Bajado a 10 pt: entra entero.

## C-5 · Puntos numerados minimalistas

Fuera la caja tintada, el borde y el cuadrado verde relleno. Ahora: número en
turquesa, texto al lado, filete fino de separación. Nueve cuadrados verdes
apilados leían como un aviso de peligro, no como un resumen.

## C-6 · Total del alquiler

Mismo tamaño que BASE IMPONIBLE, conservando el turquesa. Y sin «(IVA incl.)»:
está justo debajo de la base y el impuesto, la suma se ve sola.

## C-7 · Firma del arrendador

Fuera la casilla: VELTO MOBILITY firma con certificado digital. Ahora pone
**«Firmado digitalmente con certificado digital»** en los tres idiomas.

⚠️ **La nota no es la firma.** Queda un `TODO` en `signatureBlocks()`: falta
aplicar el certificado real al PDF generado.

## C-8 · Datos de empresa bajo las firmas

Eliminados: ya salen en el pie de **todas** las páginas, esa incluida.

## C-9 · Logo del sidebar

De 116×32 a **175×48 px**, llegando 59 px más a la derecha. Dimensionado desde
el ancho del sidebar con el `aspect-ratio` del propio SVG, con tope de altura
para no invadir el menú: si cambia el ancho del rail, el logo se ajusta solo.

---

## Datos de prueba creados

Todos ficticios, sobre producción, con autorización expresa:

| Entidad | Id | Detalle |
|---|---|---|
| Vehículo | `cEU8tAEr0zzuXno1F6vO` | Dacia Duster 7788MVT, ACRISS XFAD, 2 fotos |
| Cliente | `zu5splw25itByNbgysY0` | Ana Carolina Ruiz Mendoza (alta completa) |
| Cliente | (rápido) | Marius Ionescu Pavel (alta desde la reserva) |
| Reserva | `ZghEWQaRO6rEHfXbJvRI` | 4–11 sep 2026, 7 días, 350 € |
| Pago | — | Señal 50 € por Bizum |
| Contrato | `C-ZGHEWQ-2026` | PDF generado, timestamps correctos |

### Comprobaciones de negocio verificadas

- Matrícula y bastidor se guardan en mayúsculas aunque se escriban en minúsculas.
- ACRISS se recalcula solo: `XFAD` = Special / SUV / Automático / Diésel con A/A.
- Cálculo de días por bloques de 24 h: 4 sep 12:00 → 11 sep 12:00 = **7 días**.
- Tramo de tarifa correcto: 7 días entra en «4-7 días» → 50 €/día → 350 €.
- Los guards bloquean entrega y devolución mientras falta el contrato.

---

## Módulos verificados sin fallos

Dashboard · Calendario · Reservas · Vehículos · Clientes · Pagos · Contratos ·
Inspecciones · Informes — todos con **0 errores de consola** tras las
correcciones.

---

## Fuera del alcance de esta pasada

- **Gastos y Ajustes** siguen siendo *placeholders*, no hay nada que probar.
- **Inspecciones y mantenimiento** cargan sin errores, pero sus colecciones
  están vacías en producción: no se ha ejercitado ningún flujo real de creación.
  El índice compuesto que falta para `inspections` no se manifestará hasta que
  haya datos.
- **No se probaron flujos de escritura** (crear reserva, generar contrato,
  registrar cobro) para no ensuciar datos reales de producción.
- Los avisos de consola sobre `Cross-Origin-Opener-Policy` proceden del popup de
  Google Auth en el servidor de desarrollo y no afectan a producción.

---

## Verificación de la pasada móvil (26 ago 2026)

Sobre datos nuevos creados en producción durante la propia prueba.

| Comprobación | Resultado |
|---|---|
| Desbordamiento horizontal en las 11 rutas | `scrollWidth === clientWidth` en todas |
| Contraste en tema oscuro | 5,7 : 1 a 12 : 1 en los textos secundarios (antes ~3,3 : 1) |
| Errores de consola | 0 en todas las pantallas recorridas |
| M-14 — el cobro liquida el pendiente | ✅ la señal pasó a «Pagado» sobre la misma fila, sin duplicar |
| M-7 — formulario prerrellenado | ✅ abrió con 45 € en importe y pagado |
| Precio final editable | ✅ 60 € → 45 €, `manualAdjustment: -15` guardado |
| Tope de la señal al precio acordado | ✅ señal sembrada de 45 €, no de 50 € |

Reserva de prueba creada: `76846uDuZmLARW5M1fQC` (Dacia Duster · Marius
Ionescu Pavel · 26–27 ago 2026 · 60 € calculados, 45 € acordados).

---

# Revisión de la pantalla de reserva y del presupuesto — 27 de agosto de 2026 (noche)

Cambios pedidos por Dorel tras leer una reserva real y el PDF de presupuesto.

## C-2 · El ajuste manual se guardaba en POSITIVO

**Síntoma:** bajar el precio 10 € en el asistente y crear la reserva daba
«Ajuste manual: **+11,00 €**» en el detalle, y un total mayor que la tarifa.

**Causa:** el asistente enviaba a `createReservationWithClient()` el precio
**bruto** (`finalPrice`, con IVA) donde `resolveRentalPrice()` espera el **neto**.
El servicio comparaba 121 € contra una tarifa de 110 € —que es base imponible— y
registraba, correctamente para lo que le habían dado, un ajuste de **+11 €**.
El asistente enseñaba −10 € porque él sí trabajaba en neto: la cifra solo se
torcía al guardar.

No era un fallo de `pricing.util.ts` ni del cambio de IVA: era el paso del dato
entre la pantalla y el servicio, un sitio que ningún test cubre porque no hay
tests de componentes.

**Lo aplicado:**

- El asistente pasa `netPrice`. Una línea, con el porqué al lado.
- El parámetro del servicio se llama ahora `agreedNetPrice` y su doc dice en
  mayúsculas que viaja NETO. Nombrarlo `finalPriceOverride` era media invitación
  a pasarle el `finalPrice` que tenía la pantalla al lado.
- El detalle imprime el ajuste con dos decimales y su signo, en verde cuando es
  un descuento. Antes componía el signo a mano y sin decimales.

**Verificado en producción** (reserva creada y cancelada después): tarifa 110 €,
precio acordado 100 € → ajuste **−10,00 €**, base 100,00 €, IVA 21,00 €,
total **121,00 €**.

⚠️ Las reservas creadas con el fallo conservan su snapshot torcido —es histórico
congelado, no se toca—. La de 146,41 € del listado es una de ellas.

## C-3 · Reordenación de la pantalla de reserva

El orden era vehículo → cliente → fechas → **precio → importes** → contrato →
notas → entrega → contrato (otra vez) → resumen de pagos. El dinero cortaba el
relato del alquiler por la mitad y «contrato» aparecía dos veces.

Orden nuevo, de arriba abajo:

```
vehículo · cliente · recogida → justificante → contrato → entrega y devolución
→ importes pendientes → precio total → resumen de pagos → notas internas
```

- **Los dos bloques de contrato son uno.** El de arriba solo mostraba el estado;
  ahora ese estado es el badge de la cabecera del bloque de acciones. Cuando
  todavía no hay documento de contrato se muestra el `contractStatus` de la
  reserva, que es lo único que hay.
- Las clases de color del badge (`status-info`, `status-success`, …) **no
  estaban declaradas** en el SCSS de esta pantalla: el badge salía sin fondo.
  Mismo modo de fallo que las variables semánticas que faltaban.
- Las notas internas quedan las últimas: no son ni el alquiler ni el dinero.

## C-4 · El presupuesto y el justificante, a la escala del contrato

El contrato se condensó el 27 por la tarde; los dos documentos cortos se
quedaron con los valores por defecto del constructor y no se parecían a él.

| | Antes | Ahora |
|---|---|---|
| Título | 24 pt (contrato es: 12,5 · en: 18 · ro: 17) | **12,5 pt en los tres documentos y los tres idiomas** |
| Cuerpo | 8,2 pt / interlínea 1,6 | 7,8 pt / 1,45 |
| Etiqueta de sección | 9,5 pt | 8,6 pt, con más aire **antes** |
| Totales | 8,8 pt (más grandes que las filas de arriba) | 8,2 pt |
| Pie legal del documento | 8,5–9 pt | 7,4 pt |

Jerarquía resultante: título 12,5 > sección 8,6 > totales 8,2 > cuerpo 7,8 >
nota 7,4. **El contrato conserva sus métricas**: los tamaños nuevos se pasan
como opciones desde `documents-pdf.ts`, sin mover los valores por defecto del
constructor, para no reflujar ocho páginas de texto legal.

### El recorte fantasma: «Lugar de entre…»

`twoColumnWrap()` calculaba el ancho del valor a partir del ancho de la
etiqueta, y después recalculaba el hueco de la etiqueta a partir de ese ancho.
En coma flotante el resultado caía **una millonésima por debajo** de su propio
ancho medido, así que la etiqueta se recortaba con puntos suspensivos en una
línea que le sobraba sitio. En un PDF no hay tooltip que revele el resto.

Ahora solo se recorta cuando de verdad no cabe. Comprobado en los **tres
documentos × tres idiomas**: **ninguna cadena termina en «…»**.

### El justificante ya no se va a dos páginas

Con cuatro pasos pendientes, el bloque «ARRENDADOR» no cabía y se llevaba a una
segunda página el nombre, el teléfono, el email y la web de la empresa — los
mismos cuatro datos que ya están en la cabecera de la página 1 y en el pie de
**todas** las páginas. Se ha sustituido por la línea que sí faltaba: «¿Dudas?
Responde a este mensaje o llámanos». El justificante cabe en una página.

Se añadió `keepTogether()` al constructor para lo que quedaba: un salto de
página dejaba el rótulo de una sección solo al pie con su contenido detrás.

**Verificación:** i18n OK · `tsc` app y functions OK · build OK ·
98 tests de app + 61 de functions en verde · los tres PDF mirados en un visor
real (no solo medidos).

---

## Verificación tras desplegar las Cloud Functions — 27 ago 2026, 23:30

Functions desplegadas por Dorel. **Hosting sigue sin desplegar**, así que todo
esto se ejercitó desde `localhost:4200` contra las functions reales.

| Comprobación | Resultado |
|---|---|
| Presupuesto **es** por la function desplegada | ✅ formato nuevo, 280,00 + 58,80 = **338,80 €** |
| Presupuesto **en** | ✅ «RENTAL QUOTE», 350,00 + 73,50 = 423,50 € |
| Presupuesto **ro** | ✅ «OFERTĂ DE ÎNCHIRIERE»; `ă ș ț` y `€` correctos, sin cajas vacías |
| Título al mismo tamaño en los tres | ✅ 12,5 pt, como el contrato |
| «Lugar de entrega / devolución» | ✅ enteros, sin puntos suspensivos |
| Enlace corto `/d/q…` por hosting | ✅ sirve el PDF (el rewrite sigue vivo) |
| **Reserva anterior al cambio de IVA** | ✅ ver abajo |

### La reserva antigua sigue cuadrando

Contrato regenerado para `76846uDuZmLARW5M1fQC` (creada el 26 ago, **sin**
`tariffIncludesVat` en su snapshot):

```
Importe alquiler (tarifa):        60,00 €
Ajuste acordado:                 -15,00 €
BASE IMPONIBLE                    37,19 €
IVA (21 %)                         7,81 €
TOTAL ALQUILER                    45,00 €
FIANZA (NO SUJETA A IVA)         150,00 €
```

Los mismos números que antes del cambio y que los que enseña la app. Si la
hubiera leído como neta habría impreso 45,00 + 9,45 = 54,45 €. **La dirección
congelada funciona en producción**, que era el riesgo real del giro del IVA.

El «Ajuste acordado» también sale en negativo en el PDF.

### Encontrado de paso

**M-9 ya se ve en un documento del cliente.** `capitalizeWords()` no trata los
guiones, así que el lugar de entrega salió impreso como «Aeropuerto Adolfo
Suárez Madrid-**b**arajas, Terminal 4» en el presupuesto en inglés. Antes era un
detalle de un formulario; ahora está en un PDF que se le manda al cliente.

---

# Limpieza de compatibilidad y backlog alto — 28 de agosto de 2026

Dorel va a **borrar todos los datos de producción** y empezar de cero, así que
lo primero fue quitar lo que existía solo para leer los datos viejos.

## C-5 · Fuera la dirección congelada del IVA

`pricingSnapshot.tariffIncludesVat` existía por una única razón: las reservas
anteriores al 27 de agosto se guardaron con la tarifa **con IVA incluido** y
tenían que seguir leyéndose así. Con la base vacía ya no hay ninguna, y el
documento funcional dice explícitamente que no se mantiene compatibilidad
mientras las colecciones se vayan a borrar.

Retirado de los dos lados —app y functions— junto con `extractVat()`, que solo
servía a esa rama. `vatBreakdownOf()` es ahora una línea: **neto + IVA, siempre**,
partiendo de `netPrice` y nunca del total.

⚠️ **Consecuencia, y por eso hay que borrar antes de usar:** una reserva creada
antes de hoy se leería ahora como neta. La de 45,00 € pasaría a mostrar
45,00 + 9,45 = 54,45 €. Los datos y el código ya no son compatibles en ese
sentido, que es exactamente lo que se pidió.

De paso se corrigió un comentario del contrato que seguía diciendo «el precio ya
incluye IVA, la base se EXTRAE» — falso desde el 27 y justo el tipo de nota que
manda a alguien en la dirección contraria.

## C-6 · M-1 · Un cliente bloqueado ya bloquea

`canCreateReservationForClient()` y `clientTrustWarning()` en el workflow util,
que sigue siendo la única autoridad. `blocked` deniega; `risk` avisa y deja
seguir. Las dos capas de siempre: el asistente deshabilita «Crear reserva» y
explica por qué, y `createReservationWithClient()` lanza aunque le llamen desde
otro sitio.

**No hay excepción de workflow para esto.** Saltarse un paso es un atajo
operativo; alquilar a alguien a quien has bloqueado es una decisión sobre ese
cliente, y se toma en su ficha cambiándole el nivel — que queda registrado.

Probado en vivo: cliente marcado `blocked`, aviso rojo bajo el resumen y botón
deshabilitado (`disabled`, cursor `not-allowed`).

## C-7 · M-15 · «Total pagado» ya no cuenta la fianza

El resumen derivado (`calculateReservationPaymentSummary`) siempre lo calculó
bien; quien sumaba mal era el **detalle de la reserva**, que recorría todos los
pagos y sumaba cada `paidAmount`: alquiler + fianza + extras + retención + **la
devolución**. 693 € sobre un alquiler de 350 €.

`collectedTotalsOf()` separa ingresos de movimientos de fianza. La retención
**no** cuenta como ingreso: es cómo se pagaron los cargos extra, y contar los dos
facturaría el mismo daño dos veces.

Verificado en producción: fianza de 150 € cobrada, señal de 50 € →
**«Cobrado (sin fianza): 50,00 €»**. Antes habría puesto 200 €.

## C-8 · Un céntimo que no era un céntimo

Al mirar el asistente apareció «Resto pendiente: **58.900000000000006 €**».
`108.9 − 50` en coma flotante binaria. No era solo la pantalla: ese número se
escribía en Firestore y se sembraba como fila de pago, así que el operador tenía
que cobrar 58,900000000000006 € para dejarla a cero.

`roundMoney()` en los dos sitios, y los importes del asistente pasan ya por el
pipe de número.

## C-9 · M-3 + M-12 · Los índices de Firestore no servían para nada

Buscando dónde añadir el índice que faltaba de `inspections` apareció algo peor:
los cinco declarados usan `"arrayConfig": "CONTAINS"` en `clientId`, `vehicleId`
y `status`. Ése es el índice de `array-contains`, y las consultas de la app
filtran por **igualdad**. Ninguno de los cinco servía a ninguna consulta; lo que
funcionaba en producción eran índices creados a mano desde el enlace del error de
la consola, que nunca llegaron al repo. Eso explica los «4 índices que no están
en el repo» de M-12.

Reescrito con los ocho que las consultas piden de verdad, con `order`:

| Colección | Índice |
|---|---|
| `reservations` | `clientId + pickupDateTime desc` · `vehicleId + pickupDateTime desc` |
| `payments` | `reservationId + createdAt asc` · `clientId + createdAt desc` · `vehicleId + createdAt desc` |
| `inspections` | `reservationId + createdAt asc` |
| `vehicleMaintenance` | `vehicleId + nextDueDate desc` · `status + nextDueDate asc` |

⚠️ **Hay que desplegarlos**: `firebase deploy --only firestore:indexes`. Sin eso,
la primera inspección real seguiría fallando.

## C-10 · M-9 · «Madrid-barajas», ya no

`capitalizeWords()` estaba duplicada en dos componentes y partía solo por
espacios. Ahora es `shared/utils/text-case.util.ts` y respeta guiones, barras y
apóstrofos. Comprobado escribiendo en el asistente: «aeropuerto madrid-barajas
t4» → «Aeropuerto Madrid-Barajas T4».

También se ha borrado el CSS `.status-quote` de los cuatro componentes: era el
estado que N-1 decidió que no iba a existir.

**Verificación:** i18n OK (el auditor cazó de paso una clave que quedó huérfana)
· `tsc` app y functions OK · build OK · **114 tests de app + 61 de functions**.

---

# Alta de datos y flujo completo sobre base vacía — 28 de agosto de 2026

Firestore borrado entero (salvo `authorizedUsers`) y funciones ya desplegadas.
Se crearon **2 vehículos y 2 clientes desde cero** y se recorrió el ciclo
completo. Lo que sigue son los fallos que aparecieron por el camino.

## Índices: ninguno falla

Recorridas las nueve rutas con datos reales —dashboard, calendario, reservas,
vehículos, clientes, pagos, contratos, inspecciones e informes— y **cero errores
de índice**. La consulta de `inspections` (`reservationId ==` + `orderBy`), que
era la que nunca se había ejercitado, funcionó al completar la entrega real.

⚠️ Los índices declarados en el repo **siguen sin desplegarse**; lo que responde
en producción son los creados a mano. Desplegarlos igualmente
(`firebase deploy --only firestore:indexes`): el fichero ya declara los ocho que
las consultas piden, y hoy el repo y producción no coinciden.

## C-11 · El cursor saltaba al final en todos los campos que se reescriben

Escribir «1234abc» en la matrícula, volver al carácter 3 y corregir dejaba el
texto bien —`12X34ABC`— pero el **cursor al final**, así que la siguiente tecla
caía en otro sitio. Pasaba en marca, modelo, versión, color, matrícula y
bastidor del vehículo; nombre, documento y carnet del cliente; y el nombre del
cliente rápido del asistente. En el móvil, donde se toca para colocar el cursor,
esos campos parecían rotos.

La causa es la misma en los nueve sitios: asignar `input.value` mueve el cursor
al final. `transformInput()` en `text-case.util.ts` calcula la posición nueva
transformando el texto **anterior al cursor** y midiéndolo, así que también
funciona cuando la transformación borra caracteres (los espacios del bastidor).
Comprobado en el navegador: cursor en 3, donde debe estar.

## C-12 · «dCi» se convertía en «Dci»

`capitalizeWords` pasaba a minúscula el resto de cada palabra, y las versiones
de coche están llenas de mayúsculas intencionadas: `dCi`, `TCe`, `BlueHDi`.
Ahora una palabra que **ya mezcla mayúsculas y minúsculas se respeta tal cual**;
las que van todas en mayúsculas se siguen domando («MEGANE» → «Megane»).

## C-13 · La subida de fotos y la de documentos, unificadas

Eran dos cosas distintas para la misma tarea: el coche tenía una caja de puntos
con «Hacer foto / Subir desde galería» y el cliente una rejilla de botones por
tipo de documento. Ahora ambas usan **el mismo control**
(`app-photo-upload-buttons`), con la misma etiqueta, el mismo borde y el mismo
spinner mientras sube.

De hacerlo salieron tres fallos:

- ⚠️ **Los documentos de cliente llevaban `capture="environment"`**, que en el
  móvil **fuerza la cámara**: un DNI ya fotografiado y guardado en la galería no
  se podía subir. Atributo eliminado; el selector del sistema ofrece cámara y
  galería, que es su trabajo.
- **Las fotos de coche subían solo la primera.** `onImageSelected` cogía
  `files[0]` y descartaba el resto en silencio. Ahora sube todas, una tras otra
  (parte de M-5).
- Los errores de subida salían por `alert()` y en español duro; ahora se
  muestran en el formulario y con clave i18n, como ya hacía el cliente.

Las miniaturas pasan de cuadradas a **4:3**, que es la forma en la que se
fotografía un coche — el recorte cuadrado se comía el morro (M-6).

## C-14 · La reserva no pasaba nunca a «Confirmada»

Cobrada la señal entera, la reserva se quedaba en `reserved`. El paso 2 del flujo
canónico —«cobrar señal → confirmed»— **no estaba implementado**: el servicio de
pagos recalculaba `paymentStatus` y no tocaba `reservationStatus`.

Consecuencia: el estado `confirmed` era inalcanzable y **el justificante de
reserva no se podía emitir jamás**, porque exige `confirmed`. Es decir, N-2 no
funcionaba en ningún caso, y no se había detectado porque las reservas de prueba
anteriores venían de datos sembrados a mano.

`reservationStatusAfterPayment()` en el workflow util, con 3 tests: solo mueve
`reserved` hacia delante, nunca al revés.

## C-15 · Una clave que falte en un mapa `*_LABELS` tumbaba la lista entera

Con un vehículo cuya `category` no estaba en `VEHICLE_CATEGORY_LABELS`, el mapa
devolvía `undefined`, `translate()` llamaba a `.split()` sobre él y el listado de
flota **no renderizaba nada**. Un dato malo, una pantalla en blanco.

`translate()` acepta ahora `null`/`undefined` y devuelve cadena vacía. La regla
de oro de los mapas de etiquetas no cambia; lo que cambia es que incumplirla ya
no se lleva la pantalla por delante.

## C-16 · Los números salían en formato inglés

«9,200 km» —que en español se lee nueve coma dos— y «423.50 €». Angular formatea
en `en-US` salvo que se le diga otra cosa. Registrado el locale `es` y
`LOCALE_ID`: ahora **9.200 km** y **423,50 €**, como ya hacían los PDF.

⚠️ `LOCALE_ID` se fija al arrancar, así que **no sigue al selector de idioma**.
Español y rumano comparten convención; en inglés se verán números españoles.

## El ciclo completo, sobre datos nuevos

| Paso | Resultado |
|---|---|
| Alta de 2 vehículos | ✅ ACRISS automático (EDAD, SFMV), tarifas por defecto |
| Alta de 2 clientes | ✅ «María José Pérez-Gómez», «Andrei O'Neill Popescu» |
| Subida de foto de coche y de 2 documentos de cliente | ✅ |
| Presupuesto (7 días, Duster) | ✅ 350,00 + 73,50 = **423,50 €**, enlace corto sirve el PDF |
| Crear reserva | ✅ señal 50 €, resto 373,50 €, fianza 150 € |
| Cobrar señal | ✅ pasa a **Confirmada** (tras C-14) |
| Justificante de reserva | ✅ una página, con la fianza ya cobrada fuera de la lista de pendientes |
| Generar contrato | ✅ |
| Link de firma + firma del cliente | ✅ sin sesión, «Contrato firmado» |
| Cobrar resto | ✅ 423,50 € cobrados |
| Entrega (inspección de recogida) | ✅ reserva **Entregada**, km 9.200 |
| Errores de consola en todo el recorrido | **0** |

---

# Separación de entornos y traslado a Europa — 28 de agosto de 2026 (noche)

`velto-store` pasa a ser **desarrollo** y nace `rentalcar-veltomobility` como
**producción**. Una sola base de código; lo único que cambia es qué fichero de
entorno se compila y a qué proyecto apunta el CLI.

## C-17 · Las configuraciones de entorno estaban invertidas

`angular.json` tenía, dentro de la configuración `production`:

```json
{ "replace": "environment.ts", "with": "environment.development.ts" }
```

La build de producción compilaba el fichero de desarrollo. Y `environment.ts`
declaraba `production: true` mientras que el de desarrollo decía `false`, así
que `ng serve` servía el marcado como producción. Con un solo proyecto de
Firebase no se notaba nada. Con dos, **un push a `master` habría publicado la
web de producción hablando con la base de datos de desarrollo**.

Ahora hay dos configuraciones **las dos optimizadas** —`dev` y `production`—
que se diferencian solo en el proyecto al que apuntan. Verificado sobre el
bundle, no sobre el código:

```
build:prod → rentalcar-veltomobility
build      → velto-store
```

## C-18 · `firebase init hosting:github` reescribió el workflow de producción

Al generar la cuenta de servicio, el CLI sobrescribió
`firebase-hosting-merge.yml` sin avisar. Se llevó el `setup-node`, los tests de
app y de functions, y dejó:

```yaml
- run: npm ci && npm run build        # compila contra DESARROLLO
  projectId: rentalcar-veltomobility  # y lo publica en PRODUCCIÓN
```

El mismo cruce de C-17, reintroducido por la herramienta. Se detectó porque el
contenido del fichero no era el escrito. La copia de seguridad que se hizo
"por si acaso" **ya estaba dañada**: se tomó después de que el CLI pasara.

Reescrito, y con el aviso dentro del propio fichero para la próxima vez.

## C-19 · El Storage de desarrollo estaba en Estados Unidos

Al comparar entornos apareció que el bucket de `velto-store` se creó en junio en
`us-east1`, con el valor por defecto. Ahí habían estado los contratos de prueba,
los DNI y las fotos. Producción se creó en `eu` desde el principio.

La ubicación de un bucket no se puede cambiar: hay que borrarlo y recrearlo.
Dorel vació desarrollo entero —Firestore, Storage y el bucket— y se rehizo en
`eu`. Con la base se fueron también las reglas y los 8 índices, que son
configuración de la base y no del proyecto; redesplegados.

## C-20 · Las functions corrían lejos de sus datos

Firestore en `eur3` (Europa) y las once functions en `us-central1` (Iowa): cada
generación de PDF leía la reserva y escribía el documento cruzando el Atlántico,
y los datos personales de los contratos se procesaban fuera de la UE aunque se
guardaran dentro. Nadie lo hizo mal: `us-central1` es el defecto cuando el
código no dice nada, y el código no decía nada.

Movidas las de **los dos entornos** a `europe-west1`, que está dentro de `eur3`.
Tres sitios, y hacen falta los tres:

| Dónde | Qué |
|---|---|
| `functions/src/global-options.ts` | `setGlobalOptions({ region })` — dónde se despliegan |
| `src/app/app.config.ts` | `getFunctions(getApp(), 'europe-west1')` — dónde las busca el cliente |
| `firebase.json` | la región del rewrite `/d/**` |

⚠️ **La trampa del orden.** `setGlobalOptions` solo afecta a lo declarado
después de llamarlo, y los `export ... from` de `index.ts` evalúan sus módulos
antes que cualquier sentencia de ese fichero. Puesto como una línea al principio
de `index.ts` habría llegado tarde y las functions se habrían desplegado en la
región por defecto sin decir nada. Vive en su propio módulo, importado el
primero.

⚠️ **El rewrite viaja con el hosting, no con las functions.** Tras mover la
región, el enlace corto de un presupuesto real dio **404**; después de
redesplegar hosting, **`200 application/pdf`**. Es el fallo silencioso del que
avisa `CLAUDE.md`, esta vez provocado a propósito para comprobarlo.

## Verificación de extremo a extremo

Sobre desarrollo recién vaciado, con datos nuevos:

| | |
|---|---|
| Alta de vehículo y cliente | ✅ |
| Presupuesto | ✅ 350,00 + 73,50 = **423,50 €** |
| Endpoint al que llamó el SDK | `europe-west1-velto-store.cloudfunctions.net/generateQuotePdf` |
| Enlace corto tras redesplegar hosting | ✅ `200 application/pdf` |
| Errores de consola | 0 |

Y en producción: CI de `master` funcionando (publicó a las 22:15, después del
despliegue manual de las 21:26), las 11 functions en `europe-west1`, los 8
índices, reglas de Firestore y Storage desplegadas.

**Estado final: los dos entornos idénticos** — Firestore `eur3`, Storage `eu`
multirregión, functions `europe-west1` — y cada uno hablando solo con su propia
base de datos, comprobado leyendo los bundles servidos.

---

# El login obligaba a refrescar — 29 de agosto de 2026

## C-21 · La caché del estado de autorización servía una respuesta caducada

**Síntoma:** entras con Google, la ventana de Google se cierra, y la pantalla de
login se queda ahí. Hay que refrescar el navegador para entrar.

**Causa.** `authorizedState$` llevaba `shareReplay({ bufferSize: 1 })` para no
releer `authorizedUsers` en cada navegación. El orden lo estropea:

1. Al abrir `/login`, el `publicGuard` se suscribe. No hay sesión → emite
   `false`, y el buffer **se lo queda**.
2. El operador entra. `loginWithGoogle()` comprueba la autorización, sale bien y
   navega a `/dashboard`.
3. El `authGuard` se suscribe y el buffer le sirve **el `false` de antes**, antes
   de que la relectura del nuevo usuario termine. Con `take(1)`, esa es la
   respuesta definitiva → de vuelta a `/login`.
4. Al refrescar, el buffer nace vacío y la sesión ya está restaurada: entra. De
   ahí que «refrescando sí funciona».

Es una carrera, así que fallaba casi siempre pero no siempre — lo peor para
diagnosticarlo desde fuera.

**Lo aplicado.** Fuera el `shareReplay`: cada suscripción parte del usuario
**actual**, que es lo único correcto justo cuando el usuario acaba de cambiar. El
ahorro de lecturas se conserva con una caché **por email** dentro de
`checkAuthorization()`, que es la diferencia que importa: la clave es el usuario,
así que uno nuevo no puede recibir la respuesta del anterior. Se guarda la
promesa —dos guards simultáneos comparten una sola lectura— y un fallo de red no
se cachea. Se vacía al cerrar sesión.

**Verificado en el navegador:** login → `/dashboard` directo, sidebar y
contenido cargados, sin refrescar.

## Logo de marca más grande

En el carril lateral y en la tarjeta de login el logo se dimensionaba por
**alto**, y el ancho sobraba: 174×48 px en un carril de 260, y 160 px de ancho
en una tarjeta con 316 útiles. Ahora manda el ancho —con `aspect-ratio` del
propio fichero, que es lo que impide deformarlo— y queda un margen pequeño a
cada lado: **240×66** en el carril y **92%** del ancho útil en el login.

## C-22 · Ciclo completo con contrato firmado y email — 29 de agosto de 2026

Primer recorrido de extremo a extremo sobre la base **vacía** de `velto-store`,
después de separar los dos entornos. Objetivo real: comprobar que
`sendSignedContractEmail` envía, que era lo que arreglaba M-22.

**Lo recorrido**, en orden, sin saltarse ningún paso del workflow:

| Paso | Resultado |
|---|---|
| Vehículo desde cero | Renault Clio 1234KDB · ACRISS `EDMN` |
| Cliente desde cero | Dorel Bindea · `dbindea@gmail.com` |
| Presupuesto (sin crear reserva) | PDF en Storage + enlace corto |
| Reserva | 4 días · 200 € base + 42 € IVA = **242 €** |
| Cobro de la señal | 50 € · estado → **Confirmado** |
| Contrato PDF | `C-TUKT8S-2026` |
| Link de firma | ruta pública, sin login |
| Firma del cliente | firmado a las 11:18:57 |
| **Email del contrato firmado** | **enviado a las 11:20:03** |

**Lo que confirma cada cosa.**

`emailedAt: 2026-08-29T11:20:03.933Z` en el documento del contrato es la prueba
del envío, no un mensaje de la UI: ese campo se escribe **después** de que la
API de Resend responda `ok`, así que no puede existir si el envío falló.

El enlace corto del presupuesto respondió `200 application/pdf` (1,2 MB) tanto
por el dominio propio como por Storage, lo que confirma que el rewrite `/d/**`
sobrevivió al cambio de región.

El estado pasó a `confirmed` al cobrar la señal, y la fila sembrada quedó
liquidada en vez de duplicarse — M-14 y `reservationStatusAfterPayment` siguen
en pie sobre datos nuevos.

**Transformaciones de texto, verificadas campo a campo.** Escribiendo todo en
minúsculas: `renault` → `Renault`, `1234 kdb` → `1234KDB` (mayúsculas y sin
espacio), `x1234567l` → `X1234567L`, y `1.5 dCi Zen` **conserva el `dCi`**.

**Dos fallos encontrados**, ninguno bloqueante, los dos anotados:

- **M-24** · «oficina arganda del rey» sale «Oficina Arganda **Del** Rey». El
  capitalizado no respeta las preposiciones, y esto **se imprime en el contrato**.
- **M-25** · La dirección del cliente es el único campo de texto que no recibe
  ninguna transformación, aunque también va impresa en el contrato.

**Sin probar en producción**: el ciclo se hizo entero contra `velto-store`.

## C-23 · Ciclo completo en PRODUCCIÓN — 31 de agosto de 2026

Primer alquiler recorrido de principio a fin en `rentalcar-veltomobility`, sobre
el dominio propio y con la base vacía. Lo que se quería saber no era si la app
funciona —eso ya estaba probado en desarrollo— sino si funcionan **las tres
cosas que solo existen en producción**: el dominio, el correo nuevo y su
verificación en Resend.

| Paso | Resultado |
|---|---|
| Login con Google | entra al dashboard **sin refrescar** (confirma C-21 en producción) |
| Vehículo | Seat Leon · 5678MJK |
| Cliente | Dorel Bindea · dbindea@gmail.com |
| Presupuesto | `https://rentalcar.veltomobility.com/d/q6aa902610b3249f1` → `200 application/pdf` |
| Reserva | 3 días · estado `confirmed` tras la señal |
| Contrato | `C-1342VA-2026` |
| Link de firma | **absoluto y con el dominio propio** |
| Firma del cliente | 14:26 |
| **Email** | **enviado 12:26:58 UTC a dbindea@gmail.com** |

**Lo que confirma cada cosa.**

El email devolvió `200`, no `403`. Ese era el riesgo real: Resend solo acepta
remitentes de dominio verificado, así que un `200` prueba que
`veltomobility.com` está verificado y que `reservas@veltomobility.com` puede
enviar. `emailedAt` quedó escrito, y solo se escribe si Resend responde `ok`.

El enlace de firma salió **absoluto**. Antes salía relativo, porque
`VELTO_PUBLIC_BASE_URL` nunca llegaba al runtime (M-4).

En el PDF firmado de producción, la separación marca / razón social es la
correcta:

```
cabecera:  VELTO MOBILITY · NIF B88866900 · … · reservas@veltomobility.com
firmas:    x=50  Arrendador (Sociedad)      x=313  Arrendatario
           x=50  VELTO MOBILITY, S.L.       x=313  Dorel Bindea
           x=50  NIF/CIF B88866900          x=313  Firmado el 31/08/2026, 14:26 por Dorel Bindea
```

Marca arriba, razón social solo junto al NIF, y la constancia de firma en la
columna del arrendatario (M-26 y M-27, verificados ya en producción).

**Un fallo menor encontrado**, anotado como M-29: la respuesta de
`sendSignedContractEmail` devuelve `contractId: null`.

**Avisos de consola en el login**: los cuatro de `Cross-Origin-Opener-Policy`,
ya conocidos como M-13. No impiden el login.

## C-24 · La otra mitad del ciclo: entrega, devolución, daños y cierre — 31 de agosto de 2026

Recorrido de lo que **nunca se había ejecutado**. El motivo de hacerlo era el
patrón de esta semana: el email, Redsys y la sincronización del webhook estaban
escritos, desplegados y rotos, y nadie lo sabía porque nadie los había usado.

Sobre la reserva `ZRlBfmb4JWR4cO9QgDio` de `velto-store`, ya confirmada y con
contrato firmado.

| Paso | Resultado |
|---|---|
| Cobro del resto y de la fianza | correcto; al elegir tipo autocompleta el importe |
| Inspección de **entrega** | checklist de 8 puntos, km, combustible, limpieza |
| **Subida de foto** en la inspección | sube a `inspections/` en Storage y se muestra |
| Estado tras entregar | **Entregado** |
| Inspección de **devolución** | km, combustible, limpieza, llaves, accesorios |
| **Registro de daños** | zona TRASERA, gravedad Leve, descripción — registrado |
| Cargos extra | 62,50 km + 30 limpieza + 80 daños = **172,50 €** |
| Retención de fianza | automática, 150,00 € |
| Estado final | **Cerrado** |

**Lo que funciona y queda probado:** la subida de fotos dentro de una inspección
y el registro de daños en la devolución, los dos pendientes desde agosto. Los
cargos extra se convierten en filas de pago con su tipo (`extra_km`,
`extra_cleaning`, `extra_damage`) y la retención de fianza se crea sola.

**Tres fallos encontrados**, todos anotados:

- **M-33** · Los cargos extra nacen `paid` sin que nadie los haya cobrado. Con
  172,50 € de cargos y 150 € de fianza, **los 22,50 € de diferencia se dan por
  cobrados** y desaparecen. Es dinero y es silencioso.
- **M-34** · El cargo por km extra no se calcula, aunque la app tiene los km de
  salida, los de entrada, los incluidos por día y el precio del km extra.
- **M-35** · «Registrar cobro» abre siempre en «Señal» con importe 0, aun con la
  señal ya cobrada.

**Un detalle de método, para el que venga detrás:** en los campos de cargos, fijar
`value` por JavaScript deja el input `ng-dirty` con el valor correcto pero **no
dispara el recálculo del total**. Con escritura real sí. No es un fallo de la
app; es que la comprobación automatizada puede mentir si se hace así.

## C-25 · M-33, y los tres agujeros que aparecieron al taparlo — 31 de agosto de 2026

El fallo de partida era que los cargos de la devolución se creaban marcados como
pagados. Al dejar de mentir sobre eso, quedaron a la vista otros tres por los que
el dinero se escapaba igual. Ninguno se habría visto sin ejecutar el flujo.

| # | Dónde | Qué pasaba |
|---|---|---|
| 1 | `createExtraChargePayments` | `paidAmount = amount` con el comentario `// assumed already paid` |
| 2 | Retención de fianza | no liquidaba los cargos: iba por su cuenta |
| 3 | `cancelUncollectedPayments` | **cancelaba los cargos pendientes al cerrar** |
| 4 | `calculateReservationPaymentSummary` | `paymentStatus` ignoraba los cargos → **PAGADO** debiendo |

El tercero es el que más enseña: tapar el primero sin tapar ese solo habría
cambiado la etiqueta con la que se perdía el dinero, de «pagado» a «cancelado».

**Cómo quedó.** Los cargos nacen `pending`. La retención los liquida de mayor a
menor hasta donde alcance —`distributeRetentionAcrossCharges`, util puro con
5 tests, incluido el caso de los 22,50 € que faltaban y el de la fianza a 0—.
Lo que no cubre queda pendiente, sale con su importe y se cobra con el botón de
tarjeta que se añadió con Redsys.

**Verificado en el caso peor**, que es el que el negocio usa a diario: reserva
con **fianza a 0** (cliente conocido, con su motivo obligatorio) y 160 € de
cargos.

```
antes:  ambos cargos «Pagado» · reserva PAGADO · 160 € evaporados
ahora:  ambos «Pendiente» con botón de cobro · reserva PARCIAL
        y siguen ahí después de cerrar la reserva
```

De paso quedan probados dos pendientes más: **fianza a 0** —no siembra fila, la
marca «Exenta» y exige motivo— y el **cierre** de una reserva con deuda viva.

**Sobre el método.** Este arreglo no se podía validar con tests solos: los tres
agujeros nuevos estaban en sitios distintos del código y solo se tocan entre sí
al recorrer el flujo entero. Los tests fijan la aritmética; el recorrido es lo
que encontró el problema.

## C-26 · Cancelación, mantenimiento y excepciones — 31 de agosto de 2026

Lo que quedaba del ciclo sin ejecutar. Tres fallos y un hallazgo distinto.

**Cancelación de una reserva.** El botón salía **deshabilitado y sin explicar
por qué** en cuanto se cobraba la señal. La causa: dos reglas contradictorias en
el mismo componente —`canCancel()` copiada a mano (solo `reserved`) y
`canCancelReservation()` delegando en el workflow (`reserved` y `confirmed`)—.
El template preguntaba a una y pedía el motivo a la otra, que no tenía nada que
objetar: de ahí el `title` vacío. Retirada la copia (M-36).

Una vez cancelada, los pagos aparecían como **`cancelled` en inglés**: el getter
usaba el mapa de estados *de la reserva* para pintar el estado *de un pago*
(M-37). La traducción existía desde siempre.

Comprobado en Firestore que la cancelación hace lo correcto: la señal cobrada se
conserva `paid` —el dinero entró— y el resto y la fianza pasan a `cancelled`.

**Mantenimiento de vehículos.** Primera alta de la colección
`vehicleMaintenance`, que llevaba vacía desde el principio: tipo, estado,
prioridad, descripción, fecha, km, coste, proveedor y próxima revisión. Se
guarda y se lista bajo «Realizados».

El formulario pintaba **`maintenance.type.oil_change` en crudo** sobre el
desplegable (M-38): la etiqueta se construía con el valor seleccionado en vez de
con el nombre del campo, y además las claves están en camelCase mientras el
valor llega en snake_case, así que no habría resuelto ni con la clave correcta.

Los kilómetros se guardan como **texto** y `cost` como número (M-39).

**Excepciones de workflow: no están implementadas.** Y esto no es un fallo, es
otra cosa. `buildWorkflowException()` existe, está cubierta por tests, el modelo
tiene `workflowExceptions[]` y el workflow las respeta… pero **no hay una sola
llamada desde la UI ni desde los servicios**. La pieza está construida y no
conectada, así que no hay manera de crear una excepción.

Consecuencia concreta: si un cliente firma en papel, la entrega queda bloqueada
sin salida. Anotado como **N-7**, con las decisiones que hay que tomar antes.

**El patrón, otra vez.** Cinco de los seis hallazgos de hoy son de la misma
familia que el email o Redsys: código escrito, desplegado y nunca ejecutado.
Ninguno lo habría encontrado un test.

## C-27 · Tanda de arreglos pequeños — 1 de septiembre de 2026

Ocho puntos del backlog que no necesitaban decisión. Ninguno era grave por
separado; juntos son la diferencia entre una pantalla que ayuda y una que
estorba.

| | Qué pasaba | Cómo queda |
|---|---|---|
| **M-35** | «Registrar cobro» abría siempre en Señal y a 0 € | Abre en el primer concepto pendiente, con su importe |
| **M-18** | «Reservado (confirmed)» — enum en inglés y español duro | «Ya hay una reserva para estas fechas», traducible |
| **M-16** | Siete `alert()` en español duro | Los siete a `reservations.errors.*` |
| **M-19** | El paso «Resumen» nacía con el check verde | Nunca completo: lo completa crear la reserva |
| **M-29** | `contractId: null` en la respuesta del email | `snap.id`: `snap.data()` no trae el id |
| **M-39** | Kilómetros de mantenimiento como texto | Números, con `null` para el campo vacío |
| **M-2** | Una clave sin traducir se pintaba en crudo | Respaldo al español antes de rendirse |
| **M-8** | «El contrato no lleva logo» | **Ya estaba resuelto**; el documento iba retrasado |

**Lo que se encontró de más.** M-16 hablaba de dos `alert()` y había **siete**.
M-18 apuntaba a un sitio y el texto real venía de **otro**: el que edité primero
era el de `checkVehicleAvailability`, pero el que ve el operador en el paso 2 lo
compone `searchAvailability`. Solo se descubrió porque, tras el arreglo, la
pantalla seguía diciendo «Reservado (confirmed)».

Al lado de ese apareció un tercero: `'VehÃ­culo no disponible en flota'`, con la
tilde rota por un guardado en la codificación equivocada. Se leía así en
pantalla. También pasó a clave i18n.

**M-2, con matiz.** El respaldo al español no debería activarse nunca —la
paridad está al 100 % y el auditor la vigila— pero el día que se escape una
clave, es mejor que el usuario rumano lea español a que lea
`payments.status.cancelled`.

**Verificado en pantalla**, no solo compilado: el cobro abre en «Señal» con 50 €
con la señal pendiente y en «Resto alquiler» con 149,65 € una vez cobrada; el
paso 4 sale con su número; y el coche ocupado dice «Ya hay una reserva para
estas fechas».

## C-28 · Fotos reducidas antes de subir — 1 de septiembre de 2026

M-20 estaba escrito como un problema de descarga: la caja de la tarjeta mide
140 px y se bajaba el original. Al mirarlo de cerca eran **dos** problemas, y el
que nadie había medido era el otro: el operador **sube** 3-5 MB por foto, desde
la calle, con la cobertura que haya, y varias seguidas en una inspección.

Decisión de Dorel: reducir en el navegador antes de subir. Es la única de las
tres opciones que arregla las dos mitades — la extensión `Resize Images` y una
Cloud Function con `sharp` solo habrían mejorado la descarga, y las dos añaden
infraestructura y coste por foto.

**Medido con una imagen de 4032×3024**, que es lo que da un móvil:

| | Peso | Dimensiones |
|---|---|---|
| Entrada | 2.527 KB | 4032×3024 |
| Guardada | 906 KB | 1600×1200 |
| Miniatura | **74 KB** | 400×300 |

La lista de flota pasa de 2,5 MB por coche a 74 KB. Y la imagen de prueba era
ruido pseudoaleatorio, el peor caso posible para JPEG: una foto real comprime
bastante más.

**Verificado en pantalla y en Storage**, no solo en el código: la tarjeta usa la
miniatura (`naturalWidth` 400 en una caja de 180) y se ve nítida; el documento
guarda `path` y `thumbnailPath`; y tras borrar la foto **ninguno de los dos
ficheros responde** — la miniatura no se queda huérfana.

**Lo que no se ve pero cuesta si falta.** Si el navegador no sabe reducir el
fichero (HEIC), se sube el original y se sigue: una miniatura que falla no puede
costar la foto. `size` y `contentType` describen lo guardado y no el original,
que si no estarían describiendo un fichero que no existe. Y los `ImageBitmap` se
cierran, porque con varias fotos seguidas desde el móvil no hacerlo es la
diferencia entre que la pestaña aguante o se recargue sola.

**Un tropiezo del que dejar constancia**, porque ya me había pasado: escribir
esta documentación con `node -e` y comillas invertidas dentro de bash hizo que
el shell **ejecutara** los nombres de fichero y los borrara del texto. Para
prosa, Write y Edit; `node -e` es para datos.

## C-29 · Pago desde el móvil del cliente (N-6) — 2 de septiembre de 2026

El hueco que quedaba: cobrar con tarjeta exigía tener al cliente delante, porque
abrir la pasarela requiere un POST firmado desde la propia pantalla. Ahora se le
manda un enlace y paga cuando puede.

**Probado de extremo a extremo en desarrollo**, con la pantalla a 390 px que es
como la va a ver:

1. Botón «Copiar enlace de pago» en la fila pendiente de la reserva
2. `/pay/{id}` abre sin sesión: importe grande, concepto, marca de la empresa
3. «Pagar con tarjeta» → pasarela de test → 3D Secure → autorizado
4. «Ya he pagado, actualizar» → **«Pago recibido»**, sin ofrecer pagar de nuevo
5. La reserva pasó sola a **Pagado: 199,65 €**, por el webhook

**Comprobado que no filtra nada.** Llamando a la function sin ninguna cabecera
de autenticación, la respuesta trae importe, moneda, concepto, marca y el
formulario firmado. Ni pagador, ni cliente, ni vehículo, ni reserva: un enlace
reenviado no debe contar con quién trabajas.

**Dos tropiezos del día, los dos míos.**

`npx tsc --noEmit` **no valida las plantillas de Angular**. Había cambiado la
galería para usar `thumbnailUrl` sin declararlo en `GalleryImage`: tsc daba OK y
lo que falló fue el build del dev server. Para cambios en plantillas, el
typecheck a secas no basta.

Y `navigator.clipboard.readText()` desde el navegador automatizado **se queda
esperando un permiso que nadie concede**: colgó la herramienta media hora. Para
comprobar un enlace copiado, construirlo aparte y navegar a él.

**Antes del despliegue a producción**: `getPaymentCheckout` es nueva y solo está
en desarrollo.

---

## C-30 · QR y código de verificación en el contrato (N-9) — 4 de septiembre de 2026

Ciclo completo en desarrollo, con una reserva nueva creada para el caso: reserva
→ contrato → link de firma → firma del cliente → PDF sellado. La comprobación no
se hizo mirando la pantalla, sino **el fichero**.

| Paso | Resultado |
|---|---|
| QR del PDF firmado, descifrado del render real de la página | `https://store.veltorent.com/v/8QPBYNT49AXJ` |
| `sha256sum` del PDF descargado de Storage | `879a6d7c…8ff00272` |
| Huella que enseña `/v/8QPBYNT49AXJ` | **la misma, dígito a dígito** |
| Sellado | `adbe.pkcs7.detached` en el fichero · la página dice «Sí, con certificado digital» |
| Código impreso `VLT-8QPB-YNT4-9AXJ` tecleado a mano | resuelve al mismo contrato |
| Function sin cabecera de autenticación | cinco datos; ni nombre, ni documento, ni importe |
| Código inexistente y `../../contracts` | responden lo mismo, `state: unknown` |
| Móvil (390 px) | nada oculto; la huella parte en dos líneas en vez de truncarse |

**Lo que más cuesta comprobar de un QR es lo único que importa: que se lea.** Un
símbolo con un índice de fila invertido, o sin los 4 módulos de zona de silencio,
tiene exactamente la misma pinta que uno bueno y no lo descifra ningún móvil.
Aquí se comprobó dos veces:

1. **Sobre el PDF real**, renderizándolo con pdf.js en el navegador y pasándole
   `jsQR` al canvas — es decir, leyendo el contrato como lo leería un teléfono.
2. **En un test**, rasterizando los rectángulos que se dibujan de verdad
   (`qrRects()`) y descifrándolos. Por eso la geometría vive fuera del dibujo.

**El orden de las dos operaciones no es negociable**, y por eso está escrito en
el código: el código de verificación se decide **antes** de construir el PDF
—porque el QR va dentro del documento que luego se sella— y la huella se calcula
**después**, sobre los bytes que se guardan. Al revés, la página le diría a un
cliente que su contrato está alterado.

Desplegado en los dos entornos el mismo día; producción responde y es pública.
**Los contratos firmados antes de hoy no tienen código**: su QR no existe y la
página los da por no encontrados. Correcto, y no se migra nada.
