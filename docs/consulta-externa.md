# Consulta externa — Velto Store

> **Qué es este documento.** Un briefing autocontenido para pedir una segunda
> opinión a otra IA sobre este proyecto. Está escrito para que se pueda pegar
> entero sin acceso al repositorio. Se mantiene al día: si algo de aquí deja de
> ser cierto, se corrige.
>
> Última revisión: **11 de septiembre de 2026.**

---

## PROMPT — pégalo entero

Eres un consultor técnico y de producto. Te paso el estado real de una
aplicación en producción para un negocio pequeño, con sus decisiones de diseño y
el porqué de cada una. **No quiero un resumen de lo que te cuento ni una lista
de buenas prácticas genéricas.** Quiero que encuentres lo que no está en este
documento: riesgos, huecos y errores de criterio que no hemos visto.

Al final tienes las preguntas concretas. Si crees que la pregunta importante es
otra, dilo.

---

## 1. El negocio

**VELTO MOBILITY, S.L.** — alquiler de coches sin conductor en Torrejón de Ardoz
(Madrid, España). Flota pequeña, del orden de **2 a 10 vehículos**. Clientes en
buena parte **conocidos y recurrentes**, incluidas cuadrillas de obra que
comparten coche. Se opera **desde el móvil, en la calle**, entregando y
recogiendo coches.

El equipo es **el dueño (Dorel) más algún empleado de mostrador**. No hay
departamento técnico: Dorel programa la aplicación con ayuda de IA. Eso importa
para lo que se recomiende: nada que exija mantenimiento continuo de un
especialista tiene sentido aquí.

La aplicación es **de uso interno**. Los clientes no tienen cuenta: reciben
enlaces (presupuesto, justificante, firma de contrato, pago con tarjeta) que
funcionan sin registrarse.

## 2. Stack

**Frontend** — Angular 20.3 standalone (sin NgModules), TypeScript 5.9
`strict` + `strictTemplates`, signals, Tailwind v4 + SCSS, PrimeIcons.
i18n propio con tres JSON (**es** por defecto, **en**, **ro**) y un auditor que
falla el build si hay claves que faltan, huérfanas o desalineadas.
**1.320 claves** de traducción.

**Backend** — Firebase: Auth (Google), Firestore, Storage, Hosting y **Cloud
Functions** (Node 22, TypeScript, región `europe-west1`, junto a los datos).
PDF con `pdf-lib` + `fontkit`, firma digital con `@signpdf`, email con **Resend**,
pagos con **Redsys**.

**Tamaño** — ~58.000 líneas de app + ~18.000 de functions. 107 commits.
**436 tests** en la app y **18 ficheros de test** en las functions, todos con
Vitest.

**Dos entornos**, dos proyectos de Firebase, una sola base de código: lo único
que cambia es qué fichero de entorno se compila y a qué proyecto apunta el CLI.
No hay `if (production)` en el código de la app.

| | Desarrollo | Producción |
|---|---|---|
| Proyecto | `velto-store` | `rentalcar-veltomobility` |
| Rama | `develop` | `master` |
| Dominio | store.veltorent.com | rentalcar.veltomobility.com |

CI despliega **solo hosting**. Las Cloud Functions van a mano, entorno por
entorno — es el punto más frágil de los dos.

## 3. Los módulos, y su estado real

Quince módulos, todos construidos (ya no queda ningún placeholder):

**Reservas** · **Clientes** · **Vehículos** · **Pagos** · **Contratos** ·
**Inspecciones** · **Gastos** · **Facturas** · **Colaboradores** · **Informes** ·
**Eventos** · **Calendario** · **Documentos** · **Ajustes** · **Panel**

### El ciclo del alquiler, que es el corazón

```
Presupuesto → Reserva → Cliente → Pago señal → Contrato PDF
  → Link de firma → Firma cliente → Pago resto + fianza
  → Entrega (inspección) → Devolución (inspección)
  → Cargos extra + fianza → Cierre
```

Un único fichero (`reservation-workflow.util.ts`) es la **única autoridad** sobre
ese orden: la interfaz lo consulta para apagar botones y los servicios lo
invocan antes de mutar estado. Saltarse un paso exige un motivo escrito que
queda guardado en la reserva con autor y fecha.

**Probado de extremo a extremo con datos reales**, en los dos entornos, incluida
la cancelación.

### Contratos

Se generan en PDF en tres idiomas, el cliente los firma **sin cuenta** desde una
URL con token de un solo uso que caduca, y el PDF se **sella con el certificado
de representante de la FNMT** de la empresa. Lleva QR y Código Seguro de
Verificación con página pública propia, para el contrato en papel.

### Cobros

**Redsys funciona de extremo a extremo**, con un cobro real de 10 € en
producción. El cliente puede pagar **desde su móvil** con un enlace, sin que el
operador esté delante.

⚠️ Esa vía perdió un cobro real de 1 € el 4 de septiembre: el identificador de
pedido se regeneraba en cada consulta y el aviso del banco llegaba huérfano.
Arreglado, pero **todavía no hay un cobro por esa vía que se haya registrado
solo, sin ayuda**. Hasta que lo haya, no la damos por probada.

### Facturación y VeriFactu — lo más delicado

España obliga desde 2026-2027 (RD 1007/2023 + Orden HAC/1177/2024) a que el
software de facturación genere un **registro de facturación** por cada factura,
encadenado por huella SHA-256, y lo **remita a la AEAT**.

Estado:

- La emisión funciona: número correlativo y huella encadenada dentro de una
  transacción. Factura ordinaria, rectificativa, proforma y recibo de cobro.
- **La remisión a la AEAT está probada contra el entorno de preproducción**
  (`prewww1.aeat.es`), con certificado de representante de la FNMT autenticando
  **desde la Cloud Function** por mTLS. Las facturas se aceptan con su CSV, la
  sede responde «Encontrada» al cotejar el QR, y una function programada cada
  cinco minutos remitió una factura ella sola.
- La declaración responsable del art. 15 (aquí el **productor del software es la
  propia empresa**, al ser desarrollo propio) se emite desde Ajustes, una por
  versión del sistema.
- **En producción está apagado**: `VELTO_INVOICING_ENABLED=false`. La primera
  factura emitida en producción es un punto de no retorno, y se activa el **1 de
  enero de 2027** siguiendo un guion escrito.

⚠️ **Preproducción encontró cinco fallos que el esquema XSD y los tests dejaban
pasar**, y ese es el patrón que más nos ha enseñado: *un XML válido contra el
`.xsd` puede rechazarse por lo que significa.*

1. El NIF-IVA extranjero iba en el campo `NIF`, que es solo para identificadores
   españoles.
2. El código de país es obligatorio cuando el identificador no es un NIF-IVA,
   aunque el esquema lo declare opcional. Afecta al caso **más común** de un
   alquiler: un turista con pasaporte.
3. El registro se guardaba **congelado dentro de una factura inmutable**, así que
   un registro rechazado por un fallo del código no se podía corregir nunca y la
   cadena entera se quedaba muerta.
4. El QR medía 21,9 mm y el art. 21 lo fija entre 30×30 y 40×40 mm.
5. La respuesta de «duplicado» no trae CSV, y escribir ese vacío **borraba el
   acuse** de la remisión buena.

⚠️ **Pendiente y aparcado por Dorel:** la empresa **no está en el Registro de
Operadores Intracomunitarios (ROI)**, ni siquiera solicitado, y tarda meses. Sin
él no se puede facturar exento a otro Estado miembro ni aplicar inversión del
sujeto pasivo. La aplicación **permite** esos regímenes y la AEAT acepta sus
registros, pero **no se deben usar en una factura real** todavía. La aplicación
no lo impide hoy.

### Informes (recién construido)

Panel de analítica: beneficio, base imponible, IVA cobrado, salidas, comparativa
con el año anterior, reparto por medio de cobro, ingresos por coche, ocupación
de la flota, ingreso medio por día alquilado, clientes que repiten y mejores
clientes con días acumulados. Gráficos SVG propios, sin dependencia externa.

⚠️ Al construirlo se descubrió que **el informe anterior sumaba las fianzas como
ingresos**: una fianza de 300 € cobrada y devuelta contaba 600 € de facturación.
No fallaba nada; daba una cifra creíble y equivocada.

### Colaboradores

Comerciales que traen clientes y cobran comisión sobre el **neto** (nunca sobre
el importe con IVA: sería pagarles un porcentaje de un impuesto). El importe se
puede ajustar a mano. **Es un registro interno: no genera factura, no entra en
VeriFactu y no toca la contabilidad.**

### Avisos

Una function programada manda **a las 9:00 de la mañana** un correo con lo que
hay que preparar para el día siguiente, y solo si hay algo. Y una pantalla de
Eventos próximos que **deriva** todo de los datos existentes —entregas,
devoluciones, mantenimientos que vencen, facturas que se salen de plazo— más
recordatorios manuales, que son lo único que se guarda.

## 4. Los principios de diseño que ya están tomados

Los enumero para que, si te parecen equivocados, lo digas **explícitamente** en
vez de proponer lo contrario sin saber que se decidió así.

1. **Una sola fuente de verdad por concepto**, y lo derivado se deriva al pintar.
   No hay colección de «eventos», ni de «liquidaciones», ni de «totales». La
   única excepción es una copia del resumen de pagos dentro de la reserva, que
   ya nos ha dado un dato viejo y está documentada como trampa.
2. **Los datos son hoy desechables** (excepto las facturas). Si una forma tiene
   que cambiar, se cambia, se borran los datos y se vuelven a crear. **No se
   escribe código para leer datos viejos.** Esto cambia el 1 de enero.
3. **Una factura emitida no se edita ni se borra, nunca, ni siendo
   administrador.** Un error se corrige con una rectificativa.
4. **El texto y el hecho se deciden juntos.** Nos ha mordido cuatro veces: el
   contrato afirmaba una firma digital que no llevaba, el presupuesto decía «los
   precios incluyen IVA» encima de un desglose que lo sumaba, el contrato remitía
   a documentos que no existían, y el rótulo de un rol describía permisos que ya
   no eran esos.
5. **Un botón que no hace nada es un fallo.** Los botones de guardar no se
   deshabilitan por datos que falten: se pulsan, se marca el campo y se explica.
   Y **un permiso denegado se explica**, nunca es un botón que desaparece.
6. **Móvil primero: recolocar, nunca ocultar.** Un `display:none` que se lleve un
   importe, un estado o una fecha es un fallo, no una adaptación.
7. **Permisos en tres capas**: la pantalla esconde, el servicio rechaza y
   `firestore.rules` es lo único que impide de verdad. Dos roles: administrador y
   empleado. Un empleado no ve informes, gastos, facturas, colaboradores ni el
   histórico de cobros; no toca precios ni descuentos; no borra ni cancela. Sí
   puede saltarse un paso del workflow y eximir la fianza, porque está en el
   mostrador con el cliente delante y las dos dejan rastro.
8. **El IVA va en dos direcciones a propósito**: en un alquiler se **suma** al
   neto (30 €/día son 30 € de base), en un gasto se **extrae** del total. Viven en
   ficheros distintos con nombres explícitos porque confundirlas no da un error:
   da una cifra creíble y equivocada.
9. **Lo que se congela por reserva** —precio, tipo de IVA, kilómetros incluidos,
   descuento— no se recalcula nunca. Un cambio en Ajustes rige para lo nuevo.
10. **Ningún dato personal de más en lo público.** El QR de verificación de un
    contrato devuelve cinco datos y ninguno personal. La pantalla de pago
    devuelve importe, moneda y concepto: nunca quién es el cliente.

## 5. Qué está probado y qué no

**Probado con datos reales, en producción o contra el servicio real:**
el ciclo completo del alquiler · el contrato firmado y sellado, y su email ·
Redsys desde el botón del operador (10 € reales) · los enlaces cortos · el QR del
contrato en papel · la remisión a la AEAT contra preproducción · los permisos de
empleado atacando `firestore.rules` desde fuera de la aplicación.

**Construido y NO probado de verdad:**

- Un cobro que llegue **solo** por la vía del móvil del cliente.
- Las reglas de Firestore con **una cuenta de empleado real** para las
  colecciones financieras nuevas (hoy se probó con el rol forzado en memoria,
  que prueba la aplicación y no las reglas).
- Rectificativa por sustitución e inversión del sujeto pasivo contra
  preproducción.
- Toda la facturación **en producción**, por decisión: se activa el 1 de enero.

**Lo que no existe:**

- **No hay linter.** No hay ESLint ni script `lint`.
- **No hay tests de componentes ni E2E.** Solo utils y lógica pura. El patrón de
  fallo dominante del proyecto es *código escrito y nunca ejecutado*, y lo que lo
  encuentra es recorrer el flujo a mano o mirar el PDF generado, no los tests.
- **No hay emuladores en uso**: se prueba contra los proyectos reales.
- **No hay copias de seguridad de Firestore configuradas.**
- **No hay monitorización ni alertas** de functions que fallen.

## 6. Lo que ya sabemos que falta

No hace falta que nos lo repitas. Está aquí para que busques **lo que no está**.

1. **Copias de seguridad.** Ninguna, y a partir del 1 de enero habrá facturas
   inmutables encadenadas por huella cuya pérdida no se puede reponer.
2. **RGPD.** Guardamos DNI y carné de conducir en Storage. Borrar un cliente con
   reservas no es posible hoy: su nombre y documento viven congelados en el
   snapshot de cada reserva y de cada contrato. Un borrado real pasaría por
   anonimizar esos snapshots, y no está hecho. Tampoco hay política de retención
   ni registro de tratamiento.
3. **Dos operadores pueden reservar el mismo coche.** La disponibilidad se
   consulta y se escribe después. No se puede cerrar desde el cliente: el SDK web
   no permite consultas dentro de una transacción. Haría falta una Cloud
   Function. Mitigado comprobando otra vez justo antes de escribir (~1 s → ms).
4. **El certificado de la FNMT caduca** y hoy eso solo se notaría con una
   factura sin remitir.
5. **Bus factor de uno.** Un solo administrador, y quien programa es el dueño.
6. **Informes carga todas las colecciones enteras** y filtra en memoria.
   Deliberado para este tamaño de negocio, pero no escala.
7. **`payments` está abierto** a cualquier usuario autorizado en las reglas de
   Firestore, y no se puede cerrar sin romper la ficha de la reserva. Un empleado
   con la consola del navegador puede listar los cobros y sumarlos. Lo que
   protege la cuenta de resultados es que gastos y comisiones sí estén cerrados:
   sin ellos hay ingresos, no beneficio.
8. **Desplegar todas las Cloud Functions de golpe agota la cuota de CPU de Cloud
   Run** (hay 26 en desarrollo y 19 en producción, y el desfase es a propósito:
   las que escriben facturas aún no están en producción). El error que se lee
   dice «Container Healthcheck failed» y parece un fallo del código; la causa
   real sale una línea antes y solo a veces. Hay que desplegar por tandas.

## 7. Lo que se espera de la app

Corto plazo, comprometido:

- **1 de enero de 2027**: activar la facturación en producción y empezar a
  emitir en cadena, con la serie correlativa correcta ante la AEAT.
- Cerrar las pruebas pendientes del punto 5.

Sin fecha, esperado:

- El ROI para poder facturar intracomunitario.
- Pre-reserva desde la web pública (**decidido que va en otro proyecto**, no en
  esta aplicación).
- Crecer la flota sin rehacer nada.

## 8. Lo que te pido

Contesta a esto, y en este orden de importancia para nosotros:

1. **El 1 de enero.** Vamos a cruzar un punto de no retorno: la primera factura
   real. ¿Qué tendría que estar hecho **antes** de esa fecha y no está en este
   documento? Piensa en lo que no se puede arreglar después.

2. **Los cinco fallos que encontró preproducción** (sección 3) comparten un
   patrón: el dato era válido y significaba otra cosa. **¿Qué otros fallos de esa
   misma familia esperarías** en una integración VeriFactu que ha pasado
   preproducción pero no ha emitido nunca en real?

3. **Los principios de la sección 4.** ¿Alguno te parece equivocado para este
   negocio y este tamaño? En particular el 1 (nada derivado se guarda) y el 2
   (nada de código de compatibilidad), que son los que más código gobiernan.

4. **La lista de la sección 6 está ordenada por lo que nos preocupa.** ¿La
   ordenarías distinto? ¿Qué añadirías que no esté?

5. **RGPD.** Es donde más flojos estamos y menos sabemos. ¿Qué es lo mínimo
   exigible y qué es lo primero que haríamos si nos lo reclamaran mañana?

6. **Testing.** No hay E2E ni tests de componentes, y el patrón de fallo
   dominante es código escrito y nunca ejecutado, que se caza mirando la pantalla
   o el PDF. ¿Merece la pena montar E2E aquí, o hay algo con mejor relación
   esfuerzo/hallazgo para un equipo de una persona?

7. **La pregunta abierta.** ¿Qué es lo que **no** te hemos preguntado y deberías
   contarnos igual?

**Cómo quiero la respuesta:** concreta y priorizada. Si algo te parece un riesgo
serio, dilo primero y di por qué, con el escenario en el que muerde. Si algo de
lo que hacemos te parece bien, dilo en una línea y sigue — no necesito
confirmación, necesito lo que falta.
