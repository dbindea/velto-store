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

---

# Funcionalidades nuevas

Anotadas el **26 de agosto de 2026**. No son mejoras de algo existente: hay que
construirlas. Cada una lleva lo que ya hay en el código y **lo que falta decidir
antes de programar**.

Tres notas transversales, porque afectan al orden en que conviene atacarlas:

- **N-1, N-2 y N-3 tocan Cloud Functions.** El CI solo despliega hosting: las
  functions van a mano con `npm --prefix functions run deploy`.
- **N-3 y N-4 modifican el mismo sitio**, `pricingSnapshot` de la reserva.
  Hacerlas juntas evita tocar dos veces el snapshot y el PDF.
- Todo lo que se guarde en el snapshot es **histórico congelado**: si mañana
  cambia el IVA o se le retira el descuento a un cliente, los contratos ya
  emitidos tienen que seguir cuadrando.

---

## N-1 · PDF de presupuesto, antes de cerrar la reserva

Poder enviar al cliente un PDF de presupuesto —cliente, coche, fechas, precio,
fianza— **sin finalizar la reserva**.

**Lo que hay hoy:** `generateContractPdf` exige una reserva y un contrato ya
persistidos en Firestore. El asistente de creación no guarda nada hasta pulsar
«Crear reserva», así que en el momento del presupuesto no existe ningún
documento al que apuntar.

**Rastro curioso:** `ReservationStatus` **no** tiene `quote`, pero hay CSS
`.status-quote` en cuatro componentes y CLAUDE.md describe el flujo canónico
empezando por «Presupuesto → Reserva». Se pensó y nunca se construyó.

**Lo que hay que decidir:**

1. **¿El presupuesto se guarda o es de usar y tirar?**
   - *Persistido* (estado `quote` nuevo): queda histórico, se puede recuperar y
     convertir en reserva. A cambio hay que responder si un presupuesto
     **bloquea la disponibilidad del coche** —hoy solo bloquean `reserved`,
     `confirmed` y `delivered`— y si caduca solo o hay que limpiarlo a mano.
   - *Efímero*: se genera el PDF con los datos del formulario y no se guarda
     nada. Mucho más simple, pero no hay rastro de qué se ofreció ni a quién.
2. **Plantilla propia.** Un presupuesto no es un contrato: sin cláusulas de
   firma, sin hueco de firma, y con una validez explícita («válido hasta»).
   Decidir esa validez.
3. **Precio no comprometido.** Si el presupuesto se acepta días después y la
   tarifa cambió, ¿se respeta el precio ofertado? Con `quote` persistido el
   snapshot lo resuelve solo; en efímero, no.

## N-2 · PDF de la reserva confirmada, sin contrato firmado

El cliente quiere ver su reserva confirmada en cuanto paga, y firmar unos días
después. Hoy el único PDF que existe es el contrato, y va ligado al circuito de
firma.

**Lo que hay hoy:** cobrar la señal ya pasa la reserva a `confirmed`, que es
anterior a generar el contrato. O sea, el estado que el cliente quiere ver
documentado **ya existe**; lo que no hay es forma de enseñárselo.

**Lo que hay que decidir:**

1. **¿Documento nuevo o el contrato sin firmar?**
   - *Justificante de reserva*: documento corto y propio —localizador, coche,
     fechas, importes, qué falta por hacer—. No se confunde con el contrato.
   - *El contrato en estado `generated`*, enviado tal cual. Cero trabajo de
     plantilla, pero se le manda al cliente un contrato sin firmar que podría
     tomar por definitivo. Si se elige esto, decidir si lleva marca de agua.
2. **No debe abrir la puerta a entregar sin firma.** Los guards del workflow
   siguen mandando: esto es un documento informativo, no un paso del flujo.
   Que el cliente tenga un PDF en la mano no puede habilitar `canStartPickup`.
3. **Envío.** Reutilizar Resend como en `sendSignedContractEmail`, o dar solo un
   enlace para descargar y que se mande por WhatsApp, que es el canal real.

## N-3 · Desglose del IVA en el contrato

El precio que se muestra hoy es el final, con IVA incluido. En el contrato debe
aparecer desglosado: base imponible, IVA y total.

**Lo que hay hoy:** ninguna noción de impuestos en todo el proyecto. El PDF
imprime dos líneas sueltas, «Importe del alquiler» y «Fianza», tomadas de
`finalPrice` y `depositAmount` ([pdf.ts:975](../functions/src/contracts/pdf.ts#L975)).

⚠️ **Es un cambio de presentación, no de importe.** El precio de tarifa ya es el
que paga el cliente: hay que **extraer** el IVA de él (`base = total / 1,21`), no
añadírselo. Si se hace al revés, todos los precios suben un 21 % de golpe.

**Lo que hay que decidir:**

1. **El tipo aplicable.** El alquiler de vehículos sin conductor va al 21 %
   general en península, pero conviene confirmarlo con la gestoría —y ver si
   Canarias, Ceuta o Melilla entran alguna vez en juego—.
2. **Qué conceptos llevan IVA y cuáles no.** No es uniforme:
   - Alquiler: sí.
   - **Fianza: no.** Es un depósito en garantía, no una venta.
   - Cargos extra: combustible, limpieza, kilómetros y daños, sí. **Las multas
     no** — es una sanción que se repercute, no un servicio.
   Esto afecta a cómo se presentan los cargos de la inspección de devolución.
3. **Snapshot del tipo.** Guardar `vatRate` en `pricingSnapshot` al crear la
   reserva. Si el tipo cambia, los contratos antiguos deben conservar el suyo.
4. **Etiquetas en tres idiomas** en `clauses.ts` (es/en/ro), y `npm run i18n:audit`
   para lo que se muestre en la app.
5. ¿Aparece el desglose también en la app, o solo en el PDF?

## N-4 · Descuento de fidelidad por cliente

Un numérico en la ficha del cliente —`5` = 5 % de descuento— que se aplica a sus
reservas, puede retirarse o cambiarse, y **aparece en el contrato**.

**Lo que hay hoy:** `Client` no tiene ningún campo de descuento. Existe
`ClientTrustLevel` (`new` · `known` · `regular` · `risk` · `blocked`), pero es
informativo y no interviene en nada (ver [M-1]).

**Cuidado con el solape:** desde el 24 de agosto el resumen del asistente ya
permite **sobrescribir el precio final a mano**, y eso se guarda como
`manualAdjustment` en el snapshot. Son dos descuentos distintos sobre el mismo
importe.

**Lo que hay que decidir:**

1. **Orden de aplicación y convivencia con el ajuste manual.** Lo natural es
   tarifa → descuento de fidelidad → precio acordado a mano. Pero hay que
   decidir si el ajuste manual **sustituye** al descuento o se aplica **encima**,
   y guardarlos por separado en el snapshot para que el contrato pueda
   explicar cada línea. Si se mezclan en un solo número, el desglose de N-3
   no podrá justificarlos.
2. **¿Se asigna a mano o se gana solo?** Si es automático, con qué umbral:
   ¿número de alquileres cerrados, importe acumulado, antigüedad? Y quién lo
   recalcula: ¿al cerrar cada reserva?
3. **¿Se relaciona con `trustLevel` o es independiente?** Un `regular` no tiene
   por qué tener descuento, y un `blocked` con un 10 % guardado sería absurdo.
   Decidir si al bloquear a alguien se le retira.
4. **Snapshot obligatorio.** El porcentaje aplicado se congela en la reserva.
   Si mañana se le retira el descuento al cliente, el contrato firmado tiene que
   seguir cuadrando con lo que se cobró.
5. **¿Queda rastro de los cambios?** Subir o quitar un descuento es una decisión
   comercial con dinero detrás. Decidir si basta con el valor actual o si hace
   falta histórico de quién lo cambió y por qué, al estilo de
   `reservation.workflowExceptions[]`.
6. **Tope y validación.** Un descuento del 100 % debería ser imposible sin una
   confirmación explícita.
