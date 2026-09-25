/// <reference types="astro/client" />

/*
 * Los tipos del cliente de Astro, que es lo que hace existir `import.meta.env`
 * para TypeScript.
 *
 * ⚠️ **Sin este fichero el proyecto COMPILA IGUAL y solo se queja el editor**,
 * que es la peor combinación: `astro build` resuelve `import.meta.env` con Vite
 * sin mirar los tipos, así que la web sale bien y lo único que falla es el
 * subrayado rojo. Es el mismo reparto que en la app —donde quien valida las
 * plantillas es la compilación de Angular y no `tsc`—, y aquí no había nadie
 * declarando los tipos porque hasta el 25 de septiembre de 2026 `web/src` no
 * usaba ni una variable de entorno.
 *
 * `astro check` sí las mira, y es el que se queja si esto falta.
 */
