# VERI\*FACTU: qué hay que hacer antes de poder enviar

Escrito el 8 de septiembre de 2026, a petición de Dorel.

⚠️ **No soy asesor fiscal.** Lo que sigue es el procedimiento tal y como está
planteado en la normativa y en la sede de la AEAT, para que sepas por dónde
empezar y con qué. **Los puntos marcados como «confirmar» los cierra la
gestoría**, no este documento.

---

## 0. Lo primero, porque ahorra buscar algo que no existe

⚠️ **No hay un «alta en VERI\*FACTU».** No existe un registro al que
inscribirse, ni un formulario de adhesión, ni un número de sistema que te den.
Buscarlo es la primera media hora que pierde todo el mundo.

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

### Paso 2 — La declaración responsable *(esto sí es tuyo)*

⚠️ **Es el único trámite propiamente dicho, y te toca a ti porque el software es
de la casa.** Al no comprar un programa a un tercero, no hay fabricante que
declare por ti: VELTO MOBILITY es a la vez el obligado tributario **y** el
productor del sistema.

Ya está reflejado en el registro que emite la aplicación:

```
nombreSistemaInformatico: Velto Store
nombreRazonProductor:     VELTO MOBILITY, S.L.
nifProductor:             B88866900        ← el mismo que el emisor
```

**Confirmar con la gestoría**: en qué forma y ante quién se deja constancia de
esa declaración, y si en tu caso hay que comunicar algo por censo (036/037).
Es la pregunta que mejor responde alguien que presente tus modelos.

### Paso 3 — Preproducción, antes que nada real

**No se envía una factura de verdad hasta que el circuito pase en pruebas.** El
entorno de preproducción de la AEAT existe justo para eso y no hay que pedir
permiso para usarlo.

Lo que hay que sacar de ahí, y es lo que yo necesito:

1. La **URL del servicio** de preproducción y la de producción.
2. El **WSDL** vigente.
3. Confirmar que el certificado de la empresa **autentica** contra ese entorno.

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

Nada más que esto, y sin ello no se puede empezar:

- [ ] **URL del servicio** de preproducción y de producción.
- [ ] Confirmación de que el **certificado de la empresa autentica** contra
      preproducción (basta con que entres una vez).
- [ ] **Desde cuándo se envía**: el 1 de enero de 2027, o antes de forma
      voluntaria para llegar rodado.

---

## 4. Lo que sigue pendiente de la gestoría

Lo de siempre, más lo de aquí:

1. La forma de la **declaración responsable** y si hay comunicación censal.
2. Si conviene **empezar a remitir antes** del 1 de enero para no estrenar el
   sistema el mismo día que empieza la obligación.
3. Y lo que ya estaba en [facturacion.md](facturacion.md): el IVA de la venta de
   vehículos, las dos series del trimestre, los anticipos y el tipo de los
   cargos extra.

---

## 5. Mientras tanto, lo que ya está resuelto

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
