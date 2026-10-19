/**
 * La lógica del diálogo de pre-reserva, compartida por la página de resultados
 * y la ficha de cada coche.
 *
 * ⚠️ **Separada del marcado por lo mismo que el buscador**: son dos páginas y
 * tiene que comportarse igual en las dos. Lo que cambia entre ellas es de
 * dónde salen el coche y las fechas; lo que pasa al pulsar «Enviar», no.
 */

import { euros, pagarSenal, solicitar } from './api';
import { ocupar, ocuparUnRato, type Ocupado } from './boton-ocupado';
import { capitalizarNombre, transformarCampo } from './texto';
import { medirHito } from './medir';

export interface DatosPreReserva {
  vehicleId: string;
  /** «Citroën Berlingo · 3 días · 250,95 €» — lo que el visitante acaba de elegir. */
  resumen: string;
  /** `yyyy-MM-ddTHH:mm`, en hora local. */
  desde: string;
  hasta: string;
  /**
   * Dónde lo recoge, tal y como lo eligió en el buscador. Vacío si llegó a la
   * ficha sin pasar por él.
   *
   * ⚠️ **Viaja hasta la solicitud, que es lo que no pasaba.** Ver la nota de
   * `solicitar()` en `api.ts`: el aeropuerto llegaba a Velto sin nombrarse.
   */
  lugar?: string;
  /**
   * Cuántas horas se garantiza el precio, tal y como lo ha dicho el backend.
   *
   * ⚠️ **Sin él se deja la frase que trae la plantilla** —24 horas, el valor
   * de hoy— en vez de quitarla: una pre-reserva que no dice cuánto dura su
   * precio invita a preguntarlo por teléfono.
   */
  horasGarantia?: number;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** «hasta el 2 de octubre a las 11:30» — la fecha de verdad que da el backend. */
function hastaCuando(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `Te garantizamos este precio hasta el ${d.getDate()} de ${MESES[d.getMonth()]} a las ${p(d.getHours())}:${p(d.getMinutes())}.`;
}

/**
 * ⚠️ Las claves que devuelve la function se traducen AQUÍ. Enseñar
 * `vehicle-unavailable` es enseñarle al visitante el código de un error, y un
 * genérico «algo ha fallado» le hace pulsar otra vez sin cambiar nada.
 *
 * `vehicle-unavailable` es el que hay que acertar: entre que se pintó la lista
 * y se pulsó el botón, otro puede haberse llevado el coche — y decirlo es lo
 * único honesto, porque la solicitud no se ha creado.
 */
const MOTIVOS: Record<string, string> = {
  'missing-name': 'Necesitamos tu nombre para saber con quién hablamos.',
  'missing-phone': 'Necesitamos un teléfono para poder confirmártelo.',
  'bad-phone': 'Ese teléfono no lo entendemos. Revísalo, por favor.',
  'vehicle-unavailable': 'Ese coche acaba de ocuparse en esas fechas. Elige otras.',
  'too-many-requests': 'Ya tenemos tu solicitud. Te contestamos enseguida.',
  'bad-range': 'Revisa las fechas: la devolución tiene que ser posterior a la recogida.',
  'past-date': 'La recogida no puede ser en una fecha pasada.',
};

/**
 * Lo que se le dice cuando el pago de la señal no sale.
 *
 * ⚠️ **Ninguno de estos mensajes dice que la pre-reserva se haya perdido**, y
 * es lo más importante de los cinco: el cliente está mirando una pantalla que
 * acaba de darle una referencia. Un «no se ha podido» a secas se lee como que
 * todo el formulario se ha caído, y lo que hace entonces es volver a rellenarlo
 * — y Velto recibe la misma solicitud dos veces.
 *
 * ⚠️ **Y todos acaban ofreciendo la salida que sí funciona**: que llamen ellos.
 * Un error sin salida en la pantalla donde alguien iba a pagar es un cliente
 * perdido.
 */
const MOTIVOS_SENAL: Record<string, string> = {
  /*
   * No debería verse nunca —el botón no se enseña con el pago apagado—, pero
   * si alguien llega aquí con una pestaña vieja, lo honesto es decir que esto
   * no va por aquí y no inventarse una avería.
   */
  disabled: 'Ahora mismo no podemos cobrar la señal desde aquí. Te llamamos y lo cerramos contigo.',
  expired:
    'El precio que te dimos ya ha caducado. Llámanos y te lo actualizamos: tu pre-reserva sigue guardada.',
  closed: 'Esta pre-reserva ya está cerrada. Si crees que es un error, llámanos.',
  'no-amount': 'No hemos podido calcular la señal. Te llamamos y lo cerramos contigo.',
  'not-found': 'No encontramos esta pre-reserva. Llámanos con tu referencia delante.',
  error:
    'No hemos podido abrir el pago. Tu pre-reserva está hecha: inténtalo otra vez o espera a que te llamemos.',
};

export interface PreReserva {
  abrir: (datos: DatosPreReserva) => void;
}

export function montarPreReserva(): PreReserva | null {
  const dlg = document.getElementById('dlg') as HTMLDialogElement | null;
  const form = document.getElementById('dlg-form') as HTMLFormElement | null;
  const hecho = document.getElementById('dlg-hecho');
  const resumen = document.getElementById('dlg-resumen');
  const error = document.getElementById('dlg-error');
  const enviar = document.getElementById('dlg-enviar') as HTMLButtonElement | null;
  const ref = document.getElementById('dlg-ref');
  const horas = document.getElementById('dlg-horas');
  const garantia = document.getElementById('dlg-garantia');
  const presupuesto = document.getElementById('dlg-presupuesto');
  const correo = document.getElementById('dlg-correo');
  const pagar = document.getElementById('dlg-pagar') as HTMLButtonElement | null;
  const pagarTexto = document.getElementById('dlg-pagar-texto');
  const pagarError = document.getElementById('dlg-pagar-error');
  const llamada = document.getElementById('dlg-llamada');
  const gracias = document.getElementById('dlg-gracias');
  if (!dlg || !form || !hecho || !resumen || !error || !enviar || !ref) return null;

  let elegido: DatosPreReserva | null = null;

  /** El estado «ocupado» del botón de enviar, mientras hay petición en vuelo. */
  let ocupado: Ocupado | null = null;

  /*
   * ⚠️ **El nombre se capitaliza al escribir, con el cursor donde estaba.**
   * Es un nombre propio y lo que se teclea en un móvil llega casi siempre en
   * minúsculas —«dorel»—, y de aquí sale el nombre que Velto lee para llamar.
   * La regla es la misma del backoffice y de las functions, copiada en
   * `texto.ts` con su motivo.
   *
   * ⚠️ **Nunca `campo.value = …` a secas**: eso manda el cursor al final en
   * cada tecla y corregir una letra en medio se vuelve imposible.
   */
  const campoNombre = form.querySelector<HTMLInputElement>('input[name="name"]');
  campoNombre?.addEventListener('input', () =>
    transformarCampo(campoNombre, capitalizarNombre)
  );

  document.getElementById('dlg-cerrar')?.addEventListener('click', () => dlg.close());
  document.getElementById('dlg-ok')?.addEventListener('click', () => dlg.close());
  /*
   * ⚠️ **Aquí había un «Que me llaméis y ya decido» que CERRABA el diálogo, y
   * duró unas horas.** Cerrar desde la cara de «hecho» lleva a la portada —por
   * decisión de Dorel del 2 de octubre, para que nadie mande dos solicitudes
   * del mismo coche—, así que pulsarlo **borraba la referencia, el enlace al
   * presupuesto y el botón de pagar**. Lo probó Dorel el 19 de octubre: «me
   * llevó a la home y perdí la modal».
   *
   * ⚠️ **Y el arreglo NO era ponerle un `target`**, que es lo primero que
   * sugiere el síntoma. Los otros cuatro enlaces de esta pantalla —el
   * presupuesto, las cancelaciones y los dos de la pantalla de pago— ya abren
   * en otra pestaña y conservan el diálogo; comprobado uno a uno ese mismo día.
   * Éste no tenía a dónde ir: no es una acción, es una frase que dice que
   * pagar es opcional. Ahora es texto y no se puede pulsar.
   */

  /*
   * Pagar la señal: se pide el cobro y se manda a la pasarela.
   *
   * ⚠️ **El cobro se crea AL PULSAR, no al crear la pre-reserva.** Creándolo
   * antes, toda solicitud dejaría una fila de 50 € pendiente en la lista de
   * Pagos aunque nadie fuera a pagarla nunca — y la mayoría no va a pagar.
   * Esa lista es donde Dorel mira lo que falta por cobrar: llenarla de cobros
   * fantasma la inutiliza.
   *
   * ⚠️ **Y es idempotente por el lado del servidor**, que es donde tiene que
   * estar: la function resuelve en una transacción mirando `signalPaymentId`.
   * Un doble toque en un móvil no puede crear dos señales. Aquí lo único que
   * se hace es apagar el botón mientras va, que es cortesía y no seguridad.
   */
  pagar?.addEventListener('click', () => {
    const id = pagar.dataset.solicitud;
    if (!id) return;
    if (pagarError) pagarError.hidden = true;
    const ocupadoPago = ocupar(pagar, 'Abriendo el pago…');
    pagarSenal(id)
      .then((cobro) => {
        if (!cobro.payUrl) throw new Error('error');
        /*
         * ⚠️ **Misma pestaña, no una nueva.** Un pago que se abre en otra
         * pestaña deja la de atrás diciendo «pre-reserva hecha» con el botón
         * de pagar intacto: al volver, lo natural es pulsarlo otra vez. Y los
         * bloqueadores de ventanas emergentes se comen el `window.open()` de
         * un `then()`, porque ya no es un gesto del usuario — el pago se
         * quedaría sin abrir sin decir por qué.
         */
        location.assign(cobro.payUrl);
      })
      .catch((err: Error) => {
        ocupadoPago.libre();
        if (!pagarError) return;
        pagarError.textContent = MOTIVOS_SENAL[err.message] ?? MOTIVOS_SENAL['error'];
        pagarError.hidden = false;
      });
  });

  /*
   * ⚠️ **El presupuesto se abre en OTRA pestaña, y el `target` solo no basta.**
   * Sin él, pulsar se llevaba al visitante fuera de la web —a la URL de
   * Storage— y perdía el diálogo con su referencia: para volver a descargarlo
   * había que rehacer la pre-reserva. Lo contó Dorel el 2 de octubre de 2026.
   * Con pestaña aparte, esta se queda intacta y se puede bajar las veces que
   * haga falta, que es lo que él pidió.
   *
   * ⚠️ **Y el acuse de recibo va en un `setTimeout(…, 0)`.** Apagar el enlace
   * dentro del propio manejador le pone `pointer-events: none` antes de que el
   * navegador haya resuelto la navegación, y el riesgo es que no abra nada.
   * Cediendo un tick, la pestaña ya está en marcha.
   *
   * ⚠️ **Dice «Abriendo…» y dura un rato fijo, porque no hay nada que
   * esperar.** La descarga se la lleva otra pestaña y esta página no se entera
   * de cuándo termina: fingir una barra de progreso sería inventarse un dato.
   * Lo que resuelve es lo otro —que pulsar no cambiaba nada aquí y lo que se
   * hace entonces es volver a pulsar—.
   */
  presupuesto?.addEventListener('click', () => {
    setTimeout(() => ocuparUnRato(presupuesto, 1500, 'Abriendo…'), 0);
  });

  /**
   * ⚠️ **Cerrar con la pre-reserva ya hecha devuelve a la portada.** Quedándose
   * en la ficha, lo que el visitante tiene delante es el mismo calendario
   * marcado y el mismo botón de reservar: la salida más natural es pulsarlo
   * otra vez y mandar una segunda solicitud del mismo coche, que es trabajo
   * para el operador y una llamada incómoda. Lo pidió Dorel el 2 de octubre de
   * 2026: «si me quedo aquí, el cliente puede volver a intentarlo».
   *
   * ⚠️ **Cuelga del evento `close` y no del botón, y ese es el punto.** Un
   * `<dialog>` se cierra por tres sitios —el botón, la × de la cabecera y la
   * tecla Escape—, así que atándolo al botón quedaban dos puertas por las que
   * salir a la misma ficha. El evento es el único sitio por el que pasan las
   * tres.
   *
   * ⚠️ **Y solo desde la cara de «hecho».** Cerrando el formulario sin enviarlo
   * no ha pasado nada: echar de la ficha a quien se lo está pensando sería
   * perder la venta por un diálogo que abrió por curiosidad. Lo distingue
   * `hecho.hidden`, que es el mismo estado que pinta la pantalla.
   *
   * ⚠️ **Va a la portada SIN búsqueda** (`/`, sin `?from=`). Volver a los
   * resultados con las mismas fechas es volver a ofrecer el coche que acaba de
   * pedir.
   */
  dlg.addEventListener('close', () => {
    if (!hecho!.hidden) location.assign('/');
  });

  function abrir(datos: DatosPreReserva): void {
    elegido = datos;
    resumen!.textContent = datos.resumen;
    error!.hidden = true;
    if (horas && datos.horasGarantia) {
      horas.textContent = datos.horasGarantia === 1 ? '1 hora' : `${datos.horasGarantia} horas`;
    }
    /*
     * ⚠️ **Se vuelve a la cara del formulario en cada apertura.** Sin esto,
     * quien hace una pre-reserva y abre otra se encuentra la pantalla de
     * «hecho» de la anterior, con la referencia de un coche que ya no es el
     * que está mirando.
     */
    form!.hidden = false;
    hecho!.hidden = true;
    form!.reset();
    // Por si se reabre con una petición a medias: no puede pasar —el diálogo
    // es modal y el botón está apagado—, pero el estado se repone igual.
    ocupado?.libre();
    ocupado = null;
    dlg!.showModal();
    // El escalon donde se pierde gente: ya tiene el precio delante.
    medirHito('cotizacion');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!elegido) return;

    error.hidden = true;
    /*
     * ⚠️ **Apagado, con rueda y diciendo qué hace.** El botón ya se apagaba
     * —tres clics seguidos dan una sola petición, medido— pero no lo parecía:
     * sin regla `:disabled` en `.btn` seguía con su turquesa y su cursor de
     * mano. Y entre pulsar y la respuesta pasan segundos: la function escribe
     * la solicitud, genera el presupuesto y manda dos correos.
     */
    ocupado = ocupar(enviar, 'Reservando…');

    const datos = new FormData(form);
    solicitar({
      vehicleId: elegido.vehicleId,
      from: elegido.desde,
      to: elegido.hasta,
      name: String(datos.get('name') || ''),
      phone: String(datos.get('phone') || ''),
      note: String(datos.get('note') || ''),
      email: String(datos.get('email') || ''),
      place: elegido.lugar ?? '',
      trap: String(datos.get('trap') || ''),
    })
      .then((r) => {
        ocupado?.libre();
        ocupado = null;
        ref.textContent = r.reference;
        if (garantia) garantia.textContent = hastaCuando(r.priceGuaranteedUntil);

        /*
         * ⚠️ **El botón del presupuesto solo si hay presupuesto.** El PDF se
         * genera después de escribir la solicitud y no puede tumbarla: si
         * falla, la pre-reserva existe igual y lo que falta es el papel. Un
         * botón que no lleva a ninguna parte es peor que no ofrecerlo.
         */
        if (presupuesto) {
          const url = r.quoteUrl ?? '';
          presupuesto.hidden = !url;
          if (url) presupuesto.setAttribute('href', url);
        }

        /*
         * ⚠️ **Y solo se dice «te lo hemos mandado» si de verdad se mandó.**
         * El correo es opcional: anunciarlo siempre dejaría a quien no lo
         * puso esperando un mensaje que no llega.
         */
        if (correo) {
          const dicho = String(datos.get('email') || '').trim();
          correo.hidden = !(r.emailed && dicho);
          if (!correo.hidden) correo.textContent = `También te lo hemos mandado a ${dicho}.`;
        }

        /*
         * ⚠️ **Lo enciende la RESPUESTA, nunca el bundle.** `web/dist` se
         * construye igual para los dos entornos, así que esta pantalla no
         * puede saber sola dónde está sirviendo; lo contesta la function
         * leyendo `functions/.env.<proyecto>`. Hoy producción lo tiene
         * apagado.
         *
         * ⚠️ **Y se exigen las TRES cosas**: que el entorno lo ofrezca, que
         * haya importe y que haya llave. Un botón de pagar sin llave manda al
         * cliente a un error después de haberle prometido que cerraba la
         * reserva — y encima pensando que el problema es suyo.
         */
        const senal = r.signal;
        const ofrecerPago = !!(senal && senal.enabled && senal.amount > 0 && senal.id);
        if (pagar) {
          pagar.hidden = !ofrecerPago;
          if (ofrecerPago && pagarTexto) {
            pagarTexto.textContent = `Pagar la señal · ${euros(senal!.amount)}`;
          }
          if (ofrecerPago) pagar.dataset.solicitud = senal!.id;
        }
        if (llamada) llamada.hidden = !ofrecerPago;

        /*
         * ⚠️ **La frase de las gracias cambia con el botón**, y las dos
         * redacciones son las mismas que las del correo al cliente. Dejarla
         * fija ponía «te contactaremos» justo encima de un botón de pagar:
         * dos instrucciones a la vez, y la salida cómoda es no hacer nada.
         *
         * ⚠️ **La llamada se sigue prometiendo en los dos casos.** Pagar no
         * puede parecer obligatorio: lo que se ofrece es adelantarlo.
         */
        if (gracias && ofrecerPago) {
          gracias.textContent =
            'Gracias. Puedes cerrarla ya pagando la señal, o esperar a que te llamemos.';
        }

        /*
         * ⚠️ **Dos botones turquesa son ninguno.** Con el pago ofrecido, el
         * presupuesto baja a secundario: lo que esta pantalla quiere que pase
         * es que se cierre la reserva, y descargar un PDF es la alternativa.
         * Sin pago, recupera el color — o la pantalla se quedaría sin ninguna
         * acción destacada y quien no dejó correo se iría sin nada escrito.
         */
        presupuesto?.classList.toggle('btn--brand', !ofrecerPago);
        presupuesto?.classList.toggle('btn--ghost', ofrecerPago);

        form.hidden = true;
        hecho.hidden = false;
      })
      .catch((err: Error) => {
        ocupado?.libre();
        ocupado = null;
        error.textContent =
          MOTIVOS[err.message] ??
          'No hemos podido enviarlo. Inténtalo otra vez o escríbenos por WhatsApp.';
        error.hidden = false;
      });
  });

  return { abrir };
}
