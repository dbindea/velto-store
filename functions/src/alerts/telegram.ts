/**
 * El aviso instantáneo de que ha entrado dinero.
 *
 * ⚠️ **Existe porque el correo no despierta a nadie.** Lo dijo Dorel el 18 de
 * octubre de 2026: «hasta que no vea el email o entre no me entero». Y el
 * agujero era real y medible: `redsysNotificationWebhook` era el ÚNICO que sabe
 * que un cobro ha entrado, y **no avisaba a nadie** — ni correo, ni nada. Un
 * cliente podía pagar la señal a las dos de la mañana y la noticia se quedaba
 * esperando a que alguien abriera el panel.
 *
 * ⚠️ **Telegram y no SMS, decisión de Dorel el mismo día.** Las tres opciones
 * se midieron: SMS cuesta ~0,04 €/mensaje con un proveedor español (menos de
 * 2 € al mes a este volumen) y funciona sin apps; el push de la PWA es gratis
 * pero hoy no hay ni service worker ni FCM en el proyecto. Telegram es gratis,
 * ilimitado, llega en segundos y **no añade una sola dependencia**: `fetch` es
 * global en Node 22. Eso último no es un detalle — `index.ts` evalúa entero en
 * cada arranque en frío, y una librería de SMS la pagaría también
 * `/api/fleet`.
 *
 * ⚠️ **La composición va SEPARADA del envío**, como `email-shell.ts`. Es la
 * regla de la casa y tiene un motivo concreto: el patrón de fallo que más se
 * repite aquí es el código que se escribe y nunca se ejecuta, y un mensaje que
 * solo se puede ver mandándolo es un mensaje que nadie mira hasta que sale mal
 * delante de un cliente. `mensajeCobro()` es pura y tiene tests.
 */

import * as logger from 'firebase-functions/logger';

/** Lo que hace falta para redactar el aviso. Nada de aquí es opcional por azar. */
export interface CobroParaAvisar {
  /** Lo que ha entrado de verdad, en euros. Sale de `Ds_Amount`, que viaja firmado. */
  importe: number;
  /** El concepto de la fila de cobro, tal y como lo verá en Pagos. */
  concepto: string;
  /**
   * La referencia de la pre-reserva (`P-4K7M9X`), si el cobro salió de una.
   *
   * ⚠️ **Es lo que convierte el aviso en accionable.** Sin ella, lo que llega
   * es «han pagado 50 €» y hay que buscar quién; con ella, el operador abre la
   * solicitud por su referencia. Es el mismo motivo por el que el concepto de
   * esos cobros la lleva dentro desde que existen.
   */
  referencia?: string;
  /** Quién paga, si consta. Va aquí y NO en la pasarela: ver la nota de `redsys.ts`. */
  pagador?: string;
  /** Marca y modelo, para no tener que abrir nada. */
  vehiculo?: string;
  /** `true` si el cobro quedó saldado; `false` si fue parcial. */
  completo: boolean;
}

/**
 * Un importe como lo lee una persona. `Intl` está en el runtime, sin
 * dependencias.
 *
 * ⚠️ **`es-ES` fijo, y es correcto aquí.** Esto no lo lee un cliente: lo lee
 * Dorel. Los documentos del cliente sí siguen el idioma de la plataforma, y
 * esa distinción está escrita en la regla de los nombres de fichero — lo que
 * se **sube** no se traduce, lo que se **lee** sí.
 */
function euros(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR'
  }).format(n);
}

/**
 * Escapa lo que va dentro del HTML de Telegram.
 *
 * ⚠️ **Hace falta aunque los datos sean «nuestros».** El concepto y el nombre
 * del pagador los teclea una persona —y el nombre llega desde un **formulario
 * público**—, así que un `<` suelto rompe el mensaje entero: la API de Telegram
 * contesta `400 can't parse entities` y el aviso **no llega**. O sea que el
 * fallo no es cosmético: es quedarse sin enterarse del cobro, que es justo lo
 * que esto viene a arreglar.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * El texto del aviso.
 *
 * ⚠️ **Lleva dentro todo lo que hace falta para decidir sin abrir nada**, que
 * es la misma regla que gobierna el correo de una solicitud nueva: un aviso que
 * obliga a entrar en la aplicación para saber de qué va es un aviso que se mira
 * más tarde.
 *
 * ⚠️ **Y distingue el cobro COMPLETO del parcial.** `status` queda en `partial`
 * cuando entra menos que el total, y eso cambia lo que el operador tiene que
 * hacer después. Enseñar los dos igual haría que diera por cobrado lo que no lo
 * está — el mismo error que `paymentSummary` ya enseñó respondiendo `0`.
 */
export function mensajeCobro(c: CobroParaAvisar): string {
  const lineas: string[] = [
    c.completo ? '💳 <b>Cobro recibido</b>' : '💳 <b>Cobro parcial recibido</b>',
    '',
    `<b>${esc(euros(c.importe))}</b> · ${esc(c.concepto)}`
  ];

  if (c.referencia) lineas.push(`Solicitud <code>${esc(c.referencia)}</code>`);
  if (c.pagador) lineas.push(`De ${esc(c.pagador)}`);
  if (c.vehiculo) lineas.push(esc(c.vehiculo));

  if (!c.completo) {
    // Sin esta línea, un parcial se lee como un cobro cerrado y la fila se
    // queda esperando a que alguien mire la pantalla de Pagos.
    lineas.push('', '⚠️ Queda importe pendiente en esa fila.');
  }

  return lineas.join('\n');
}

/**
 * Manda el aviso. Devuelve `true` si Telegram lo aceptó.
 *
 * ⚠️ **NUNCA lanza.** Quien llama es el webhook de Redsys, y ahí el orden de
 * prioridades no admite discusión: el cobro ya está escrito y a la pasarela hay
 * que contestarle `200`. Si Telegram está caído, lo que se pierde es el aviso;
 * si esto tumbara el webhook, Redsys reintentaría y lo que se pondría en juego
 * es el registro de un dinero que ya está en el banco. Es la misma regla que
 * sella el contrato: perder el sello es un problema, perder la firma es uno
 * mucho mayor.
 *
 * ⚠️ **Sin token configurado NO es un error, es que no está puesto.** Se
 * registra en `info` y se sigue. Un `error` en los logs por una integración que
 * nadie ha dado de alta es ruido que acaba haciendo que no se miren los logs.
 */
export async function avisarPorTelegram(
  texto: string,
  token: string | undefined,
  chatId: string | undefined
): Promise<boolean> {
  /**
   * ⚠️ **Se RECORTA, y eso tiene un motivo operativo.** Declarar un secret que
   * no existe **bloquea el despliegue de TODAS las functions**, no solo de la
   * que lo usa: el CLI valida los secrets del codebase entero antes de subir
   * nada, y contesta «In non-interactive mode but have no value for the
   * secret». Medido el 19 de octubre de 2026 intentando desplegar
   * `generateContractPdf`, que no tiene nada que ver con esto.
   *
   * Así que mientras el bot no exista, `TELEGRAM_BOT_TOKEN` se da de alta con
   * un valor de relleno — y «de relleno» tiene que poder significar **vacío o
   * en blanco**, o el código intentaría hablar con la API de Telegram con un
   * token que no vale y llenaría los logs de 401 en cada cobro.
   */
  if (!token?.trim() || !chatId?.trim()) {
    logger.info('Telegram no configurado: no se manda el aviso');
    return false;
  }

  try {
    /**
     * ⚠️ **Con `AbortSignal.timeout`, y no es precaución teórica.** Esto corre
     * dentro del webhook de la pasarela: sin plazo, una petición colgada deja
     * la function esperando hasta su propio timeout y Redsys sin respuesta. Y
     * Redsys reintenta lo que no se le contesta.
     */
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        // El aviso es el texto: una vista previa de enlace lo taparía.
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      // El cuerpo de Telegram dice POR QUÉ —`chat not found`, `can't parse
      // entities`—, y sin él un 400 no se puede arreglar.
      const detalle = await res.text().catch(() => '');
      logger.error('Telegram rechazó el aviso', { status: res.status, detalle });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('No se pudo avisar por Telegram', error);
    return false;
  }
}
