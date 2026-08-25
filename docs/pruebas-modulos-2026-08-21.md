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
