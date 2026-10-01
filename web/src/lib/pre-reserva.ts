/**
 * La lógica del diálogo de pre-reserva, compartida por la página de resultados
 * y la ficha de cada coche.
 *
 * ⚠️ **Separada del marcado por lo mismo que el buscador**: son dos páginas y
 * tiene que comportarse igual en las dos. Lo que cambia entre ellas es de
 * dónde salen el coche y las fechas; lo que pasa al pulsar «Enviar», no.
 */

import { solicitar } from './api';

export interface DatosPreReserva {
  vehicleId: string;
  /** «Citroën Berlingo · 3 días · 250,95 €» — lo que el visitante acaba de elegir. */
  resumen: string;
  /** `yyyy-MM-ddTHH:mm`, en hora local. */
  desde: string;
  hasta: string;
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
  if (!dlg || !form || !hecho || !resumen || !error || !enviar || !ref) return null;

  let elegido: DatosPreReserva | null = null;

  document.getElementById('dlg-cerrar')?.addEventListener('click', () => dlg.close());
  document.getElementById('dlg-ok')?.addEventListener('click', () => dlg.close());

  function abrir(datos: DatosPreReserva): void {
    elegido = datos;
    resumen!.textContent = datos.resumen;
    error!.hidden = true;
    /*
     * ⚠️ **Se vuelve a la cara del formulario en cada apertura.** Sin esto,
     * quien hace una pre-reserva y abre otra se encuentra la pantalla de
     * «hecho» de la anterior, con la referencia de un coche que ya no es el
     * que está mirando.
     */
    form!.hidden = false;
    hecho!.hidden = true;
    form!.reset();
    enviar!.disabled = false;
    enviar!.textContent = 'Enviar';
    dlg!.showModal();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!elegido) return;

    error.hidden = true;
    enviar.disabled = true;
    enviar.textContent = 'Enviando…';

    const datos = new FormData(form);
    solicitar({
      vehicleId: elegido.vehicleId,
      from: elegido.desde,
      to: elegido.hasta,
      name: String(datos.get('name') || ''),
      phone: String(datos.get('phone') || ''),
      note: String(datos.get('note') || ''),
      trap: String(datos.get('trap') || ''),
    })
      .then((r) => {
        ref.textContent = r.reference;
        form.hidden = true;
        hecho.hidden = false;
      })
      .catch((err: Error) => {
        enviar.disabled = false;
        enviar.textContent = 'Enviar';
        error.textContent =
          MOTIVOS[err.message] ??
          'No hemos podido enviarlo. Inténtalo otra vez o escríbenos por WhatsApp.';
        error.hidden = false;
      });
  });

  return { abrir };
}
