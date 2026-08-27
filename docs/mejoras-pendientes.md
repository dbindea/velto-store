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

## Prioridad alta

- [ ] **M-1 · Un cliente `blocked` no bloquea nada.**
  `ClientTrustLevel` tiene `risk` y `blocked`, se muestran con color, y el
  workflow los ignora por completo: se puede crear una reserva a un cliente
  marcado como «no alquilar». Decidir si `blocked` impide crear la reserva o
  solo avisa con confirmación. Es la §10.1 del documento funcional.

- [ ] **M-2 · `TranslateService` no cae al español.**
  Si una clave falta en `ro.json`, el usuario rumano ve la clave en crudo aunque
  el español exista. Hoy la paridad está al 100 %, así que no se manifiesta,
  pero es un fallo latente de una línea. Añadir fallback a `es`.

- [ ] **M-3 · Falta el índice compuesto de `inspections`.**
  `inspection.service.ts` consulta `reservationId ==` + `orderBy('createdAt')`,
  que exige índice compuesto y no está en `firestore.indexes.json`. La colección
  está vacía, por eso no ha saltado. Saltará en la primera inspección real.

- [ ] **M-4 · Verificar `VELTO_PUBLIC_BASE_URL` en producción.**
  El link de firma se construyó con `localhost:4321` en las pruebas porque el
  frontend sustituye el marcador con su propio origen. Confirmar que en
  producción el secret está puesto y el link que se copia para WhatsApp apunta
  al dominio real.

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

- [ ] **M-15 · «Total pagado» suma la devolución de fianza como ingreso.**
  Tras cerrar la reserva mostraba 693 €, que es
  350 + 150 + 18 + 25 + 43 + 107: mete en el mismo saco el alquiler, la fianza,
  los cargos extra, la retención **y la devolución** —dinero que sale—. El
  documento funcional dice que la fianza no debe contar como ingreso de
  alquiler. Separar ingresos reales de movimientos de fianza.

- [ ] **M-21 · Eximir la fianza automáticamente a clientes conocidos.**
  Hoy la fianza es editable y puede ponerse a 0 con motivo, pero la decisión es
  manual en cada reserva. Lo natural sería que un cliente con `trustLevel`
  distinto de `new` viniera ya con la fianza a 0 y un motivo propuesto. **No se
  ha hecho a propósito**: es un cambio de lógica de negocio —quién paga fianza y
  quién no— y esa decisión es tuya, no del código. Si se hace, el motivo debe
  seguir quedando registrado, porque es lo que permite cerrar la reserva.

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

- [ ] **M-9 · `capitalizeWords` no trata los guiones.**
  «madrid-barajas» se queda en «Madrid-barajas». Capitalizar también tras
  guion y apóstrofo.

## Prioridad baja

- [ ] **M-10 · El dashboard no ofrece reintentar.**
  Cuando la carga falla ya se avisa correctamente, pero la única salida es
  recargar la página. Un botón de reintento es barato.

- [ ] **M-11 · Reservas canceladas con «pago pendiente».**
  El listado muestra reservas canceladas con su saldo pendiente en rojo, lo que
  invita a perseguir un cobro que ya no toca. Decidir si se ocultan esos
  importes o se marcan como no exigibles.

- [ ] **M-12 · Producción tiene 4 índices que no están en el repo.**
  Lo avisó el despliegue de índices. Revisar si sobran (y borrarlos) o si
  faltan en `firestore.indexes.json`. Uno identificado al revisar M-14:
  `getPaymentsByReservation` consulta `reservationId ==` + `orderBy('createdAt')`
  y funciona en producción, luego el índice existe allí pero no está declarado.

- [ ] **M-13 · Avisos de `Cross-Origin-Opener-Policy` en el login.**
  Los emite el popup de Google Auth en el servidor de desarrollo. No afectan a
  producción, pero ensucian la consola y esconden avisos reales.

---

## Pendiente de probar

El ciclo completo del alquiler está ejercitado de principio a fin: vehículo,
cliente, cliente rápido, reserva, contrato, firma, entrega, devolución con
cargos extra, resolución de fianza y cierre. Queda:

- [ ] Cobro libre con Redsys (`free_payment`) contra el entorno de test real
- [ ] Envío del contrato firmado por email con Resend
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
- [ ] **N-3 en el PDF real**, tras desplegar las functions a mano
- [ ] **N-1 end-to-end**: generar un presupuesto, abrir el enlace y comprobar
      que se ve desde un móvil sin sesión
- [ ] **N-2 end-to-end**: cobrar la señal, emitir el justificante, regenerarlo
      y verificar que **el primer enlace sigue funcionando**
- [ ] **Fianza a 0**: crear una reserva sin fianza, comprobar que no siembra
      fila de pago, que el estado es «Exenta» y que la reserva **se puede
      cerrar** (es lo que el motivo obligatorio protege)
- [ ] **Los tres PDF en los tres idiomas**, cambiando el idioma de la
      plataforma antes de generarlos
- [ ] **Los tres PDF abiertos en un visor real.** El rediseño se verificó
      extrayendo texto y midiendo cajas, no mirándolos: falta la comprobación
      visual del logo, los filetes y el color.
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

⚠️ **Falta desplegar hosting** (verificado el 27 de agosto de 2026):

```bash
firebase deploy --only hosting         # activa el rewrite /d/**
```

`documentLink` **ya está desplegada y funciona**: sirve el PDF con
`200 application/pdf`, 1,2 MB, llamándola directamente. Lo que no está activo es
el rewrite, así que `velto-store.web.app/d/q…` devuelve el `index.html` de la SPA.

⚠️ **El fallo es silencioso**: sin el rewrite la ruta la captura el catch-all de
la SPA y responde `200`, así que parece que va. Hay que mirar el `content-type`:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://velto-store.web.app/d/qXXXX
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
