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

- [ ] **M-2 · `TranslateService` no cae al español.**
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

- [ ] **M-29 · `sendSignedContractEmail` devuelve `contractId: null`.** *(31 ago 2026)*
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

- [ ] **M-23 · Redsys tiene el mismo fallo, y sigue abierto.**
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

- [ ] **M-17 · No hay pluralización en ningún sitio.**
  El asistente y el detalle escriben «1 días» porque concatenan el número con
  `reservations.fields.totalDays`, que es una cadena fija en plural. Pasa en
  la tarjeta del vehículo del paso 2, en el resumen y en el detalle de la
  reserva. Decidir el enfoque: claves `_one` / `_other` por idioma —el rumano
  además tiene forma *few*, «2 zile» frente a «21 de zile»— o un pipe propio.
  No es solo cosmético: son tres idiomas con reglas distintas.

- [ ] **M-18 · El vehículo no disponible muestra el estado en inglés.**
  En el paso 2 del asistente, un coche ocupado se etiqueta «Reservado
  (reserved)»: `conflictMessage` compone el texto traducido y añade entre
  paréntesis el valor crudo del enum. Decidir si el paréntesis aporta algo al
  operador o se quita.

- [ ] **M-19 · El paso «Resumen» del asistente nace marcado como completado.**
  `isStepComplete('summary')` devuelve `true` siempre, así que el cuarto paso
  aparece con el check verde desde que se abre el formulario, cuando todavía
  no se ha creado nada. Decidir si el último paso debe considerarse completo
  solo tras crear la reserva, o si el check ahí no significa nada y conviene
  no pintarlo.

- [ ] **M-20 · Las fotos de vehículo se sirven a tamaño completo en móvil.**
  Relacionado con [M-6], pero ahora medido en teléfono: la caja de la imagen
  en la tarjeta es de 140 px de alto y se descarga el original. En una lista
  de flota son varios megas por pantalla y con datos móviles se nota.
  Generar miniaturas al subir sigue siendo la solución; la decisión es dónde
  —Cloud Function al subir, o `<img srcset>` con tamaños de Storage—.

- [ ] **M-16 · Los `alert()` de la pantalla de reserva están en español duro.**
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

- [ ] **M-8 · El PDF del contrato no lleva logo.**
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

- [ ] Cobro libre con Redsys (`free_payment`) contra el entorno de test real
      — **bloqueado por M-23**: la function aborta antes de llamar a Redsys
- [x] Envío del contrato firmado por email con Resend — **probado de extremo a
      extremo el 29 de agosto de 2026** en `velto-store`, ciclo completo desde
      cero: vehículo → cliente → presupuesto → reserva → señal → contrato →
      link de firma → firma del cliente → email. Contrato `C-TUKT8S-2026`,
      `emailedAt: 2026-08-29T11:20:03.933Z` en Firestore, que solo se escribe si
      Resend devolvió `ok`. Remitente `reservas@veltorent.com`, destinatario
      `dbindea@gmail.com`. **Sin probar todavía en producción.**
- [ ] Módulo de mantenimiento de vehículos (colección aún vacía)
- [ ] Subida de fotos dentro de una inspección (probada en vehículos, no en
      inspecciones)
- [ ] Registro de daños en la devolución
- [ ] Cancelación de una reserva
- [ ] Excepciones de workflow (`buildWorkflowException`) desde la UI
- [ ] **N-4 end-to-end**: poner un 10 % a un cliente, crear reserva y comprobar
      que el snapshot congela el porcentaje; luego retirárselo y verificar que
      la reserva anterior no se mueve
- [ ] **N-4 + bloqueo**: marcar `blocked` a un cliente con descuento y
      comprobar que se retira y queda anotado en el histórico
- [x] **N-3 en el PDF real**, tras desplegar las functions a mano.
      *(27 ago 2026, 23:30)* Desglose correcto en presupuesto y contrato, en las
      dos direcciones de IVA.
- [ ] **N-1 end-to-end**: generar un presupuesto, abrir el enlace y comprobar
      que se ve desde un móvil sin sesión
- [ ] **N-2 end-to-end**: cobrar la señal, emitir el justificante, regenerarlo
      y verificar que **el primer enlace sigue funcionando**
- [ ] **Fianza a 0**: crear una reserva sin fianza, comprobar que no siembra
      fila de pago, que el estado es «Exenta» y que la reserva **se puede
      cerrar** (es lo que el motivo obligatorio protege)
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
