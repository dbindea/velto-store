# Traspaso de sesión — 17 de septiembre de 2026

> Pégalo entero al abrir la sesión nueva. Está escrito para alguien que **no ha
> visto nada de lo anterior**: dice dónde estamos, qué NO tocar, y cómo entra el
> trabajo a partir de ahora.

---

## 0. LO PRIMERO: esto ya no es un proyecto en construcción

⚠️ **El 17 de septiembre de 2026 la empresa empezó a trabajar en real sobre
producción.** Es la frase más importante de este documento y lo cambia todo lo
demás.

Hasta ese día `rentalcar-veltomobility` tenía datos desechables y estaba
permitido ensuciarlo para probar. **Ya no.** Lo que hay dentro son clientes,
reservas, cobros y facturas de verdad.

Lo que eso significa, en concreto:

| | Antes | Ahora |
|---|---|---|
| Cambiar la forma de un documento | se cambiaba y se borraban los datos | **campos aditivos y migración** |
| Renombrar un campo | en sitio | **tres despliegues**: escribir, migrar, borrar |
| Borrar una colección en producción | se hizo tres veces | **no** |
| Probar | valía producción | **solo `velto-store`** |

La regla larga, con sus motivos, está en CLAUDE.md § «Los datos de producción YA
SON REALES». Y hay un matiz que se olvida: **lo congelado no se migra**. Los
snapshots —`pricingSnapshot`, `ownerShareSnapshot`, `clientSnapshot`, el del
contrato— son histórico, y el código nuevo tiene que saber leer los viejos. Eso
no es un parche de compatibilidad: es la razón de ser de un snapshot.

---

## 1. Qué es esto

**Velto Store** — SPA de gestión de flota de alquiler. Angular 20 + Firebase.
Negocio real, pequeño: 2–10 coches en Torrejón de Ardoz. Se opera **desde el
móvil, en la calle**. El dueño se llama **Dorel** y es quien programa.

Lee **`CLAUDE.md`** entero antes de tocar nada: es largo y cada aviso está ahí
porque el fallo ya ocurrió. Y **`FUNCIONAL.md`** para el negocio.

Dos entornos, dos proyectos: `velto-store` (desarrollo, rama `develop`,
`store.veltorent.com`) y `rentalcar-veltomobility` (producción, rama `master`,
`rentalcar.veltomobility.com`).

---

## 2. Dónde quedó todo el 17 de septiembre

Fue un día largo y conviene saber qué se movió, porque casi todo fue en
producción.

**Producción se vació entera** antes de empezar en real: siete colecciones y los
siete ficheros de Storage, versiones incluidas. Quedó solo `authorizedUsers` con
`veltorent@gmail.com`. Fue el último borrado; ya no se puede repetir.

**Se desplegaron a producción** las cinco functions que se habían quedado atrás
—`generateContractPdf` con el archivado de contratos, `getContractVerification`
con el estado `superseded`, y las tres de Redsys con el importe pendiente, el
nombre del cliente fuera del base64 y la devolución que ya no se lee como
cobro—. Verificadas: las dos públicas responden bien.

**Y producción empezó a facturar.** `VELTO_INVOICING_ENABLED=true`,
`issueInvoice` e `issueComplianceDeclaration` desplegadas, y la declaración
responsable emitida (`verifactuDeclarations/1.0`). La primera factura será
`2026/0001`.

⚠️ **Emite pero NO remite.** `VELTO_VERIFACTU_ENABLED` sigue en `false`: los
registros se guardan con cada factura y no se envían a la AEAT hasta el 1 de
enero de 2027. Es legal —la obligación no empieza hasta entonces— y es lo que
mantiene apagados el QR y la leyenda, que es lo correcto mientras la sede no
tenga esas facturas.

**Estado de las functions** (verificado ese día): producción **22**, desarrollo
**27**. Las cinco que faltan son las que hablan con la Agencia, y faltan a
propósito.

**Reglas e índices de producción: al día.** Comprobado descargando el ruleset
desplegado y comparándolo — `firestore.rules` solo difiere en un comentario,
`storage.rules` es idéntico y los 13 índices declarados están los 13. La
advertencia de traspasos anteriores («las reglas nuevas están solo en
desarrollo») **ya no aplica**.

---

## 3. Cómo entra el trabajo a partir de ahora

El desarrollo por tandas se cierra aquí. Lo que venga vendrá de **Dorel
trabajando en producción**: un fallo que le salga, algo que le estorbe, o una
funcionalidad que eche en falta con clientes delante.

Cuando llegue uno de esos, el orden que ha funcionado:

1. **Reproducirlo, no imaginarlo.** El patrón de fallo dominante aquí es código
   escrito y nunca ejecutado; el segundo es código que sí se ejecutó pero en el
   otro entorno.
2. **Preguntarse si es de producción o del código.** El 17 de septiembre, un
   «User code failed to load» del despliegue no era el código —cargaba en 1,2 s—
   sino la máquina ocupada; y un «No se pudo consultar el estado de la remisión»
   sí era el código, pero no donde parecía.
3. **Arreglarlo en `develop`, probarlo en desarrollo, y luego a `master`.** El
   CI despliega hosting; **las functions van a mano**.
4. ⚠️ **Los despliegues de functions a producción los lanza Dorel.** A mí me los
   bloquea el clasificador de permisos, así que lo que hago es dejarle el
   comando exacto, con `--only` explícito y por tandas.

---

## 4. Lo que NO se toca

- **Producción no se usa para probar.** Ni una reserva de prueba, ni un cobro:
  allí Redsys está en `live` y cobra de verdad.
- **No se borran colecciones en producción.** Nunca más.
- **`invoices` es inmutable.** `update` y `delete` denegados a todo el mundo,
  administrador incluido. Un error se corrige con una rectificativa.
- **La declaración responsable tampoco se borra.** Hay una por versión del
  sistema y ya existe la 1.0.
- **`VELTO_VERIFACTU_ENABLED` en producción solo lo enciende Dorel**, con el
  guion del 1 de enero delante.
- **`veltorent@gmail.com`** es el único propietario de los dos proyectos y el
  único usuario. Si se pierde esa cuenta no hay forma de entrar, restaurar ni
  desplegar. Sigue siendo el primer punto pendiente del sobre
  ([emergencia.md](emergencia.md)).

---

## 5. Lo que queda pendiente

La lista viva está en [mejoras-pendientes.md](mejoras-pendientes.md). Lo que hay
que tener en la cabeza al retomar:

**Con fecha, y es lo único con fecha:** el guion del 1 de enero de 2027
([verifactu-alta.md](verifactu-alta.md) § 5 bis). Incluye un paso nuevo —el 3
bis— que no existía y que lo crea haber empezado a facturar antes: **qué se hace
con las facturas de 2026** cuando se encienda la remisión. El barrido se lleva
todas las filas pendientes **sin filtro de fecha**, así que si no se decide
nada, en enero intentará remitir meses de facturas que nunca estuvieron
obligadas. Las dos salidas están escritas y **hay que probarlas contra
preproducción desde desarrollo, antes de enero**.

**Decisiones de Dorel, sin prisa:** el turquesa `#20A48F` como texto se queda en
3,10:1 y hace falta 4,5:1 —haría falta un tono propio para texto—; la fianza
automática a clientes conocidos (M-21); y consultar VIES antes de emitir, que
hoy no se hace y una factura con un NIF-IVA que la AEAT no reconozca no se puede
remitir nunca.

**Deuda técnica que ahora sí puede morder:** Informes se trae seis colecciones
enteras y filtra en memoria —es lo primero que se rompe cuando crezcan los
datos—; dos operadores pueden reservar el mismo coche, reducido a milisegundos
pero no cerrado; y no hay lint.

**Sin cerrar desde hace tiempo:** un cobro por la vía pública del móvil que se
registre solo en **producción**. En desarrollo ya ocurrió; una vía de cobro no
está probada hasta que alguien paga por ella y la aplicación se entera sin
ayuda.

---

## 6. Cómo se trabaja aquí

Esto no es estilo, es lo que hace que la aplicación no mienta:

1. **Antes de dar algo por bueno**: `npm run build` (comprueba las plantillas,
   cosa que `tsc --noEmit` no hace), `npm test`, `npm --prefix functions test`,
   `npm run i18n:audit`, `npm run css:audit` y `npm run spacing:audit`.
2. **Y además abrir la pantalla.** El patrón de fallo dominante es **código
   escrito y nunca ejecutado**. Los fallos más caros de septiembre no los habría
   cazado ninguna auditoría.
3. **Mirar también el móvil**, a 390 px. Es una aplicación de móvil.
4. **Medir, no deducir.** Vale para el CSS —`getComputedStyle` es la única
   respuesta buena, y la especificidad de Angular engaña— y vale para los
   despliegues: el 17 de septiembre, dos errores seguidos acusaban al código y
   ninguno era del código.
5. **El texto y el hecho se deciden juntos.** Ha mordido cinco veces: el
   contrato afirmaba una firma que no tenía, el presupuesto decía «IVA incluido»
   sobre un desglose que lo sumaba…
6. **Nada de texto en español dentro del código.** Todo clave i18n, en los tres
   idiomas.
7. **Un botón que no hace nada es un fallo**, y un permiso denegado se explica.
8. **Cada pregunta se contesta con su propia bandera**, aunque hoy dos coincidan.
   Es la lección de `invoicingEnabled` contra `verifactuEnabled`: coincidieron
   durante meses y el día que se separaron rompieron una pantalla.
9. **Commits en español**, formato convencional, contando **por qué**. Se puede
   commitear en `develop`; **`master` necesita el visto bueno de Dorel**, y
   ahora con más razón: merge a `master` es desplegar sobre datos reales.

⚠️ **Y lo más importante de todo:** cuando algo no cuadre, **decirlo**. La regla
de esta casa es que una cifra creíble y equivocada es peor que un error.
