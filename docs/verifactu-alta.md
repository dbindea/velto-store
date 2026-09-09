# VERI\*FACTU: qué hay que hacer antes de poder enviar

Escrito el 8 de septiembre de 2026 y corregido el 9 con las aclaraciones de
Dorel: no hay comunicación censal, no se usa el modelo 036, y la declaración
responsable ya está construida dentro de la aplicación.

⚠️ **No soy asesor fiscal.** Lo que sigue es el procedimiento tal y como está
planteado en la normativa y en la sede de la AEAT, para que sepas por dónde
empezar y con qué.

---

## 0. Lo primero, porque ahorra buscar algo que no existe

⚠️ **No hay un «alta en VERI\*FACTU».** No existe un registro al que
inscribirse, ni un formulario de adhesión, ni un número de sistema que te den.
Buscarlo es la primera media hora que pierde todo el mundo.

⚠️ **Y no se comunica por el modelo 036.** Confirmado por Dorel el 9 de
septiembre de 2026: la AEAT lo dice expresamente. No hay alta censal, ni nada
que declarar a la gestoría por este motivo.

⚠️ **VERI\*FACTU tampoco sustituye nada de lo que ya se hace.** Las facturas se
siguen entregando y contabilizando igual, y los modelos fiscales se siguen
presentando igual: es una obligación **adicional sobre el funcionamiento de la
aplicación**, no un régimen que reemplace la contabilidad ni las declaraciones.

Lo que sí existen son **tres cosas distintas**, y conviene no mezclarlas:

| | Qué es | Quién lo hace |
|---|---|---|
| **Declaración responsable** | El productor del software declara que su sistema cumple el RD 1007/2023 | **Tú**, porque la aplicación es desarrollo propio |
| **Elegir modalidad** | Remitir a la AEAT (VERI\*FACTU) o no remitir y firmar cada registro | Ya elegida: **remitir** |
| **Poder enviar** | Autenticarse contra el servicio web con certificado | Certificado que ya tienes |

La obligación se cumple **usando** un sistema que cumpla, no dándose de alta en
ningún sitio. Lo que la AEAT comprueba es que le lleguen los registros.

---

## 1. Los medios que hacen falta

| | Estado |
|---|---|
| **Certificado electrónico de representante** de la S.L. | ✅ Ya lo tienes: es el mismo de la FNMT con el que se sellan los contratos |
| Acceso a la **sede electrónica** de la AEAT con ese certificado | ✅ Si entras hoy a presentar impuestos, ya lo tienes |
| El certificado **instalado en el navegador** para los trámites de la sede | Comprobar |
| Que el certificado **autentique desde la Cloud Function** contra preproducción | ⛔ Por probar, y es la prueba que vale |
| El `.p12` disponible para el envío automático | ✅ Está en Secret Manager (`VELTO_SIGNING_CERT`) |

⚠️ **El certificado del envío y el de la sede son el mismo, pero se usan de dos
formas distintas.** En la sede lo usas tú con el navegador; en el envío lo usa
la aplicación desde una Cloud Function. Que uno funcione no garantiza el otro:
el del envío hay que probarlo contra preproducción.

---

## 2. Los pasos, en orden

### Paso 1 — Entrar y localizar el área

**Dónde:** sede electrónica de la AEAT (`sede.agenciatributaria.gob.es`), con
certificado. Busca el apartado de **sistemas informáticos de facturación /
VERI\*FACTU**; hay dos zonas y hacen falta las dos:

- El área **informativa**: preguntas frecuentes, normativa, plazos.
- El área de **Desarrolladores**: es la que importa para el envío. Ahí están el
  diseño de registro, las especificaciones de la huella, los **WSDL** del
  servicio y el **entorno de preproducción**.

⚠️ **Las rutas de menú de la sede cambian con frecuencia**, así que no las copio
aquí: se llega buscando «VERI\*FACTU» en el buscador de la propia sede. Lo que
no cambia es que el material técnico vive en el área de Desarrolladores y es
**público** — no hace falta ningún permiso para descargarlo.

### Paso 2 — La declaración responsable *(ya está en la aplicación)*

⚠️ **Te toca a ti porque el software es de la casa.** Al no comprar un programa
a un tercero, no hay fabricante que declare por ti: VELTO MOBILITY es a la vez
el obligado tributario **y** el productor del sistema.

**Hecho el 9 de septiembre de 2026.** Está en **Ajustes › Declaración
responsable**: genera el documento del art. 15 con los datos obligatorios
—productor, sistema, identificador, versión, componentes, fecha y lugar—, lo
conserva y da su PDF.

```
nombreSistemaInformatico: Velto Store
nombreRazonProductor:     VELTO MOBILITY, S.L.
nifProductor:             B88866900        ← el mismo que el emisor
modalidad:                exclusivamente VERI*FACTU
obligados tributarios:    uno solo
```

⚠️ **Una declaración por CADA versión del sistema**, y ninguna se borra: la de
una versión pasada sigue acreditando lo que se declaró mientras esa versión
estuvo emitiendo facturas. La pantalla avisa en ámbar cuando la versión que
está corriendo no tiene la suya, y `firestore.rules` deniega `update` y
`delete` a todo el mundo, igual que con las facturas.

⚠️ **Lo que declara sale del mismo sitio que el registro de facturación.** Si la
declaración dijera una modalidad y los registros llevaran otra, la declaración
sería falsa sin que nadie tocara nada: son el mismo hecho contado en dos sitios,
así que se leen de una sola fuente.

### Paso 3 — Preproducción, antes que nada real

**No se envía una factura de verdad hasta que el circuito pase en pruebas.**

Lo que hace falta de ahí está en el punto 3: los esquemas, el WSDL o los
endpoints, y la lista de códigos de error.

### Paso 4 — El envío, ya con código

Cuando lo anterior esté, programo el envío: XML del registro, firma, llamada al
servicio, estados, reintentos y tratamiento de duplicados y errores.

### Paso 5 — Encender el QR

⚠️ **Lo último, y no antes.** El QR y la leyenda «Factura verificable en la sede
electrónica de la AEAT» están construidos y **apagados**
(`VELTO_VERIFACTU_ENABLED=false`). Se encienden el día que el envío funcione: con
la leyenda impresa y el registro sin remitir, el cliente escanea, la sede no
encuentra su factura y lo que parece roto es la factura.

Y al encenderlo en producción, `VELTO_VERIFACTU_ENV` tiene que ser `live`: con
`test` el QR apuntaría al validador de preproducción, que no conoce las facturas
reales.

---

## 3. Lo que necesito de ti para programar el envío

✅ **Los archivos técnicos ya están** en [`docs/aeat/`](aeat/README.md), subidos
el 9 de septiembre de 2026: los esquemas, el WSDL con los endpoints, el diseño
de registro con las descripciones de las claves, la especificación del QR y los
247 códigos de error.

Todo lo que se había escrito antes de tenerlos **está contrastado contra ellos**;
el detalle de qué salió bien y qué hubo que corregir está en
[aeat/README.md](aeat/README.md).

Lo que queda por decidir, y es tuyo:

- [ ] **Cuándo sale la primera factura real de la aplicación.** No es una
      pregunta de numeración —las tres de Word no estorban— sino de VeriFactu:
      ver «Y con VeriFactu encima, la pregunta cambia» en
      [facturacion.md](facturacion.md). Recomendado: empezar a facturar y a
      remitir **el mismo día**, usando `RemisionVoluntaria` para no esperar a
      enero y llegar rodado.

---

## 3 bis. El plan de pruebas en preproducción

Objetivo: llegar al 1 de enero de 2027 **sin estrenar nada**. Todo esto contra
`prewww1.aeat.es`, nunca contra producción.

**Circuito básico**

- [ ] El certificado **autentica desde la Cloud Function** (no desde el
      navegador).
- [ ] Un `RegistroAlta` valida contra los `.xsd` **antes** de enviarlo.
- [ ] Envío de una factura → respuesta `Correcto` con su CSV.
- [ ] La huella que calcula la AEAT coincide con la nuestra (error `2000` si no).

**El encadenamiento, que es lo que no se puede rehacer**

- [ ] La primera se declara `PrimerRegistro`.
- [ ] La segunda encadena con la primera y la AEAT lo acepta.
- [ ] Reenviar la primera declarándola otra vez `PrimerRegistro` → tiene que dar
      el error `2007`. **Si no lo da, es que no estamos donde creemos.**

**Los caminos que no son el feliz**

- [ ] Un registro **duplicado**: la respuesta trae `RegistroDuplicado` con lo que
      la AEAT ya tenía.
- [ ] Un envío **parcialmente correcto**: dos facturas, una mal. Comprobar que se
      distingue `EstadoEnvio` de `EstadoRegistro` — que el envío "funcione" no
      significa que las dos hayan entrado.
- [ ] Un **rechazo de cabecera** (4102, 4107…): que no se marque como enviada
      ninguna factura.
- [ ] **Corte de red a mitad**: que el reintento no cree un segundo registro ni
      dé la factura por remitida.

**Los tipos de factura**

- [ ] Factura ordinaria `F1` con IVA general.
- [ ] Rectificativa `R1` por diferencias (`I`) con importes negativos.
- [ ] Rectificativa por sustitución (`S`), con base y cuota rectificadas.
- [ ] Una exenta (`E5`) y una con inversión del sujeto pasivo (`S2`).
- [ ] Una con `FechaOperacion` distinta de la expedición.

**Y lo último**

- [ ] El **QR encendido** apuntando a preproducción, escaneado con un móvil de
      verdad, que devuelva la factura.
- [ ] Solo entonces, `VELTO_VERIFACTU_ENABLED=true` en producción **con tu
      autorización expresa**.

---

## 4. Cómo se va a probar la autenticación

⚠️ **Desde la propia Cloud Function, no entrando tú en la sede.** Que un
certificado funcione en un navegador no prueba que funcione en una llamada
máquina a máquina: cambian el formato, la cadena de confianza y el modo de
presentarlo. La prueba que vale es una petición real desde la function contra
preproducción.

El certificado sigue **en Secret Manager** (`VELTO_SIGNING_CERT`, el `.p12` en
base64, y su contraseña aparte). Nunca al repositorio ni a un `.env`.

⚠️ **Y no se toca producción sin autorización expresa.** Todo contra
preproducción hasta que tú digas lo contrario.

---

## 5. Cuándo estará «terminado»

⚠️ **Guardar un registro internamente no significa que la AEAT lo haya
aceptado.** La integración no está hecha hasta que, contra preproducción, se
haya validado:

- [ ] El **XML** contra los esquemas oficiales.
- [ ] El **encadenamiento** entre registros sucesivos.
- [ ] El **QR** y su leyenda.
- [ ] Las **respuestas** de aceptación.
- [ ] Los **errores** y los rechazos, cada uno con su tratamiento.
- [ ] Los **reenvíos**: qué se reintenta, cuántas veces y qué se hace con lo que
      no entra.

Hasta entonces esto sigue siendo «registro guardado», que es otra cosa.

---

## 6. Lo que sigue pendiente de la gestoría

Nada de VERI\*FACTU: no hay comunicación censal ni trámite que presentar. Queda
lo que ya estaba en [facturacion.md](facturacion.md), que es de IVA y no de
sistemas: el IVA de la venta de vehículos, las dos series del trimestre, los
anticipos y el tipo de los cargos extra.

---

## 7. Mientras tanto, lo que ya está resuelto

⚠️ **Lo irreversible ya está hecho, y es lo que importaba de este plazo.** Desde
el 8 de septiembre de 2026 cada factura guarda su **registro de facturación
completo** —con el encadenamiento, el desglose por régimen y el bloque de
sistema informático— además de la huella, que se encadenaba desde la primera.

Eso significa que **se puede dejar el envío para más adelante sin coste**: las
facturas que emitas de aquí a enero ya nacen con todo lo que el envío necesitará.
Lo que no se puede es dejar para más adelante el registro, porque una factura
emitida no se edita.

El calendario real, entonces, no es «cuándo empezamos», sino **cuánto antes del
1 de enero de 2027 quieres tener el envío probado**. Con los datos del punto 3,
son días de trabajo, no meses.
