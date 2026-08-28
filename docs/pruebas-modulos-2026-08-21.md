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
