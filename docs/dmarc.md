# DMARC: dejar de recibir XML, y proteger el dominio de verdad

Para Dorel. Dos cosas distintas que conviene no mezclar: **dejar de recibir los
informes** es un cambio de un minuto, y **proteger el dominio** es lo que hay
detrás y lleva unas semanas. Lo segundo es lo que importa.

Lo que se comprueba a mano desde PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File docs\comprobar-correo.ps1
powershell -ExecutionPolicy Bypass -File docs\comprobar-correo.ps1 -Dominio veltorent.com
```

---

## 1. Por qué esto importa en este negocio

Sin DMARC en serio, **cualquiera puede mandar un correo que diga venir de
`@veltomobility.com`** y al que lo recibe no le salta nada. Y por ese dominio
salen contratos para firmar, presupuestos con precios y facturas con un número
de cuenta: un correo falso bien hecho es dinero que se va a la cuenta de otro, y
el cliente no tiene forma de saberlo.

⚠️ **`p=none` NO protege.** Solo pide informes. Es el estado de hoy, y es el
estado correcto **mientras se mira**; lo que no puede es quedarse así.

---

## 2. Dónde está hoy

**Medido el 8 de octubre de 2026.** Los dos dominios están igual:

```
_dmarc.veltomobility.com   v=DMARC1; p=none; rua=mailto:c861ab…@dmarc-reports.cloudflare.net,mailto:veltorent@gmail.com
_dmarc.veltorent.com       v=DMARC1; p=none; rua=mailto:000d39…@dmarc-reports.cloudflare.net
```

Y quién manda correo legítimamente como `@veltomobility.com`:

| Quién | Cómo autentica | Dónde está configurado |
|---|---|---|
| **La aplicación**, por Resend | DKIM `resend._domainkey` y SPF de `send.veltomobility.com` | `VELTO_COMPANY_EMAIL` en `functions/.env.rentalcar-veltomobility` |
| *(por confirmar)* Gmail «enviar como» | **no autentica**: ver el aviso del paso 4 | Ajustes de Gmail |

El apex lleva `v=spf1 include:_spf.mx.cloudflare.net ~all`, que es de **recibir**
(Email Routing), no de enviar.

---

## 3. Lo primero, que es gratis: dejar de recibir los XML

El `rua` de `veltomobility.com` tiene **dos** destinos y el segundo es tu buzón.
El primero es el DMARC Management de Cloudflare, que ya los recoge y te los
enseña masticados en el panel — así que la copia al correo no aporta nada.

En **Cloudflare → DNS → Records**, edita el TXT `_dmarc` y déjalo así:

```
v=DMARC1; p=none; rua=mailto:c861ab6c2c6b462ab7c864a385a814fe@dmarc-reports.cloudflare.net
```

Es exactamente la forma que ya tiene `veltorent.com`. Para comprobarlo, el guion
de arriba: tiene que decir **«informes a 1 destino(s)»**.

⚠️ **Lo que NO hay que hacer es quitar el `rua` entero.** Sin él nadie recoge
nada y te quedas sin saber quién manda correo como tu dominio — que es
justamente lo que hace falta para el paso siguiente.

---

## 4. El repaso, dentro de unas semanas

**A partir del 29 de octubre de 2026** (tres semanas de datos). En Cloudflare →
**Email** → **DMARC Management**, mirando el dominio `veltomobility.com`.

La pregunta no es «¿pasa todo?», es **«¿reconozco todo lo que aparece?»**. Tres
cosas que tienen que ser ciertas antes de tocar nada:

1. **Todas las fuentes con volumen son conocidas.** Resend/Amazon SES y
   Cloudflare son las esperadas. Si aparece otra con correos de verdad, hay que
   saber qué es **antes** de endurecer: endurecer la apaga.
2. **Lo legítimo pasa por DKIM, no solo por SPF.** Es la condición que de verdad
   decide, y el motivo está abajo.
3. **No hay nada tuyo saliendo desde Gmail.** Si en el panel aparece Google como
   fuente que **falla**, es que en algún sitio hay un «enviar como»
   `reservas@veltomobility.com` desde Gmail. Eso falla hoy —Gmail firma como
   `gmail.com`, que no alinea— y con `p=reject` dejaría de llegar.
   ⚠️ Y en **enero de 2027 Gmail deja de enviar como direcciones de terceros** de
   todas formas, así que si está en uso hay que moverlo a Resend o a Workspace
   antes. Está anotado en [publicar-web.md](publicar-web.md).

### ⚠️ Por qué DKIM y no SPF

**El reenvío rompe SPF por diseño.** Cuando alguien reenvía un correo tuyo —o
cuando Cloudflare Email Routing lo reenvía a tu Gmail—, el correo sale de un
servidor que tu SPF no nombra, así que SPF falla. DKIM es una firma dentro del
mensaje y **sobrevive al reenvío**.

Por eso un dominio puede estar «pasando DMARC» hoy gracias a SPF y romperse el
día que se endurece. Si en el panel lo legítimo pasa por DKIM, endurecer es
seguro.

---

## 5. Los tres pasos

Solo si el repaso del paso 4 ha salido limpio. **Nunca saltar directamente al
último**: lo que se rompa, se rompe sin avisar y en correo que ya no llega.

### Paso 1 — una cuarta parte, una semana

```
v=DMARC1; p=quarantine; pct=25; rua=mailto:c861ab6c2c6b462ab7c864a385a814fe@dmarc-reports.cloudflare.net
```

`pct=25` dice «aplica la política solo a uno de cada cuatro». Si algo legítimo
se rompe, se rompe en una cuarta parte y se ve en el panel antes de que duela.

Una semana. Mirar el panel: ninguna fuente conocida en `quarantine`.

### Paso 2 — todo, dos semanas

```
v=DMARC1; p=quarantine; rua=mailto:c861ab6c2c6b462ab7c864a385a814fe@dmarc-reports.cloudflare.net
```

Sin `pct` se aplica al 100 %. Lo que no autentique se va a spam, no se pierde.

Dos semanas. Si nadie se queja y el panel sigue limpio, el último paso.

### Paso 3 — rechazar

```
v=DMARC1; p=reject; rua=mailto:c861ab6c2c6b462ab7c864a385a814fe@dmarc-reports.cloudflare.net
```

A partir de aquí, un correo que diga venir de `@veltomobility.com` sin
autenticar **se rechaza**. Esto es lo que impide que alguien mande una factura
falsa con su número de cuenta.

### Lo que no hace falta tocar

- **`sp=`** (política para subdominios): sin él, los subdominios heredan `p`, que
  es lo que se quiere. `send.veltomobility.com` no manda nada con el `De:` puesto
  ahí, solo es el sobre.
- ⚠️ **`adkim` y `aspf` se quedan en relajado (`r`), que es el valor por
  defecto.** Ponerlos en estricto (`s`) **rompería Resend**: su SPF vive en
  `send.veltomobility.com` y en estricto eso deja de alinear con el apex.

---

## 6. Si algo se rompe

Se nota en dos sitios, y en este orden:

1. **El panel de Cloudflare**, al día siguiente: una fuente que conoces aparece
   en `quarantine` o `reject`.
2. **Un cliente que dice que no le llega nada**, o un correo tuyo en su spam.

**Volver atrás es un cambio de TXT y propaga en minutos**: deja el registro en
`p=none` con su `rua` y todo vuelve a entrar como antes mientras se averigua qué
pasó. No hay nada que reconstruir — DMARC no guarda estado.

⚠️ **Lo que no se recupera es el correo rechazado.** Con `p=reject` el servidor
de destino lo rechaza y no queda copia en ninguna parte: ni en spam, ni en
cuarentena, ni en un registro tuyo. Por eso los dos pasos previos.

---

## 7. El calendario

| Cuándo | Qué |
|---|---|
| hoy | quitar el segundo `mailto:` del `rua` (paso 3) |
| **29 de octubre de 2026** | el repaso del paso 4 |
| +1 semana | `p=quarantine; pct=25` |
| +1 semana | `p=quarantine` al 100 % |
| +2 semanas | `p=reject` |
| **antes de diciembre** | decidir lo de Gmail «enviar como» / Workspace |

`veltorent.com` va detrás y con los mismos pasos. Hoy es el dominio de
desarrollo y la marca antigua, así que el daño de un correo falso es menor —
pero mientras resuelva y mande correo, el mismo razonamiento aplica.
