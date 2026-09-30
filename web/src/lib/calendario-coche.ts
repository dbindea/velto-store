/**
 * Elegir un rango de días en el calendario de un coche, con los días ocupados
 * delante.
 *
 * ⚠️ **Aparte de la pantalla y con tests, por lo mismo que el QR del contrato
 * y el aspa: un calendario mal calculado tiene exactamente la misma pinta que
 * uno bueno.** Aquí lo que se puede romper en silencio es peor que un dibujo
 * feo: ofrecer un día que está ocupado, o dejar elegir un rango que salta por
 * encima de una reserva. Las dos cosas terminan en un cliente que se planta a
 * por un coche que no está.
 *
 * ⚠️ **La cuenta de días es la del BUSCADOR, no la de un hotel.** Del 1 al 4
 * son **cuatro** días, no tres: el coche está fuera los días 1, 2, 3 y 4, y es
 * lo que contesta `/api/availability` después de ensanchar la ventana a días
 * completos. Si aquí se contara distinto, la ficha diría un número y la página
 * de resultados otro para la misma selección.
 */

/** `yyyy-MM-dd` en hora LOCAL. Nunca `toISOString()`, que pasa a UTC. */
export function diaIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * `yyyy-MM-dd` → fecha **local**.
 *
 * ⚠️ **`new Date('2026-10-10')` NO vale**, y es el fallo clásico de todo
 * calendario: esa cadena se interpreta como medianoche **UTC**, así que en
 * cualquier huso al oeste de Greenwich sale el día anterior. Aquí no se
 * notaría —España va por delante— hasta que alguien abra la web desde Canarias
 * en invierno o desde América, y entonces el horizonte se corre un día.
 */
export function parseDiaIso(valor: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export interface Rango {
  desde: Date | null;
  hasta: Date | null;
}

export const RANGO_VACIO: Rango = { desde: null, hasta: null };

/** Días de alquiler de una selección de calendario: del 1 al 4 son cuatro. */
export function diasDelRango(desde: Date, hasta: Date): number {
  const a = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate()).getTime();
  const b = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate()).getTime();
  if (b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** ¿Hay algún día ocupado entre estos dos, ambos incluidos? */
export function hayOcupadoEntre(desde: Date, hasta: Date, ocupados: Set<string>): boolean {
  const total = diasDelRango(desde, hasta);
  for (let i = 0; i < total; i++) {
    const dia = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + i);
    if (ocupados.has(diaIso(dia))) return true;
  }
  return false;
}

/**
 * Qué pasa al pulsar un día.
 *
 * Las cuatro situaciones, y cada una tiene su motivo:
 *
 * 1. **No hay nada elegido** → empieza el rango.
 * 2. **Hay recogida y se pulsa un día posterior sin ocupados en medio** → se
 *    cierra el rango.
 * 3. **Se pulsa un día ANTERIOR a la recogida** → se empieza de nuevo ahí. Es
 *    lo que la gente espera: corregir la primera fecha, no que no pase nada.
 * 4. ⚠️ **Se pulsa un día posterior pero hay una reserva en medio** → se
 *    empieza de nuevo en ese día. **No se acepta el rango saltándose la
 *    reserva**, que es el fallo que este módulo existe para impedir: la
 *    selección se vería perfecta y el coche está alquilado en medio.
 *
 * ⚠️ **Y un rango ya cerrado vuelve a empezar.** Con el rango completo, el
 * siguiente clic es «quiero otras fechas»; extenderlo obligaría a adivinar por
 * cuál de los dos extremos.
 */
export function elegirDia(rango: Rango, dia: Date, ocupados: Set<string>): Rango {
  if (ocupados.has(diaIso(dia))) return rango;

  const empezar = { desde: dia, hasta: null };
  if (!rango.desde || rango.hasta) return empezar;
  if (dia < rango.desde) return empezar;
  if (hayOcupadoEntre(rango.desde, dia, ocupados)) return empezar;
  return { desde: rango.desde, hasta: dia };
}

/**
 * Qué se está señalando mientras se mueve el ratón sobre el calendario.
 *
 * ⚠️ **No es adorno: es lo que dice si el rango se va a poder cerrar.** Sin
 * previsualización, el visitante pulsa un día del otro lado de una reserva y
 * la selección se le reinicia sin explicación — parece que el calendario no
 * funciona. Con la previsualización ve que el tramo se corta.
 */
export function previsualizar(rango: Rango, dia: Date | null, ocupados: Set<string>): Rango {
  if (!rango.desde || rango.hasta || !dia) return rango;
  if (dia <= rango.desde) return rango;
  if (hayOcupadoEntre(rango.desde, dia, ocupados)) return rango;
  return { desde: rango.desde, hasta: dia };
}

export type EstadoDia = 'libre' | 'ocupado' | 'pasado' | 'fuera-de-horizonte';

/**
 * En qué estado está un día.
 *
 * ⚠️ **«Fuera de horizonte» NO es «libre».** El backend mira 180 días; más
 * allá no ha comprobado nada, y un día en blanco se lee como disponible. Es la
 * misma regla que gobierna toda la web pública: ante la duda, no publicar.
 */
export function estadoDelDia(
  dia: Date,
  ocupados: Set<string>,
  hoy: Date,
  horizonte: Date | null
): EstadoDia {
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (dia < inicioHoy) return 'pasado';
  if (horizonte && dia > horizonte) return 'fuera-de-horizonte';
  return ocupados.has(diaIso(dia)) ? 'ocupado' : 'libre';
}

/** Dónde cae un día respecto al rango elegido, para pintarlo. */
export type PosicionEnRango = 'fuera' | 'inicio' | 'medio' | 'fin' | 'unico';

export function posicionEnRango(dia: Date, rango: Rango): PosicionEnRango {
  if (!rango.desde) return 'fuera';
  const iso = diaIso(dia);
  const desde = diaIso(rango.desde);
  const hasta = rango.hasta ? diaIso(rango.hasta) : desde;
  if (iso < desde || iso > hasta) return 'fuera';
  if (desde === hasta) return 'unico';
  if (iso === desde) return 'inicio';
  if (iso === hasta) return 'fin';
  return 'medio';
}

/**
 * La hora con la que se sale de aquí hacia el buscador.
 *
 * ⚠️ **Las 10:00, la de apertura, y es la misma que usa el resto de la web.**
 * El calendario de la ficha elige DÍAS —es lo que se puede publicar sin decir
 * a qué hora devuelve el coche un cliente concreto—, así que la hora la pone
 * quien recoge, hablando. Poner 00:00 mandaría al buscador una recogida de
 * madrugada, que es justo lo que ya se corrigió en las solicitudes de la web.
 */
export const HORA_RECOGIDA = 10;

export function comoCampo(dia: Date, hora = HORA_RECOGIDA): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dia.getFullYear()}-${p(dia.getMonth() + 1)}-${p(dia.getDate())}T${p(hora)}:00`;
}
