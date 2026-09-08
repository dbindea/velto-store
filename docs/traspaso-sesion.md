# Traspaso de sesión — 8 de septiembre de 2026

Pega el bloque de abajo en el chat nuevo. Todo lo demás de este fichero es
contexto para ti, no para pegar.

---

## PROMPT PARA EL CHAT NUEVO

```
Retomamos velto-store (Angular 20 + Firebase). Lee CLAUDE.md, FUNCIONAL.md,
docs/facturacion.md y docs/mejoras-pendientes.md antes de tocar nada: ahí está
el porqué de casi todas las decisiones y las trampas que ya nos han costado
tiempo.

CÓMO TRABAJO CONTIGO
- Háblame en español.
- Commitea tú en `develop`, en formato convencional. A `master` NO se sube sin
  mi visto bueno explícito: master despliega a producción con datos reales.
- Las Cloud Functions las despliegas tú a mano, con destino explícito
  (`npm run deploy:dev:functions`). El CI solo despliega hosting.
- Los datos de producción son desechables y puedes ensuciarlos, EXCEPTO
  `invoices`: ahí no hay ni una factura todavía y la primera que se emita marca
  el punto de no retorno.
- Prueba en el navegador en localhost:4200 (hay sesión abierta). El CSS se mira
  con capturas, no se da por bueno porque compile.
- Antes de dar algo por hecho: `npx tsc -p tsconfig.app.json --noEmit`,
  `npm run build` (es lo único que valida las plantillas de Angular),
  `npm test`, `npm --prefix functions test` y `npm run i18n:audit`.

DÓNDE ESTAMOS
Acabamos de terminar las fases 1 y 2 del módulo de FACTURACIÓN, y de añadir
cuatro temas de color. Todo está commiteado en `develop` y desplegado SOLO en
desarrollo. El roadmap y el porqué legal de cada decisión están en
docs/facturacion.md.

LO SIGUIENTE, por orden:

1. RECIBO DE COBRO. Se planificó en la fase 1 y se quedó fuera. Es lo que hago
   a mano en Word cuando alguien me da la señal. Sale de un pago de la
   colección `payments`. Lo único delicado: NO puede parecer una factura —lleva
   impreso que no tiene validez fiscal, no desglosa IVA y no lleva número de
   serie—. Diseño ya escrito en docs/facturacion.md § 11.d.

2. PARTE DE ENTREGA FIRMADO (N-17, aprobado). El contrato remite CUATRO veces a
   «el parte de entrega, que ambas partes firman», y ese documento no existe:
   la inspección no genera PDF, no se entrega y no la firma nadie. De él
   cuelgan los tres cargos que se cobran de la fianza: combustible, kilómetros
   extra y dotación faltante. La firma es OPCIONAL y la decide el agente —a
   familiares y socios no se les penaliza—. Ya existe `signature-pad`.

3. VERIFACTU (fase 3). Tope: 1 de enero de 2027, que es el que me toca a mí por
   ser S.L. La huella encadenada ya se calcula y se guarda; falta el registro
   XML, el envío a la AEAT, el QR y la leyenda.

Pregúntame lo que no esté claro antes de empezar.
```

---

## Contexto que NO va en el prompt (para ti, el que traspasa)

### Estado del repositorio

Rama `develop`, árbol limpio. Los siete commits de esta sesión:

```
6c32709 fix: la comprobación de la cadena la SIGUE, no la ordena
1247e95 feat: cuatro temas, con dos paletas intermedias
7f2f773 feat: rectificativas y proforma
3b6eab8 docs: la inmutabilidad de las facturas, verificada atacando las reglas
c3c1ba6 fix: las facturas y sus destinatarios solo los lee un administrador
ca319cc test: la factura entra en los invariantes de maquetación
cb874bd feat: régimen de IVA por línea en las facturas (REBU, exentas, ISP)
```

### Qué hay emitido en desarrollo

`2026/0001`, `2026/0002`, `2026/0003` y `R2026/0001` (rectificativa por
diferencias, −605 €, que dejó la `2026/0003` marcada como rectificada). Más dos
proformas `P-…`. **No se pueden borrar desde la aplicación**: para limpiar hay
que vaciar `invoices` e `invoiceCounters` desde la consola de Firebase.

### Lo único pendiente de cerrar la fase 2

Volver a pasar `docs/comprobar-reglas-facturas.js` con la versión corregida. La
primera pasada dio un falso «CADENA ROTA» porque el guion ordenaba por
`number`, que es el correlativo **de cada serie** —así que `R2026/0001` valía 1
y se colaba entre la primera y la segunda factura—. Ahora la cadena se sigue de
huella en huella. **Las reglas sí salieron verdes**: PATCH 403, DELETE 403 y
factura intacta.

### Lo que pende de Dorel, no del código

- **Rellenar aseguradora, póliza y teléfono de asistencia de cada coche** en su
  ficha. Mientras estén vacíos, la cláusula de accidentes del contrato remite a
  unos datos que el PDF no imprime.
- **Gestoría**, por orden de importancia: el IVA de la venta de vehículos; las
  dos series conviviendo este trimestre; los anticipos; el tipo de IVA de los
  cargos extra; y el alta en VERI\*FACTU.
- **Validación de los textos legales del contrato** (N-14) antes de que lleguen
  a clientes reales. Ya están sirviéndose en producción.
- Un **cobro desde el móvil** que la aplicación registre sola. Es la única vía
  de cobro sin probar de extremo a extremo.

### Cosas que aprendimos hoy y conviene no repetir

Todas están ya en CLAUDE.md o en docs/facturacion.md, pero las resumo porque son
el tipo de fallo que vuelve:

1. **Una regla más laxa que el permiso de la aplicación no es una regla laxa: es
   que el permiso no existe.** `viewInvoices` era de admin y las reglas dejaban
   leer `invoices` a cualquier autorizado. Ningún test lo coge.
2. **Los tests de maquetación comprueban que el texto QUEPA, nunca que sea
   cierto.** El presupuesto afirmó durante meses que los precios llevaban el IVA
   incluido, tres líneas debajo de un desglose que lo sumaba.
3. **Las condiciones con signo.** `base > 0` ocultó el desglose de una
   rectificativa, que lo tiene negativo. `soloRebu` miraba si la base era cero y
   en REBU no lo es.
4. **`computed()` no se reevalúa con un array que `ngModel` muta en sitio.** Los
   totales se quedaban a 0 al teclear.
5. **Un conversor de fechas propio se come los `{ seconds }` de Firestore.** El
   proyecto ya tiene `toDate()` y `toDateString()`.
6. **Bash se come los backticks y las llaves** en scripts largos. Usar la
   herramienta de escritura de ficheros, no heredocs.
