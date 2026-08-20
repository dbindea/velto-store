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
| Redsys | ⚠️ recién corregido | ❌ nunca funcionó | Sin validar contra pasarela |
| Gastos | ❌ placeholder | — | Solo `moduleInProgress` |
| Ajustes | ❌ placeholder | — | Solo `moduleInProgress` |
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

### Cliente

Nombre, teléfono, email, documento, dirección, carnet (número, expedición, caducidad, país),
nivel de confianza, notas internas, documentos.

```
ClientTrustLevel: new | known | regular | risk | blocked
```

`blocked` significa no alquilar. Hoy el nivel es informativo: **no bloquea el flujo**. Ver §10.

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

⚠️ **Redsys nunca ha funcionado en producción.** La firma `HMAC_SHA256_V1` estaba mal
implementada (faltaba la derivación 3DES de la clave). Está corregida y verificada contra un
vector de referencia, pero **falta la validación end-to-end contra el entorno de test real**,
y las Cloud Functions se despliegan a mano.

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

---

## 9. Divergencias conocidas entre visión y código

La parte que más valor tiene mantener al día.

### Ya resuelto

- La firma de Redsys, el formato del `Ds_Merchant_Order` y la URL del webhook estaban mal.
  Corregidos y con tests.
- Los guards del workflow ignoraban los overrides de `WorkflowContext` mientras el timeline
  sí los respetaba. Alineados.
- `generateContractPdf` fallaba al escribir `undefined` en Firestore.

### Abierto

**Falta el índice compuesto de `inspections`.** `getByReservation()` consulta
`where('reservationId','==',x)` + `orderBy('createdAt','asc')`, que exige un índice compuesto.
`firestore.indexes.json` declara índices para `reservations`, `payments` y `vehicleMaintenance`,
**pero ninguno para `inspections`**. Como la colección nunca se ha usado en producción, nadie
ha llegado a toparse con el fallo. Se manifestará en el primer uso real del módulo.

**El nivel de confianza del cliente no hace nada.** `blocked` y `risk` se muestran, pero no
intervienen en el workflow. Falta decidir si `blocked` debe impedir crear una reserva.

**Gastos y ajustes son placeholders.** Las reglas de Firestore ya contemplan una colección
`expenses`, pero no hay ni modelo ni servicio. Sin definición funcional no se puede avanzar:
qué campos tiene un gasto, si se asocia a vehículo o reserva, y qué debe ser configurable
en ajustes.

**No hay tests de componentes ni E2E.** Solo utils y lógica pura (32 tests). El flujo
completo de alquiler no tiene cobertura automatizada.

**Deuda de repositorio.** `deploy.log` y tres `test-contract-*.pdf` (~4 MB) están trackeados
sin necesidad.

---

## 10. Decisiones pendientes

No son bugs, son preguntas de producto sin responder:

1. ¿Un cliente `blocked` debe impedir crear la reserva, o solo avisar?
2. ¿Qué es exactamente un gasto y contra qué se imputa?
3. ¿Qué debe poder configurarse en Ajustes? (¿tarifas por defecto, datos de empresa,
   textos del contrato, usuarios autorizados?)
4. ¿El calendario y los informes cubren la necesidad real, o se construyeron sin uso?
5. ¿Se factura? La generación de facturas aparece como idea, sin definir.

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
