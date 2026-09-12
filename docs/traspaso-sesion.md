# Traspaso de sesión — 12 de septiembre de 2026

> Pégalo entero al abrir la sesión nueva. Está escrito para alguien que **no ha
> visto nada de lo anterior**: dice qué hacer, en qué orden, y qué NO tocar.

---

## 0. LO PRIMERO DE TODO, ANTES DE PROGRAMAR NADA

**Vaciar Firestore de DESARROLLO entero y empezar de cero.** Es una decisión de
Dorel del 12 de septiembre de 2026 y es la que desbloquea lo demás.

**Por qué:** la funcionalidad nueva —coches de colaborador— cambia la forma de
`vehicles`, `reservations` y `collaboratorSales`. Con datos viejos dentro habría
que escribir código para leerlos, y **este proyecto tiene prohibido hacer eso**
(ver CLAUDE.md, «Los datos todavía se pueden borrar»). Borrar sale más barato y
deja el código limpio.

### ⚠️ Lo que NO se borra

- **`authorizedUsers`.** Es donde vive la autorización de acceso: borrarla deja a
  todo el mundo fuera **sin forma de entrar a arreglarlo desde la aplicación**.
  Ahora tiene **dos** documentos y los dos hacen falta:
  `veltorent@gmail.com` (admin) y `dbindea@gmail.com` (employee, creado el 12 de
  septiembre para probar las reglas).
- **Producción.** `rentalcar-veltomobility` no se toca. Solo `velto-store`.

### ⚠️ Y tres cosas que hay que saber antes de ejecutar

1. **Vaciar Firestore no vacía Storage.** Los PDF, las firmas y las fotos se
   quedan, huérfanos y con su token de descarga vivo. Se limpian aparte, desde la
   consola de Firebase.
2. **Hay copias programadas y PITR desde el 11 de septiembre**, así que el
   borrado es recuperable durante 7 días. No es una red para confiarse, pero
   quita hierro.
3. **La protección contra borrado de la base está activada.** Eso impide
   `databases delete`, no borrar documentos: para esto no estorba.

### Después de borrar, lo que el borrado permite

- Hacer **`CollaboratorSale.kind` obligatorio** y retirar la tolerancia a su
  ausencia en `kindOf()` — hoy la ausencia se lee como `referral` porque hay
  cuatro comisiones antiguas. Sin ellas, el campo puede exigirse y el compilador
  ayuda.
- Recrear datos de prueba **con coches de colaborador desde el principio**, que
  es lo que hace falta para probar el reparto de verdad.

---

## 1. Qué es esto

**Velto Store** — SPA de gestión de flota de alquiler. Angular 20 + Firebase.
Negocio real, pequeño: 2–10 coches en Torrejón de Ardoz. Se opera **desde el
móvil, en la calle**. El dueño se llama **Dorel** y es quien programa.

Lee **`CLAUDE.md`** entero antes de tocar nada: es largo y cada aviso está ahí
porque el fallo ya ocurrió. Y **`FUNCIONAL.md`** para el negocio.

Dos entornos, dos proyectos: `velto-store` (desarrollo, rama `develop`) y
`rentalcar-veltomobility` (producción, rama `master`).

Estado a 12 de septiembre de 2026: **469 tests** en la app y **369** en las
functions, build, `i18n:audit` y `css:audit` en verde. Todo subido a `develop`.

---

## 2. La tarea principal: coches de colaborador (N-33)

Velto alquila también vehículos cedidos por colaboradores, que cobran una parte.

⚠️ **Velto sigue siendo quien alquila y quien factura al cliente**, por el total
y en nombre de VELTO MOBILITY. El propietario **no aparece** de cara al cliente.
Lo que hay detrás es otra relación: Velto le debe su parte por la cesión.

### Las cuatro decisiones, ya tomadas por Dorel. No volver a preguntarlas

| | Decisión |
|---|---|
| **Extras** | **No se reparten**: son de Velto. Combustible, limpieza, daños, km de más y multas cubren un coste que pone la agencia |
| **Devengo** | **Al cerrar la reserva**, con los importes definitivos |
| **Porcentaje** | **En cada coche**, con el del colaborador como propuesta |
| **Factura** | **La manda el propietario y Velto la registra.** Sin autofacturación |

### Entrega 1 — HECHA (commit `5ca5f74`)

- **`src/app/shared/utils/owner-share.util.ts`** + spec. Única autoridad sobre la
  base: el alquiler **sin IVA y solo el alquiler**.
- `Vehicle`: `ownership` (`own` | `collaborator`), `ownerCollaboratorId`,
  `ownerSharePercent`. Ausente vale «propio».
- `Reservation`: `ownerShareSnapshot`, **congelado al crear**.
- `Collaborator`: `ownerSharePercent`, **distinto** de `commissionPercent`.
- `CollaboratorSale`: `kind` (`referral` | `vehicle_owner`), `kindOf()`,
  `balanceByKind()`.

⚠️ **`kind` es la petición literal de Dorel: «no mezclar ni duplicar».** El mismo
colaborador puede traer el cliente **y** poner el coche de la **misma** reserva:
son **dos apuntes**, no uno mayor. Uno lleva detrás una factura suya por la
cesión y el otro no.

⚠️ **Un fallo que salió escribiendo el test y conviene recordar:**
`Number(null)` es `0`, no `NaN`. Un porcentaje sin rellenar pasaba como reparto
del **0 %**, que aquí es legítimo, así que nada chirriaba: al propietario se le
habría liquidado cero hasta que se quejara.

### Entrega 2 — SIGUIENTE

Alta de vehículo con propietario y reparto automático en la reserva.

- En `vehicle-form`: elegir «Propio» o «De colaborador». Si es de colaborador,
  **seleccionar uno existente o crearlo desde ahí** —Dorel lo pidió así— y
  proponer su `ownerSharePercent`, editable por coche.
- Validar con `vehicleOwnershipProblem()`, que ya existe. Recordar la regla de la
  casa: **el botón de guardar no se deshabilita**, se marca el campo y se
  explica.
- Al crear la reserva, llamar a `ownerShareSnapshotOf()` y guardar el resultado.
  El sitio es `commitReservationWithPayments()`, que ya mete reserva y pagos en un
  `writeBatch`.
- Enseñarlo en la ficha de la reserva: de quién es el coche y cuánto le toca.

### Entrega 3

Liquidaciones agrupadas y la factura del propietario.

- Agrupar **varias reservas en un pago**: fecha, importe y forma, **incluido
  efectivo**. Hoy `collaborator.util.ts` tiene `settlements()` y las ventas se
  marcan pagadas de una en una.
- Registrar **la factura recibida** del propietario: número, fecha, importe, PDF.
- ⚠️ **Tres cosas distintas que no se pueden confundir**: la **liquidación** (lo
  que se le reconoce), el **pago** (que se le entrega el dinero) y la **factura**
  (el justificante). Se puede pagar sin factura todavía.
- ⚠️ **«Pendiente de recibir factura» NO es «no hay que facturar».** Dorel lo
  dijo expresamente. Que el estado no se lea como una exención.
- ⚠️ **Pagarle no genera ninguna factura de venta de Velto.** Es un gasto de
  Velto, no una venta.

### Entrega 4

- **Informes**: el reparto y el resultado real de Velto. Hoy `analytics.util.ts`
  es la única autoridad sobre qué cuenta como ingreso; la parte del propietario
  es una **salida** más, junto a gastos, mantenimiento y comisiones.
- **La fecha de operación de las facturas** — ver abajo, es tarea aparte.

---

## 3. La otra tarea: fecha de operación de las facturas

Pedida el 12 de septiembre, **sin empezar**. Hoy `Invoice` ya tiene
`operationDate` separada de `issueDate` y existe `needsOperationDate()`, pero
**nadie la propone**.

Lo que pidió Dorel, literal:

- Regla general: **la fecha en que el precio del alquiler resulta exigible** según
  lo pactado.
- Si se exige **al entregar** el coche → esa fecha. Si **al finalizar** → la de
  finalización.
- Si hay un **anticipo cobrado antes** → la fecha de cobro para el importe
  anticipado, **sin volver a contarlo** en la factura final.
- Si hay **mensualidades** → el vencimiento de cada período.
- **Una explicación breve** de la fecha propuesta, para poder revisarla.

⚠️ **Separadas**: fecha de expedición, fecha de operación y fechas del alquiler
son tres cosas. **No usar la de emisión ni la de devolución para todos los
casos**, que es lo que haría lo fácil.

⚠️ Y esto toca VeriFactu: `FechaOperacion` va en el registro que se remite a la
AEAT. Antes de tocarlo, leer `docs/verifactu-alta.md` y
`functions/src/invoices/verifactu.ts`.

---

## 4. Lo que está pendiente y NO es programar

### 4.1 · Probar las reglas con la cuenta de empleado ⭐

Dorel creó `dbindea@gmail.com` como `employee` en desarrollo el 12 de septiembre
**para esto**, y sigue sin hacerse.

Hace falta que **él** inicie sesión con esa cuenta (ventana de incógnito,
`localhost:4200`) y entonces ejecutar
**`docs/comprobar-reglas-financieras.js`** en la consola del navegador.

⚠️ **No intentes generar el token tú**: acuñar una credencial de sesión está
bloqueado, y con razón.

Lo que tiene que salir: **403** en `expenses`, `invoices`, `invoiceCounters`,
`billingProfiles`, `verifactuDeclarations`, `verifactuSubmissions`,
`collaborators` y `collaboratorSales`; **403** al ascenderse a admin; y **200**
en `payments`, `reservations` y `vehicles`, que es lo que necesita para trabajar.

⚠️ **`payments` en 200 es correcto**, no un agujero olvidado: la ficha de la
reserva necesita leer los pagos cobrados. Está explicado en `firestore.rules`.

### 4.2 · Ensayar una restauración

Las copias están activas desde el 11 de septiembre, **y nunca se ha restaurado
ninguna**. Procedimiento en `docs/copias-de-seguridad.md` § 4.

⚠️ Lo que hay que entender antes: **restaurar un estado anterior reintroduce
numeraciones y huellas ya consumidas**. Con facturas emitidas, lo primero es
**parar la emisión**, no restaurar.

### 4.3 · Producción, el 1 de enero

`VELTO_INVOICING_ENABLED=false` en producción y las siete functions que escriben
facturas **sin desplegar**, a propósito. El guion está en
`docs/verifactu-alta.md` § 5 bis. **Producción no se toca sin Dorel.**

### 4.4 · Aparcado por decisión suya

- **RD 933/2021** (registro ante Interior). ⚠️ Es una obligación que **ya corre**
  desde el 2 de diciembre de 2024. Aparcada el 11 de septiembre; ver N-30. No es
  un olvido, no hace falta volver a plantearla.
- **ROI / VIES**: sin pedir. `exempt_eu` y `reverse_charge` están **bloqueados
  técnicamente en producción** desde el 11 de septiembre.

---

## 5. Cómo se trabaja aquí

Esto no es estilo, es lo que hace que la aplicación no mienta:

1. **Antes de dar algo por bueno**: `npm run build` (comprueba las plantillas,
   cosa que `tsc --noEmit` no hace), `npm test`, `npm --prefix functions test`,
   `npm run i18n:audit` y `npm run css:audit`.
2. **Y además abrir la pantalla.** El patrón de fallo dominante es **código
   escrito y nunca ejecutado**. Los tres fallos más caros de septiembre no los
   habría cazado ninguna auditoría. Hay sesión abierta en `localhost:4200`.
3. **Mirar también el móvil**, a 390 px. Es una aplicación de móvil.
4. **El texto y el hecho se deciden juntos.** Ha mordido cinco veces: el contrato
   afirmaba una firma que no tenía, el presupuesto decía «IVA incluido» sobre un
   desglose que lo sumaba, el correo decía «el coche no se puede alquilar» y la
   aplicación lo alquilaba…
5. **Nada de texto en español dentro del código.** Todo clave i18n, en los tres
   idiomas, y `i18n:audit` en verde.
6. **Un botón que no hace nada es un fallo**, y un permiso denegado se explica.
7. **Commits en español**, formato convencional, contando **por qué**. Se puede
   commitear en `develop`; `master` necesita el visto bueno de Dorel.

⚠️ **Y lo más importante de todo:** cuando algo no cuadre, **decirlo**. La regla
de esta casa es que una cifra creíble y equivocada es peor que un error.

---

## 6. Estado del repaso previo a producción

Cuatro tandas entre el 11 y el 12 de septiembre, **unos treinta fallos** (N-32).
La curva se aplanó: la cuarta no sacó ningún fallo estructural.

**Todavía no se ha dado el visto bueno para producción**, y falta poco:

- Ficha de cliente, detalle de pago y formulario de vehículo en móvil — las tres
  que no se llegaron a abrir.
- La prueba de reglas del punto 4.1.
- El ensayo de restauración del 4.2.
