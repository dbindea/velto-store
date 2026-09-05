# Mejoras pendientes

Lista viva de mejoras sobre lo **ya programado**, salida de las pruebas end‑to‑end
con datos reales del 21 de agosto de 2026. No son bugs —esos van en
[pruebas-modulos-2026-08-21.md](pruebas-modulos-2026-08-21.md) y ya están
corregidos— sino cosas que funcionan pero se pueden hacer mejor.

Marca con `[x]` lo que se cierre y añade la fecha.

Dos numeraciones, para no mezclar cosas distintas:

- **`M-N`** — mejoras sobre algo que ya existe y funciona.
- **`N-N`** — funcionalidades **nuevas**, que hay que construir desde cero.
  Van al final del documento.

---

## Estado a 4 de septiembre de 2026

**El ciclo del alquiler está completo y probado de extremo a extremo**, en
desarrollo y en producción: presupuesto → reserva → señal → contrato → firma →
email → entrega → devolución con daños y cargos → fianza → cierre. Y también la
cancelación, el mantenimiento de vehículos y las excepciones de workflow.

**Cobros**: Redsys funciona en los dos entornos, incluido un cobro real de 10 €
en producción. El cliente puede pagar **desde su móvil** con un enlace, sin que
el operador esté delante.

⚠️ **La vía del móvil perdió un cobro real el 4 de septiembre** (F-32): el
pedido se regeneraba en cada consulta y el aviso de Redsys llegaba huérfano.
Arreglado y desplegado el mismo día, pero **la vía pública sigue sin un cobro
que haya cerrado el círculo entero por sí solo**. Hasta que eso pase, no está
probada.

**Contrato**: se sella con el certificado FNMT de la empresa.

**Contrato en papel**: lleva QR y Código Seguro de Verificación desde el 4 de
septiembre de 2026 (N-9), con página pública propia en `/v/:codigo`.

⚠️ **Las dos bases de datos se vaciaron el 4 de septiembre de 2026**, por
decisión de Dorel: todo menos `authorizedUsers`, en desarrollo y en producción.
No hay coches, ni clientes, ni reservas. Se empieza de cero. **Los ficheros de
Storage siguen ahí** —vaciar Firestore no los borra— y se limpian desde la
consola de Firebase.

**Ya no queda ningún módulo en construcción**: Gastos y Ajustes se construyeron
el 4 de septiembre de 2026. La clave `common.moduleInProgress` se ha retirado
porque no la usaba nadie.

**Lo que falta**, por tamaño:

| | Qué es |
|---|---|
| **N-5** | Pre-reserva desde la web pública — sin decidir |
| **D-1…D-6** | Seis decisiones de Dorel pendientes |
| resto | Mejoras menores: M-5, M-6, M-10, M-11, M-13, M-21 |

**Cerrado**: la copia del `.p12` de `public/` está borrada (4 sep 2026). El
certificado vive solo en Secret Manager, que es su sitio.

---

## Ciclo completo en producción — 5 de septiembre de 2026

Recorrido entero con datos reales, **dejado montado en producción** para que
Dorel lo revise: conciliación del euro cobrado → contrato → firma del cliente →
sellado FNMT → verificación por QR → email → entrega → devolución con daños →
mantenimiento → cierre.

Lo que quedó verificado de verdad:

| | |
|---|---|
| Liquidación del pago sembrado | una sola fila «Pagado», sin duplicar (M-14) |
| Sellado FNMT en producción | `digitallySealed: true` |
| Huella del contrato | `be2ed32a…` coincide **al byte** con el PDF de Storage |
| Página `/v/:codigo` | verifica sin filtrar un solo dato personal |
| Enlace de firma | sale con el dominio propio, no con `.web.app` |
| Validación de formularios (M-42) | tres campos en rojo, mensaje y resumen |
| Mantenimiento sin próxima revisión | **aparece** en la ficha del coche (M-40) |
| Gastos | lee el coste del mantenimiento sin duplicarlo |
| Km del vehículo | 25.000 → 25.350 tras la devolución |

Y tres fallos que solo se ven recorriéndolo. Los tres están arreglados; los dos
de frontend necesitan que subas la rama.

### ✅ F-33 · El cliente veía el correo de desarrollo al firmar

El pie de la pantalla pública de firma decía **`reservas@veltorent.com`** en
producción, justo debajo del botón de firmar — mientras el contrato adjunto
traía `reservas@veltomobility.com`. Dos correos distintos en el mismo trámite,
y el equivocado en el sitio donde el cliente decide fiarse.

La causa es de las que se repiten: el dato estaba **escrito a mano en la
plantilla**, y su respaldo (`BRAND_CONFIG.email`) tampoco valía, porque
`brand.config.ts` se compila dentro del bundle y **la app se construye igual
para los dos entornos**. El correo sí cambia por entorno, y vive en
`functions/.env.<proyecto>`.

Ahora lo sirve `getContractForSigning` junto al resto de la vista. Verificado
contra las dos functions desplegadas:

```
prod -> marca: VELTO MOBILITY | correo: reservas@veltomobility.com
dev  -> marca: VELTO MOBILITY | correo: reservas@veltorent.com
```

`brand.config.ts` se queda con un aviso encima: **es la referencia de la marca,
no una fuente para lo que ve el cliente**.

### ✅ F-34 · Se podía cerrar un alquiler debiendo 145 € sin un solo aviso

La devolución generó tres cargos —combustible 15 €, limpieza 10 €, daños 120 €—
que nacieron **Pendientes**, como debe ser (M-33). Pero:

1. La tarjeta del resumen decía **«CARGOS EXTRA · 0,00 €»** con las tres filas
   sumando 145 € tres líneas más abajo. Enseñaba `extrasTotal`, que es lo
   **cobrado**. Un cero que significa «aún nada cobrado» y otro que significa
   «no se debe nada» se pintaban igual.
2. `canCloseReservation()` mira estado, inspección, resto y fianza —**no los
   cargos extra**—, así que el botón cerró la reserva sin decir nada.

Juntos hacen que el alquiler desaparezca de la lista de trabajo con la deuda
viva y la pantalla afirmando que no hay cargos. Es exactamente cómo se pierde
ese dinero.

Arreglado en las dos mitades: el resumen expone `extrasRequired` (devengado) y
`extrasPending`, la tarjeta enseña lo devengado con un aviso ámbar de lo que
falta, y cerrar con cargos pendientes **pregunta primero, con el importe
delante**. Tres tests nuevos fijan la distinción.

⚠️ **No bloquea el cierre, y es deliberado**: reclamar un cargo puede llevar
semanas y la agencia necesita cerrar la operación mientras tanto. Lo que no
puede es no enterarse. Si prefieres que bloquee, se cambia en una línea.

### ✅ F-35 · El botón de mantenimiento estaba apagado, con la validación ya escrita

`vehicle-maintenance-form` **ya tenía** las tres piezas de M-42 —`FieldProblems`,
`<app-form-error>`, `submitted`— y no servían de nada: el botón llevaba
`[disabled]="saving || !form.title.trim()"`, así que con el formulario vacío no
se podía pulsar y el mensaje no llegaba a aparecer nunca.

Es el fallo que M-42 vino a quitar, sobreviviendo **dentro** del componente que
lo arreglaba. Ahora solo se apaga mientras guarda.

Barrido del resto: los demás `[disabled]` con condición son guards de workflow o
de permisos, y esos sí llevan su razón escrita al lado. Este era el único.

✅ **El email del contrato firmado llegó** (confirmado por Dorel el 5 de
septiembre de 2026). Con eso queda probado en producción todo lo que rodea a
Resend: el secret está puesto, `veltomobility.com` **está verificado** como
dominio remitente y el adjunto sale con el correo bueno.

### Pendiente de que lo mires tú

- **M-45**: la pantalla de contrato **no enseña el código de verificación**. Si
  un cliente llama leyendo el `VLT-…` de su papel, el operador no puede buscarlo
  desde la aplicación. Hoy solo está dentro del PDF y en Firestore.

Datos que quedan en producción, para borrar cuando empieces a usar la
plataforma de verdad: vehículo `BW8A1BR7ZB4ioHD4BkZJ` (Renault Clio 0001PRB),
cliente `dukWvwIQwJojo5rZEPw9`, reserva `KPPlsVPWUiZShOH06Fdv` con su contrato
`C-KPPLSV-2026` (código `VLT-7M63-EE55-THDK`), cuatro pagos y un mantenimiento.

---

## ✅ F-32 · Un cobro real que la aplicación no registró *(4 sep 2026)*

**Un pago de 1 € en producción se cobró y la reserva siguió diciendo «pendiente».**
No fue Redsys: el aviso llegó, con su firma válida, a las 22:06:50. Lo que el
log dijo fue nuestro:

```
No payment found for order { order: '93247C7C67BC' }
```

El pago existía. Lo que ya no existía era ese pedido.

**La causa.** `prepareRedsysCheckout()` generaba un pedido nuevo **en cada
llamada** y lo sobrescribía en el documento. Hasta ahí, defendible: lo llamaba
solo el botón del operador. Pero desde que existe la pantalla pública
`/pay/:id`, la llama también `getPaymentCheckout` — y esa pantalla es la que el
cliente refresca **para ver si su pago ya consta**. Cada mirada al estado
cambiaba la referencia del pago que estaba en vuelo.

La secuencia, con las horas del log:

| | |
|---|---|
| 21:45 | se crea el pago |
| ~22:05 | se abre el checkout → pedido `93247C7C67BC`, y con él se paga |
| 22:06:50 | Redsys avisa de `93247C7C67BC` → no lo encuentra → descartado |
| 22:13:55 | se reabre la pantalla → pedido `5678997A390A`, machaca al anterior |

Ni siquiera hacía falta refrescar en mitad del pago: basta con volver a la
pantalla, que es exactamente lo que hace quien acaba de pagar.

**Lo que se ha arreglado**, en tres piezas, porque las tres fallaron:

1. **El pedido se reutiliza** mientras nadie haya intentado pagar con él
   (`resolveOrder()`). Si ya llegó un aviso —una denegación— se emite uno
   nuevo: la pasarela rechaza un pedido ya procesado con SIS0051.
2. **Se guardan todos los pedidos emitidos** en `redsys.issuedOrders`, y el
   webhook busca ahí cuando el vigente no cuadra. Una carrera entre pantallas
   deja de costar un cobro.
3. **Un aviso sin pago al que aplicarse ya no se tira**: se guarda en
   `redsysOrphanNotifications/{pedido}`. Es lo que faltó anoche — el código de
   respuesta y el de autorización del cobro se perdieron con el `console.warn`,
   así que hoy no se puede saber desde aquí si aquel euro llegó a cobrarse.

Una denegación de un pedido superado se anota pero **no** marca el pago como
fallido: el cliente pudo ser rechazado con una tarjeta y estar pagando con otra.
Aprobado sí se aplica siempre, venga del pedido que venga: el dinero está cobrado.

Cubierto por tests (`resolveOrder`, `newOrder`) y verificado en producción: tres
consultas seguidas al checkout devuelven ahora el mismo pedido, y `arrayUnion`
no lo duplica.

⚠️ **Queda una cosa por cerrar, y es de Dorel**: mirar en el panel de Redsys si
el cobro de 1 € del 4 de septiembre (pedido `93247C7C67BC`, comercio `361040215`,
22:06) quedó autorizado. El pago `DTCCE0Phi2w0RaSdXdCm` sigue en `pending`.

**Lo que este fallo dice del resto.** El módulo de pagos estaba «probado de
extremo a extremo», y lo estaba: el cobro de 10 € del 31 de agosto se hizo desde
el botón del operador, la única vía que existía entonces. La pantalla pública
llegó después y reutilizó la misma función sin que nadie recorriera el flujo
entero desde el móvil de un cliente. Es el patrón de siempre —código escrito y
nunca ejecutado— pero esta vez con dinero: **una vía de pago nueva no está
probada hasta que alguien paga por ella y la aplicación se entera sola**.

---

## ✅ N-10 · Módulo de Gastos *(hecho el 4 sep 2026)*

Dejaba de ser un placeholder. Es la contraparte de Pagos: **lo que sale**.

**Decisiones de Dorel:**

- Un gasto se imputa **a un vehículo, a una reserva o a la empresa**. Los tres,
  no uno.
- **El mantenimiento se lee, no se duplica.** Una reparación se sigue
  registrando en `vehicleMaintenance` —que es donde además vive el aviso de la
  próxima ITV y de la próxima revisión por km— y Gastos suma su coste. Se
  descartó absorberlo, que habría costado esos avisos, y también dejarlos
  separados, que habría hecho que un cambio de aceite de 180 € estuviera en la
  aplicación y no en el total de gastos.

⚠️ **El IVA de un gasto se EXTRAE del total; el del alquiler se SUMA al neto.**
No es una incoherencia: en un alquiler el número que se negocia es el neto, y en
un gasto lo que tienes en la mano es una factura con su total. Por eso la
aritmética vive en `expense.util.ts` y no en `pricing.util.ts`, con la nota
escrita en los dos sitios. Confundirlas no da un error: da una cifra creíble y
equivocada.

**Lo construido:** modelo con snapshot de vehículo o reserva congelado,
`expense.util.ts` con **21 tests**, servicio, listado con totales y formulario
con desglose en vivo. Categorías distintas según a qué se impute —dieciocho en
un desplegable no las lee nadie— y **la multa propone 0 % de IVA**, porque es una
sanción repercutida y no un servicio, igual que la fianza del otro lado.

**Los totales no cuadran a propósito, y la pantalla lo dice.** El bruto incluye
el mantenimiento; la base y el IVA solo las filas que traen desglose, porque el
coste de una reparación se teclea como un importe suelto y suponerle un 21 %
sería fabricar una base imponible que la gestoría daría por buena. La tarjeta
pone «IVA soportado · sobre 1/3» en vez de enseñar tres números que no encajan.

**Probado en el navegador**, no solo compilado: gasto general de 121 € guardado y
releído desde Firestore con su desglose intacto, la multa poniendo el IVA a 0
sola, la validación rechazando un gasto de vehículo sin vehículo, y un
mantenimiento de 180 € apareciendo en la lista con su matrícula, su proveedor y
la etiqueta «Mantenimiento».

Falta por probar: gasto imputado a una reserva —no había ninguna tras vaciar las
bases— y la subida de la factura a Storage.

- [x] **M-40 · Un mantenimiento sin próxima revisión desaparecía de la ficha
  del coche.** *(4 sep 2026)*
  `getMaintenanceByVehicle` ordenaba por `nextDueDate`, y **Firestore excluye
  del resultado los documentos que no tienen el campo por el que se ordena**.
  Una reparación ya hecha y sin próxima revisión programada —el caso más normal
  de todos: un cambio de aceite que se paga y se olvida— se guardaba
  correctamente y la pestaña decía «Sin registros de mantenimiento para este
  vehículo».

  Llevaba ahí desde que existe el módulo. No se vio el 31 de agosto porque
  aquella prueba rellenó la próxima revisión. **Salió construyendo Gastos**: el
  mismo registro aparecía en la lista de gastos, leído de la misma colección, y
  no en la ficha del coche.

  El orden se hace ahora en memoria, por fecha de realización, próxima revisión
  o creación —la primera que exista— para que ninguna ficha pueda quedar fuera
  por no tener un campo.

---

## ⚠️ Revisar tras el cambio de IVA (27 ago 2026)

- [x] **Repasar las tarifas de los vehículos.** *(27 ago 2026 — decidido: no se
  tocan.)* Desde el 27 de agosto el `pricePerDay` es **neto** y el IVA se suma
  encima. Las tarifas no se han cambiado, así que **lo que se cobra por el mismo
  alquiler sube un 21 %**: 7 días a 50 €/día pasan de 350 € totales a
  350 € + 73,50 € = **423,50 €**.

  Decisión de Dorel: **se dejan como están**. La tarifa pasa a ser el precio
  neto que se negocia y el IVA va encima; el ingreso sube. No hay nada que
  programar.

- [x] **Comprobar una reserva antigua** después de desplegar. *(27 ago 2026,
  23:30 — hecho contra las functions ya desplegadas.)* Contrato regenerado de
  una reserva del 26 de agosto: 37,19 + 7,81 = **45,00 €**, los mismos números
  que antes. La dirección congelada en `tariffIncludesVat` aguanta.

## Prioridad alta

- [x] **M-1 · Un cliente `blocked` no bloquea nada.**
  `ClientTrustLevel` tiene `risk` y `blocked`, se muestran con color, y el
  workflow los ignora por completo: se puede crear una reserva a un cliente
  marcado como «no alquilar». Decidir si `blocked` impide crear la reserva o
  solo avisa con confirmación. Es la §10.1 del documento funcional.

  **Resuelto el 28 de agosto de 2026.** Decisión de Dorel: `blocked` **impide**
  crear la reserva, `risk` **solo avisa**. `canCreateReservationForClient()` y
  `clientTrustWarning()` viven en el workflow util, con 9 tests. La UI deshabilita
  el botón y explica por qué; el servicio rechaza la llamada igualmente.
  **Sin excepción de workflow**: la salida es cambiarle el nivel al cliente en su
  ficha, que queda registrado.

- [x] **M-33 · Los cargos extra nacían «pagados» sin que nadie los cobrara.** *(31 ago 2026)*
  Al completar la devolución, cada cargo se creaba con `status: paid` y
  `paidAmount = amount` — el código lo admitía en un comentario:
  `// assumed already paid`. Nadie había cobrado nada.

  Con 172,50 € de cargos contra 150 € de fianza, la reserva salía **PAGADA** y
  los 22,50 € de diferencia desaparecían. Con **fianza a 0** —lo normal en un
  cliente conocido— se daba por cobrado el cargo entero sin cobrar un céntimo.

  **Eran cuatro agujeros, no uno.** Los tres últimos aparecieron al tapar el
  primero:

  1. Los cargos nacen ahora `pending`, no `paid`.
  2. La retención de fianza los **liquida de verdad**, de mayor a menor y hasta
     donde alcance (`distributeRetentionAcrossCharges`, util puro con 5 tests).
     Lo que no cubre queda pendiente y se cobra con el botón de tarjeta.
  3. **`cancelUncollectedPayments` los cancelaba al cerrar la reserva.** Estaba
     pensado para limpiar filas sembradas que nunca se usaron; un cargo extra
     nace de un hecho —un daño, kilómetros de más— y es deuda del cliente. Sin
     esto, el arreglo solo cambiaba la etiqueta con la que se perdía el dinero.
  4. **`paymentStatus` solo miraba señal y resto**, así que una reserva con
     160 € de cargos sin cobrar seguía anunciándose como **PAGADA**. No se veía
     porque los cargos nacían pagados.

  **Verificado en el caso peor**, reserva con fianza a 0 y 160 € de cargos
  (120 daños + 40 limpieza):

  ```
  antes:  los dos cargos → «Pagado», reserva PAGADO, 160 € perdidos
  ahora:  los dos cargos → «Pendiente» con botón de cobro
          reserva PARCIAL, y siguen ahí después de cerrarla
  ```

- [x] **M-36 · No se podía cancelar una reserva confirmada.** *(31 ago 2026)*
  El botón «Cancelar reserva» salía **deshabilitado y sin explicar por qué**
  (`title=""`) en cuanto se cobraba la señal.

  Había **dos reglas contradictorias en el mismo fichero**: `canCancel()`, que
  copiaba la regla a mano y solo admitía `reserved`, y `canCancelReservation()`,
  que delega en el workflow —la única autoridad— y también admite `confirmed`.
  El template usaba la primera; el `title` lo pedía a la segunda, que no tenía
  nada que objetar, y por eso salía vacío.

  Es justo lo que CLAUDE.md prohíbe: duplicar reglas del workflow en un
  componente. Retirado `canCancel()`; el template usa el workflow. Verificado:
  se cancela una reserva confirmada, la señal cobrada se conserva como `paid` y
  el resto y la fianza pasan a `cancelled`.

- [x] **M-37 · El estado de un pago salía en inglés.** *(31 ago 2026)*
  Al cancelar una reserva, sus pagos aparecían como **`cancelled`** en crudo.

  `getPaymentStatusLabel()` resolvía contra `RESERVATION_PAYMENT_STATUS_LABELS`
  —el estado de pago **de la reserva**, que solo conoce `pending`, `partial` y
  `paid`— en lugar de `PAYMENT_STATUS_LABELS`, que es el de **un pago** y sí
  tiene `cancelled`, `failed` y `refunded`. Al no encontrar la clave caía al
  respaldo, que es el valor crudo. **La traducción existía desde siempre.**

  De paso se quitó un `| translate` redundante: el getter ya devuelve el texto.

- [x] **M-38 · La etiqueta del tipo de mantenimiento salía como clave.** *(31 ago 2026)*
  El formulario pintaba **`maintenance.type.oil_change`** sobre el desplegable.
  Dos errores en la misma línea: se construía la clave con el **valor
  seleccionado** en vez del nombre del campo, y las claves de
  `maintenance.type.*` están en camelCase (`oilChange`) mientras el valor llega
  en snake_case (`oil_change`), así que no resolvía nunca.

  Añadida `maintenance.fields.type` en los tres idiomas.

- [x] **M-39 · Los kilómetros de mantenimiento se guardan como texto.** *(1 sep 2026)*
  `performedAtKm` y `nextDueKm` acaban en Firestore como `"44200"`, mientras
  `cost` sí es número. Hoy no molesta porque solo se pintan, pero cualquier
  orden o comparación por kilómetros saldría mal: como texto, `"9000"` es mayor
  que `"44200"`. `nextDueDate` va también como cadena `"2027-08-31"` en vez de
  fecha; ordena bien por ser ISO, pero no es una fecha.

- [x] **N-7 · Excepciones de workflow, conectadas por fin.** *(1 sep 2026)*
  `buildWorkflowException()`, `hasWorkflowException()` y `canWithException()`
  estaban escritas y cubiertas por tests desde el principio, y **nadie las
  llamaba**. Se podían escribir excepciones en el modelo y el workflow las
  respetaba en teoría, pero ninguna pantalla las consultaba ni había forma de
  crear una: un cliente que firmaba en papel dejaba la entrega bloqueada sin
  salida, y el único arreglo era entrar a Firestore a mano.

  **Decisiones de Dorel:** admiten excepción **todos los pasos menos alquilar a
  un cliente bloqueado**, y basta con el **motivo escrito** que ya exigía
  `buildWorkflowException` (mínimo 3 caracteres).

  Lo construido:

  - `EXCEPTIONABLE_ACTIONS` en el workflow, que es donde vive la lista y donde
    queda escrito por qué `createReservationForClient` **no** está.
  - `ReservationService.addWorkflowException()`, que persiste con `arrayUnion` y
    el objeto ya limpio de `undefined` — el centinela no se puede limpiar
    después.
  - Las cinco decisiones de la ficha pasan por `canWithException()`, que es lo
    que hace que registrar una excepción sirva de algo.
  - Botón **«Saltar este paso»** bajo el motivo del bloqueo, visible solo cuando
    el paso está bloqueado, y con trazo discontinuo: es la salida de emergencia,
    no una alternativa al camino normal.
  - Tarjeta **«Pasos saltados»** con acción, motivo, autor y fecha. Solo aparece
    si hay alguna.

  **Verificado**: motivo vacío → rechazado con su explicación; con motivo → la
  entrega se desbloquea, la excepción aparece en la ficha y queda en Firestore
  con `action`, `reason`, `createdBy` y `createdAt`.

  El prefijo dinámico `workflow.` quedó registrado en `DYNAMIC_KEY_SETS`; el
  auditor lo detectó y falló hasta hacerlo, que es exactamente su trabajo.

- [x] **M-34 · El cargo por km extra: se avisa, no se rellena.** *(31 ago 2026)*
  El vehículo lleva `includedKmPerDay` y `extraKmPrice`, y la inspección conoce
  los km de salida y de entrada, pero el campo se dejaba a 0 sin más y la cuenta
  la hacía el operador a mano.

  **Decisión de Dorel, y el criterio es suyo:** el primer año **no se cobra** el
  kilometraje extra, para captar clientela. Y aunque se cobrara, prerrellenar el
  campo es peligroso — *«si se me olvida lo guardo sin querer»*—: un importe
  puesto por la aplicación acaba cobrándole al cliente algo que no querías
  cobrarle. Un texto no se guarda solo.

  Así que el campo **sigue a 0** y debajo aparece un aviso:

  ```
  Cargo por km extra  [ 0 ]
  ⓘ Sin cobrar. Exceso detectado: 600 km · 150,00 €
  ```

  La aritmética vive en `suggestExtraKmCharge()` (`pricing.util.ts`), con
  5 tests: el caso real, el límite exacto de los km incluidos, el kilometraje de
  entrada menor que el de salida —un error de tecleo no puede producir un cargo—
  y la ausencia de cualquier dato, que **no propone nada** en vez de inventar
  una cifra.

  Queda pendiente lo mismo para el **combustible**, que necesita antes un precio
  por depósito o por cuarto en la ficha del vehículo: ese campo no existe.

- [x] **M-35 · «Registrar cobro» nace en Señal con importe 0.** *(1 sep 2026)*
  Con la señal ya cobrada, el formulario sigue abriendo en `initial_payment` y
  a 0 €. Al elegir el tipo sí autocompleta el importe pendiente —eso funciona—,
  así que basta con que arranque en **el primer tipo que quede pendiente**.

- [x] **M-2 · `TranslateService` no cae al español.** *(1 sep 2026)*
  Si una clave falta en `ro.json`, el usuario rumano ve la clave en crudo aunque
  el español exista. Hoy la paridad está al 100 %, así que no se manifiesta,
  pero es un fallo latente de una línea. Añadir fallback a `es`.

- [x] **M-3 · Falta el índice compuesto de `inspections`.**
  `inspection.service.ts` consulta `reservationId ==` + `orderBy('createdAt')`,
  que exige índice compuesto y no está en `firestore.indexes.json`. La colección
  está vacía, por eso no ha saltado. Saltará en la primera inspección real.

  **Resuelto el 28 de agosto de 2026**, junto con M-12: el fichero entero estaba
  mal, no solo faltaba este índice.

- [x] **M-22 · Los secrets no llegaban a las functions que los usan.** *(29 ago 2026)*
  `sendSignedContractEmail` leía `process.env.RESEND_API_KEY` **sin declarar el
  secret** en las opciones del callable. En Cloud Functions v2 un secret que no
  aparece en `secrets: [...]` no se monta en el runtime: la variable sale
  `undefined` y la función abortaba con «Resend no está configurado» aunque el
  secret estuviera puesto. **El envío del contrato firmado por email no ha
  funcionado nunca en ninguno de los dos entornos.**

  Corregido: `defineSecret('RESEND_API_KEY')`, declarado en `secrets: [...]` y
  leído **dentro** del handler con `.value()` — en el módulo se evalúa antes de
  que el runtime resuelva los secrets (F-12).

  De paso, el remitente deja de ser un secret: `RESEND_FROM_EMAIL` no existía en
  ningún proyecto y era la dirección de la empresa duplicada. Ahora sale de
  `companyConfig().email`, igual que la razón social del asunto y de la firma.

  **Falta por tu parte:** crear `RESEND_API_KEY` en producción
  (`firebase functions:secrets:set RESEND_API_KEY --project prod`). Sin él el
  despliegue de producción **falla**, porque el secret ya está declarado.

- [~] **M-24 · El capitalizado escribe «Del» con mayúscula.** *(29 ago 2026)*
  «oficina arganda del rey» sale «Oficina Arganda **Del** Rey», porque
  `capitalizeWords()` no distingue preposiciones.

  **Descartado por Dorel el mismo día: «es insignificante el error».** No se
  toca. Si algún día se retoma, el arreglo es una lista de partículas que no se
  capitalizan salvo en primera posición, cuidando de no romper `dCi` / `TCe`,
  que sí están cubiertos por tests.

- [x] **M-25 · La dirección del cliente no se transforma.** *(29 ago 2026)*
  Es el único campo de texto que se guarda tal cual se teclea, aunque se imprime
  en el contrato como domicilio del arrendatario.

  **Decisión de Dorel: se queda como está, «a elección del cliente».** Una
  dirección lleva abreviaturas, números y códigos postales; automatizarla tiene
  más formas de salir mal que de salir bien.

- [x] **M-26 · La razón social se colaba donde tocaba la marca.** *(29 ago 2026)*
  `VELTO MOBILITY, S.L.` salía en el asunto del email, en el «Gracias por
  confiar en…» —con el punto doble de regalo, porque `S.L.` ya acaba en punto—,
  en la cabecera de los tres PDF, en sus metadatos y en la pantalla pública de
  firma.

  **Criterio de Dorel:** la razón social solo donde la empresa comparece como
  persona jurídica, o sea **acompañada del NIF**. Todo lo demás, la marca: el
  cliente no sabe qué es una S.L. ni tiene por qué saberlo.

  Resuelto con `brandName` en `CompanyConfig`, separado de `legalName`. Quedan
  con razón social exactamente cuatro sitios, los cuatro con NIF al lado: bloque
  de datos del arrendador, «Razón social:» de la página 2, casilla de firma del
  arrendador y pie legal de cada página. Verificado sobre el PDF real desplegado.

- [x] **M-27 · La constancia de firma salía en la casilla del arrendador.** *(29 ago 2026)*
  «Firmado el 29/08/2026, 13:18 por Dorel Bindea» se pintaba **debajo de la
  columna izquierda**, la de la empresa: leía como si hubiera firmado el
  arrendador con el nombre del cliente.

  La causa era de maquetación, no de datos: la línea se dibujaba como texto
  normal **después** del bloque de firmas, y el texto normal del builder arranca
  en el margen izquierdo. Ahora viaja dentro de `signatureBlocks()` como
  `renterSignedNote` y se pinta en la columna del arrendatario, partida en
  líneas en vez de truncada — lleva dentro el nombre del firmante.

  **Cubierto por un test**: `layout.spec.ts` renderiza el contrato **firmado** y
  comprueba que la constancia cae en la mitad derecha y el arrendador en la
  izquierda, en la misma página.

- [x] **M-28 · Correo distinto en cada entorno.** *(29 ago 2026)*
  Producción pasa a `reservas@veltomobility.com`; desarrollo se queda en
  `reservas@veltorent.com`.

  Resuelto con `functions/.env.<proyecto>`, que Firebase inyecta **sin declarar
  nada** — al contrario que los secrets. Es además la salida natural para el
  resto de `VELTO_COMPANY_*` y para lo pendiente en M-23 y M-4: ninguno de esos
  valores es un secreto.

  **Verificado, no supuesto**: se puso un correo distinguible en desarrollo, se
  desplegó, se generó un justificante y salió impreso `prueba-env@veltorent.com`
  en el PDF. Después se devolvió el valor bueno y se redesplegó.

  ⚠️ **Pendiente por tu parte: verificar `veltomobility.com` en Resend.** Sin
  eso, el envío del contrato en producción falla con 403. Y el 403 no explica
  por qué.

- [x] **M-29 · `sendSignedContractEmail` devuelve `contractId: null`.** *(1 sep 2026)*
  La función lee el contrato con `snap.data()`, que **no incluye el id del
  documento**, y luego devuelve `contractId: contract.id` — siempre `undefined`,
  que viaja como `null`. Visto en la respuesta real de producción:

  ```json
  {"contractId":null,"emailedAt":"2026-08-31T12:26:58.263Z","to":"dbindea@gmail.com"}
  ```

  Hoy no rompe nada: el email se envía, `emailedAt` se escribe y el nombre del
  adjunto usa `contractNumber`. Pero el mismo `contract.id` es el **fallback**
  del nombre del fichero, así que un contrato sin número se adjuntaría como
  `contrato-firmado-undefined.pdf`. Arreglo de una línea: usar `snap.id` (o el
  `contractId` que ya llega en la petición). Va en el próximo despliegue de
  functions, no merece uno para él solo.

- [x] **M-30 · El botón de pago hacía GET a Redsys, que solo admite POST.** *(31 ago 2026)*
  `openRedsys()` hacía `window.open(paymentUrl)`, es decir un **GET** a
  `https://sis-t.redsys.es:25443/sis/realizarPago` **sin ningún parámetro**. El
  importe, el pedido y la firma viajaban en `formData`, que el componente
  recibía, guardaba… y no usaba nunca. El cliente llegaba a una pantalla de
  error del banco: **ningún cobro con tarjeta podía completarse**.

  Ahora se construye un formulario efímero con los tres campos
  (`Ds_SignatureVersion`, `Ds_MerchantParameters`, `Ds_Signature`), se autoenvía
  por POST y se retira del DOM.

  Retirado también el botón **«Copiar enlace»**: copiaba esa misma URL sin
  parámetros, idéntica para todos los cobros. Pegada en un WhatsApp no llevaba a
  ningún pago. Para eso hace falta una página pública de pago — ver N-6.

- [x] **M-31 · Cobrar con tarjeta una fila pendiente de la reserva.** *(31 ago 2026)*
  Hasta ahora `redsys` era solo una opción del desplegable de método: registraba
  el cobro **como si ya estuviera hecho**, sin abrir ninguna pasarela. Cobrar la
  señal con tarjeta desde la reserva era imposible.

  Cada fila pendiente (señal, resto, fianza) lleva ya un botón **Cobrar con
  tarjeta** que pide el enlace para *ese* pago y abre la pasarela. No crea un
  pago nuevo: liquida el que ya estaba sembrado, con su importe y su concepto.

  El POST vive ahora en `RedsysPaymentService.openGateway()`, compartido con el
  cobro libre, para que el fallo de M-30 no se pueda repetir en un sitio y en el
  otro no.

  En móvil el botón **baja a una línea propia** en vez de desaparecer: la celda
  de estado se oculta a 640px, y meterlo ahí lo habría escondido justo en la
  pantalla donde se cobra con el cliente delante.

- [x] **M-32 · Un cobro por Redsys dejaba la reserva desincronizada.** *(31 ago 2026)*
  Encontrado al probar M-31 de punta a punta. El webhook marcaba el pago como
  `paid` —correctamente— pero la reserva se quedaba así:

  ```
  reservationStatus: reserved      ← debería ser confirmed
  paymentStatus:     pending
  initialPayment:    pending, paidAmount 0
  ```

  Es decir: **el dinero entraba y el workflow no se enteraba**. La fila decía
  «Pagado» y el resumen «pendiente» a la vez. Con la señal cobrada, la reserva
  no llegaba a `confirmed`, así que no se podía emitir el justificante ni
  avanzar.

  La causa es de reparto: el webhook solo escribe en `payments`, y los campos
  que la reserva lleva embebidos los calcula el frontend.

  **No se ha duplicado la aritmética en la function.** Habría creado una segunda
  fuente de verdad para el dinero, que es justo lo que el proyecto prohíbe. En
  su lugar, `reservation-detail` compara al cargar los pagos reales contra lo
  que dice la reserva y, **solo si difieren**, llama a la reconciliación que ya
  existía (`syncReservationPaymentStatus`). Converge y para: una visita normal
  no escribe nada.

  ⚠️ **Esto cuadra la reserva cuando alguien la abre.** Basta mientras el
  operador esté delante del cobro. El día que un cliente pague solo desde la web
  (N-5), el cálculo tendrá que vivir en la Cloud Function: nadie garantiza que
  alguien abra la pantalla.

- [x] **M-23 · Redsys funciona de extremo a extremo.** *(31 ago 2026)*
  Resuelto lo que era mío: `REDSYS_MERCHANT_CODE`, `REDSYS_TERMINAL` y
  `REDSYS_ENVIRONMENT` viven ya en `functions/.env.<proyecto>`, que llegan sin
  declarar nada. Ni el código de comercio ni el terminal son secretos: viajan
  firmados dentro del formulario que ve el cliente.

  | | Comercio | Terminal | Entorno |
  |---|---|---|---|
  | desarrollo | 361040215 | 1 | `test` |
  | producción | 361040215 | 1 | `live` |

  **Probado contra la pasarela real de test.** `createRedsysPaymentLink`
  devuelve `200` —ya no aborta con «Redsys no está configurado»— con importe,
  pedido de 12 caracteres, comercio, terminal y el webhook apuntando a
  `europe-west1`. El POST llega y **Redsys reconoce el comercio**: pinta
  `Terminal: 361040215-1` en su propia pantalla.

  Con la primera clave se quedaba en `SIS0042` (error de firma). Dorel puso las
  claves buenas el mismo día — las dos con formato válido (24 bytes) — y el
  ciclo pasó entero:

  | Paso | Resultado |
  |---|---|
  | Pasarela | «Pantalla de pago Redsys», 9,90 € |
  | Tarjeta de prueba + 3DS | **OPERACIÓN AUTORIZADA, código 002329** |
  | Webhook | notificación recibida y validada |
  | Firestore | `status: paid` · `responseCode: 0000` · `authorizationCode: 002329` |

  El código de autorización guardado coincide con el del ticket del banco, que
  es la prueba de que la notificación asíncrona es la que manda.

  Comprobado además que el webhook es **públicamente accesible** en los dos
  proyectos, que es condición para que Redsys pueda notificar: responde `400` a
  un POST vacío y `405` a un GET — respuestas nuestras, no un `403` de Google.

- [x] **N-6 · El cliente paga desde su móvil, sin ti delante.** *(2 sep 2026)*
  Hasta ahora solo se podía cobrar con tarjeta desde el backoffice y con el
  cliente al lado, porque abrir la pasarela exige un POST firmado.

  **Decisión de Dorel:** ruta pública propia, no Paygold.

  Lo construido:

  - `getPaymentCheckout`, Cloud Function **pública** que devuelve el formulario
    firmado. Comparte con `createRedsysPaymentLink` la preparación del pago
    (`prepareRedsysCheckout`), para no duplicar la firma, el formato del pedido
    ni la URL del webhook — tres cosas que ya han estado mal alguna vez.
  - Ruta pública `/pay/:paymentId`, **antes** del bloque con `authGuard`: pedirle
    a un cliente que inicie sesión para pagar es pedirle que no pague.
  - Pantalla pensada para el móvil, que es como llega el enlace: el importe
    grande y primero, botón de 52 px, y la marca de la empresa arriba.
  - Botón **«Copiar enlace de pago»** en cada fila pendiente de la reserva.

  **Lo que devuelve y lo que no.** Solo importe, concepto y marca. Nunca el
  nombre del pagador, su email, el cliente, el vehículo ni la reserva: quien
  abre un enlace reenviado no debe enterarse de con quién trabajas. Comprobado
  llamando a la function sin ninguna cabecera de autenticación.

  Un pago **ya cobrado no genera formulario**: devuelve `paid` y la pantalla lo
  dice. Sin eso, reenviar el enlace después de pagar cobraría dos veces. Un id
  inexistente y uno cancelado responden lo mismo, para no confirmar desde fuera
  si un identificador es real.

  `Ds_Merchant_UrlOK` y `UrlKO` apuntan ya a la propia pantalla de pago, que
  consulta el estado. Y como la notificación de Redsys puede llegar un instante
  después que el navegador, hay un **«Ya he pagado, actualizar»**: en vez de
  fingir que sabemos el resultado, se vuelve a preguntar.

  **Probado de extremo a extremo** en desarrollo: enlace → pantalla en móvil →
  tarjeta de prueba → 3DS → «Pago recibido», y la reserva pasó sola a
  **Pagado: 199,65 €** por el webhook.

  ⚠️ Falta desplegar `getPaymentCheckout` **en producción**.
  `createRedsysPaymentLink` declara `REDSYS_SECRET_KEY` pero lee
  `REDSYS_MERCHANT_CODE`, `REDSYS_TERMINAL` y `REDSYS_ENVIRONMENT` de
  `process.env` sin declararlos. Salen `undefined` y la función responde «Redsys
  no está configurado» **en los dos entornos**, aunque en dev los tres secrets
  existen.

  No se ha arreglado a la vez que M-22 a propósito: en producción **no existe
  ninguno de los tres**, y declarar un secret inexistente tumba el despliegue.
  El orden es crearlos en prod y después añadirlos al `secrets: [...]`.

  Alternativa a decidir: ninguno de los tres es un secreto de verdad —el código
  de comercio y el terminal van en el formulario que ve el cliente— así que
  encajarían mejor en `functions/.env.<proyecto>`, que Firebase inyecta sin
  declarar nada. Solo `REDSYS_SECRET_KEY` necesita Secret Manager.

- [x] **M-4 · `VELTO_PUBLIC_BASE_URL` no llegaba a ninguna function.** *(31 ago 2026)*
  En producción no estaba puesta. En desarrollo estaba puesta **como secret sin
  declarar**, así que tampoco llegaba: el enlace de firma llevaba meses saliendo
  relativo y los cortos apuntando al dominio `.web.app`. El secret existía, y eso
  bastaba para dar el asunto por resuelto sin estarlo.

  Resuelto por la misma vía que M-28, `functions/.env.<proyecto>`:

  | | Dominio |
  |---|---|
  | desarrollo | `https://store.veltorent.com` |
  | producción | `https://rentalcar.veltomobility.com` |

  **Verificado en desarrollo de punta a punta**: la respuesta de
  `generateBookingConfirmationPdf` trae ya
  `pdfUrl: https://store.veltorent.com/d/rtuKt8s4DW2ivAOBZru65`, y ese enlace
  responde `200 application/pdf`.

  El rewrite `/d/**` está activo en **los dos dominios propios**: con un id
  inexistente responden `404`, no `200 text/html`, que es lo que devolvería la
  SPA si el rewrite faltara.

  ⚠️ Queda el secret `VELTO_PUBLIC_BASE_URL` en Secret Manager de desarrollo,
  inútil pero inofensivo. Se puede borrar con
  `firebase functions:secrets:destroy VELTO_PUBLIC_BASE_URL --project dev`.

- [x] **M-14 · Los cobros manuales duplican los pagos preparados.** *(24 ago 2026)*
  Al crear una reserva, `createInitialPaymentsForReservation` siembra tres
  documentos de pago en estado `pending` (señal, resto, fianza). Pero
  «Registrar cobro» **creaba documentos nuevos** en vez de liquidar aquellos.

  Resultado observado al cerrar la reserva de prueba: seis filas donde debería
  haber tres, y tres pagos que se quedaban en «Pendiente» para siempre sobre una
  reserva ya cerrada. El resumen derivado sí era correcto —la reserva quedaba
  `paid` y `closed`— pero la lista que veía el operador decía lo contrario.

  **Decisión: se mantienen los placeholders y el cobro los liquida.** Se
  descartó eliminarlos porque son lo único que da contenido a la pestaña
  «Pendientes» del módulo de pagos y lo que conserva el vencimiento del resto
  como fila accionable. Lo aplicado:

  - `selectSettleablePayment` / `applySettlement` en `payment-summary.util.ts`
    (lógica pura, 11 tests nuevos). El importe **se acumula**, no se sustituye:
    dos cobros parciales cierran la misma fila. Un cobro de más sube el `amount`
    de la fila en vez de dejar un pendiente negativo.
  - `PaymentService.registerReservationPayment()` busca la fila abierta del tipo
    elegido y la liquida; solo crea documento nuevo si no hay nada que liquidar
    (cargos extra, `rental_payment`, o un cobro sobre un concepto ya pagado).
  - Cerrar o cancelar una reserva cancela sus pagos sembrados que nunca
    cobraron un euro (`cancelUncollectedPayments`). Los parciales se respetan:
    cancelarlos borraría su `paidAmount` del resumen.

- [~] **M-17 · No hay pluralización en ningún sitio.** *(descartado el 1 sep 2026)*
  El asistente y el detalle escriben «1 días» porque concatenan el número con
  `reservations.fields.totalDays`, que es una cadena fija en plural. Pasa en
  la tarjeta del vehículo del paso 2, en el resumen y en el detalle de la
  reserva. Decidir el enfoque: claves `_one` / `_other` por idioma —el rumano
  además tiene forma *few*, «2 zile» frente a «21 de zile»— o un pipe propio.
  No es solo cosmético: son tres idiomas con reglas distintas.

- [x] **M-18 · El vehículo no disponible muestra el estado en inglés.** *(1 sep 2026)*
  En el paso 2 del asistente, un coche ocupado se etiqueta «Reservado
  (reserved)»: `conflictMessage` compone el texto traducido y añade entre
  paréntesis el valor crudo del enum. Decidir si el paréntesis aporta algo al
  operador o se quita.

- [x] **M-19 · El paso «Resumen» del asistente nace marcado como completado.** *(1 sep 2026)*
  `isStepComplete('summary')` devuelve `true` siempre, así que el cuarto paso
  aparece con el check verde desde que se abre el formulario, cuando todavía
  no se ha creado nada. Decidir si el último paso debe considerarse completo
  solo tras crear la reserva, o si el check ahí no significa nada y conviene
  no pintarlo.

- [x] **M-20 · Las fotos se subían y se servían a tamaño completo.** *(1 sep 2026)*
  La caja de la tarjeta mide 140 px y se descargaba el original: en una lista de
  flota, varios megas por pantalla. Pero el problema tenía **dos mitades**, y la
  que nadie había medido era la otra: el operador **subía** 3-5 MB por foto,
  desde la calle y con la cobertura que hubiera.

  **Decisión de Dorel:** reducir **en el navegador antes de subir**, y guardar
  solo la versión reducida. Es lo único que arregla las dos mitades a la vez, y
  no añade infraestructura ni coste — frente a la extensión `Resize Images` o
  una Cloud Function con `sharp`, que solo habrían mejorado la descarga.

  Se guardan dos ficheros: la versión de uso (máx. 1600 px) y una miniatura
  (máx. 400 px). Medido con una foto de 4032×3024:

  | | Peso | Dimensiones |
  |---|---|---|
  | Entrada | 2.527 KB | 4032×3024 |
  | Guardada | 906 KB | 1600×1200 |
  | Miniatura | **74 KB** | 400×300 |

  La lista de flota pasa de 2,5 MB por coche a **74 KB**. Y la imagen de prueba
  era ruido, el peor caso para JPEG: una foto real comprime bastante más.

  Aplicado también a las **fotos de inspección**, donde importa más todavía:
  son varias seguidas, en la calle y con el cliente delante.

  Detalles que no se ven pero cuestan si faltan:

  - Si el navegador no sabe reducir el fichero —HEIC, por ejemplo— se sube el
    original y se sigue. **Una miniatura que falla no puede costar la foto.**
  - El borrado se lleva las **dos**, o la miniatura se queda huérfana en Storage
    para siempre. Verificado: tras borrar, ninguna de las dos responde.
  - `size` y `contentType` describen lo que se guarda, no el original: si
    dijeran 4 MB estarían describiendo un fichero que no existe.
  - Los `ImageBitmap` se cierran. Con varias fotos seguidas desde el móvil, no
    hacerlo es la diferencia entre que la pestaña aguante o se recargue sola.

  La aritmética está en `image-resize.util.ts` con **11 tests** —incluido que
  una imagen pequeña no se amplía y que una panorámica no acaba con un lado de
  0 px—. El redimensionado en sí usa `canvas`, que jsdom no implementa: eso se
  verificó subiendo una foto de verdad.


- [x] **M-16 · Los `alert()` de la pantalla de reserva están en español duro.** *(1 sep 2026)*
  `registerPayment()` y `processDeposit()` avisan con
  `alert('Error al registrar el pago')` y `alert('Error al procesar la fianza')`,
  sin pasar por i18n. Son cadenas escritas a mano, el mismo problema que F-13
  pero en código en vez de plantilla. Decidir si se traducen o si se sustituyen
  los `alert` por un aviso en pantalla.

- [x] **M-15 · «Total pagado» suma la devolución de fianza como ingreso.**
  Tras cerrar la reserva mostraba 693 €, que es
  350 + 150 + 18 + 25 + 43 + 107: mete en el mismo saco el alquiler, la fianza,
  los cargos extra, la retención **y la devolución** —dinero que sale—. El
  documento funcional dice que la fianza no debe contar como ingreso de
  alquiler. Separar ingresos reales de movimientos de fianza.

  **Resuelto el 28 de agosto de 2026.** El resumen ya lo calculaba bien; era el
  detalle de la reserva el que sumaba por su cuenta todos los `paidAmount`.
  `collectedTotalsOf()` en `payment-summary.util.ts` separa ingresos
  (alquiler + extras + cobro libre) de movimientos de fianza, con la reserva
  cerrada del 21 de agosto como caso de prueba. La retención **no** cuenta como
  ingreso: es cómo se pagaron los cargos extra, no dinero adicional. La etiqueta
  pasa a ser «Cobrado (sin fianza)», porque el número cambió de significado.

- [ ] **M-21 · Eximir la fianza automáticamente a clientes conocidos.**
  Hoy la fianza es editable y puede ponerse a 0 con motivo, pero la decisión es
  manual en cada reserva. Lo natural sería que un cliente con `trustLevel`
  distinto de `new` viniera ya con la fianza a 0 y un motivo propuesto. **No se
  ha hecho a propósito**: es un cambio de lógica de negocio —quién paga fianza y
  quién no— y esa decisión es tuya, no del código. Si se hace, el motivo debe
  seguir quedando registrado, porque es lo que permite cerrar la reserva.

## Decisiones tuyas pendientes *(28 ago 2026)*

Salidas de crear los dos coches y los dos clientes desde cero. Ninguna es un
fallo: son convenciones que hay que elegir.

- [ ] **D-1 · ¿Cómo se capitalizan direcciones y lugares?** Hoy conviven dos
  reglas: el asistente title-casea el lugar de recogida y sale
  «Arganda **Del** Rey» en el presupuesto y en el contrato; la dirección del
  cliente no se toca y se guarda tal cual se teclee («avenida de la
  constitución 45»). Las tres opciones son: dejar las preposiciones en
  minúscula (Arganda del Rey), capitalizar solo la primera letra, o no tocar
  nada y que el operador escriba. Afecta a documentos que ve el cliente.

- [ ] **D-2 · La versión del coche no llega al contrato.** El presupuesto dice
  «Dacia Duster Journey TCe 130» y el contrato y el justificante dicen «Dacia
  Duster»: `vehicleSnapshot` no guarda `version`. Si quieres que el contrato
  identifique el coche igual que la oferta, hay que añadir el campo al snapshot
  (solo afecta a reservas nuevas).

- [ ] **D-3 · ¿El aire acondicionado debería venir marcado por defecto?** Un
  coche nuevo nace sin A/A y el ACRISS sale con «N» (sin aire) hasta que lo
  marcas. En una flota de 2026 lo raro es el que no lo lleva.

- [ ] **D-4 · Números en inglés fuera del español.** Se ha fijado el formato
  español (9.200 km · 423,50 €) porque el `LOCALE_ID` se decide al arrancar y no
  puede seguir al selector de idioma. El rumano comparte convención; **en inglés
  se verán números españoles**. Si algún día hay un operador que trabaje en
  inglés, hay que hacerlo dinámico y eso es bastante más trabajo.

- [ ] **D-5 · ¿Sirve de algo «Pago completo del alquiler»?** El desplegable de
  cobro ofrece `rental_payment`, pero ese tipo no cuenta ni como señal ni como
  resto: cobrando por ahí, la reserva **no pasa a confirmada** ni se marca como
  pagada, aunque el dinero esté. O se quita del desplegable, o tiene que liquidar
  las dos filas sembradas.

- [ ] **D-6 · Confirmar la subida de fotos en tu móvil.** Al unificar el control
  se quitó `capture="environment"`, que forzaba la cámara e impedía subir un
  documento de la galería. Ahora abre el selector del sistema, que ofrece las dos
  cosas. Merece una comprobación en tu teléfono.

## Prioridad media

- [ ] **M-5 · Subida de fotos de una en una.**
  Los dos `input[type=file]` tienen `multiple: false`. El documento funcional
  pide 8 fotos por inspección (frontal, trasera, laterales, interior, cuadro,
  combustible, daños): son 8 ciclos de abrir el selector. Permitir selección
  múltiple desde galería, manteniendo la cámara de una en una.

- [ ] **M-6 · Las fotos de vehículo se recortan mal.**
  Una foto vertical de 1086×1448 se muestra en una caja de 347×180: el recorte
  se come el coche. Además se descarga la imagen completa para pintarla a 347 px.
  Generar miniaturas al subir, o al menos servir tamaños responsivos.

- [x] **M-7 · El formulario de cobro empieza en 0 €.** *(24 ago 2026, con M-14)*
  «Registrar cobro» abría con importe y pagado a 0, cuando la pantalla ya sabe
  que faltan 300 € de resto y 150 € de fianza. Cerrado como parte de M-14, donde
  además pasó a ser obligatorio: con el modelo de liquidar la fila pendiente, un
  formulario a 0 la habría saldado con 0 €. `onPaymentTypeChange()` prerrellena
  importe y pagado con lo que falta del concepto elegido, y `registerPayment()`
  rechaza los importes a 0.

- [x] **M-8 · El PDF del contrato no lleva logo.** *(ya estaba resuelto)*
  `pdf.ts` no dibuja ninguna imagen de marca. El documento que firma el cliente
  sale sin identidad visual. Ahora que los SVG están ordenados es fácil de
  añadir.

- [x] **M-9 · `capitalizeWords` no trata los guiones.**
  «madrid-barajas» se queda en «Madrid-barajas». Capitalizar también tras
  guion y apóstrofo. ⚠️ **Sube de prioridad:** desde N-1 esto ya no se queda en
  el formulario — el 27 de agosto salió impreso en un presupuesto real como
  «Aeropuerto Adolfo Suárez Madrid-barajas, Terminal 4».

  **Resuelto el 28 de agosto de 2026.** Las dos copias privadas —asistente y
  formulario de vehículo— se sustituyen por `shared/utils/text-case.util.ts`,
  que respeta guiones, barras y apóstrofos. 7 tests.

## Prioridad baja

- [ ] **M-10 · El dashboard no ofrece reintentar.**
  Cuando la carga falla ya se avisa correctamente, pero la única salida es
  recargar la página. Un botón de reintento es barato.

- [ ] **M-11 · Reservas canceladas con «pago pendiente».**
  El listado muestra reservas canceladas con su saldo pendiente en rojo, lo que
  invita a perseguir un cobro que ya no toca. Decidir si se ocultan esos
  importes o se marcan como no exigibles.

- [x] **M-12 · Producción tiene 4 índices que no están en el repo.**
  Lo avisó el despliegue de índices. Revisar si sobran (y borrarlos) o si
  faltan en `firestore.indexes.json`. Uno identificado al revisar M-14:
  `getPaymentsByReservation` consulta `reservationId ==` + `orderBy('createdAt')`
  y funciona en producción, luego el índice existe allí pero no está declarado.

  **Resuelto el 28 de agosto de 2026, y era peor de lo que decía esta nota.** Los
  cinco índices declarados usaban `"arrayConfig": "CONTAINS"` en `clientId`,
  `vehicleId` y `status`, que es el índice de `array-contains` — otra consulta
  distinta. Ninguno servía a las consultas de la app: las que funcionaban lo
  hacían con índices creados a mano desde el enlace del error de la consola. El
  fichero se ha reescrito con los ocho que las consultas piden de verdad,
  declarados con `order`. **Hay que desplegarlos:**
  `firebase deploy --only firestore:indexes`.

- [ ] **M-13 · Avisos de `Cross-Origin-Opener-Policy` en el login.**
  Los emite el popup de Google Auth en el servidor de desarrollo. No afectan a
  producción, pero ensucian la consola y esconden avisos reales.

---

## Pendiente de probar

El ciclo completo del alquiler está ejercitado de principio a fin: vehículo,
cliente, cliente rápido, reserva, contrato, firma, entrega, devolución con
cargos extra, resolución de fianza y cierre. Queda:

- [x] Cobro libre con Redsys contra el entorno de test real — **probado el 31 de
      agosto de 2026**: pago autorizado (código 002329), webhook recibido y
      pago en `paid` en Firestore. También probado el cobro de una fila
      pendiente desde la reserva (M-31), con la reserva pasando a `confirmed`.
- [x] Redsys **en producción, con dinero real** — *31 de agosto de 2026*. Cobro
      libre de 10,00 € contra `sis.redsys.es`, pedido `14182A8C727F`:

      ```
      status: paid · paidAmount: 10
      responseCode: 0000 · authorizationCode: 379521
      notifiedAt: 2026-08-31T17:27:55.981Z
      ```

      El webhook de producción recibió la notificación, validó la firma con la
      clave real y escribió el resultado. **Quedan 10 € cobrados de verdad a
      GATE2FLY: devolver desde el panel de Redsys.**

      ⚠️ Aquel día la pasarela se abrió lanzando el POST **a mano desde la
      consola**, porque el hosting de producción servía aún el bundle anterior.
      **Dorel lo da por bueno el 4 de septiembre de 2026**: ha probado el botón
      ya desplegado hasta la pasarela, sin llegar a finalizar el cobro. Queda
      cerrado; si alguna vez falla, el sitio donde mirar es
      `RedsysPaymentService.openGateway()`, que es el POST compartido por las
      dos pantallas.
- [x] Envío del contrato firmado por email con Resend — **probado de extremo a
      extremo el 29 de agosto de 2026** en `velto-store`, ciclo completo desde
      cero: vehículo → cliente → presupuesto → reserva → señal → contrato →
      link de firma → firma del cliente → email. Contrato `C-TUKT8S-2026`,
      `emailedAt: 2026-08-29T11:20:03.933Z` en Firestore, que solo se escribe si
      Resend devolvió `ok`. Remitente `reservas@veltorent.com`, destinatario
      `dbindea@gmail.com`. **Repetido en producción el 31 de agosto** (C-23):
      contrato `C-1342VA-2026`, remitente `reservas@veltomobility.com`,
      respuesta `200` y no `403` — que es lo que prueba que Resend tiene el
      dominio verificado.
- [x] Módulo de mantenimiento de vehículos — **probado el 31 de agosto de 2026**:
      alta completa (tipo, estado, prioridad, coste, proveedor, próxima revisión)
      y guardado en `vehicleMaintenance`, que hasta hoy estaba vacía. Salieron
      M-38 y M-39.
- [x] Subida de fotos dentro de una inspección — **probada el 31 de agosto de
      2026**: sube a Storage bajo `inspections/` y se muestra en la ficha.
- [x] Registro de daños en la devolución — **probado el 31 de agosto de 2026**:
      zona, gravedad y descripción quedan registrados en la inspección.
- [x] Cancelación de una reserva — **probada el 31 de agosto de 2026**. Sacó
      M-36 (no se podía cancelar una reserva confirmada) y M-37 (el estado del
      pago en inglés).
- [x] Excepciones de workflow desde la UI — **implementadas y probadas el 1 de
      septiembre de 2026** (N-7): motivo obligatorio, el paso se desbloquea y
      queda registrado con autor y fecha en la ficha de la reserva.
- [x] **N-4 end-to-end** *(4 sep 2026: descuento del 10 % congelado en el snapshot)*: poner un 10 % a un cliente, crear reserva y comprobar
      que el snapshot congela el porcentaje; luego retirárselo y verificar que
      la reserva anterior no se mueve
- [ ] **N-4 + bloqueo**: marcar `blocked` a un cliente con descuento y
      comprobar que se retira y queda anotado en el histórico
- [x] **N-3 en el PDF real**, tras desplegar las functions a mano.
      *(27 ago 2026, 23:30)* Desglose correcto en presupuesto y contrato, en las
      dos direcciones de IVA.
- [x] **N-1 end-to-end** *(4 sep 2026: enlace corto abierto sin sesión, 200 application/pdf)*: generar un presupuesto, abrir el enlace y comprobar
      que se ve desde un móvil sin sesión
- [x] **N-2 end-to-end** *(4 sep 2026: regenerado, el enlace del cliente sigue vivo)*: cobrar la señal, emitir el justificante, regenerarlo
      y verificar que **el primer enlace sigue funcionando**
- [x] **Fianza a 0** — **probado el 31 de agosto de 2026**: no siembra fila de
      fianza, la marca «Exenta» con su motivo, y el motivo es obligatorio en el
      asistente. Usada además como caso peor de M-33.
- [x] **El presupuesto en los tres idiomas**, cambiando el idioma de la
      plataforma antes de generarlo. *(27 ago 2026, 23:30)* es/en/ro correctos
      contra la function desplegada; el rumano con `ă ș ț` y `€` sin cajas
      vacías. Falta repetirlo con el **justificante** y el **contrato**.
- [x] **Los tres PDF abiertos en un visor real.** *(27 ago 2026, noche)* Vistos
      en el visor del navegador, en español. El logo, los filetes y el turquesa
      salen bien. De mirarlos salieron dos correcciones que las medidas no
      detectaban: el título del presupuesto al doble de tamaño que el del
      contrato y las etiquetas «Lugar de entre…» recortadas. Falta repetirlo en
      **en** y **ro**.
- [ ] **Elegir y conectar el dominio de los enlaces al cliente.** Hoy salen con
      `velto-store.web.app`. Al conectarlo basta con apuntar
      `VELTO_PUBLIC_BASE_URL` al dominio nuevo: **no hay que tocar código**, y
      los enlaces de firma se mueven con él.

      ⚠️ **No apuntar la raíz de `veltorent.com` a este hosting.** La §11 del
      documento funcional reserva ese dominio para la **web pública** de coches
      y deja la app interna en `store.veltorent.com`. Este proyecto de Firebase
      sirve el backoffice: si se le cuelga la raíz, se cierra la puerta a la web
      pública. Usar un subdominio (`store.` o uno propio para documentos).
      `veltomobility.com` sirve igual; la elección es comercial, no técnica.
- [ ] **Probar un enlace corto desde el móvil**, fuera de la sesión del
      operador, para confirmar que abre el PDF en el navegador de WhatsApp
- [ ] **Revisar los secrets de empresa** antes de dar por buena la marca:
      `VELTO_COMPANY_NAME`, `_ADDRESS`, `_PHONE`, `_REGISTRY`. Si están puestos
      con los valores antiguos, el código nuevo no los cambia.
- [ ] **Confirmar los datos registrales con la gestoría.** El código traía
      «Tomo 45067, Folio 44, Hoja M-793170» y la factura dice «Hoja M-893718 ·
      IRUS 1000477431057». Se ha adoptado el de la factura.

---

# Funcionalidades nuevas

Anotadas el **26 de agosto de 2026**. No son mejoras de algo existente: hay que
construirlas. Cada una lleva lo que ya hay en el código y **lo que falta decidir
antes de programar**.

**Las cuatro están construidas.** N-3 y N-4 el 26 de agosto de 2026, porque
modificaban el mismo sitio —`pricingSnapshot`— y el mismo PDF; N-1 y N-2 el 27,
por la misma razón entre ellas: los dos son documentos cortos que comparten
plantilla, subida a Storage y enlace.

Nota transversal: todo lo que se guarde en el snapshot es **histórico
congelado**. Si mañana cambia el IVA o se le retira el descuento a un cliente,
los contratos ya emitidos tienen que seguir cuadrando.

✅ **Desplegado el 27 de agosto de 2026.** Las cuatro están en producción:
`generateQuotePdf`, `generateBookingConfirmationPdf` y `generateContractPdf`
responden (verificado: devuelven `UNAUTHENTICATED` a una llamada sin sesión, no
404), y el hosting sirve ya la app con la marca nueva.

## Estado de despliegue — 27 de agosto de 2026, tarde

✅ **Verificado en vivo:** el rewrite `/d/**` ya funciona
(`velto-store.web.app/d/q…` devuelve `200 application/pdf`). Los enlaces
cortos de presupuesto y justificante están operativos.

⚠️ **Todo lo commiteado el 27 por la tarde está SIN desplegar.** Comprobado
leyendo el CSS vivo: no contiene el `aspect-ratio` del logo nuevo, así que el
hosting es anterior a esa tanda. Hacen falta **los dos** despliegues:

```bash
npm --prefix functions run deploy   # PDF: IVA, tipografía, firmas, títulos
firebase deploy --only hosting      # logo, precio neto en el asistente
```

Sin el de functions, los PDF siguen saliendo con el formato viejo **y con el
IVA en la dirección antigua**, que ahora ya no coincide con lo que enseña la
app: la app mostraría neto + IVA y el PDF extraería el IVA del total.

Los dos despliegues siguen pendientes al cierre del 27 por la noche, y ahora
arrastran además lo de esa noche: el ajuste manual en negativo y la pantalla de
reserva reordenada (hosting), y la escala tipográfica del presupuesto y del
justificante (functions). Ver
[pruebas-modulos-2026-08-21.md](pruebas-modulos-2026-08-21.md), C-2 a C-4.

Para comprobar que el rewrite sigue vivo tras cualquier despliegue de hosting:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}
" https://velto-store.web.app/d/qXXXX
# application/pdf → bien | text/html → el rewrite no está
```

---

## ✅ N-1 · PDF de presupuesto, antes de cerrar la reserva *(27 ago 2026)*

Botón **«Generar presupuesto»** en el resumen del asistente, justo encima de
«Crear reserva», porque es el paso que va antes en una conversación real.

**Decisiones tomadas:**

1. **Efímero.** No se crea documento en Firestore, no existe el estado `quote`,
   y el coche **sigue disponible** para cualquier otro. El PDF lo dice con esas
   palabras, para que el cliente no crea que tiene el coche apartado.
2. **Validez de 7 días**, impresa como «Válido hasta». Es un compromiso
   comercial, no técnico: sin persistencia no hay nada que respete ese precio
   automáticamente.
3. **Se comparte por enlace**, pensado para pegar en WhatsApp.

**La tensión, y cómo se resolvió.** «Efímero» y «enlace para WhatsApp» se
contradicen a medias: un enlace exige que el archivo viva en algún sitio. El PDF
se sube a Storage y se devuelve su URL, pero no se escribe **nada** en
Firestore. Es efímero en lo que importa —no hay presupuesto que gestionar,
caducar ni limpiar—; lo único que queda es el archivo.

**Lo aplicado:**

- `generateQuotePdf` (callable, auth). Cada presupuesto va a
  `quotes/{uuid}/quote.pdf`: dos presupuestos del mismo coche el mismo día son
  ofertas distintas, y sobrescribir una con otra cambiaría un documento ya
  enviado.
- A diferencia de la reserva, **no recalcula el precio**: no hay reserva de la
  que derivarlo y duplicar el motor de tarifas en functions daría dos copias que
  mantener. Es aceptable porque el documento no es vinculante y quien llama es
  un operador autenticado que ya puede pactar cualquier precio a mano.

**Rastro pendiente:** sigue habiendo CSS `.status-quote` en cuatro componentes
para un estado que ahora ya sabemos que **no va a existir**. Es CSS muerto.

## ✅ N-2 · PDF de la reserva confirmada, sin contrato firmado *(27 ago 2026)*

**Justificante de reserva**: documento corto y propio —localizador, coche,
fechas, importes, estado de los pagos y qué falta por hacer—. Se descartó
mandar el contrato sin firmar: por muy marcado que fuera, es un contrato en las
manos del cliente antes de tiempo.

**Decisiones tomadas:**

1. **Documento propio**, no el contrato en estado `generated`.
2. **Solo desde `confirmed`.** Antes de cobrar la señal, un papel titulado
   «justificante de reserva» afirmaría algo que no ha pasado. Lo comprueban las
   dos capas: la tarjeta no aparece en la UI y la function lo rechaza con
   `failed-precondition`.
3. **Se comparte por enlace**, igual que el presupuesto.

**Lo aplicado:**

- `generateBookingConfirmationPdf` (callable, auth), que lee la reserva y
  **no escribe nada de vuelta**. Ni `contractStatus`, ni `contractInfo`, ni
  cambio de estado. Es la salvaguarda que pedía el planteamiento: que el cliente
  tenga este PDF no puede acercar la entrega ni un paso. Los guards siguen
  siendo lo único que decide.
- El PDF dice explícitamente **«NO es el contrato de alquiler»**, y la lista de
  «qué falta por hacer» se adapta: firmar, pagar el resto, dejar la fianza,
  traer la documentación — solo aparece lo que de verdad está pendiente.
- Al regenerarlo se **reutiliza el token de descarga** del archivo anterior, así
  que el enlace que el cliente ya tiene en su chat sigue funcionando. Escribir un
  token nuevo lo habría roto en silencio.

**Localizador:** `R-XXXXXX` a partir del id, misma convención que el número de
contrato, para que los dos documentos de un alquiler se citen igual.

## ✅ N-3 · Desglose del IVA en el contrato *(26 ago 2026)*

El precio mostraba solo el total con IVA incluido. Ahora el contrato, el
asistente y el detalle de la reserva enseñan base imponible, IVA y total.

**Decisiones tomadas:**

1. **21 % fijo en constante**, `DEFAULT_VAT_RATE = 0.21` en `pricing.util.ts`.
   Se descartó hacerlo configurable en Ajustes —que sigue siendo un
   placeholder— y por vehículo, que solo tendría sentido con flota en Canarias.
2. **Se ve en el PDF y en la app** (resumen del asistente y detalle de la
   reserva), no solo en el contrato: el operador ve lo mismo que el cliente.
3. **La fianza no lleva IVA** y las multas tampoco; combustible, limpieza,
   kilómetros y daños sí.

**Lo aplicado:**

- `extractVat()` en `pricing.util.ts`. El IVA se calcula **por resta**
  (`vat = total − base`), no multiplicando la base, para que `base + vat` sea
  exactamente el total: redondear las dos partes por separado desviaba un
  céntimo con frecuencia suficiente como para que se notara en un contrato.
- `pricingSnapshot.vatRate` congela el tipo al crear la reserva. Una reserva
  anterior a este campo cae al tipo general vía `resolveVatRate()`, que es el
  que su precio ya incluía —el campo registra el tipo, nunca lo cambió—.
- El PDF imprime base, IVA y «Total alquiler (IVA incl.)», y etiqueta la fianza
  como **«no sujeta a IVA»**. Etiquetas en los tres idiomas en `pdf.ts`. La
  cláusula 4 ya decía que el precio «figura desglosado»; ahora es cierto.
- En functions la constante y la aritmética están **duplicadas a propósito**:
  app y functions compilan con tsconfigs distintos y no pueden compartir módulo.
  Va comentado en ambos lados.

**Verificado** renderizando el PDF en local en tres escenarios —sin descuentos,
con los dos descuentos, y una reserva antigua sin `vatRate`—: los tres imprimen
289,26 + 60,74 = 350,00 y 413,22 + 86,78 = 500,00 respectivamente.

**Queda fuera:** los cargos extra de la inspección de devolución no se
desglosan. El contrato se genera antes de que existan, y tocarlo implicaba
entrar en la lógica de pagos recién estabilizada en M-14.

## ✅ N-4 · Descuento de fidelidad por cliente *(26 ago 2026)*

Un porcentaje en la ficha del cliente que se aplica a sus reservas nuevas.

**Decisiones tomadas:**

1. **Separados y acumulativos.** Tarifa → descuento de fidelidad → ajuste
   manual encima. `loyaltyDiscount` y `manualAdjustment` viven como campos
   distintos del snapshot, ambos con signo. Fundidos en un solo número, el
   desglose de N-3 no habría podido justificar cada línea.
2. **Se asigna a mano**, no se gana por umbrales. Independiente de
   `trustLevel`, salvo que **bloquear a un cliente retira el descuento**.
3. **Tope del 30 %** y registro de cada cambio con autor y fecha.

**Lo aplicado:**

- `resolveRentalPrice()` en `pricing.util.ts` es ahora **la única autoridad
  sobre el precio**: la usan el asistente y `reservation.service.ts`, que lo
  recalcula en vez de fiarse de la cifra que enseñó la UI. 22 tests nuevos.
- El `manualAdjustment` mide contra el precio **ya descontado**, no contra la
  tarifa. Cambiar de cliente en el asistente descarta un precio acordado
  previo: la base sobre la que se pactó ya no es la misma.
- `Client.loyaltyDiscountPercent` + `loyaltyDiscountHistory[]`, append-only con
  autor, fecha y motivo, al estilo de `workflowExceptions[]`. El histórico se
  reconstruye en JS y **no** con `arrayUnion()`: `cleanData()` recorre el
  payload con `Object.entries()` y habría aplanado el centinela a `{}`, que es
  exactamente cómo `stripUndefined()` corrompió los timestamps en F-4.
- El formulario recorta al tope mientras se escribe, para que nadie teclee 50 y
  guarde 30 sin enterarse. La ficha del cliente muestra el descuento como badge.
- El contrato imprime tarifa, descuento con su porcentaje y ajuste acordado,
  **solo cuando movieron el precio**: un alquiler sin descuentos se lee igual
  que antes.

**Queda fuera:** el descuento no se aplica a reservas ya creadas, por diseño —
el snapshot es histórico congelado.

## N-5 · Pre-reserva desde la web pública *(anotado el 29 ago 2026 — sin decidir)*

El cliente elige coche en una web pública, recibe por WhatsApp un enlace de
pre-reserva con **validez de 3 horas**, y en ese plazo paga la señal por TPV o
contacta para pagarla en efectivo. Si es conocido y es horario de oficina,
Dorel puede darla por confirmada **sin señal**. Lo que no se paga, se
autocancela.

**Lo que se propuso, y por qué.** Una colección aparte, `preReservations`, y no
un estado más dentro de `reservations`:

- Una pre-reserva **no tiene cliente** — alguien de la web deja un teléfono y
  poco más. Meterla en `reservations` obliga a inventar clientes fantasma.
- Sus reglas de Firestore son distintas: la lee un desconocido con un token.
- Al caducar se queda donde está y **no ensucia** el listado de reservas ni los
  informes, como sí hace hoy una `cancelled`.
- Al pagar **se convierte**: nace la reserva de verdad y el flujo arranca en el
  paso 1, sin que el workflow sepa que existió la pre-reserva.

Forma tentativa: vehículo y precio congelados como en la reserva, `contact`
suelto, `status`, **`expiresAt`**, `token`, `holdMinutes`, y `confirmedBy` /
`confirmedReason` para cuando se confirma a mano sin cobro.

⚠️ **Lo delicado es la disponibilidad.** `searchAvailability()` tendría que
mirar también las pre-reservas vivas, y con una regla escrita: *una caducada no
bloquea aunque el trigger todavía no la haya marcado*. Fiarse solo del trigger
deja una ventana en la que el coche está bloqueado por algo muerto.

El trigger sería una function **programada** (`onSchedule`, cada 10-15 min) —
la primera del proyecto, hoy todas son llamables o webhooks — y trae consigo
Cloud Scheduler, que hay que habilitar en los dos proyectos.

**Cuatro decisiones antes de tocar nada:**

1. ¿La pre-reserva **bloquea** el coche de verdad durante las 3 horas, o pueden
   convivir varias y gana quien paga? Lo primero es honesto, lo segundo vende.
2. Al confirmar a mano sin señal, ¿la reserva nace `confirmed` con señal 0 y
   motivo obligatorio —como la fianza exenta— o `reserved` esperando cobro?
3. Si el pago por TPV llega **dos minutos después** de caducar, ¿se acepta o se
   devuelve? Redsys puede confirmar tarde.
4. El PDF: ¿un cuarto documento, o el presupuesto con una caja de «válido hasta
   las HH:MM»? Lo segundo reaprovecha plantilla, precios e IVA.

## ✅ N-8 · Sellar el contrato con el certificado FNMT *(hecho el 4 sep 2026)*

Funcionando en los dos entornos. El contrato firmado sale con firma PKCS#7 del
certificado de la empresa: `/ByteRange`, `Adobe.PPKLite`, `adbe.pkcs7.detached`
y el motivo «Contrato de alquiler C-…».

**El hueco de la firma se quedó corto en el primer intento.** Reservé 8192 bytes
«porque una firma ronda los 3-4 KB» y el certificado real falló con *Signature
exceeds placeholder length: **11916 > 8192***: el certificado FNMT de
representante incrusta la cadena completa de la autoridad. Ahora son 32 KB, con
margen para cuando se renueve y la cadena crezca.

⚠️ **Y ese fallo destapó un error de diseño mío.** La primera versión decidía si
imprimir «Firmado digitalmente con certificado digital» **antes** de intentar
sellar, así que el contrato de prueba salió afirmando una firma que no llevaba:
justo el problema que N-8 venía a arreglar, pero intermitente y silencioso.
Corregido: si el sellado falla, **el PDF se reconstruye sin la frase**. La
promesa y la realidad se deciden juntas.

El sellado **nunca aborta la firma**: si falla se guarda sin sellar, porque
perder el sello es un problema y perder la firma que el cliente acaba de hacer
es uno mucho peor.

**Sobre las dependencias.** El paquete habitual `@signpdf/placeholder-plain`
arrastra `pdfkit` → `crypto-js` con vulnerabilidades **críticas**, y ni siquiera
se usaría: el contrato se genera con `pdf-lib`. Se usa
`@signpdf/placeholder-pdf-lib`, que solo depende de `@signpdf/utils`. Auditoría
de lo añadido: cero vulnerabilidades.

⚠️ **Seguridad, 4 de septiembre de 2026.** Aparecieron el `.p12` y su base64 en
`public/` del repositorio. No llegaron a commitearse ni a publicarse —hosting
sirve `dist/`— pero un `git add .` los habría subido. Añadidas reglas a
`.gitignore` para `*.p12`, `*.pfx`, `*.key` y `cert.b64`. **Quien tenga ese
fichero y la contraseña puede firmar contratos en nombre de la empresa**: la
copia local hay que borrarla, el sitio del certificado es Secret Manager.

Sin sellado de tiempo, por decisión: la firma acredita quién y qué, no la fecha
ante un tercero. Se puede añadir después sin rehacer nada.

## N-8 (planteamiento original) *(anotado el 2 sep 2026)*

Dorel ya tiene el certificado FNMT de representante de la empresa. La idea es
sellar con él el PDF del contrato, después de que el cliente firme.

⚠️ **Hoy el contrato afirma algo que no es cierto.** En la casilla del
arrendador se imprime «Firmado digitalmente con certificado digital», y el
código lo reconoce en un TODO de `pdf.ts`:

> *apply the actual certificate to the generated PDF. Until then this states the
> intent; the note is not a substitute for the signature.*

Es una frase que va al cliente afirmando una firma que no existe. **Si N-8 se
retrasa, esa línea debería quitarse mientras tanto.**

**Qué implica.** El sellado va como último paso, después de incrustar la firma
manuscrita del cliente: un PDF firmado no se puede tocar sin romper la firma.
Son cuatro pasos —reservar el hueco de firma, calcular el hash, firmar con la
clave privada del `.p12`, reinsertar— y `pdf-lib` no firma, así que entra
`@signpdf` con `node-forge`. Las dos son JavaScript puro, sin binarios que
compilar. El `.p12` va a Secret Manager en base64, nunca al repositorio.

**Coste: prácticamente cero.** Librerías libres, certificado ya comprado, y
firmar son milisegundos de CPU. Lo único que puede costar es el **sellado de
tiempo**, que acredita *cuándo* se firmó; se puede empezar sin él y añadirlo
después.

**Complejidad: media, un par de días.** La mayor parte del tiempo se va en
comprobar que Adobe Reader valida la firma, que es donde esto suele fallar.

Tres cosas que vigilar:

- El certificado FNMT de representante **caduca a los dos años**. Si expira sin
  renovar, los contratos nuevos dejan de firmarse.
- El **orden importa**: sellar antes de incrustar la firma del cliente
  invalidaría el documento.
- Probarlo en los dos entornos.

**Lo que NO arregla, y conviene tener claro.** El certificado firma *como la
empresa*: acredita que el documento no se ha alterado y que lo emitiste tú. La
firma **del cliente** sigue siendo un trazo en un canvas —firma electrónica
simple, válida pero con poco peso probatorio si él la niega—. Sellar con el
certificado de la empresa no la convierte en cualificada. Para eso haría falta
un prestador de servicios de confianza, que cobra por firma y es otro
desarrollo.

## ✅ N-9 · QR de verificación en el contrato *(hecho el 4 sep 2026)*

En la casilla del arrendador van ahora **un QR y un código corto legible**,
`VLT-8QPB-YNT4-9AXJ`, junto a la línea «Firmado digitalmente con certificado
digital».

**Qué problema resuelve, y cuál no.** Un QR **no puede validar una firma
electrónica** — eso lo hace Adobe Reader o VALIDe abriendo el PDF. Lo que
resuelve es el **papel**: quien tiene una copia impresa no podía comprobar nada.
Con un CSV, como los de la Administración, confirma que el contrato existe, que
está firmado y —comparando la huella— que su fichero es el que emitimos. Los
textos del PDF y de la página dicen exactamente eso y no más.

**Decisiones de Dorel:**

- QR a una **página pública propia**, no al PDF suelto ni a VALIDe.
- La página **no muestra datos personales**: número de contrato, fecha de firma,
  matrícula, estado y huella SHA-256. Quien escanee un contrato olvidado en un
  mostrador no debe ver el nombre ni el DNI de nadie.
- **El QR no sustituye a la frase, convive con ella.** Son dos hechos distintos
  y cada uno es cierto por su cuenta: la frase dice que el PDF lleva el sello
  del certificado de la empresa, el QR sirve para comprobar el papel. Si el
  sellado falla, desaparece la frase y el QR se queda.

**Lo construido:**

- `verification.ts` — el código (12 caracteres sobre un alfabeto **sin `I`, `L`,
  `O`, `U`, `0` ni `1`**, porque se dicta por teléfono y se copia de un papel),
  su formato impreso y la huella. El sorteo va con **muestreo con rechazo**:
  `byte % 30` habría favorecido a los seis primeros símbolos.
- `qr.ts` — la matriz y **los rectángulos que se dibujan**, separados del dibujo
  a propósito (ver abajo). Vectorial, no un PNG: nítido al imprimir y sin un
  mega de imagen en un PDF que ya pesa.
- `getContractVerification`, function **pública** que devuelve cinco datos y
  ninguno personal. Un código mal formado ni siquiera consulta Firestore.
- Ruta pública `/v/:codigo` —y `/v` para teclearlo a mano— **antes** del bloque
  con `authGuard`.

**Las dos trampas, y cómo se resolvieron:**

- El QR va **dentro** del PDF que se sella, así que el código se decide antes de
  construirlo: un PDF firmado no admite cambios y no hay segunda oportunidad.
- La huella se calcula sobre **los bytes que se guardan**, después de sellar y
  después de la posible reconstrucción sin la frase. Calcularla antes daría un
  valor que no coincide con ningún fichero real, y la página le diría al cliente
  que su contrato está alterado.

**Un QR que no se lee tiene la misma pinta que uno que sí.** Por eso la
geometría vive fuera del dibujo y hay un test que **rasteriza los rectángulos
reales y los descifra con un lector** (`jsqr`): un índice de fila invertido o la
zona de silencio olvidada dan un cuadrado de aspecto normal que ningún móvil
entiende, y eso no se ve mirando el PDF.

**Verificado de extremo a extremo en desarrollo**, ciclo completo: reserva nueva
→ contrato → link de firma → firma del cliente → PDF sellado. Y sobre el fichero
real, no sobre la pantalla:

| Comprobación | Resultado |
|---|---|
| QR del PDF firmado, descifrado del render real | `https://store.veltorent.com/v/8QPBYNT49AXJ` |
| `sha256sum` del PDF descargado | `879a6d7c…8ff00272` |
| Huella que enseña la página | **la misma** |
| Sellado | `adbe.pkcs7.detached` presente · la página dice «Sí, con certificado digital» |
| Function sin cabecera de autenticación | cinco datos, ni nombre ni documento ni importe |
| Código inexistente y basura (`../../contracts`) | responden lo mismo |

Desplegada en los dos entornos el 4 de septiembre de 2026: **trece functions**.

⚠️ **Los contratos firmados antes de hoy no tienen código**, así que su QR no
existe y la página responde «no encontrado» si alguien inventa uno. Es lo
correcto y no se migra nada: los datos siguen siendo desechables.

---

## ✅ N-12 · Ajustes *(hecho el 4 sep 2026)*

El último placeholder. Dos pestañas, según lo que decidió Dorel: **valores por
defecto de la operación** y **usuarios autorizados**. Se descartaron los datos de
empresa —hoy los leen las Cloud Functions de `company-config.ts` y los `.env`, y
moverlos a Firestore es otro trabajo— y los textos del contrato, que son texto
legal y editarlos sin control se lamenta después.

**Los cinco ajustes, y hasta dónde llega cada uno:**

| Ajuste | A qué afecta |
|---|---|
| Fianza propuesta | Con la que abre el asistente y nace un vehículo nuevo. Manda la del coche si la tiene |
| IVA general | Reservas nuevas. **Se congela en cada una** |
| Validez del presupuesto | El «Válido hasta» del PDF. Lo lee la Cloud Function |
| Caducidad del enlace de firma | Los enlaces ya emitidos conservan la suya |
| Km incluidos por día | Con los que nace un vehículo nuevo |

⚠️ **Todo son valores por defecto para lo que se cree a partir de ahora.** Ni una
reserva hecha, ni un contrato firmado, ni un enlace enviado se mueven: cada uno
lleva los suyos congelados. Es lo que hace que sea seguro tener el IVA
configurable, y la pantalla lo dice antes de que nadie se lo pregunte.

**Las dos que viven en el backend** —validez del presupuesto y caducidad del
enlace— las lee `functions/src/settings.ts` del mismo documento. Sin eso, la
pantalla habría ofrecido dos campos que no cambiaban nada del PDF.

**Probado de extremo a extremo**: con la validez puesta a 15 días, un presupuesto
generado el 4 de septiembre salió con «Válido hasta: 19/09/2026»; con la fianza a
250, el asistente y el alta de vehículo la propusieron. Después se devolvieron a
7 y 150.

**Usuarios**: alta por correo de Google, rol, quitar y dar acceso, y borrar solo
lo ya desactivado. El email **se normaliza a minúsculas** —es el id del
documento, y `AuthService` lo busca por id exacto: guardado con mayúsculas, la
persona queda dada de alta y sin poder entrar—. Y **nadie puede desactivarse ni
degradarse a sí mismo**: el único administrador que se quite el acceso ya no
puede volver desde la aplicación.

- [x] **M-41 · `authorizedUser().email` salía siempre vacío.** *(4 sep 2026)*
  `AuthService` guardaba `userDoc.data()`, y **`data()` no incluye el id del
  documento** — que aquí *es* el email. Cualquier documento que no repitiera el
  email dentro dejaba la señal sin él.

  Se vio a la primera en la pantalla de Ajustes: la fila del propio usuario salía
  sin la marca «Tú» y **con el botón de quitarse el acceso a uno mismo**, que es
  justo la acción de la que no se puede volver. Es el mismo despiste que M-29 con
  `contract.id`.

---

## N-11 · Permisos por rol, hasta el último botón *(anotado el 4 sep 2026)*

Dorel quiere dar de alta a **compañeros de agencia con permisos reducidos**. La
mitad está hecha; esta tarea es la otra mitad.

**Ya funciona** (N-12): `permissions.util.ts` es la única autoridad, con la tabla
de rol → permisos y 12 tests. El menú y los guards de ruta la consultan, así que
un empleado **no ve ni entra** en Informes, Gastos ni Ajustes. Las reglas de
Firestore ya distinguen administrador para `authorizedUsers` y `settings`.

**Falta lo fino**, que es lo que gobierna botones dentro de una pantalla. Los
permisos ya están **declarados** en la tabla —`editPricing`, `grantDiscounts`,
`waiveDeposit`, `deleteRecords`, `cancelReservations`— y todavía no los consulta
nadie:

1. **Precios y descuentos.** El precio acordado del asistente, el descuento de
   fidelidad en la ficha del cliente y la exención de fianza. Es donde se regala
   dinero sin que se note.
2. **Borrar y cancelar.** Borrar vehículos, clientes o gastos, y cancelar
   reservas.
3. **Las reglas de Firestore que lo respalden.** Sin esto lo anterior es
   decoración: un guard oculta un botón, no impide una escritura. Hoy cualquier
   usuario autorizado puede escribir en `reservations`, `clients`, `vehicles` y
   `expenses`.

**Tres decisiones antes de tocar nada:**

- ¿Un empleado **ve** el precio y no puede cambiarlo, o tampoco lo ve? Lo primero
  es lo normal —tiene que decírselo al cliente— pero deja el margen a la vista.
- ¿Y los **gastos de un vehículo** dentro de su ficha? Hoy Gastos entero le queda
  cerrado, pero la pestaña del coche es otra puerta a lo mismo.
- ¿Hace falta un **tercer rol**? Con «administrador» y «empleado» no hay sitio
  para alguien que lleve la caja pero no la configuración.

⚠️ **Un permiso denegado tiene que explicarse.** Un botón que desaparece sin más
hace que el compañero llame preguntando qué le pasa a la aplicación. Igual que el
workflow dice «Falta contrato firmado», esto debería decir «Tu rol no permite
cambiar precios».

⚠️ **Y la tabla y las reglas tienen que decir lo mismo.** Son dos ficheros que
se editan por separado y nada los ata: cuando se añada un permiso, hay que tocar
los dos. Es la misma pareja UI/servicio que ya sostiene el workflow.

---

## ✅ M-42 · Un botón que no hace nada, en toda la aplicación *(4 sep 2026)*

Con el formulario de usuarios vacío, «Dar acceso» **no hacía nada**: el botón
estaba deshabilitado y nada decía por qué. El mismo patrón estaba repartido por
media aplicación, y en el resto la explicación era un `alert()` del navegador
—una ventana que hay que cerrar para poder ver el campo que te está señalando— y
casi siempre **en español duro, sin traducir**.

**Decisiones de Dorel:** el botón se pulsa siempre y es él quien dice qué falta,
con el campo marcado en rojo suave; y los obligatorios llevan asterisco desde que
se abre el formulario. Se descartó el toast, «molesto a la larga».

**Lo aplicado**, en una sola pieza para los diez formularios:
`FieldProblems` —campo → clave de i18n—, `<app-form-error>` y los estilos de
estado en `styles.scss`.

⚠️ **Una sola función de validación por formulario**, no dos: la que pinta la
pantalla es la que llama el servicio antes de escribir. Con dos, la pantalla
acaba dejando guardar algo que el servicio rechaza.

⚠️ **El resumen junto al botón solo donde hace falta.** En el formulario de
vehículos, con 29 campos, es lo único que sirve: el campo en rojo puede quedar a
dos pantallas de scroll. En uno de tres campos repite lo que ya está debajo del
campo y es ruido.

**Formularios cubiertos** (10): ajustes de operación, alta de usuario, gasto,
cliente, vehículo, mantenimiento, cliente rápido del asistente, cobro libre,
inspección de entrega, inspección de devolución —y dentro de ella el alta de
daño— y el registro de cobro de la ficha de reserva.

**Ocho `alert()` de validación retirados**, entre ellos tres seguidos en la
inspección de entrega: se arreglaba el primero, se volvía a pulsar y aparecía el
segundo. Ahora salen los tres a la vez. Uno decía `'Title required'` **en
inglés**, en una aplicación que se usa en tres idiomas y donde ninguno es ese.

**Un fallo de CSS que solo se veía mirando.** El campo se marcaba en la clase
pero seguía del mismo color: `.form-control` la declara cada componente y con la
encapsulación de Angular su regla empata en especificidad con
`.form-control.is-invalid`, así que ganaba la del componente por orden de
inyección. Se resolvió subiendo la especificidad con el elemento
(`input.form-control.is-invalid`).

- [ ] **M-43 · Quedan 26 `alert()` de errores de operación.** No son validación
  de campos —esos ya no existen— sino fallos de una llamada: «Error al generar el
  contrato», «Error al subir la foto», «Error al crear la reserva». Siguen siendo
  ventanas del navegador y **la mayoría en español duro**, así que un operador en
  inglés o rumano ve castellano.

  No se han tocado en M-42 a propósito: son otro problema —cómo se cuenta que
  algo ha fallado, no qué falta por rellenar— y la solución no es la misma. El
  sitio donde están concentrados es `reservation-detail` (9),
  `contract-detail` (5) y las dos inspecciones (6, todos de subida de fotos).

---

## ✅ N-11 · Permisos por rol, hasta el último botón *(hecho el 4 sep 2026)*

La otra mitad de lo que dejó N-12. Un empleado ya no puede tocar precios,
conceder descuentos, borrar ni cancelar — ni desde la pantalla ni llamando al
servicio ni escribiendo directo en Firestore.

**Decisiones de Dorel del día:**

- **El coste del mantenimiento lo ve.** Quien lleva el coche al taller sabe lo
  que costó porque pagó él. No se toca la ficha del vehículo.
- **Eximir la fianza sí puede.** Exige motivo desde que existe y queda con autor
  y fecha; la fianza a 0 es **lo normal** con un cliente conocido, no la
  excepción, y pedir permiso convertiría cada uno de esos alquileres en una
  llamada. Por eso `waiveDeposit` pasó a la lista del empleado.
- **Dos roles bastan.** Nada de un tercero «por si acaso».

**Las tres capas, y las tres hacen falta:**

1. **La tabla** en `permissions.util.ts`, única autoridad, con `PermissionsService`
   encima para que ningún componente escriba su propia consulta.
2. **La pantalla**: el precio queda en solo lectura, el descuento deshabilitado,
   y borrar y cancelar desaparecen. ⚠️ **Siempre con el porqué al lado** —«Tu rol
   no permite cambiar el precio»—: un botón que se esfuma sin explicación hace
   que el compañero llame preguntando qué le pasa a la aplicación.
3. **El servicio**, que rechaza igualmente. Cualquier camino que no pase por ese
   botón —una pantalla nueva, un atajo— se saltaría el permiso.

**Y las reglas de Firestore, que es lo único que impide de verdad.** Todas las
colecciones tenían `allow write`, que **incluye borrar**: un empleado podía
vaciar la flota desde cualquier cliente de Firestore por mucho que la pantalla le
escondiera el botón. Ahora:

| Colección | Cambio |
|---|---|
| vehicles, clients, payments, inspections, vehicleMaintenance | `delete` solo administrador |
| expenses | lectura y escritura solo administrador — si no, ocultar el menú era decoración |
| contracts | `delete` **denegado a todos**: es el documento que acredita el alquiler |
| reservations | `update` no puede mover `pricingSnapshot` salvo administrador |

⚠️ **Lo que las reglas NO cubren, y conviene saberlo:** el precio con el que una
reserva **nace**. Al crear no hay valor anterior con el que comparar, así que
ahí manda la comprobación del servicio. Un empleado con conocimientos y la
consola del navegador podría crear una reserva al precio que quisiera; no puede,
en cambio, cambiar el de una que ya existe.

**Probado en el navegador forzando el rol en memoria** —sin tocar Firestore, para
no perder el propio acceso de administrador—:

| Comprobación | Resultado |
|---|---|
| Menú | Desaparecen Gastos, Informes y Ajustes; el pie dice «Empleado» |
| Navegar a `/expenses`, `/reports`, `/settings` | Los tres devuelven al **dashboard**, no al login: la sesión es válida, la sección no es suya |
| `/reservations` | Entra, como debe |
| Descuento de fidelidad | Deshabilitado, con «Tu rol no permite conceder descuentos» |
| Precio del asistente | Solo lectura, con «Se aplica el de tarifa» |
| Fianza | **Editable**, según lo decidido |
| Rol real tras la prueba | Sigue siendo `admin` |

⚠️ **Lo que no se ha podido probar: las reglas con un empleado de verdad.** Haría
falta iniciar sesión con una segunda cuenta de Google. Están desplegadas en los
dos entornos y leídas con cuidado, pero no ejercitadas — que en este proyecto no
es lo mismo.

- [x] **M-44 · Adjuntar una factura a un gasto fallaba siempre.** *(4 sep 2026)*
  `storage/unauthorized`: a `storage.rules` le faltaba la regla de `expenses/`,
  así que la ruta caía en el «default deny». Se construyó el módulo con la
  subida como lo único sin probar, y estaba rota desde el primer día.

  **Y arrastraba uno peor.** El gasto se crea antes de subir la factura —su ruta
  de Storage lleva el id dentro—, así que al fallar la subida el gasto quedaba
  guardado, el operador se quedaba en el formulario viendo un error y **volver a
  pulsar creaba un segundo gasto idéntico**. Ahora se recuerda el id para que el
  reintento actualice el mismo, y el aviso distingue «no se ha guardado» de «se
  ha guardado sin la factura».
