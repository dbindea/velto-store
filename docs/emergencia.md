# Sobre de emergencia — VELTO MOBILITY

> **Para quién es esto.** Para quien tenga que sacar adelante el negocio un día
> en que Dorel no esté y algo no funcione. No hace falta saber programar para
> leer la primera mitad.
>
> ⚠️ **Aquí no hay contraseñas ni claves.** Este fichero está en el repositorio,
> donde no van credenciales. Dice **dónde** está cada cosa y **qué hacer**; lo
> que abre las puertas va en el sobre físico. Ver § 2.
>
> Escrito el **11 de septiembre de 2026**.

---

## 0. ⚠️ Lo que hoy hace inútil este sobre

Comprobado hoy contra los dos proyectos:

| | Quién |
|---|---|
| Propietario de Google Cloud, desarrollo y producción | **`veltorent@gmail.com`, y nadie más** |
| Usuarios de la aplicación, desarrollo y producción | **`veltorent@gmail.com`, y nadie más** |

Es decir: **una sola cuenta**. Si esa cuenta se pierde —Dorel no está, se bloquea,
se pierde el móvil del segundo factor— no hay nadie que pueda entrar en la
aplicación, ni restaurar una copia, ni parar la facturación, ni renovar el
certificado, ni desplegar nada. El negocio se queda sin sistema **y sin forma de
recuperarlo**.

Un sobre que dice «entra en Firebase» a alguien que no puede entrar no sirve de
nada. Así que antes que nada, dos cosas que **solo puede hacer Dorel**:

### 0.1 · Un segundo propietario en los dos proyectos

```bash
gcloud projects add-iam-policy-binding rentalcar-veltomobility \
  --member='user:SEGUNDA_CUENTA@gmail.com' --role='roles/owner' \
  --account=veltorent@gmail.com

gcloud projects add-iam-policy-binding velto-store \
  --member='user:SEGUNDA_CUENTA@gmail.com' --role='roles/owner' \
  --account=veltorent@gmail.com
```

No tiene que ser un técnico. Tiene que ser alguien de confianza con una cuenta de
Google que no se vaya a perder a la vez que la tuya: un socio, un familiar, la
gestoría. Lo que se necesita de esa persona no es que sepa usarlo, es que
**pueda dar acceso a quien sepa**.

### 0.2 · Un segundo usuario de la aplicación

Desde **Ajustes › Usuarios**, con rol `admin`. Hace falta en **los dos entornos**
(`authorizedUsers` es la única colección que sobrevive a un vaciado, y se
gestiona por separado en cada proyecto).

⚠️ **Nadie puede desactivarse ni degradarse a sí mismo**, así que con dos
administradores tampoco hay riesgo de que uno deje al otro fuera por error.

### 0.3 · El certificado de la FNMT, fuera de Google

El `.p12` y su contraseña están en Secret Manager, que vive dentro del mismo
proyecto que se puede perder. **Tiene que existir una copia fuera**, en el sitio
donde guardas lo que no se puede volver a pedir en una tarde. Renovarlo exige
acreditar la representación de la sociedad ante la FNMT, y eso lleva días.

---

## 1. Si algo va mal: el orden

1. **¿Se puede seguir alquilando?** → § 3. Eso primero: el coche está en la
   puerta y el cliente delante.
2. **¿Hay que parar algo?** → § 4. Cobros y facturación son las dos cosas que,
   funcionando mal, hacen daño de verdad.
3. **¿Hay que arreglarlo?** → § 6, y probablemente hace falta alguien técnico.
4. **Anota lo que pase, con la hora.** Si se ha cobrado algo fuera de la
   aplicación, o se ha entregado un coche sin contrato en el sistema, eso hay que
   regularizarlo después y nadie se acuerda tres días más tarde.

---

## 2. Qué tiene que haber en el sobre físico

Esto es lo que **no** puede estar aquí. Papel, en la oficina, y una copia en otro
sitio:

- [ ] Cuenta de Google y contraseña · **códigos de recuperación del segundo
      factor** (son los que salvan si se pierde el móvil)
- [ ] Quién es el **segundo propietario** y cómo localizarle
- [ ] El **`.p12` de la FNMT** y su contraseña, en un pendrive o donde guardes lo
      importante
- [ ] Dónde está registrado el dominio **veltomobility.com** y con qué cuenta
- [ ] Contacto del **banco / Redsys** (comercio `361040215`, terminal `1`)
- [ ] Contacto de la **gestoría**
- [ ] Una copia impresa de este documento
- [ ] **Diez contratos de alquiler impresos en blanco** → ver § 3

---

## 3. Seguir alquilando sin la aplicación

⚠️ **Esto se puede hacer sin saber nada de informática, y funciona.** El negocio
es alquilar coches; la aplicación es cómo se anota. Si la aplicación no va, se
anota en papel y se pasa después.

### Entregar un coche

1. **Contrato en papel.** Se rellena a mano uno de los impresos en blanco y lo
   firma el cliente. ⚠️ Es un contrato igual de válido: lo que obliga es la firma
   y el texto, no que lo haya generado un ordenador.
2. **Fotocopia o foto del DNI y del carné** del cliente y de cada conductor.
3. **Fotos del coche con el móvil**, las mismas que se harían en la aplicación:
   las cuatro esquinas, el cuadro de mandos con **los kilómetros y el nivel de
   combustible**, y cualquier daño. ⚠️ **Las fotos son la prueba.** Sin ellas no
   se puede cobrar después un depósito por un golpe ni por el combustible.
4. **Anota en el contrato**: km de salida, combustible, fecha y hora.

### Cobrar

- **Efectivo o transferencia.** Anótalo en el contrato con el importe y la fecha.
- **Con tarjeta no se puede** si la aplicación no va: el enlace de pago lo genera
  ella.
- ⚠️ **No des un recibo hecho a mano que parezca una factura.** Un papel que diga
  «recibí X €» está bien; algo con número de factura, no. Ver § 3 bis.

### Devolver un coche

Fotos otra vez, km de vuelta, combustible, y lo que se le cobre o se le devuelva
de la fianza, anotado en el mismo contrato.

### Después, cuando la aplicación vuelva

Se crea la reserva con las fechas reales, se registran los cobros y se suben las
fotos. El contrato de papel se escanea y se guarda: **el que vale es el de
papel**, porque es el que está firmado.

---

## 3 bis. ⚠️ Lo que NO se hace nunca

**No emitas una factura fuera de la aplicación.** Ni a mano, ni con una
plantilla, ni con otro programa.

Las facturas llevan una numeración correlativa y van **encadenadas por huella**:
cada una se calcula a partir de la anterior, y todas se remiten a la Agencia
Tributaria. Una factura hecha por fuera:

- consume un número que la aplicación volverá a usar → dos facturas con el mismo
  número;
- rompe la cadena de todas las siguientes;
- **no se puede arreglar borrándola**, porque una factura emitida no se borra
  nunca — se corrige con una rectificativa, y el cliente ya tiene la mala.

Si un cliente pide factura y la aplicación no va: **se le dice que se la envías en
cuanto puedas**, y se anota. No hay ninguna prisa que justifique romper esto.

---

## 4. Parar cosas

⚠️ Todo lo de esta sección necesita el ordenador de trabajo y los accesos.

### Parar la facturación

La forma inmediata, sin tocar código:

```bash
firebase functions:delete issueInvoice --project prod
```

Deja de poder emitirse cualquier factura. Lo demás sigue funcionando. Para
volver: `npm run deploy:prod:functions` con el nombre de esa function.

### Parar los cobros con tarjeta

```bash
firebase functions:delete createRedsysPaymentLink --project prod
firebase functions:delete getPaymentCheckout --project prod
```

⚠️ **Nunca borres `redsysNotificationWebhook`.** Es el que recibe el aviso del
banco cuando un cliente paga. Sin él, un cobro que **ya se ha cargado en la
tarjeta** no se registra en ninguna parte y no hay forma de enterarse: eso ya
costó un cobro perdido el 4 de septiembre de 2026.

El orden correcto es: cortar los que **generan** el cobro, dejar vivo el que lo
**recoge**.

### Quitarle el acceso a alguien

**Ajustes › Usuarios › desactivar.** Si no se puede entrar en la aplicación, desde
la consola de Firebase: colección `authorizedUsers`, el documento con su correo,
`active: false`.

⚠️ Desactivar a alguien **no borra lo que hizo**, y así debe ser.

### Parar la aplicación entera

Si hay que cortar del todo —por ejemplo, una fuga de datos—:

```bash
firebase hosting:disable --project prod
```

La web deja de servirse. Los enlaces que ya tengan los clientes dejan de
funcionar también.

---

## 5. Dónde está cada cosa

| | Desarrollo | Producción |
|---|---|---|
| Proyecto de Google | `velto-store` | `rentalcar-veltomobility` |
| Dominio | store.veltorent.com | **rentalcar.veltomobility.com** |
| Rama de git | `develop` | `master` |
| Región | `europe-west1` · Firestore `eur3` | igual |
| Correo de la empresa | reservas@veltorent.com | **reservas@veltomobility.com** |

**El código** está en GitHub: `dbindea/velto-store`.

**Las claves** están en Secret Manager, dentro de cada proyecto de Google. Los
nombres, para saber qué existe:

| Secret | Qué es | dev | prod |
|---|---|---|---|
| `VELTO_SIGNING_CERT` | el `.p12` de la FNMT, en base64 | sí | sí |
| `VELTO_SIGNING_CERT_PASSWORD` | su contraseña | sí | sí |
| `RESEND_API_KEY` | envío de correo | sí | sí |
| `REDSYS_SECRET_KEY` | firma de los cobros con tarjeta | sí | sí |

**Lo que no es secreto pero cambia entre entornos** vive en el repositorio, en
`functions/.env.velto-store` y `functions/.env.rentalcar-veltomobility`. Ahí se
ve de un vistazo si un entorno factura, si remite a la AEAT y contra qué pasarela
cobra.

**Los proveedores**: Google (Firebase), Resend (correo), Redsys vía 〔**banco:
rellenar**〕, FNMT (certificado).

---

## 6. Operaciones

### Desplegar

```bash
npm run deploy:dev:functions      # desarrollo
npm run deploy:prod:functions     # producción
```

⚠️ **Nunca `--only functions` a secas contra producción.** Produción tiene **19**
functions y el código define **26**: las siete que faltan son las que escriben
facturas y hablan con la AEAT, y no están allí a propósito hasta el 1 de enero.
Un despliegue completo las subiría. Van siempre por nombre:
`--only functions:nombre1,functions:nombre2`.

⚠️ **Y por tandas de dos o tres.** Todas de golpe agota la cuota de CPU de Cloud
Run, y el error que se lee —«Container Healthcheck failed»— parece un fallo del
código y no lo es. Antes de buscar un error inexistente:

```bash
cd functions && node -e "require('./lib/index.js')"
```

Si eso imprime sin error, el código está bien: es cuota. Espera dos minutos y
reintenta con menos.

### Restaurar una copia

**No lo hagas sin leer** [copias-de-seguridad.md](copias-de-seguridad.md) § 4.
Restaurar un estado anterior con facturas ya emitidas **reintroduce números y
huellas ya consumidos**, y a partir de ahí la contabilidad miente. Lo primero es
parar la facturación (§ 4), no restaurar.

### Renovar el certificado de la FNMT

Caduca el **30 de julio de 2028**. El correo de las 9:00 avisa a 60, 30 y 15 días,
y todos los días desde una semana antes. Procedimiento en
[copias-de-seguridad.md](copias-de-seguridad.md) § 5.

### Ver si hay facturas sin remitir a la AEAT

**Ajustes › VeriFactu**. Ahí se ve el estado de cada envío y se puede reintentar
una rechazada. El correo de las 9:00 avisa si algo lleva parado.

---

## 7. A quién llamar

〔**Rellenar a mano. Un hueco vacío aquí es el motivo por el que existe este
documento.**〕

| | Quién | Teléfono |
|---|---|---|
| Segundo propietario | 〔…〕 | 〔…〕 |
| Gestoría / asesoría fiscal | 〔…〕 | 〔…〕 |
| Banco (Redsys) | 〔…〕 | 〔…〕 |
| Seguro de la flota | 〔…〕 | 〔…〕 |
| Quien pueda tocar el código | 〔…〕 | 〔…〕 |

---

## 8. Mantener esto vivo

Un sobre de emergencia con datos viejos es peor que ninguno: se actúa sobre él.

**Repásalo cuando**: cambie un dominio, un proveedor, una cuenta o un teléfono;
se dé de alta o de baja a alguien; o se encienda la facturación en producción.

Y **una vez al año, ábrelo y comprueba tres cosas**: que la contraseña de Google
sigue siendo esa, que el `.p12` del pendrive todavía se abre con la contraseña
apuntada, y que la persona del § 7 sigue siendo la que crees.
