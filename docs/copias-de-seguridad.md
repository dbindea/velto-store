# Copias de seguridad, restauración y certificado

> Escrito el **11 de septiembre de 2026**, antes de la primera factura real.
>
> ⚠️ **Esto no es un documento de buenas intenciones.** A partir del 1 de enero
> habrá facturas encadenadas por huella SHA-256 que no se pueden editar ni
> reponer. Lo que no esté hecho antes de ese día, después no se arregla.

---

## 0. El resumen, por si hay prisa

Aplicado el **11 de septiembre de 2026** en los dos proyectos:

| | Desarrollo | Producción |
|---|---|---|
| Copia diaria de Firestore | ✅ 7 días | ✅ 7 días |
| Copia semanal (domingo) | — | ✅ **14 semanas** |
| Point-in-time recovery | ✅ 7 días | ✅ 7 días |
| **Protección contra borrado** de la base | ✅ | ✅ |
| Versionado de Storage | ✅ | ✅ |
| Borrado reversible de Storage | ✅ 30 días | ✅ 30 días |
| Aviso de caducidad del certificado FNMT | ✅ correo de las 9:00 | ✅ correo de las 9:00 |
| Aviso de factura emitida y no remitida | ✅ correo de las 9:00 | ✅ correo de las 9:00 |
| **Restauración ensayada** | ❌ **nunca** | ❌ **nunca** |

⚠️ **La última fila es la que importa y es la que falta.** Una copia sin ensayo
de restauración da tranquilidad y no protege. Ver § 4.

⚠️ **La protección contra borrado estaba desactivada en las dos bases**, o sea
que producción se podía borrar entera con un comando. No estaba en ninguna lista
de riesgos; salió al mirar el estado real antes de tocar nada.

### ⚠️ La cuenta activa de `gcloud` manda, y no vive en el repositorio

En esta máquina hay **dos cuentas autenticadas** —`veltorent@gmail.com` y
`reservas@gate2fly.com`, la del otro negocio— y los comandos van con la
**activa**, que se cambia sola al autenticarse en otro sitio. A mitad de esta
sesión volvió a la del otro negocio y los comandos empezaron a dar
`PERMISSION_DENIED` sobre proyectos que existen.

Es el mismo problema que `firebase use`: el destino real no está en ningún
fichero que se pueda leer. Por eso **todos los comandos de aquí llevan
`--account` explícito**, igual que los scripts de `package.json` llevan
`--project`.

```bash
gcloud auth list                      # cuál está activa (la del *)
gcloud config set account veltorent@gmail.com
```

⚠️ **Y `gcloud` de esta máquina necesita su Python empaquetado**, porque el
`python3` del PATH es el resolutor de la Microsoft Store y da
`Permission denied`:

```bash
export CLOUDSDK_PYTHON="/c/Users/dorel/AppData/Local/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe"
```

---

## 1. Qué protege cada cosa, y qué no

⚠️ **Firestore y Storage son dos servicios distintos y se copian aparte.** Es la
misma trampa que ya mordió al borrar clientes: borrar el documento dejaba el DNI
y el carné en Storage. Aquí es al revés y peor — una copia de Firestore con los
PDF perdidos deja facturas que existen y no se pueden enseñar.

| Dónde vive | Qué hay | Cómo se protege |
|---|---|---|
| Firestore | facturas, cadena de huellas, contadores, reservas, clientes, pagos | copias programadas + PITR |
| Storage | **PDF de facturas y contratos sellados**, firmas, fotos de inspección, documentos de cliente | versionado de objetos + borrado reversible |

⚠️ **No todo lo de Storage vale lo mismo.** Perder la foto de un coche es una
molestia; perder el PDF **sellado con el certificado de la FNMT** de un contrato
firmado es perder la prueba de un alquiler, y no se puede regenerar: un PDF
firmado no admite cambios, así que no existe «volver a generarlo igual».

---

## 2. Copias programadas de Firestore — **hecho**

Dos horarios, por lo mismo que las dos cosas que protegen: la diaria cubre el
error de ayer, la semanal cubre el error que se descubre tres semanas después.

Lo que se ejecutó (queda por si hay que rehacerlo o crear un proyecto nuevo):

```bash
CUENTA="--account=veltorent@gmail.com"

# --- Producción ---
gcloud firestore backups schedules create $CUENTA \
  --project=rentalcar-veltomobility --database='(default)' \
  --recurrence=daily --retention=7d

gcloud firestore backups schedules create $CUENTA \
  --project=rentalcar-veltomobility --database='(default)' \
  --recurrence=weekly --day-of-week=SUN --retention=14w

# --- Desarrollo: solo la diaria. Aquí los datos son de prueba. ---
gcloud firestore backups schedules create $CUENTA \
  --project=velto-store --database='(default)' \
  --recurrence=daily --retention=7d

# --- PITR y protección contra borrado, en los dos ---
gcloud firestore databases update $CUENTA --database='(default)' \
  --project=rentalcar-veltomobility --enable-pitr --delete-protection
gcloud firestore databases update $CUENTA --database='(default)' \
  --project=velto-store --enable-pitr --delete-protection
```

Comprobar lo que hay hoy:

```bash
gcloud firestore backups schedules list $CUENTA --database='(default)' --project=rentalcar-veltomobility
gcloud firestore backups list $CUENTA --location=eur3 --project=rentalcar-veltomobility
gcloud firestore databases describe $CUENTA --database='(default)' --project=rentalcar-veltomobility \
  --format='value(pointInTimeRecoveryEnablement,deleteProtectionState)'
```

⚠️ **La primera copia no es inmediata.** El horario existe desde el minuto uno,
pero la copia se hace a una hora indeterminada del día. Si al día siguiente
`backups list` sale vacío, no es que no funcione: comprueba a las 48 horas antes
de tocar nada.

⚠️ **La protección contra borrado impide `databases delete`**, así que al borrar
una base de ensayo (§ 4) hay que quitarla antes — de esa, no de la buena.

Tres cosas que conviene saber antes de ejecutarlas:

- **La retención máxima es de 14 semanas.** No hay copia de «hace un año».
- **No se puede elegir la hora.** La copia se hace a una hora distinta cada día.
- **La recurrencia no se puede cambiar** después: para cambiarla hay que borrar
  el horario y crear otro.

⚠️ **La región es `eur3`**, la misma que la base de datos. Un `--location`
equivocado no falla: no encuentra nada, que se parece mucho a «no hay copias».

### PITR, que es otra cosa

Point-in-time recovery permite volver a un instante de los **últimos 7 días**,
con granularidad de un minuto en la última hora. Cubre el caso «he ejecutado un
borrado que no debía hace veinte minutos», que las copias diarias no cubren.

---

## 3. Storage — **hecho**

⚠️ **El borrado reversible ya estaba, pero a 7 días**: es el valor de fábrica de
Google, no una decisión de nadie. Subido a 30. El **versionado estaba apagado**,
que es lo que protege de una sobrescritura — y `uploadPdf()` sobrescribe a
propósito para no matar el enlace que el cliente ya tiene.

```bash
CUENTA="--account=veltorent@gmail.com"

for b in rentalcar-veltomobility velto-store; do
  gcloud storage buckets update gs://$b.firebasestorage.app $CUENTA \
    --versioning --soft-delete-duration=30d
done

# Comprobar:
gcloud storage buckets describe gs://rentalcar-veltomobility.firebasestorage.app $CUENTA \
  | grep -iE "versioning|retentionDurationSeconds"
```

⚠️ **El versionado crece sin límite.** Cada regeneración de un parte de entrega
o de un justificante deja la versión anterior guardada y facturándose. A este
volumen no importa; si algún día importa, la solución es una regla de ciclo de
vida que borre las versiones **no actuales** a los N días — no quitar el
versionado. No se ha puesto hoy a propósito: es una regla que **borra**, y
merece decidirse a la vista de la factura real, no por si acaso.

⚠️ **El versionado no es una copia de seguridad de verdad**: protege del error
—sobrescribir, borrar— pero no de perder el bucket. Para eso hace falta copiar a
otro sitio:

```bash
gcloud storage rsync -r \
  gs://rentalcar-veltomobility.firebasestorage.app \
  gs://velto-copias/storage-$(date +%F)
```

⚠️ **Y ese bucket de copias tiene datos personales dentro** —DNI, carnés,
firmas—, así que va en la UE, sin acceso público, y con su propia política de
retención. No es un cajón donde dejar cosas.

---

## 4. El ensayo de restauración — esto es lo que importa

⚠️ **Una copia sin ensayo de restauración es peor que ninguna**, porque da
tranquilidad y no protege. Lo que hay que probar no es que el fichero exista: es
que después de restaurar, **la cadena de facturación sigue siendo cierta**.

**Buena noticia**: una restauración de Firestore **crea una base de datos
nueva**, nunca sobrescribe la que hay. El ensayo es seguro.

```bash
# 1. Elige una copia
gcloud firestore backups list --location=eur3 --project=rentalcar-veltomobility

# 2. Restaura en una base NUEVA, con la fecha en el nombre
gcloud firestore databases restore \
  --project=rentalcar-veltomobility \
  --source-backup=projects/rentalcar-veltomobility/locations/eur3/backups/BACKUP_ID \
  --destination-database=ensayo-2027-01-15

# 3. Cuando termine el cotejo, se borra. No dejes una base de ensayo viva:
#    nada apunta a ella y el día que alguien la encuentre no sabrá qué es.
#    ⚠️ La base de ensayo nace SIN protección de borrado; la de verdad la tiene
#    puesta, así que un `delete` contra ella falla. Es la red que hay que tener.
gcloud firestore databases delete --database=ensayo-2027-01-15 \
  --project=rentalcar-veltomobility --account=veltorent@gmail.com
```

### Qué hay que cotejar, y por qué

No basta con «hay documentos». Estos cinco, en este orden:

1. **El último número de cada serie** (`invoiceCounters/{serie}.lastNumber`)
   coincide con la última factura de esa serie.
2. **La última huella** (`invoiceCounters/{serie}.lastHash`) es la `hash` de esa
   factura.
3. **La cadena se recorre entera**: se arranca por el documento sin huella
   anterior y se salta de huella en huella hasta el final, sin bifurcaciones ni
   documentos sueltos. El guion
   [comprobar-reglas-facturas.js](comprobar-reglas-facturas.js) hace exactamente
   esto; cambia la constante `PROJECT` y apúntalo a la base restaurada.
4. **Cada factura tiene su fila en `verifactuSubmissions`**, y las aceptadas
   conservan su **CSV**. Sin el CSV no se puede acreditar que se remitió.
5. **Los PDF de Storage siguen ahí** para las facturas de la copia. Firestore y
   Storage se restauran por separado y pueden quedar desfasados.

### ⚠️ El peligro que nadie ve venir

**Restaurar un estado anterior reintroduce numeraciones y huellas ya
consumidas.** Si el 20 de enero restauras la copia del 15, las facturas emitidas
entre el 15 y el 20 desaparecen de Firestore — pero **existen**: el cliente tiene
su PDF y la AEAT tiene su registro con su CSV. El contador vuelve atrás y la
siguiente factura reutiliza un número ya emitido, encadenando sobre una huella
que no es la última real.

A partir de ahí la cadena **miente**, y no se puede arreglar borrando, porque las
facturas no se borran.

Por eso, ante una pérdida de datos con facturas emitidas, el orden es:

1. **Parar la emisión.** `VELTO_INVOICING_ENABLED=false` en el `.env` del
   proyecto y desplegar. Ninguna factura nueva hasta saber qué ha pasado.
2. **Restaurar en una base de ensayo**, nunca encima.
3. **Preguntar a la AEAT qué tiene**, que es la única fuente que no se ha
   perdido: el listado de registros remitidos dice qué números existen de verdad.
4. **Reconstruir el contador** a partir de eso, no de la copia.
5. Solo entonces, reabrir la emisión.

⚠️ **Los pasos 3 y 4 no están probados y no hay guion.** Es el hueco que queda
después de este documento, y conviene saberlo antes que descubrirlo.

---

## 5. Renovar el certificado de la FNMT

El correo de las 9:00 avisa a **60, 30 y 15 días**, y todos los días desde una
semana antes (`functions/src/alerts/system-alerts.ts`). Cuando llegue el aviso:

```bash
# 1. Del .p12 nuevo a base64 — Secret Manager guarda texto, no binario
base64 -w0 certificado-nuevo.p12 > cert.b64

# 2. A los DOS proyectos. Si falta en uno, ahí se deja de remitir.
firebase functions:secrets:set VELTO_SIGNING_CERT --project dev  --data-file cert.b64
firebase functions:secrets:set VELTO_SIGNING_CERT --project prod --data-file cert.b64
firebase functions:secrets:set VELTO_SIGNING_CERT_PASSWORD --project dev
firebase functions:secrets:set VELTO_SIGNING_CERT_PASSWORD --project prod

# 3. Borra el intermedio. No se queda en el disco.
rm cert.b64

# 4. Redespliega lo que lo declara: un secret nuevo NO llega a una function
#    que no se vuelve a desplegar.
npm run deploy:prod:functions
```

Y **comprobarlo desde la function**, no entrando en la sede con el navegador —
allí el certificado lo presenta el navegador y aquí lo presenta Node:

Ajustes › VeriFactu › **Probar conexión**. Devuelve el titular del certificado y
los días que le quedan.

⚠️ **El hueco de la firma del contrato son 32 KB.** Empezó en 8192 y falló porque
la FNMT incrusta la cadena completa de la autoridad. Al renovar, firma un
contrato de prueba y comprueba que sigue cabiendo antes de darlo por bueno.

---

## 6. Lo que este documento NO cubre

Dicho para que no se dé por cubierto:

- **La reconstrucción del contador desde los registros de la AEAT** (§ 4).
- **Copia de los secrets.** Si se pierde el proyecto entero se pierden con él.
  El `.p12` original y su contraseña tienen que existir **fuera** de Google, en
  el sitio donde Dorel guarda lo que no se puede volver a pedir.
- **Quién hace esto si Dorel no está.** Es la otra pregunta pendiente, y va en su
  propio documento.
