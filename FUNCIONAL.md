# Velto Rent — Documento funcional

> **Documento vivo.** Describe qué es Velto Rent, qué hay construido hoy y hacia dónde va.
> No es un contrato ni una especificación cerrada: si un requisito nuevo lo contradice, gana
> el requisito nuevo y se actualiza este archivo. Si algo aquí no coincide con el código,
> gana el código — y se corrige aquí.
>
> Última revisión contrastada contra el repositorio y contra el proyecto Firebase real:
> **21 de agosto de 2026**.

---

## 1. Qué es Velto Rent

Alquiler de coches de flota pequeña, vinculado a la agencia de viajes Gate2Fly. Se alquila
sobre todo a clientes conocidos, clientes de la agencia y recomendados. Flota inicial de tres
vehículos (Renault Mégane, Renault Kadjar, Dacia Duster).

La app es una **herramienta interna de operación**, no un ERP ni un rent-a-car corporativo.
Su función es que una sola persona pueda gestionar el ciclo completo del alquiler desde el
móvil sin que se escape nada:

- pagos pendientes y fianzas sin resolver
- daños, kilómetros extra y combustible
- contratos sin firmar
- documentación de cliente incompleta
- entregas y devoluciones mal registradas

**Criterio rector:** ante la duda entre una función más y un flujo más claro, gana el flujo
más claro.

### Filosofía

Mobile-first, sencilla, rápida, visualmente limpia, preparada para crecer. Pensada para uno
o pocos usuarios operando desde el móvil.

---

## 2. Estado real: qué está construido y qué se ha usado

Esta es la sección más importante del documento y la que más rápido se desactualiza.
La distinción clave no es "construido / no construido", sino **construido y ejercitado en
producción** frente a **construido pero nunca usado**.

Las colecciones que existen hoy en Firestore son exactamente:

```
authorizedUsers   clients   contracts   contractSigningTokens
payments          reservations         vehicles
```

De ahí se deduce el estado real:

| Módulo | Código | Datos en producción | Lectura |
|---|---|---|---|
| Vehículos | ✅ completo | ✅ sí | Probado |
| Clientes | ✅ completo | ✅ sí | Probado |
| Reservas | ✅ completo | ✅ sí | Probado |
| Pagos y fianzas | ✅ completo | ✅ sí | Probado |
| Contratos y firma | ✅ completo | ✅ sí | Probado |
| Dashboard | ✅ completo | — | Probado |
| Calendario | ✅ completo | — | Construido, uso real desconocido |
| Informes | ✅ completo | — | Construido, uso real desconocido |
| **Inspecciones** | ✅ completo | ❌ **colección vacía** | **Nunca ejercitado** |
| **Mantenimiento** | ✅ completo | ❌ **colección vacía** | **Nunca ejercitado** |
| Redsys | ✅ completo | ✅ sí | Probado con dinero real (31 ago 2026) |
| Gastos | ✅ completo | — | Construido el 4 sep 2026, probado en desarrollo |
| Ajustes | ✅ completo | — | Construido el 4 sep 2026, probado en desarrollo |
| Web pública | ❌ no existe | — | Futuro |
| WhatsApp / IA | ❌ no existe | — | Futuro, con campos ya preparados |

### Consecuencia práctica

**Inspecciones y mantenimiento son código sin rodar.** Están completos —modelo, servicio,
componentes, reglas de Firestore— pero nunca se ha escrito un documento real. Antes de darlos
por buenos hay que ejercitarlos de punta a punta, porque es donde más probable es que aparezcan
fallos que ningún test cubre.

Ya hay uno detectado, ver §9.

---

## 3. Modelo de dominio

Las entidades y sus estados, tal y como existen en el código.

### Vehículo

Marca, modelo, versión, año, matrícula, VIN, color, km actuales, categoría, código ACRISS,
combustible, transmisión, plazas, maletas, fotos, tarifas.

Matrícula y VIN se guardan **siempre en mayúsculas**.

```
VehicleStatus: available | rented | maintenance | out_of_service
```

Campos ya presentes y relevantes para el futuro: `publicEnabled` (para la web pública),
`pricingRules`, `extraKmPrice`, `minDays`.

### Tarifas

Cada coche tiene sus propias reglas por tramos de días. **No se cobra igual un día que un mes.**

```ts
pricingRules: [{ minDays, maxDays, pricePerDay, label }]
```

Referencia orientativa: 1 día 60 €/día · 2-3 días 55 · 4-7 días 50 · 8-15 días 45 ·
16-30 días 38 · +30 días 35.

Al crear la reserva se calcula con estas reglas y **se guarda un snapshot del precio**. Cambiar
la tarifa del vehículo no altera reservas ya creadas. Lo mismo aplica a los snapshots de
vehículo y cliente.

### Los tres escalones del precio

El precio se resuelve en un solo sitio —`resolveRentalPrice()` en `pricing.util.ts`— y siempre
en este orden:

```
tarifa del vehículo → descuento de fidelidad del cliente → precio acordado a mano
```

**Descuento de fidelidad.** Un porcentaje en la ficha del cliente (`loyaltyDiscountPercent`,
máx. 30 %) que se aplica solo a sus reservas nuevas. Se asigna a mano; no se gana por umbrales.
Es independiente de `trustLevel`, con una excepción: **bloquear a un cliente se lo retira**, y la
retirada queda registrada como cualquier otro cambio. Cada subida o bajada se anota en
`loyaltyDiscountHistory[]` con autor y fecha, append-only, al estilo de `workflowExceptions[]`.

**Precio acordado.** La tarifa propone, el operador dispone: en el resumen del asistente,
**el precio final es editable**. Un cálculo de 600 € puede cerrarse en 500 €.

Los dos descuentos **se guardan por separado** en el snapshot —`loyaltyDiscount` y
`manualAdjustment`, ambos con signo— porque responden a preguntas distintas: a qué tiene derecho
este cliente, frente a a qué cerramos este trato. Fundidos en un solo número, el contrato no
podría justificar cada línea. El `manualAdjustment` mide contra el precio **ya descontado**, no
contra la tarifa.

El snapshot conserva además el cálculo original (`pricePerDay`, `basePrice`, `appliedRule`). La
señal nunca supera el precio acordado. Cambiar de cliente en el asistente descarta un precio
acordado previo: la base sobre la que se pactó ya no es la misma.

### IVA

**El precio de tarifa es NETO y el IVA se le suma.** Un coche a 30 €/día son 30 € de base
imponible; el cliente paga 36,30 €. Se hace así porque el número redondo es el que se negocia
por teléfono, y el cliente que no quiere factura paga justo ese neto sin decimales.

Lo que se edita en el asistente es el **neto**; el total se calcula debajo, y el desglose
sale siempre de `netPrice`, nunca del total.

El tipo aplicado se congela en `pricingSnapshot.vatRate` al crear la reserva, como fracción
(`0.21`), para que una subida futura del tipo general no mueva un contrato ya firmado.

> Entre el 27 y el 28 de agosto de 2026 convivieron las dos direcciones: las reservas
> anteriores al cambio se habían creado con el IVA incluido, y `tariffIncludesVat` congelaba
> cuál le tocaba a cada una. Al borrar los datos de producción y empezar de cero, ese
> mecanismo se retiró: hoy **toda** reserva es neta + IVA.

Qué lleva IVA y qué no:

| Concepto | IVA |
|---|---|
| Alquiler | Sí, 21 % general (península) |
| **Fianza** | **No** — es depósito en garantía, no una venta |
| Combustible, limpieza, kilómetros, daños | Sí |
| **Multas** | **No** — sanción repercutida, no un servicio |

El desglose se ve en el resumen del asistente, en el detalle de la reserva y en el contrato PDF,
que imprime base imponible, IVA y total, y etiqueta la fianza como no sujeta. Los cargos extra
de la inspección de devolución **todavía no se desglosan**: el contrato se genera antes de que
existan.

### Cliente

Nombre, teléfono, email, documento, dirección, carnet (número, expedición, caducidad, país),
nivel de confianza, notas internas, documentos.

```
ClientTrustLevel: new | known | regular | risk | blocked
```

`blocked` significa no alquilar, y desde el 28 de agosto de 2026 **lo impide de verdad**: el
asistente deshabilita «Crear reserva» y `reservation.service.ts` rechaza la llamada. No hay
excepción de workflow para esto — la salida es cambiarle el nivel al cliente en su ficha,
que queda registrado. `risk` solo avisa y deja continuar. Los demás niveles son informativos.

### Reserva

```
ReservationStatus: reserved | confirmed | delivered | returned | closed | cancelled
```

- `reserved` — creada, coche bloqueado
- `confirmed` — señal pagada
- `delivered` — coche entregado
- `returned` — coche devuelto
- `closed` — alquiler cerrado
- `cancelled` — anulada

### Contrato

```
ContractStatus: pending | generated | pending_signature | signed | cancelled | expired
ContractLocale: es | en | ro
```

### Inspección

```
InspectionType:   pickup | return
InspectionStatus: draft | completed | cancelled
FuelLevel:        empty | quarter | half | three_quarters | full
Cleanliness:      clean | normal | dirty | very_dirty
DamageSeverity:   minor | medium | serious
```

### Pago

La colección `payments` es la **única fuente de verdad** del dinero. El resumen que se ve en
la reserva se deriva de ella, nunca al revés.

```
PaymentMethod: cash | bank_transfer | bizum | physical_pos | redsys | manual_card | other
PaymentSource: manual | redsys | system | whatsapp_ai
```

Conceptos: `initial_payment`, `remaining_payment`, `deposit`, `deposit_refund`,
`deposit_retention`, `extra_fuel`, `extra_refuel_penalty`, `extra_km`, `extra_cleaning`,
`extra_damage`, `extra_fine`, `extra_other`, `free_payment`.

**La fianza no es ingreso de alquiler.** Se muestra siempre separada.

### Mantenimiento

Colección `vehicleMaintenance`. Tipo, estado, prioridad, título, descripción, km realizado,
fecha, próximo km, próxima fecha, coste, proveedor, documento, notas.

```
MaintenanceStatus:   pending | scheduled | completed | overdue | cancelled
MaintenancePriority: low | medium | high | critical
```

---

## 4. Disponibilidad

Un coche no está disponible si existe una reserva solapada en estado activo.

**Bloquean:** `reserved`, `confirmed`, `delivered`
**No bloquean:** `returned`, `closed`, `cancelled`

```
existing.pickupDateTime < requested.returnDateTime
AND existing.returnDateTime > requested.pickupDateTime
```

### Cálculo de días

Por bloques de 24 horas, **redondeando hacia arriba** ante cualquier exceso.

| Recogida | Devolución | Días |
|---|---|---|
| 10 jun 12:00 | 11 jun 12:00 | 1 |
| 10 jun 12:00 | 11 jun 13:00 | 2 |
| 10 jun 12:00 | 10 jun 18:00 | 1 |
| 10 jun 12:00 | 17 jun 12:00 | 7 |

Hora por defecto en el formulario: **12:00**.

---

## 5. El flujo canónico

Es el corazón del producto. Vive en `src/app/shared/utils/reservation-workflow.util.ts`,
que es **la única autoridad**: la UI deshabilita botones consultándolo y los servicios lo
invocan antes de mutar estado. No se replican estas reglas en componentes.

```
1. Crear reserva                       → coche bloqueado
2. Cobrar señal                        → confirmed
3. Generar contrato PDF                → generated
4. Generar link de firma               → pending_signature
5. Cliente firma                       → signed
6. Cobrar resto del alquiler
7. Cobrar fianza
8. Entrega (inspección pickup)         → delivered · vehículo rented
9. Devolución (inspección return)      → returned · vehículo available, km actualizados
10. Registrar cargos extra
11. Devolver o retener fianza
12. Cerrar reserva                     → closed
```

No se puede entregar un coche si falta cliente identificado, contrato firmado, señal, resto
del alquiler o fianza.

### Excepciones

Saltarse un paso es posible, pero **nunca en silencio**. Requiere
`buildWorkflowException(action, reason, createdBy)` con motivo obligatorio de al menos
3 caracteres, que se persiste en `reservation.workflowExceptions[]`.

### Timeline

Cada reserva muestra su progreso visual con los pasos completados, el actual destacado y los
bloqueados explicando qué falta ("Falta contrato firmado", "Falta fianza", "Primero completa
la entrega").

El timeline y los guards **deben coincidir siempre**. Que discreparan fue un bug real, ya
corregido y cubierto por tests: ambos leen ahora los mismos resolvers.

---

## 6. Pagos y fianzas

En la reserva se ven bloques claros: señal, resto del alquiler, fianza, cargos extra y
resumen final.

En la UI hay **tres acciones**: Registrar cobro · Devolver fianza · Retener fianza.

**Los cargos extra solo nacen desde la inspección de devolución.** Un único origen, sin
doble fuente. Pueden cobrarse aparte o compensarse contra la fianza retenida.

### Una fila por concepto

Al crear la reserva se siembra un pago en estado `pending` por cada concepto esperado:
señal, resto y fianza. **Cobrar liquida esa fila, no crea otra al lado.** Es lo que hace
que la lista de pagos de una reserva cerrada diga lo mismo que su estado.

- El importe **se acumula**: dos cobros parciales cierran la misma fila.
- Cobrar de más sube el importe esperado de la fila; nunca queda un pendiente negativo.
- Solo se crea documento nuevo cuando no hay nada que liquidar: cargos extra, pago
  completo del alquiler, o un segundo cobro sobre un concepto ya pagado.
- Cerrar o cancelar una reserva **cancela sus filas sembradas que nunca cobraron nada**.
  Las parciales se respetan: cancelarlas borraría dinero real del resumen.

El formulario de cobro se abre con lo que falta del concepto elegido. No es cosmética:
guardar a 0 € saldaría la fila con 0.

### Fianza

| Escenario | Cobrada | Retener | Devolver |
|---|---|---|---|
| Todo correcto | 300 € | 0 € | 300 € |
| Falta combustible | 300 € | 45 € | 255 € |

Retener exige motivo.

### Cobro libre

`free_payment` permite cobrar un importe suelto sin reserva asociada: diferencias, servicios
adicionales, penalizaciones. Si lleva `reservationId` actualiza la reserva; si no, queda como
cobro independiente.

### Redsys

Toda la lógica vive en Cloud Functions. **Angular nunca ve las claves.** El frontend solo pide
el link, abre la pasarela o lo copia.

Un pago **no se marca como pagado porque el usuario vuelva por la URL OK**. Solo se marca al
recibir y validar la notificación firmada del webhook.

**Redsys funciona de extremo a extremo desde el 31 de agosto de 2026**, probado contra la
pasarela de test y con un cobro real de 10 € en producción. El cliente puede además pagar
**desde su móvil** con un enlace (`/pay/:paymentId`), sin el operador delante.

Lo que estuvo roto y conviene recordar: la firma `HMAC_SHA256_V1` sin la derivación 3DES
de la clave, y el botón que abría la pasarela con un GET cuando Redsys solo admite POST.

---

## 6.b Gastos

Lo que sale, frente a Pagos, que es lo que entra. Colección `expenses`, plana.

Un gasto se imputa a **una de tres cosas**, y esa elección decide qué categorías se
ofrecen:

| Se imputa a | Para qué sirve | Ejemplos |
|---|---|---|
| **Vehículo** | Saber cuánto cuesta y cuánto deja cada coche | Seguro, ITV, reparación, neumáticos, impuesto |
| **Reserva** | Ver el margen real de un alquiler | Gasolina que pones tú, un traslado, una limpieza extra |
| **Empresa** | Lo que no cuelga de nada | Gestoría, publicidad, teléfono, comisiones bancarias |

Un gasto de vehículo **exige vehículo** y uno de reserva **exige reserva**: sin ellos sería
un gasto general con la etiqueta equivocada, y falsearía el coste por coche. Lo comprueban
las dos capas, la pantalla y el servicio.

### El IVA va al revés que en el alquiler

**En un gasto el IVA se extrae del total.** Lo que se teclea es el número que pone la
factura y la base se deduce; en un alquiler es al contrario, porque lo que se negocia es
el neto. Las dos aritméticas viven en ficheros distintos a propósito.

El tipo se elige entre 21 %, 10 %, 4 % y 0, y se congela en el gasto. **Una multa propone
0 %** — es una sanción repercutida, no un servicio, igual que la fianza en el otro lado.

### El mantenimiento se lee, no se duplica

Una reparación se registra en `vehicleMaintenance`, que es donde vive junto al aviso de la
próxima ITV y de la próxima revisión por km. Gastos **lee** su coste y lo suma; la fila
aparece marcada como «Mantenimiento» y lleva a su ficha en lugar de a un formulario de
edición. Escribirla en los dos sitios daría dos fuentes de verdad para el mismo euro.

Solo cuenta el mantenimiento **realizado y con coste**: una ITV agendada para dentro de
tres meses no es dinero que haya salido.

⚠️ **Los totales no cuadran, y es correcto.** El coste de un mantenimiento entra en el
bruto pero no tiene base ni IVA conocidos —se teclea como un importe suelto—, así que la
suma de bases es menor que el total. La pantalla dice sobre cuántas filas se ha calculado
el IVA. Igualar los tres números sería inventarse ese impuesto.

---

## 7. Inspecciones

### Entrega

Checklist (DNI, carnet, contrato, pago, fianza, llaves, documentación), km de salida,
combustible, limpieza, daños previos y fotos.

Fotos recomendadas: frontal, trasera, lateral izquierdo, lateral derecho, interior, cuadro de
kilómetros, combustible y daños existentes.

### Devolución

Km de entrada, combustible, limpieza, llaves, daños nuevos, fotos, cargos extra y decisión
sobre la fianza.

Al completarla: reserva a `returned`, vehículo a `available`, `currentKm` actualizado.

---

## 8. Contratos y firma

El cliente firma **sin cuenta**. Ruta pública `/sign-contract/:token`, fuera del `authGuard`.

El token es de 256 bits URL-safe, **de un solo uso** y caduca (7 días por defecto). Vive en
`contractSigningTokens`, colección cuyas reglas **deniegan todo acceso desde cliente**: solo
entra el admin SDK. La página pública opera a través de Cloud Functions que reciben el token,
nunca abriendo Firestore.

El PDF se genera en backend con `pdf-lib`, en es/en/ro, y se envía por email con Resend desde
Cloud Functions.

No hay firma avanzada tipo DocuSign, y no se busca en esta fase.

### El contrato en papel se puede comprobar

El PDF firmado lleva, en la casilla del arrendador, un **QR y un Código Seguro de
Verificación** legible (`VLT-8QPB-YNT4-9AXJ`) que llevan a la ruta pública `/v/:codigo`.
Ahí se ven cinco datos y ninguno personal: número de contrato, fecha de firma, matrícula,
estado y huella SHA-256 del PDF.

⚠️ **Un QR no valida una firma electrónica** — eso lo hace Adobe o VALIDe abriendo el
fichero. Lo que resuelve es el papel, donde no hay nada que abrir: confirma que el
contrato existe, que está firmado y que el fichero es el que emitimos. Convive con la
línea «Firmado digitalmente con certificado digital» porque son dos hechos distintos, y
si el sellado falla desaparece la frase y el QR se queda.

Los contratos firmados antes del 4 de septiembre de 2026 no tienen código: no se ha
migrado nada.

### Fianza

**No todos los alquileres llevan fianza.** A los clientes conocidos no se les cobra; se pide
sobre todo a quien alquila por primera vez. Por eso la fianza es **editable** en el asistente
y 0 es una respuesta legítima.

Una fianza a 0 **no es una fianza pendiente de cobrar**: nace en estado `waived` y **exige
motivo**. La distinción no es burocracia — `isDepositSettled()` solo da por resuelta una
fianza a 0 si hay motivo registrado, así que sin él la reserva se quedaría esperando para
siempre un dinero que nadie va a pagar, y no se podría cerrar.

El motivo se muestra en el detalle de la reserva. La decisión de a quién se le exime sigue
siendo del operador, caso por caso: **no se aplica sola** según el nivel de confianza.

### Los tres documentos

El contrato no es el único papel que ve el cliente. Son tres, en el orden de la conversación:

| Documento | Cuándo | Qué es |
|---|---|---|
| **Presupuesto** | Antes de crear nada | Precio ofertado, válido 7 días. **No reserva el coche.** |
| **Justificante de reserva** | Al cobrar la señal (`confirmed`) | Prueba de la reserva y de lo que falta. **No es el contrato.** |
| **Contrato** | Antes de la entrega | El documento vinculante, con cláusulas y firma. |

Los tres comparten plantilla, desglose de precio con IVA y datos de empresa, para que el
cliente pueda ponerlos uno al lado del otro y leer los mismos números.

Los dos primeros son **informativos y no tocan la reserva**: generarlos no escribe nada en
Firestore que el workflow mire. Es deliberado y es la regla que no se puede relajar —que el
cliente tenga un PDF en la mano no puede habilitar `canStartPickup`. Solo el contrato firmado
mueve el flujo.

El presupuesto además **no se persiste**: no existe el estado `quote`, y el coche sigue libre
para cualquier otro hasta que se cree la reserva. Lo único que queda es el PDF en Storage,
porque el enlace tiene que apuntar a algo.

Ambos se comparten como enlace, para pegar en WhatsApp, que es el canal real. Regenerar el
justificante conserva el token de descarga: el enlace que el cliente ya tiene sigue vivo.

---

## 9. Divergencias conocidas entre visión y código

La parte que más valor tiene mantener al día.

### Ya resuelto

- La firma de Redsys, el formato del `Ds_Merchant_Order` y la URL del webhook estaban mal.
  Corregidos y con tests.
- Los guards del workflow ignoraban los overrides de `WorkflowContext` mientras el timeline
  sí los respetaba. Alineados.
- `generateContractPdf` fallaba al escribir `undefined` en Firestore.
- **Los índices de Firestore declarados no servían a ninguna consulta.** El fichero usaba
  `arrayConfig: CONTAINS` donde las consultas filtran por igualdad; lo que funcionaba en
  producción eran índices creados a mano que no estaban en el repo. Reescrito el 28 de
  agosto de 2026, con el de `inspections` que además faltaba.
- **El nivel de confianza del cliente no hacía nada.** `blocked` ya impide crear la
  reserva, en la UI y en el servicio; `risk` avisa. Ver §3.
- **«Total pagado» sumaba la devolución de fianza como ingreso.** El resumen de la reserva
  separa ahora lo cobrado de los movimientos de fianza.

### Abierto

**Los permisos por rol están a medias.** Un empleado no ve Informes, Gastos ni Ajustes,
pero dentro de las pantallas que sí ve puede tocar precios, borrar y cancelar: los permisos
finos están declarados y sin conectar. Ver N-11.

**No hay tests de componentes ni E2E.** Solo utils y lógica pura (32 tests). El flujo
completo de alquiler no tiene cobertura automatizada.

**Deuda de repositorio.** `deploy.log` y tres `test-contract-*.pdf` (~4 MB) están trackeados
sin necesidad.

---

## 9.b Seguimiento

- [docs/pruebas-modulos-2026-08-21.md](docs/pruebas-modulos-2026-08-21.md) —
  fallos encontrados en las pruebas end‑to‑end y cómo se corrigieron.
- [docs/mejoras-pendientes.md](docs/mejoras-pendientes.md) — lista viva de
  mejoras sobre lo ya programado, y qué falta por probar.

---

## 10. Decisiones pendientes

No son bugs, son preguntas de producto sin responder:

1. ~~¿Un cliente `blocked` debe impedir crear la reserva, o solo avisar?~~ **Respondida el
   28 de agosto de 2026: `blocked` lo impide, `risk` solo avisa.** Ver §3.
2. ~~¿Qué es exactamente un gasto y contra qué se imputa?~~ **Respondida el 4 de
   septiembre de 2026: contra un vehículo, contra una reserva o contra la empresa.** Ver
   §6.b.
3. ~~¿Qué debe poder configurarse en Ajustes?~~ **Respondida el 4 de septiembre de 2026:
   valores por defecto de la operación y usuarios autorizados.** Los datos de empresa y los
   textos del contrato quedan fuera por ahora. Ver §12.b.
4. ¿El calendario y los informes cubren la necesidad real, o se construyeron sin uso?
5. ¿Se factura? La generación de facturas aparece como idea, sin definir.

### Pedidas el 26 de agosto de 2026 — todas construidas

Las cuatro funcionalidades nuevas (`N-1` a `N-4`) están hechas, con el detalle de qué se
decidió y por qué en [docs/mejoras-pendientes.md](docs/mejoras-pendientes.md):

- `N-3` IVA y `N-4` descuento de fidelidad — ver §3.
- `N-1` presupuesto y `N-2` justificante de reserva — ver «Los tres documentos» más abajo.

⚠️ Ninguna llega al cliente hasta **desplegar las Cloud Functions a mano**.

---

## 11. Futuro

Nada de esto se implementa ahora, pero la arquitectura no debe cerrarles la puerta.

### Web pública (`veltorent.com`)

Ver coches disponibles, fotos, precios, solicitar reserva, pagar señal, firmar. La app interna
vive en `store.veltorent.com`.

Leerá **solo información pública controlada** — el campo `publicEnabled` en vehículos ya existe
para esto. Nunca abrir Firestore ni Storage privados.

### WhatsApp con IA

El cliente escribe, la IA consulta disponibilidad, calcula precio, ofrece coches, crea reserva
provisional, genera link de pago, y tras la confirmación de Redsys envía el contrato para firma.

Ya preparado en el modelo: `PaymentSource` incluye `whatsapp_ai`, los snapshots hacen los
históricos independientes del dato vivo, y los estados están limpios.

---

## 12. Principios de desarrollo

- Cambios mínimos y limpios. No reescribir lo que funciona.
- Mobile-first, dark/light mode y traducciones es/ro/en en todo lo visible.
- **Ningún secreto en Angular.** Redsys, Resend y generación de PDF van en Cloud Functions.
- Centralizar las reglas de workflow. No duplicar lógica en componentes.
- Bloquear en UI **y** validar en servicios. Defensa en profundidad.
- Snapshots en reservas, contratos y pagos: el histórico no depende del dato vivo.
- Sin compatibilidad legacy mientras las colecciones estén vacías o se vayan a borrar.

---

## 12.b Ajustes y permisos

Dos pestañas, y solo dos por ahora:

**Valores por defecto de la operación** — fianza propuesta, IVA general, validez del
presupuesto, caducidad del enlace de firma y km incluidos por día.

⚠️ **Rigen para lo que se cree a partir de ahora, nunca hacia atrás.** El IVA se congela en
cada reserva, el precio en su snapshot y la caducidad en el propio token de firma. Es lo que
permite que el IVA sea configurable sin poner en riesgo un contrato ya firmado.

Quedan fuera, por decisión del 4 de septiembre de 2026: los **datos de la empresa** —hoy los
leen las Cloud Functions de su propia configuración y moverlos a Firestore es otro trabajo— y
los **textos del contrato**, que son texto legal.

**Usuarios autorizados** — alta por correo de Google, rol, quitar y dar acceso. Antes se hacía
entrando a Firestore a mano.

### Roles

Dos, con permisos por rol; se descartó la matriz por persona, que con dos o tres compañeros
acaba en «cópiale los permisos a Juan».

| | Administrador | Empleado |
|---|---|---|
| Operación diaria: reservas, clientes, vehículos, cobros, entregas | Sí | Sí |
| Saltarse un paso del workflow (queda registrado) | Sí | **Sí** |
| Informes y gastos | Sí | No |
| Ajustes y dar acceso a otros | Sí | No |
| Precios, descuentos y eximir fianza | Sí | No *(pendiente, N-11)* |
| Borrar y cancelar | Sí | No *(pendiente, N-11)* |

Los tres límites los eligió Dorel: **precios y descuentos** porque es donde se regala dinero
sin que se note, **borrar y cancelar** porque es lo irreversible, e **informes y gastos**
porque son la cuenta de resultados del negocio. Saltarse un paso del workflow sí lo puede
hacer: es la salida de emergencia de quien tiene el coche en la puerta, y queda con autor y
motivo.

⚠️ **Hoy solo se aplican los tres primeros bloques.** Un empleado no ve ni entra en Informes,
Gastos ni Ajustes; dentro de lo que sí ve, todavía puede tocar precios, borrar y cancelar. Los
permisos existen en la tabla y falta conectarlos y respaldarlos con reglas de Firestore: es
N-11.

### Branding

Verde `#20A48F`, negro `#000000`, blanco `#FFFFFF`. Logo en login, sidebar, favicon,
contratos PDF, emails y pantalla pública de firma. Tipografía Gotham Medium con fallback
limpio (Inter, Arial, sans-serif).

---

## 13. Cómo usar este documento

- Al empezar algo nuevo, comprobar §2 (¿existe ya?) y §9 (¿hay una divergencia conocida?).
- Al cerrar un módulo, mover su fila en §2 y borrar lo que corresponda de §9.
- Al responder una de las preguntas de §10, escribirla aquí antes de programar.
- Si el código contradice este documento, el código tiene razón: corregir el documento.

Detalles técnicos de stack, comandos, estructura de carpetas y convenciones: ver
[CLAUDE.md](CLAUDE.md).
