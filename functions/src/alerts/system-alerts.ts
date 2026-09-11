/**
 * Los avisos que no salen de una reserva: el certificado que caduca y la
 * remisión a la AEAT que se ha quedado atascada.
 *
 * ⚠️ **Van en el correo diario y no en una pantalla.** Los dos comparten una
 * propiedad incómoda: *no se notan*. Un certificado caducado no rompe nada
 * visible hasta que hay que remitir una factura, y una factura emitida y nunca
 * remitida se queda callada mientras el plazo corre. Lo que hace falta es que
 * te lleguen sin que nadie entre a mirar.
 *
 * ⚠️ **Y por eso estos avisos SÍ obligan a mandar el correo**, aunque no haya
 * entregas ni devoluciones. La regla de «si no hay nada, no se manda» vale para
 * el trabajo del día; un certificado que caduca en quince días no es trabajo del
 * día, es algo que hay que saber aunque mañana no haya ni un coche que entregar.
 */

import { Remision, remisionBloqueada } from '../invoices/verifactu-submission';

export interface AvisoSistema {
  clase: 'certificado' | 'remision';
  /** El texto que se lee en el correo. */
  texto: string;
  /**
   * `true` cuando hay algo parado **ahora**: el certificado ya caducó o está a
   * punto, o la cadena de facturación está bloqueada. Sale en el asunto.
   */
  urgente: boolean;
}

// ---------------------------------------------------------------------------
// El certificado de la FNMT
// ---------------------------------------------------------------------------

/**
 * Los días a los que se avisa, además de todos los días desde una semana antes.
 *
 * ⚠️ **No se avisa los sesenta días seguidos.** Un correo que repite lo mismo
 * dos meses se deja de leer, y con él se deja de leer el que traía las entregas
 * de mañana. Se avisa al cruzar cada umbral —hay tiempo de sobra para pedir la
 * renovación— y a partir de una semana, todos los días, porque ahí ya no lo es.
 */
export const UMBRALES_CERTIFICADO = [60, 30, 15];

/** Desde aquí, todos los días. */
export const DIAS_AVISO_DIARIO = 7;

/**
 * ⚠️ **Renovar un certificado de representante de la FNMT no es inmediato**:
 * hay que solicitarlo, acreditar la representación y descargarlo. Sesenta días
 * es margen para hacerlo sin prisa; siete, para hacerlo corriendo.
 *
 * Y cuando llegue, hay que volver a subirlo como secreto en **los dos
 * proyectos** y redesplegar las functions que lo declaran. El procedimiento está
 * en `docs/copias-de-seguridad.md`, junto al resto de lo que no se puede
 * improvisar.
 */
export function avisoCertificado(diasParaCaducar: number | undefined): AvisoSistema | null {
  if (diasParaCaducar === undefined || !Number.isFinite(diasParaCaducar)) return null;

  if (diasParaCaducar < 0) {
    return {
      clase: 'certificado',
      urgente: true,
      texto:
        `El certificado de la FNMT CADUCÓ hace ${Math.abs(diasParaCaducar)} ` +
        `${Math.abs(diasParaCaducar) === 1 ? 'día' : 'días'}. ` +
        'No se puede remitir ninguna factura a la AEAT hasta que se renueve.'
    };
  }

  const toca = UMBRALES_CERTIFICADO.includes(diasParaCaducar) || diasParaCaducar <= DIAS_AVISO_DIARIO;
  if (!toca) return null;

  return {
    clase: 'certificado',
    urgente: diasParaCaducar <= DIAS_AVISO_DIARIO,
    texto:
      `El certificado de la FNMT caduca en ${diasParaCaducar} ` +
      `${diasParaCaducar === 1 ? 'día' : 'días'}. ` +
      'Al renovarlo hay que subirlo como secreto en los dos proyectos y redesplegar.'
  };
}

// ---------------------------------------------------------------------------
// La remisión a la AEAT
// ---------------------------------------------------------------------------

/**
 * Cuántos intentos fallidos hacen falta para dar una fila por atascada.
 *
 * El barrido corre **cada cinco minutos**, así que doce intentos son cerca de
 * una hora sin conseguirlo. Por debajo de eso no hay nada que contar: un error
 * de red que se arregla solo en el siguiente barrido no es un incidente, y
 * avisar de él enseña a ignorar el aviso.
 */
export const INTENTOS_PARA_ATASCO = 12;

/**
 * ⚠️ **Una factura emitida y nunca remitida es peor que una remitida tarde.**
 * Tarde se ve y se arregla; nunca se queda callada mientras el plazo corre, y la
 * factura ya no se puede editar. Esto es lo único que lo convierte en algo que
 * alguien mira.
 *
 * Un **rechazo** es urgente aunque sea uno solo: para la cadena entera, porque
 * todo lo que venga detrás encadena con su huella. Lo desbloquea una persona.
 */
export function avisoRemision(remisiones: Remision[]): AvisoSistema | null {
  const bloqueada = remisionBloqueada(remisiones);
  if (bloqueada) {
    return {
      clase: 'remision',
      urgente: true,
      texto:
        `La AEAT rechazó la factura ${bloqueada.fullNumber}. La cadena está PARADA: ` +
        'ninguna factura posterior se remitirá hasta que se resuelva y se reencole.'
    };
  }

  const atascadas = remisiones.filter(
    (r) => r.estado !== 'aceptado' && r.intentos >= INTENTOS_PARA_ATASCO
  );
  if (!atascadas.length) return null;

  const numeros = atascadas
    .sort((a, b) => a.chainIndex - b.chainIndex)
    .map((r) => r.fullNumber)
    .slice(0, 5)
    .join(', ');

  return {
    clase: 'remision',
    urgente: false,
    texto:
      `${atascadas.length} ${atascadas.length === 1 ? 'factura lleva' : 'facturas llevan'} ` +
      `más de ${INTENTOS_PARA_ATASCO} intentos sin llegar a la AEAT: ${numeros}` +
      (atascadas.length > 5 ? '…' : '') +
      '. Comprueba la conexión y el certificado.'
  };
}

/** Los dos juntos, en el orden en que hay que leerlos. */
export function avisosDelSistema(
  diasParaCaducar: number | undefined,
  remisiones: Remision[]
): AvisoSistema[] {
  return [avisoRemision(remisiones), avisoCertificado(diasParaCaducar)].filter(
    (a): a is AvisoSistema => a !== null
  );
}
