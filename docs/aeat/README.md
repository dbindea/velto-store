# Ficheros oficiales de la AEAT para VERI\*FACTU

Subidos por Dorel el 9 de septiembre de 2026. **Son la fuente de verdad** del
registro de facturación y del QR: cuando el código y estos ficheros discrepen,
mandan estos.

Están versionados a propósito. Las especificaciones de la sede cambian sin
avisar y sin dejar rastro de qué versión se usó: con la copia en el repositorio,
un registro emitido en 2026 se puede contrastar años después contra el mismo
documento con el que se construyó.

| Fichero | Qué es |
|---|---|
| `SistemaFacturacion.wsdl.xml` | El servicio: operaciones y **endpoints** de los cuatro entornos |
| `SuministroLR.xsd` | La raíz del envío: `RegFactuSistemaFacturacion` = cabecera + hasta 1000 registros |
| `SuministroInformacion.xsd` | Los tipos: `RegistroAlta`, `RegistroAnulacion`, desglose y catálogos |
| `RespuestaSuministro.xsd` | La respuesta: CSV, estado del envío y estado de cada línea |
| `ConsultaLR.xsd` / `RespuestaConsultaLR.xsd` | La consulta de registros ya remitidos |
| `RespuestaValRegistNoVeriFactu.xsd` | Respuesta del cotejo en la modalidad no verificable |
| `EventosSIF.xsd` | Registros de evento del sistema informático |
| `DsRegistroVeriFactu.xlsx` | El diseño de registro **con las descripciones de las claves** |
| `DetalleEspecificacTecnCodigoQRfactura.pdf` | El QR: URL, parámetros y codificación |
| `errores.properties.txt` | Los 247 códigos de error y rechazo |

---

## Lo que se ha contrastado contra ellos (9 de septiembre de 2026)

Todo lo que estaba escrito antes de tenerlos **se ha verificado uno a uno**.

### Correcto, sin cambios

| | Verificado contra |
|---|---|
| URL del QR en producción y pruebas | `DetalleEspecificacTecnCodigoQRfactura.pdf`, apdo. 5.1 |
| Parámetros `nif`, `numserie`, `fecha`, `importe` | el mismo |
| Codificación de la URL | el mismo, con su ejemplo de URL incorrecta |
| `E5` = art. 25, entregas intracomunitarias | `DsRegistroVeriFactu.xlsx` |
| `E2` = art. 21, exportaciones | el mismo |
| `E6` = exenta por otros | el mismo |
| Clave de régimen `01` general, `02` exportación, `03` bienes usados | el mismo |
| `S1` / `S2` de calificación | `SuministroInformacion.xsd` |
| `01` = SHA-256 en `TipoHuella` | el mismo |
| `F1` y `R1`…`R5` en `TipoFactura` | el mismo |
| Encadenamiento con los cuatro datos del anterior | `EncadenamientoFacturaAnteriorType` |

### Corregido

| | Qué pasaba |
|---|---|
| **Nombres de campo** | El registro usaba nombres propios (`idFactura`, `cuotaTotal`). Ahora usa los del esquema (`IDFactura`, `CuotaTotal`), para que el XML sea una serialización directa y no haya una tabla de traducción en medio |
| **`Desglose`** | Era un array suelto; el esquema lo envuelve en `Desglose > DetalleDesglose` |
| **`Destinatarios`** | Igual: `Destinatarios > IDDestinatario`, con `NombreRazon` y `NIF` |
| **`FacturasRectificadas`** | Igual: envuelve `IDFacturaRectificada` |
| **`Impuesto`** | Faltaba. `01` = IVA, en cada línea del desglose |
| **`FechaOperacion`** | Faltaba, y es el caso normal aquí: se factura en agosto un alquiler de junio. Solo se declara si difiere de la expedición |
| **Endpoints** | Estaban por confirmar; ahora salen del WSDL |

⚠️ **Las facturas emitidas antes de esta corrección conservan los nombres
viejos** en su registro guardado: son inmutables y no se tocan. Son las de
desarrollo, `2026/0001` a `2026/0005`; **en producción no hay ninguna**, así que
no afecta a nada real. Al construir el XML de una factura antigua habría que
mapear, cosa que hoy no hace falta porque el envío empieza de cero.

---

## Dos cosas del WSDL que conviene no olvidar

⚠️ **Hay dos direcciones por entorno según el tipo de certificado**, y no son
intercambiables:

| | Representante *(el nuestro)* | Sello |
|---|---|---|
| Pruebas | `prewww1.aeat.es` | `prewww10.aeat.es` |
| Producción | `www1.agenciatributaria.gob.es` | `www10.agenciatributaria.gob.es` |

Llamar a la que no toca da un rechazo de autenticación que parece un problema
del certificado y no lo es. El error `4112` lo confirma: el titular del
certificado debe ser obligado a emisión, colaborador social, apoderado o
sucesor — que es el caso del certificado de representante de la FNMT que ya
tenemos.

⚠️ **Un envío admite hasta 1000 registros** (`maxOccurs="1000"`), y la respuesta
puede ser `Correcto`, `ParcialmenteCorrecto` o `Incorrecto`: con un lote, que el
envío "funcione" no significa que todas las facturas hayan entrado. Cada línea
trae su propio `EstadoRegistro`, y un rechazo por duplicado devuelve además el
registro que la AEAT ya tenía.
