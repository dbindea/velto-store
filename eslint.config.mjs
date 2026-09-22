// @ts-check
/**
 * ESLint — lo genérico que las auditorías propias no miran.
 *
 * Este proyecto lleva cuatro auditorías escritas a mano (i18n, CSS, espaciado,
 * filas) que cubren muy bien **lo suyo** y nada de lo común: un import muerto,
 * una promesa sin esperar o un `<div (click)>` que no se puede pulsar con el
 * teclado. Eso es lo que hace esto.
 *
 * ⚠️ **No se extiende `tseslint.configs.recommended` entero, y es deliberado.**
 * Trae `no-explicit-any` como error, y aquí hay decenas de `any` legítimos: las
 * fechas de Firestore llegan como `Timestamp | {seconds} | string` y el modelo
 * las declara `any` a propósito. Una regla que marca cien sitios correctos se
 * apaga a la semana, y con ella se apaga el lint entero. Las reglas se eligen
 * una a una y cada una tiene su motivo escrito.
 *
 * ⚠️ **Y no hay plugin de RxJS**, aunque sea lo primero que uno buscaría en una
 * aplicación llena de suscripciones. La regla que existe —`no-ignored-subscription`—
 * pide guardar la `Subscription` que devuelve `.subscribe()`, y aquí el patrón
 * correcto es justo el contrario: `takeUntilDestroyed()` en el `pipe`, que no
 * devuelve nada que guardar. Marcaría como fallo lo que CLAUDE.md manda hacer.
 *
 * Dos niveles, y la diferencia importa:
 * - **error** — algo que está mal y se arregla. El lint falla.
 * - **warn** — algo que hay que mirar, con mucho pendiente de un repaso que no
 *   se hace en un día (las 47 celdas pulsables sin teclado). No bloquea.
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config([
  {
    ignores: [
      'dist/**',
      '.angular/**',
      'node_modules/**',
      'functions/lib/**',
      'functions/node_modules/**',
      '.playwright-mcp/**',
      // Guiones de Node, no código de la aplicación: otro entorno y otro módulo.
      'scripts/**',
      'docs/**',
      'src/assets/i18n/audit.js'
    ]
  },

  {
    files: ['src/**/*.ts'],
    // `tseslint.configs.base` no trae reglas: registra el analizador y el
    // plugin de TypeScript, que es lo que permite nombrar sus reglas abajo.
    extends: [eslint.configs.recommended, tseslint.configs.base, ...angular.configs.tsRecommended],
    languageOptions: {
      parserOptions: {
        /**
         * Los dos tsconfig de la aplicación, a mano.
         *
         * ⚠️ **`projectService: true` no vale aquí**: busca el `tsconfig.json`
         * más cercano, y el de la raíz no incluye nada —es el de referencias—,
         * así que las 28 specs daban «was not found by the project service».
         * Sin tipos no hay `no-floating-promises`, que es la regla por la que
         * merece la pena pagar el coste de leerlos.
         *
         * ⚠️ **Y `functions/` se queda fuera a propósito.** Su tsconfig
         * **excluye** los `*.spec.ts` —y no se puede tocar: `firebase deploy`
         * sube todo lo que haya en `lib/`, y el bundle acabaría importando
         * vitest en producción—, así que sus tests darían ese mismo error de
         * análisis. Meterlas es añadir un tsconfig solo para el lint; se hace
         * el día que compense.
         */
        project: ['tsconfig.app.json', 'tsconfig.spec.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    processor: angular.processInlineTemplates,
    rules: {
      /**
       * ⚠️ **`no-undef` se apaga en TypeScript, y no es pereza.** No conoce el
       * entorno declarado en el tsconfig, así que marcaba `document` y
       * `console` como no definidos en una aplicación de navegador. Lo que de
       * verdad comprueba que un identificador existe es el compilador, y ese
       * ya corre en cada `npm run build`. Es la recomendación de
       * typescript-eslint, no un apaño local.
       */
      'no-undef': 'off',

      // El de JavaScript no entiende tipos ni enumerados: se apaga y manda el
      // de TypeScript.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // Un argumento que hay que declarar para llegar al siguiente se
          // nombra con guion bajo y deja de contar.
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          /**
           * ⚠️ **Sacar campos de un objeto para NO copiarlos es una forma de
           * escribir, no un descuido.** El formulario de cliente hace
           * `const { documents, createdAt, id, ...dataToUpdate } = …` justo
           * para que esos cuatro no viajen en la actualización; sin esta
           * opción el lint pedía borrarlos, que es cambiar lo que hace el
           * código. Es el valor por defecto de la regla desde ESLint 9, pero
           * se escribe porque la primera pasada lo marcó.
           */
          ignoreRestSiblings: true
        }
      ],

      /**
       * La que justifica el coste de leer los tipos.
       *
       * Una escritura en Firestore sin `await` no falla: sale del método, la
       * pantalla dice que guardó y el error —si lo hay— se pierde sin que nadie
       * lo vea. Es exactamente el fallo que este proyecto llama «código escrito
       * y nunca ejecutado», pero en silencio.
       *
       * ⚠️ **En aviso, y con fecha de caducidad.** Salen **107**, y la mayoría
       * son a propósito: un `this.router.navigate(...)` devuelve una promesa
       * que nadie espera nunca, y una carga disparada desde `ngOnInit` tampoco.
       * Marcarlos todos en rojo el primer día es como se aprende a ignorar un
       * lint. Lo que hay que hacer es repasarlos por tandas —poniendo `void`
       * delante de lo deliberado y `await` donde falte de verdad— y entonces
       * subirla a `error`. Mientras tanto, al menos se ven.
       */
      '@typescript-eslint/no-floating-promises': 'warn',
      // Esta sí en error: son dos, y un `await` sobre algo que no es una
      // promesa siempre es un malentendido.
      '@typescript-eslint/await-thenable': 'error',

      /**
       * `await` sobre algo que no es una promesa se lee como si esperara y no
       * espera nada; y un `async` pasado donde se espera una función normal
       * hace que nadie recoja su error. En plantillas Angular es común y
       * aceptable, así que va en aviso.
       */
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: false }
      ],

      // Un `catch` vacío se traga el error; uno con un comentario dentro dice
      // que la decisión está tomada a propósito. Hay varios así.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // `==` con null es idiomático y se permite; el resto compara tipos
      // distintos sin decirlo.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Un `case` que se cae al siguiente sin decirlo es un fallo clásico en
      // las máquinas de estados de esta aplicación.
      'no-fallthrough': 'error'
    }
  },

  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      /**
       * ⚠️ En aviso, no en error, y con motivo.
       *
       * Hay 47 `<div (click)>` en 18 plantillas: filas de tabla, tarjetas y
       * celdas de calendario que se pulsan con el ratón y **no se alcanzan con
       * el teclado**. Convertirlas es trabajo de verdad —cada una cambia de
       * elemento y de estilo—, y ponerlo en error hoy dejaría el lint en rojo
       * desde el primer día, que es como se aprende a ignorarlo.
       *
       * Pero salió caro una vez: el menú «Más» de la barra inferior vivía
       * dentro de uno de esos `<div (click)>`, y por eso al elegir una opción
       * el clic lo volvía a abrir. Con el panel en un `<button>` hermano, ni
       * siquiera se podía escribir ese fallo.
       */
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/interactive-supports-focus': 'warn',
      // Las etiquetas de esta aplicación envuelven al campo en vez de usar
      // `for`, que es válido y está documentado en CLAUDE.md.
      '@angular-eslint/template/label-has-associated-control': 'warn'
    }
  }
]);
