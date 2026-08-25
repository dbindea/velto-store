# Mejoras pendientes

Lista viva de mejoras sobre lo **ya programado**, salida de las pruebas end‑to‑end
con datos reales del 21 de agosto de 2026. No son bugs —esos van en
[pruebas-modulos-2026-08-21.md](pruebas-modulos-2026-08-21.md) y ya están
corregidos— sino cosas que funcionan pero se pueden hacer mejor.

Marca con `[x]` lo que se cierre y añade la fecha.

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
