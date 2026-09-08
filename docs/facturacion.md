# Facturación — análisis previo

Estado: **análisis, nada implementado.** Escrito el 8 de septiembre de 2026 a
petición de Dorel, que hoy hace las facturas a mano en Word y quiere emitirlas
desde la reserva.

⚠️ **No soy asesor fiscal.** Lo que sigue está contrastado con el BOE y la sede
de la AEAT, y las fuentes van citadas, pero **las decisiones de numeración y el
alta en VeriFactu las tiene que confirmar la gestoría** antes de emitir una
factura real.

---

## 0. Decisiones tomadas — 8 de septiembre de 2026

| | Decisión de Dorel |
|---|---|
| **Numeración** | `2026/0001`. Serie igual al ejercicio, contador de cuatro dígitos |
| **Cuándo se emite** | En cualquier momento. Hay empresas que piden factura **para poder pagar** |
| **A quién** | **Solo a petición.** Habrá reservas que se facturen meses después, cuando el cliente se acuerde |
| **Forma de pago** | Si está pendiente: cuenta, TPV o efectivo (por debajo de 1.000 €). Si está pagada: «Factura pagada» |
| **VeriFactu** | Modalidad **VERI\*FACTU**, con envío a la AEAT |
| **Anticipos** | **No se facturan aparte.** Una sola factura final. Mientras tanto, un **recibo informativo** sin validez fiscal |
| **Importe** | Editable: se puede facturar por más o por menos de lo que costó el alquiler |
| **Sin reserva** | Hay que poder emitir **facturas libres** — venta de un coche, una limpieza, un cambio de aceite |
| **Proforma** | Sí, pero barata: sin VeriFactu y sin número fiscal |
| **Las 3 de Word** | Se quedan como están. Ver sección 2 bis |

Las tres primeras tienen consecuencias que no son evidentes y que van en la
sección 3 bis. La de la forma de pago, en la 6 bis. Las cinco de abajo cambian
la forma del modelo y están en la **sección 11**.

---

## 1. Lo primero, porque cambia cómo trabajamos

**Una factura emitida no se puede borrar ni modificar. Nunca.**

Hasta hoy, CLAUDE.md dice que los datos de producción son desechables: se borra
una colección, se cambia la forma de un documento y se vuelve a crear. Esa regla
ha valido para todo — reservas, contratos, pagos.

**Con las facturas se acaba.** Desde la primera factura real emitida:

- No se borra. No se edita. Un error se corrige emitiendo una **factura
  rectificativa**, que es un documento nuevo que referencia al anterior.
- El número consumido queda consumido aunque la operación se anule.
- La colección `invoices` deja de ser desechable, y con VeriFactu además queda
  encadenada: borrar una rompe la cadena de todas las siguientes.

Esto no es una restricción que nos inventemos por prudencia: es el art. 15 del
[RD 1619/2012](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) y, a partir
de 2027, el encadenamiento por huella del RD 1007/2023.

**Consecuencia práctica**: mientras probamos, se factura **solo en
`velto-store`** (desarrollo). La primera factura que se emita en producción
marca el punto de no retorno de esa colección.

---

## 2. La numeración: qué exige la ley y qué se puede elegir

### Lo que es obligatorio

El [art. 6.1.a) del RD 1619/2012](https://www.iberley.es/legislacion/articulo-6-reglamento-regulan-obligaciones-facturacion)
pide número y, en su caso, serie, **correlativos dentro de cada serie**. De ahí
salen tres reglas y ninguna es negociable:

1. **Sin huecos.** No se pasa del 2 al 4. Si una factura se emite, ocupa su
   número para siempre; si estaba mal, se rectifica, no se borra.
2. **Sin reutilizar.** Un número consumido no vuelve.
3. **Sin retroceder.** La secuencia sube.

### Lo que sí se puede elegir

**El formato es libre.** No hay uno obligatorio. El actual —`0001/2600001`—
es perfectamente válido: serie `0001`, y el número lleva el año dentro (`26` +
cinco dígitos).

⚠️ **Pero el formato se elige una vez.** Cambiarlo hoy no cuesta nada; cambiarlo
con cien facturas emitidas obliga a abrir serie nueva y a explicarle a la
gestoría por qué hay dos formatos en el mismo ejercicio.

**Decidido: `2026/0001`** — serie igual al ejercicio, contador de cuatro dígitos
que reinicia cada año. Por qué:

- La serie **es** el año, así que el reinicio anual está justificado solo con
  mirar el número: cada ejercicio es su propia serie correlativa.
- No hay que decidir qué pasa cuando el contador de cinco dígitos se cruce con
  el cambio de año.
- Se lee en voz alta sin ambigüedad, que importa cuando un cliente llama.

⚠️ **La numeración de Word arranca de cero.** Las facturas ya emitidas a mano
—como la `0001/2600001` del ejemplo— **no se importan**: quedan donde están, en
su serie, y la aplicación abre la suya. Dos series conviviendo en el mismo
ejercicio están permitidas y es más limpio que reconstruir a mano un histórico
que después no se puede tocar.

### Las series que sí son obligatorias

**Las facturas rectificativas van en serie propia**, por exigencia del art. 6.2:
`R2026/0001`.

---

## 2 bis. Las tres facturas de Word: **no se rehacen**

Situación: `0001/2600001` a `0001/2600003` ya emitidas y entregadas, trimestre
sin cerrar. La duda era si rehacerlas en la serie nueva.

**No.** Y no es prudencia, es que no se puede sin inventarse una causa.

El [art. 15 del RD 1619/2012](https://sede.agenciatributaria.gob.es/Sede/iva/facturacion-registro/facturacion-iva/facturas-rectificativas.html)
lista cuándo procede una rectificativa: cuando la factura no cumple los
requisitos de los arts. 6 o 7, cuando las cuotas se determinaron mal, o cuando
concurren las circunstancias del art. 80 LIVA. **Cambiar el formato del número no
es ninguna de las tres.** Esas tres facturas son correctas: tienen número, serie,
fechas, NIF, base, tipo y cuota. Rectificar una factura correcta para
renumerarla sería emitir una rectificación sin causa, y encima obligaría a
explicarle a tres clientes —que ya las tienen contabilizadas— por qué reciben
documentos nuevos por el mismo servicio.

**Lo correcto es lo más cómodo**: las tres se quedan en su serie, y la aplicación
abre la suya con `2026/0001`. El [art. 6.2](https://www.iberley.es/legislacion/articulo-6-reglamento-regulan-obligaciones-facturacion)
permite series separadas «cuando existan razones que lo justifiquen», y cambiar
de sistema de facturación a mitad de ejercicio es exactamente eso.

Cada serie mantiene su propia correlatividad, que es lo único que la ley pide. La
`0001/26…` queda cerrada en el 3 y no vuelve a usarse nunca.

⚠️ **Díselo a la gestoría igualmente**, no para pedir permiso sino porque le
aparecerán dos series en el mismo trimestre y conviene que sepa por qué.

---

### Cómo se garantiza «sin huecos» en Firestore

El número **se asigna al emitir, nunca antes**. Un borrador no tiene número.

La asignación es un contador por serie en un documento propio, y se incrementa
**en la misma transacción** que crea la factura: o entran las dos cosas o no
entra ninguna. Es el mismo razonamiento que `commitReservationWithPayments()`,
donde una escritura suelta dejaba una reserva sin nada que cobrar.

⚠️ **Aquí sí se puede usar una transacción desde el cliente**, al contrario que
en la disponibilidad de vehículos: el problema allí era que el SDK web no permite
**consultas** dentro de una transacción, y el contador se lee **por id**, que sí
está permitido. Aun así lo pondría en una Cloud Function, por el motivo de
siempre: `firestore.rules` no puede impedir que alguien escriba un número
arbitrario, y el número de factura es exactamente el dato que no puede quedar al
criterio del cliente.

---

## 3. Emitir con fecha pasada: la respuesta corta es «no, pero no hace falta»

Tu pregunta era hasta qué punto se puede. La normativa distingue **dos fechas**,
y ahí está la solución a tu caso real:

| Campo | Qué es | ¿Se puede poner en el pasado? |
|---|---|---|
| **Fecha de expedición** | El día en que emites la factura | **No.** Es hoy |
| **Fecha de la operación** | Cuándo se prestó el servicio | **Sí**, y es obligatoria si difiere de la de expedición (art. 6.1.f) |

Tu factura de ejemplo ya lo hace bien sin saberlo: expedida el **10/08/2026**
para un periodo **01/06 – 01/08/2026**. Eso es exactamente la figura prevista: no
estás retrodatando nada, estás facturando en agosto un servicio de junio a
agosto.

Por qué no conviene permitir retrodatar la expedición, aunque la tentación
aparezca:

- Rompe la correlación cronológica dentro de la serie: una factura con número
  posterior y fecha anterior a otra ya emitida es justo lo que hace saltar una
  revisión.
- A partir de 2027 el registro se envía a la AEAT con su marca de tiempo, así
  que retrodatar pasa de ser discutible a ser **detectable**.

**Lo que sí hay que respetar** es el plazo de expedición: cuando el destinatario
es empresario o profesional —tu caso cuando factures a una empresa—, la factura
debe expedirse **antes del día 16 del mes siguiente** a aquel en que se devengó
la operación. Eso no lo impone la aplicación, pero sí puede avisarlo.

**Propuesta**: la fecha de expedición es siempre la del día en que se pulsa
«Emitir», sin campo editable. El periodo de la operación se rellena solo con las
fechas de la reserva y se puede ajustar a mano.

---

## 3 bis. Lo que abren «en cualquier momento» y «solo a petición»

Tres casos que nacen de esas dos decisiones y que hay que resolver en el diseño,
no cuando aparezcan.

### a) Facturar en 2027 una operación de 2026

Si un cliente pide en febrero la factura de un alquiler de noviembre, **la serie
es la del año de expedición**, no la de la operación: sale `2027/0007`, con la
fecha de operación en 2026. Es correcto y está previsto — la serie ordena
cuándo se emitió, y la fecha de operación dice cuándo se prestó el servicio.

Lo que **no** vale es reservar huecos en la serie de 2026 «por si acaso»: un
número no emitido no existe.

### b) «Solo a petición» vale para particulares. Para empresas, no

Aquí sí hay una diferencia legal, y conviene conocerla porque afecta al 90 % de
lo que quieres facturar:

| Destinatario | Cuándo hay que emitirla |
|---|---|
| **Particular** | Cuando la **solicite**. Tu decisión es exactamente lo que prevé la norma |
| **Empresario o profesional** | Siempre, y **antes del día 16 del mes siguiente** al devengo |

O sea: la empresa que alquila un coche para sus obreros tiene derecho a su
factura la pida o no, y con plazo. La sanción por incumplir el plazo es del **2 %
del importe**, y ⚠️ **con VeriFactu las fechas quedan registradas en la AEAT**,
así que emitir tarde pasa de ser invisible a ser comprobable.

**Propuesta**: la aplicación no bloquea nada, pero **avisa**. Una reserva cuyo
destinatario de factura sea una empresa y que pase del día 16 del mes siguiente
sin factura sale marcada, igual que hoy sale una señal pendiente en el panel. Es
el mismo criterio que ya usamos: no impedir, explicar.

### c) Factura antes de cobrar, y facturas a medias

«Hay empresas que quieren factura para pagar» significa que **la factura se emite
antes del cobro**, así que el importe **no puede derivarse de lo pagado**: se
deriva de lo devengado —el alquiler pactado más los cargos extra que existan—.

Y aparece el caso intermedio, que en tu flujo es el normal: **señal cobrada y
resto pendiente**. Una factura documenta la operación completa, no los cobros,
así que se factura el total y la forma de pago se aplica al saldo. Conviene que
el PDF diga las dos cifras —anticipo recibido y pendiente— para que el cliente no
pague dos veces la señal.

⚠️ **Un anticipo devenga IVA cuando se cobra** (art. 75.Dos LIVA), no cuando se
presta el servicio. Estrictamente, una señal cobrada en junio por un alquiler de
agosto tendría que facturarse en junio. En la práctica muchas pymes facturan al
final, pero **esto lo tiene que decidir la gestoría**, porque afecta a en qué
trimestre entra el IVA de tus señales. Es la pregunta más importante de esta
lista.

---

## 4. VeriFactu: te aplica el 1 de enero de 2027, no en julio

Es la fecha que más conviene tener clara, porque hay dos y la que circula más es
la que **no** te toca:

| Quién | Desde |
|---|---|
| **Contribuyentes del Impuesto sobre Sociedades** — VELTO MOBILITY, S.L. | **1 de enero de 2027** |
| Autónomos y demás | 1 de julio de 2027 |

Las fechas vienen del [RDL 15/2025, de 2 de diciembre](https://noticias.juridicas.com/actualidad/noticias/20735-nueva-prorroga:-verifactu-no-sera-obligatorio-hasta-2027-para-sociedades-y-otros-contribuyentes/),
que aplazó por segunda vez el calendario del RD 1007/2023. Antes eran enero y
julio de **2026**.

Son **menos de cuatro meses** desde hoy.

### Lo que exige, y lo que mucha gente cree que es opcional y no lo es

VeriFactu tiene dos modalidades, y aquí está el matiz que condiciona el diseño:

- **VERI\*FACTU**: el sistema envía cada registro de facturación a la AEAT en
  tiempo real. La factura lleva QR y la leyenda «Factura verificable en la sede
  electrónica de la AEAT».
- **No verificable**: no se envía nada, pero hay que **firmar electrónicamente
  cada registro** y conservarlo íntegro y disponible.

⚠️ **La huella SHA-256 encadenada es obligatoria en las DOS.** No es una
característica del modo conectado: todo sistema de facturación debe calcular la
huella de cada registro incorporando la del registro anterior, de forma que
alterar uno rompa la cadena.
([FAQ de la AEAT sobre la huella](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/huella-hash.html))

### Modalidad elegida: VERI\*FACTU *(confirmado por Dorel)*

Enviar es **más trabajo de integración y menos trabajo de todo lo demás**:

- La alternativa obliga a firmar electrónicamente cada registro y a sostener
  durante años la prueba de que nada se ha tocado. Enviar traslada esa carga a la
  AEAT: lo que ella tiene registrado es la referencia.
- El QR y la leyenda son **una ventaja comercial**, no una carga: el cliente
  comprueba su factura y la empresa parece lo que es.
- Ya tenemos las dos piezas difíciles: **generación de QR** (`contracts/qr.ts`,
  con test que lo rasteriza y lo lee de verdad) y **certificado FNMT** en Secret
  Manager para autenticarse contra la AEAT.

### Lo que hay que hacer AHORA aunque no se envíe nada hasta 2027

Esto es lo importante del análisis, y el motivo de escribirlo antes de programar:

1. **El registro de facturación se diseña desde el primer día** con los campos
   que pide la Orden HAC/1177/2024. Añadirlos después obliga a reconstruir
   facturas ya emitidas, que es justo lo que no se puede hacer.
2. **La huella encadenada se calcula desde la primera factura.** Si se empieza a
   emitir sin encadenar y la cadena arranca en enero de 2027, arranca sobre un
   histórico que nadie puede acreditar.
3. **Inmutabilidad desde el día uno**, en `firestore.rules`: `create` sí,
   `update` y `delete` **nunca**, ni siquiera para administrador. Lo mismo que ya
   hace la regla que impide borrar un contrato firmado.

El envío a la AEAT puede llegar después. La forma de los datos, no.

---

## 5. Quien conduce no es siempre quien paga

Hoy `Client` es **siempre una persona física**: `fullName`, DNI/NIE/pasaporte,
carné de conducir, fecha de nacimiento. No hay razón social, ni CIF, ni domicilio
fiscal.

Para facturar a una empresa hacen falta tres datos que no existen: **razón
social, NIF/CIF y domicilio fiscal** del destinatario.

**Propuesta**: un *destinatario de factura* independiente del conductor.

- Puede ser el propio cliente —el caso normal— o una empresa.
- Se guarda como perfil reutilizable: una constructora que alquila ocho veces al
  año no se teclea ocho veces.
- ⚠️ **La factura congela un snapshot**, como ya hacen el contrato y la reserva
  con el cliente. Si la empresa cambia de domicilio, las facturas viejas siguen
  diciendo lo que decían el día que se emitieron. Una factura emitida no cambia
  porque cambie una ficha.

Encaja además con las cuadrillas de las que hablabas en los conductores
adicionales: conducen cuatro, factura la empresa.

---

## 6. Qué se factura, y qué no

De tu factura de ejemplo y de cómo funciona hoy el dinero:

| Concepto | ¿Va en factura? |
|---|---|
| Alquiler (base + IVA) | Sí. Es la línea principal |
| **Fianza** | **No.** Es una garantía, no un ingreso. Tu factura de ejemplo ya la deja fuera, y es correcto |
| Cargos extra (combustible, km, limpieza, daños) | Sí, **si ya se conocen** al emitir |

⚠️ Y aquí hay una decisión de negocio que tienes que tomar: **cuándo se emite**.
Tu ejemplo se expide al final del periodo, con todo consumido, y eso permite
meterlo todo en una factura. Si alguna vez hay que facturar por adelantado, los
cargos extra nacen después y necesitan **factura aparte** — no rectificativa,
porque no corrigen nada: son operaciones nuevas.

⚠️ **El IVA de los cargos extra no está resuelto hoy.** CLAUDE.md ya lo anota:
los cargos extra no llevan desglose de IVA porque nacen en la inspección de
devolución, después del contrato. Para facturarlos hay que decidir su tipo. Casi
todos son 21 %, pero eso lo confirma la gestoría, no yo.

---

## 6 bis. La forma de pago, y el límite que la aplicación debe conocer

Tu regla, tal cual: **si está pendiente**, cuenta / TPV / efectivo; **si está
pagada**, «Factura pagada».

La aplicación puede proponerla sola, porque ya sabe lo que se debe:

| Estado del cobro | Qué imprime la factura |
|---|---|
| Todo cobrado | **PAGADA**, sin datos bancarios. No hay nada que pedir |
| Pendiente, por transferencia | «Transferencia bancaria · BBVA» + IBAN, como tu factura de Word |
| Pendiente, con tarjeta | TPV — y aquí cabe el enlace de pago de Redsys, que ya existe |
| Pendiente, en efectivo | Solo **por debajo de 1.000 €** |

⚠️ **El límite del efectivo es 1.000 €, no 999**, y es «igual o superior a
1.000 € queda prohibido» cuando una de las partes actúa como empresario — que en
tus alquileres eres siempre tú. Así que el máximo legal es **999,99 €**. Tu
intuición era correcta; solo conviene fijar la cifra exacta en el código.

La sanción es del **25 % del importe pagado en efectivo**, y la paga tanto quien
paga como quien cobra.

⚠️ **Y no se puede trocear una operación para esquivarlo.** Un alquiler de
1.400 € no se puede cobrar en dos entregas de 700 € en efectivo: el límite mira
la **operación**, no cada entrega. Esto importa en tu flujo más de lo que parece,
porque señal y resto son dos cobros de una misma operación: si el total llega a
1.000 €, **ninguna de las dos partes puede ir en efectivo**.

Por eso el efectivo no se oculta cuando no cabe: **se deshabilita y se explica**
—«Por encima de 1.000 € la ley no permite el cobro en efectivo»—, que es la misma
regla que ya sigue el resto de la aplicación con los permisos y el workflow.

---

## 7. La factura es la excepción a lo que cambiamos ayer

Ayer movimos la cabecera de los documentos al **domicilio comercial** (C/ María
Zambrano, 4), dejando el social solo junto al NIF.

**En la factura no.** El art. 6.1.c) exige el domicilio del expedidor, y ahí es
un dato fiscal: va el **domicilio social** (C/ Vereda del Melero, 3). Tu factura
de Word ya lo hace así.

Es coherente con la regla que ya seguimos: el domicilio social aparece donde la
empresa comparece como persona jurídica. Una factura es exactamente eso.

---

## 8. Lo que ya está hecho y se reutiliza

Más de lo que parece. La factura de Word **ya es la referencia visual** de los
PDF de la aplicación, así que el diseño no hay que inventarlo:

- **`PdfBuilder`** con Gotham, versalitas turquesa, filetes y pie legal — copiado
  precisamente de esa factura.
- **Bloque de totales** (`totalsBlock`) idéntico al de tu factura.
- **`infoColumns`** para «DATOS DE LA FACTURA» / «FACTURAR A», que es literalmente
  la maquetación que ya usan los tres documentos.
- **QR** con test de lectura real, para el de VeriFactu.
- **SHA-256** ya en uso para la huella del contrato.
- **Certificado FNMT** en Secret Manager.
- **Enlaces cortos `/d/…`** para mandar la factura por WhatsApp.
- **`pricing.util.ts`**, que ya sabe que el IVA se suma al neto.

Lo que **no** existe: la colección, el contador de numeración, el destinatario de
factura, la pantalla y el registro de VeriFactu.

---

## 11. Cinco documentos, no uno

Lo que se pidió el 8 de septiembre convierte «una factura de la reserva» en un
módulo de facturación con **cinco documentos distintos**, y solo dos de ellos
son fiscales:

| Documento | ¿Numeración fiscal? | ¿VeriFactu? | ¿Se puede borrar? |
|---|---|---|---|
| **Factura** (con o sin reserva) | `2026/0001` | Sí | **No** |
| **Rectificativa** | `R2026/0001`, serie propia | Sí | **No** |
| **Proforma** | No fiscal (`P2026/0001`) | **No** | Sí |
| **Recibo de cobro** | No fiscal | **No** | Sí |
| Presupuesto *(ya existe)* | Ninguna | No | Sí |

Esa tabla es el diseño. Lo que sigue explica las decisiones que no son obvias.

### a) La factura no cuelga de la reserva

Velto tiene varios CNAE: puede vender un coche de su flota, lavar un coche ajeno
o hacer un cambio de aceite. Así que **la reserva es un origen opcional**, no el
dueño de la factura.

En la práctica: `reservationId` opcional, un módulo **Facturas** propio en el
menú, y desde la reserva un atajo que la crea con las líneas ya rellenas. Es la
diferencia entre «facturar una reserva» y «tener facturación».

⚠️ **La venta de un vehículo no es una línea más.** Es la transmisión de un bien
de inversión afecto a la actividad, y trae dos cosas que un alquiler no tiene:
un tratamiento de IVA propio —que depende de cómo se dedujo al comprarlo— y la
baja del coche en la flota. Lo primero **lo dice la gestoría**; lo segundo lo
puede recordar la aplicación, pero no lo hará sola: facturar un coche no lo va a
dar de baja sin que alguien lo confirme.

### b) Las líneas son editables, y por qué eso es lo normal

Poder facturar por un importe distinto del alquiler es una función estándar: todo
programa de facturación permite editar las líneas, y hay motivos legítimos de
sobra —un precio pactado distinto, un descuento acordado, conceptos que se
refacturan juntos—.

El diseño que lo hace bien: **la factura tiene sus propias líneas y no es un
espejo de la reserva**. La reserva *propone* la línea con su importe; a partir de
ahí la factura vive por su cuenta. Sin eso, cualquier edición sería una pelea
contra el recálculo automático.

Dos cosas que sí van, por higiene y no por desconfianza:

- **Queda registrado** quién emitió la factura y si el importe difiere del de la
  reserva de origen. Es el mismo criterio que ya usan
  `loyaltyDiscountHistory[]` y las excepciones de workflow: lo excepcional se
  anota con autor.
- **Alterar el importe es permiso de administrador**, como ya lo es mover el
  `pricingSnapshot` — donde además `firestore.rules` lo impide de verdad.

⚠️ Y un hecho técnico que conviene tener delante: si lo facturado no coincide con
lo cobrado, **queda un descuadre visible** entre el módulo de Facturas y el de
Pagos, que se deriva de la colección `payments`. No es un problema de la
aplicación —es información correcta— pero es exactamente lo que una revisión
compara primero. Que la pantalla lo enseñe es mejor que descubrirlo después.

### c) La proforma: barata porque no es nada

Una proforma **no es una factura**: no devenga IVA, no se declara, no se registra
y no entra en VeriFactu. Es una oferta con pinta de factura para que el cliente
tramite el pago.

Por eso sale casi gratis: el mismo generador de PDF, el título cambiado y tres
reglas.

1. ⚠️ **Nunca consume número de la serie fiscal.** Si una proforma cogiera el
   `2026/0007` y luego no se convirtiera en factura, quedaría un hueco — y los
   huecos son justo lo que no se puede tener. Lleva su propia numeración `P…`,
   que no es fiscal y puede saltar sin consecuencias.
2. **No se llama «factura» en ninguna parte** del documento. Lleva
   «PROFORMA — no es una factura» impreso.
3. Convertirla en factura **crea una factura nueva**, no la transforma. La
   proforma se queda como estaba.

### d) El recibo de cobro: útil y peligroso a partes iguales

Es lo que hoy haces a mano en Word cuando alguien te da la señal: un justificante
de dinero recibido.

Sale de un documento de `payments`, que ya es la única fuente de verdad del
dinero que entra, así que no hay nada que inventar: importe, fecha, concepto,
medio de pago y a qué reserva corresponde.

⚠️ **Lo único que importa aquí es que no pueda confundirse con una factura.** Un
cliente que se deduzca el IVA con un recibo tiene un problema, y quien se lo dio
también. Así que:

- Lleva impreso **«Recibo — documento informativo, sin validez fiscal. No es una
  factura»**, y no en letra pequeña.
- **No desglosa IVA** como lo hace una factura. Importe recibido y ya.
- **No lleva número de serie fiscal** ni nada que lo parezca.
- Dice **«La factura se emitirá al finalizar el alquiler»**, que además es cierto
  y evita la llamada preguntando por ella.

---

## 9. Plan por fases

Las tres fases son entregables completos: cada una se puede usar sin la
siguiente. El orden **no** es negociable en un punto —el encadenamiento va en la
fase 1— por lo que dice la sección 4.

### ✅ Fase 1 — construida el 8 de septiembre de 2026

Probada de extremo a extremo en desarrollo: **`2026/0001` y `2026/0002`
emitidas**, con su PDF, su correlativo y su huella encadenada.

Lo que quedó dentro:

| | |
|---|---|
| `invoices` | Inmutable en `firestore.rules`: `create`, `update` y `delete` **denegados a todos**, también al backoffice. El único camino es `issueInvoice` |
| `issueInvoice` | Cloud Function. Número y huella dentro de **una transacción** con el contador |
| Huella SHA-256 | Encadenada desde la primera factura, con la cadena de entrada exacta de la AEAT y test propio |
| Líneas | Propias y editables, con o sin reserva de origen |
| Destinatario | Persona o empresa, con perfiles reutilizables y snapshot congelado |
| PDF | Calcado del Word, con el `PdfBuilder` que ya existía |
| Efectivo | Se apaga y se explica por encima de 1.000 €, mirando el **total** |
| Plazo | Avisa cuando el destinatario es empresa y pasó el día 16 |

⚠️ **Dos verificaciones pendientes**, las dos anotadas para no darlas por
hechas:

1. **Las reglas atacadas desde fuera de la aplicación.** Es la prueba que vale
   —la misma que se hizo con los permisos de empleado— y necesita el token de
   sesión, que el entorno no deja extraer. La regla es `if false`
   incondicional, así que no depende de datos, pero **no está probada en vivo**.
2. **El encadenamiento visto sobre los datos reales.** Está cubierto por tests
   —incluido uno que altera una factura del medio y comprueba que rompe todas
   las siguientes— pero no se ha leído `hash`/`previousHash` de las dos
   facturas emitidas.

Y una nota práctica: **las dos facturas de prueba de desarrollo no se pueden
borrar desde la aplicación**, que es exactamente lo que se pretendía. Para
dejarlo limpio hay que vaciar la colección desde la consola de Firebase.

#### Un fallo que apareció al probarlo, y no en los tests

La primera factura salió **sin el periodo del servicio ni la fecha de
operación**. El conversor de fechas del formulario entendía `Date` y
`Timestamp.toDate()`, pero un timestamp llega también como `{ seconds }` desde
el SDK web: con ese, `new Date(objeto)` da fecha inválida y los tres campos se
quedaban vacíos **en silencio**, con el resto del formulario relleno.

El proyecto ya tenía `toDate()` y `toDateString()` resolviendo justo eso. La
lección es la de siempre aquí: lo escrito y nunca ejecutado. Ningún test lo
habría cogido, porque el bug estaba en el pegamento entre la reserva y el
formulario.

### Fase 1 · Alcance *(lo que sustituye al Word)*

- Colección `invoices`, inmutable en `firestore.rules` desde el primer día:
  `create` sí, `update` y `delete` **para nadie**.
- Contador por serie, asignado **en la misma transacción** que crea la factura, y
  en una Cloud Function: el número no puede quedar al criterio del cliente.
- **Destinatario de factura**: perfil reutilizable —persona o empresa— y snapshot
  congelado en la factura.
- **Líneas propias y editables.** La reserva las propone; después la factura vive
  por su cuenta. Con o **sin** reserva de origen: una venta o un cambio de aceite
  se facturan igual.
- Módulo **Facturas** en el menú, más el atajo desde la reserva.
- PDF con el `PdfBuilder` que ya existe, calcado de tu factura de Word.
- **La huella SHA-256 encadenada ya se calcula y se guarda**, aunque no se envíe
  a ningún sitio. Es lo que hace que la fase 3 sea posible.
- Aviso cuando el destinatario es empresa y se acerca el día 16 del mes
  siguiente.
- **Recibo de cobro** desde un pago. Entra aquí y no más tarde porque es lo que
  Dorel hace hoy a mano y no depende de nada de lo demás.

### Fase 2 · Rectificativas y proforma

Rectificativa en serie propia (`R2026/0001`), con referencia a la factura
rectificada y las claves `S` (sustitución) o `I` (diferencias) que exige la
norma. Es lo que convierte «no se puede modificar» en algo operable.

La proforma va aquí porque, hecha la factura, es casi gratis: mismo PDF, título
distinto, numeración no fiscal y ningún registro.

### Fase 3 · VeriFactu

Registro XML según la Orden HAC/1177/2024, envío a la AEAT, QR en la factura y
la leyenda «Factura verificable en la sede electrónica de la AEAT». Tope: **1 de
enero de 2027**.

⚠️ La fase 3 **no puede rescatar** lo que la fase 1 no haya guardado: si las
facturas de 2026 no están encadenadas, la cadena arranca en 2027 sobre un
histórico sin acreditar.

## 10. Lo que tiene que confirmar la gestoría

Por orden de importancia:

1. ⚠️ **La venta de vehículos.** Es un bien de inversión afecto a la actividad y
   su IVA depende de cómo se dedujo al comprar el coche. Es el punto con más
   dinero en juego de toda la lista.
2. **Dos series en el mismo trimestre**: la `0001/26…` cerrada en el 3 y la
   `2026/…` desde la primera factura de la aplicación. Está permitido (art. 6.2),
   pero que no le sorprenda.
3. Los **anticipos**. Dorel decide una sola factura final, que es lo que hace
   hoy. Conviene que la gestoría lo confirme, porque una señal cobrada devenga
   IVA en el momento del cobro (art. 75.Dos LIVA).
4. El **tipo de IVA de los cargos extra** — combustible, limpieza, daños,
   kilómetros. Se presume 21 %, pero no lo decido yo.
5. El alta y la modalidad **VERI\*FACTU**.
6. Si la **fianza retenida** que se convierte en cobro por daños hay que
   facturarla: ahí sí hay operación sujeta, y no es evidente.

---

## Fuentes

- [RD 1619/2012, Reglamento de obligaciones de facturación (BOE)](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696)
- [Art. 6 — contenido de la factura (Iberley)](https://www.iberley.es/legislacion/articulo-6-reglamento-regulan-obligaciones-facturacion)
- [AEAT — facturas rectificativas](https://sede.agenciatributaria.gob.es/Sede/iva/facturacion-registro/facturacion-iva/facturas-rectificativas.html)
- [AEAT — FAQ sobre la huella o «hash»](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/huella-hash.html)
- [RD 1007/2023 (BOE)](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840)
- [Aplazamiento a 2027 por el RDL 15/2025](https://noticias.juridicas.com/actualidad/noticias/20735-nueva-prorroga:-verifactu-no-sera-obligatorio-hasta-2027-para-sociedades-y-otros-contribuyentes/)
- [ICAM — retraso de VeriFactu a 2027](https://web.icam.es/se-retrasa-al-2027-la-entrada-en-vigor-de-verifactu-la-nueva-normativa-de-facturacion-electronica/)
