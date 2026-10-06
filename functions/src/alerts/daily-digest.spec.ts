import { describe, expect, it } from 'vitest';
import {
  asuntoDe,
  entraEnElResumen,
  horaEn,
  mereceEnvio,
  rangoManana,
  type Resumen
} from './daily-digest';
import {
  ESTADOS_BORRABLES,
  HORAS_SIN_CONTESTAR,
  consultaCaducada,
  solicitudCaducada
} from './sendDailyDigest';

const TZ = 'Europe/Madrid';

/** Un instante UTC a partir de una hora de Madrid, para que las pruebas se lean. */
const madrid = (iso: string) => new Date(iso);

describe('el día de mañana, en Madrid y no en UTC', () => {
  /**
   * ⚠️ **La prueba que da sentido a todo esto.** Las Cloud Functions arrancan en
   * UTC, y en verano Madrid va dos horas por delante: el día de mañana empieza a
   * las 22:00 UTC de hoy. Con un rango calculado en UTC, una entrega temprana no
   * saldría en el correo de nadie.
   */
  it('en verano el día empieza a las 22:00 UTC del día anterior', () => {
    // 10 de septiembre, 20:00 en Madrid = 18:00 UTC. Mañana es el 11.
    const r = rangoManana(madrid('2026-09-10T18:00:00Z'), TZ);
    expect(r.etiqueta).toBe('11/09/2026');
    expect(r.desde.toISOString()).toBe('2026-09-10T22:00:00.000Z');
    expect(r.hasta.toISOString()).toBe('2026-09-11T22:00:00.000Z');
  });

  it('en invierno empieza a las 23:00 UTC, porque el desfase es otro', () => {
    // 10 de diciembre, 20:00 en Madrid = 19:00 UTC.
    const r = rangoManana(madrid('2026-12-10T19:00:00Z'), TZ);
    expect(r.etiqueta).toBe('11/12/2026');
    expect(r.desde.toISOString()).toBe('2026-12-10T23:00:00.000Z');
    expect(r.hasta.toISOString()).toBe('2026-12-11T23:00:00.000Z');
  });

  /**
   * ⚠️ El desfase depende del instante y el instante es lo que se busca, así que
   * el cálculo se hace dos veces. Los dos domingos del año en que cambia la hora
   * son los únicos en que la primera respuesta cae al otro lado del cambio.
   */
  it('la víspera del cambio de hora de octubre dura 25 horas', () => {
    // En 2026 el cambio a horario de invierno es el domingo 25 de octubre.
    const r = rangoManana(madrid('2026-10-24T18:00:00Z'), TZ);
    expect(r.etiqueta).toBe('25/10/2026');
    const horas = (r.hasta.getTime() - r.desde.getTime()) / 3_600_000;
    expect(horas).toBe(25);
  });

  it('y la de marzo dura 23', () => {
    // El cambio a horario de verano es el domingo 29 de marzo de 2026.
    const r = rangoManana(madrid('2026-03-28T19:00:00Z'), TZ);
    expect(r.etiqueta).toBe('29/03/2026');
    const horas = (r.hasta.getTime() - r.desde.getTime()) / 3_600_000;
    expect(horas).toBe(23);
  });

  it('el último día del mes, mañana es el primero del siguiente', () => {
    expect(rangoManana(madrid('2026-01-31T19:00:00Z'), TZ).etiqueta).toBe('01/02/2026');
  });

  it('y en Nochevieja, el 1 de enero del año que viene', () => {
    expect(rangoManana(madrid('2026-12-31T19:00:00Z'), TZ).etiqueta).toBe('01/01/2027');
  });

  /**
   * ⚠️ Se manda a las 9:00 de Madrid, que en UTC son las 07:00 en verano y las
   * 08:00 en invierno. En las dos, «mañana» tiene que ser el mismo día.
   */
  it('a las 9:00 de Madrid, mañana es mañana en las dos épocas del año', () => {
    expect(rangoManana(madrid('2026-07-15T07:00:00Z'), TZ).etiqueta).toBe('16/07/2026');
    expect(rangoManana(madrid('2026-01-15T08:00:00Z'), TZ).etiqueta).toBe('16/01/2026');
  });

  it('la hora se pinta en la del negocio, no en UTC', () => {
    expect(horaEn(madrid('2026-09-11T07:00:00Z'), TZ)).toBe('09:00');
    expect(horaEn(madrid('2026-12-11T08:00:00Z'), TZ)).toBe('09:00');
  });
});

const vacio: Resumen = {
  fecha: '11/09/2026',
  entregas: [],
  devoluciones: [],
  vencimientos: [],
  sinContestar: [],
  sinFirmar: 0,
  avisos: []
};

const entrega = (contratoSinFirmar = false) => ({
  reservationId: 'r1',
  hora: '09:00',
  cliente: 'Cliente Pruebas',
  vehiculo: 'Kia Ceed · 7777ATM',
  contratoSinFirmar
});

const sinContestar = (horasRestantes = 48) => ({
  referencia: 'SOL-2026-0007',
  cliente: 'Cliente Pruebas',
  telefono: '600 11 22 33',
  coche: 'Kia Ceed',
  horasRestantes
});

/**
 * ⚠️ **Treinta correos iguales entrenan a saltarse la sección.** Un vencimiento
 * a 30 días salía cada día desde que se abría la ventana, y el día que de verdad
 * urgía se leía por encima como los veintinueve anteriores. Lo dijo Dorel el 6
 * de octubre de 2026.
 */
describe('qué días sale un vencimiento en el resumen', () => {
  const ANTICIPACION = 30;

  it('el día que se abre el plazo, que es cuando da tiempo a pedir cita', () => {
    expect(entraEnElResumen(30, ANTICIPACION)).toBe(true);
  });

  it('el día antes, que es la última oportunidad de moverlo', () => {
    expect(entraEnElResumen(1, ANTICIPACION)).toBe(true);
  });

  it('y el mismo día, porque a partir de mañana el coche no circula', () => {
    expect(entraEnElResumen(0, ANTICIPACION)).toBe(true);
  });

  /**
   * ⚠️ **Lo vencido no es un recordatorio: es un coche que la aplicación está
   * rechazando.** Callarlo escondería justo lo que está costando alquileres, y
   * es la misma regla que ya aplica la pantalla de Eventos.
   */
  it('lo ya vencido sale SIEMPRE, se lleve lo que se lleve vencido', () => {
    expect(entraEnElResumen(-1, ANTICIPACION)).toBe(true);
    expect(entraEnElResumen(-90, ANTICIPACION)).toBe(true);
  });

  it('y los días de en medio NO: ahí no hay nada nuevo que contar', () => {
    for (const d of [2, 5, 14, 29]) {
      expect(entraEnElResumen(d, ANTICIPACION)).toBe(false);
    }
  });

  /** La anticipación es un parámetro: con 14, el aviso de apertura cae en el 14. */
  it('sigue a la anticipación que se le pase, no a un 30 escrito a mano', () => {
    expect(entraEnElResumen(14, 14)).toBe(true);
    expect(entraEnElResumen(30, 14)).toBe(false);
  });
});

describe('cuándo se manda y cuándo se calla', () => {
  /**
   * ⚠️ **Un correo diario que casi siempre dice «nada» se acaba filtrando**, y
   * con él se filtra el que sí importaba. El silencio es la señal.
   */
  it('un día sin nada NO genera correo', () => {
    expect(mereceEnvio(vacio)).toBe(false);
  });

  it('una sola entrega ya lo justifica', () => {
    expect(mereceEnvio({ ...vacio, entregas: [entrega()] })).toBe(true);
  });

  it('y un vencimiento solo, también: no hace falta que haya movimiento', () => {
    expect(
      mereceEnvio({
        ...vacio,
        vencimientos: [
          { vehiculo: '0951LTL', concepto: 'ITV', fecha: '17/09/2026', diasRestantes: 7, bloquea: true }
        ]
      })
    ).toBe(true);
  });

  /**
   * ⚠️ **Lo que este test protege es lo que hace útil el aviso.** El certificado
   * que caduca y la cadena de facturación parada no se notan en ninguna
   * pantalla: el correo es el único sitio donde salen. Si se callaran los días
   * en que no hay entregas, el día que hicieran falta tampoco habría correo — y
   * un certificado no espera a que mañana haya trabajo.
   */
  it('un aviso del sistema manda el correo aunque mañana no haya nada', () => {
    expect(
      mereceEnvio({
        ...vacio,
        avisos: [{ clase: 'certificado', texto: 'Caduca en 30 días', urgente: false }]
      })
    ).toBe(true);
  });

  /**
   * ⚠️ **Esta línea es lo que hace defendible borrar una solicitud sin
   * contestar.** Detrás de ella viene un borrado a las 72 h: si un día sin
   * entregas ni devoluciones se callara, las tres oportunidades de avisar se
   * gastarían en silencio y la solicitud se iría sin que nadie la hubiera
   * visto. Es el mismo motivo por el que un aviso de sistema obliga a mandarlo.
   */
  it('una solicitud sin contestar manda el correo aunque mañana no haya nada', () => {
    expect(mereceEnvio({ ...vacio, sinContestar: [sinContestar()] })).toBe(true);
  });
});

describe('el asunto, que es lo único que se lee sin abrir', () => {
  /**
   * ⚠️ **Lo que urge va delante.** Sin contrato firmado no se puede entregar el
   * coche, y enterarse por la mañana deja sin margen para llamar al cliente.
   */
  it('un contrato sin firmar manda sobre todo lo demás', () => {
    const s = asuntoDe(
      { ...vacio, entregas: [entrega(true), entrega()], sinFirmar: 1 },
      'VELTO MOBILITY'
    );
    expect(s).toBe('VELTO MOBILITY · Mañana 11/09/2026: 1 SIN FIRMAR · 2 entregas');
  });

  it('sin nada urgente, cuenta el día', () => {
    const s = asuntoDe(
      { ...vacio, entregas: [entrega()], devoluciones: [entrega(), entrega()] },
      'VELTO MOBILITY'
    );
    expect(s).toBe('VELTO MOBILITY · Mañana 11/09/2026: 1 entrega · 2 devoluciones');
  });

  /** Un vencimiento pasado y uno futuro no son la misma noticia. */
  it('distingue lo ya vencido de lo que está por vencer', () => {
    const porVencer = asuntoDe(
      {
        ...vacio,
        vencimientos: [{ vehiculo: '0951LTL', concepto: 'ITV', fecha: '17/09/2026', diasRestantes: 7, bloquea: true }]
      },
      'VELTO'
    );
    expect(porVencer).toContain('1 por vencer');

    const vencido = asuntoDe(
      {
        ...vacio,
        vencimientos: [{ vehiculo: '0951LTL', concepto: 'ITV', fecha: '01/09/2026', diasRestantes: -9, bloquea: true }]
      },
      'VELTO'
    );
    expect(vencido).toContain('1 vencido');
  });

  /**
   * Un aviso urgente gana incluso al contrato sin firmar: ese se resuelve esa
   * mañana con una llamada, y una cadena de facturación parada no.
   */
  it('lo urgente del sistema va el primero de todo', () => {
    const s = asuntoDe(
      {
        ...vacio,
        entregas: [entrega(true)],
        sinFirmar: 1,
        avisos: [{ clase: 'remision', texto: 'Cadena parada', urgente: true }]
      },
      'VELTO'
    );
    expect(s).toBe('VELTO · Mañana 11/09/2026: ⚠️ REVISAR · 1 SIN FIRMAR · 1 entrega');
  });

  /**
   * ⚠️ Sin esto, un aviso no urgente en un día tranquilo dejaba el asunto
   * terminado en dos puntos —«Mañana 11/09/2026: »—: el correo llegaba y el
   * asunto no decía de qué, que es lo único que se lee sin abrirlo.
   */
  /**
   * ⚠️ **La última vuelta sale en el ASUNTO, no solo dentro.** Es la última
   * oportunidad de llamar antes de que el barrido se la lleve: metida solo en
   * el cuerpo, quien no abra el correo esa mañana la pierde — y justo ese es el
   * lector al que este aviso tiene que alcanzar.
   */
  it('las que se van hoy salen en el asunto', () => {
    const s = asuntoDe({ ...vacio, sinContestar: [sinContestar(12), sinContestar(60)] }, 'VELTO');
    expect(s).toContain('1 sin contestar · ÚLTIMO DÍA');
  });

  /**
   * Y las que todavía tienen margen no gritan: con tres días por delante, un
   * «ÚLTIMO DÍA» en el asunto es la clase de aviso que se deja de creer.
   */
  it('las que aún tienen margen se cuentan, sin alarma', () => {
    const s = asuntoDe({ ...vacio, sinContestar: [sinContestar(60)] }, 'VELTO');
    expect(s).toBe('VELTO · Mañana 11/09/2026: 1 sin contestar');
    expect(s).not.toContain('ÚLTIMO DÍA');
  });

  it('un aviso tranquilo y un día vacío no dejan el asunto cojo', () => {
    const s = asuntoDe(
      { ...vacio, avisos: [{ clase: 'certificado', texto: 'Caduca en 30 días', urgente: false }] },
      'VELTO'
    );
    expect(s).toBe('VELTO · Mañana 11/09/2026: 1 aviso');
  });
});

/**
 * ⚠️ **Lo que estos tests protegen es un BORRADO.** `limpiarSolicitudesCaducadas`
 * corre a las nueve de la mañana, sin nadie delante, y se lleva el nombre y el
 * teléfono de un cliente potencial para siempre. Hasta el 29 de septiembre de
 * 2026 no tenía ni uno: lo único que impedía que arrasara con el trabajo
 * pendiente era un `where('status','in',…)` que nadie comprobaba.
 */
describe('qué solicitudes se borran solas', () => {
  const ahora = new Date('2026-09-29T09:00:00Z');
  const hace = (horas: number) => new Date(ahora.getTime() - horas * 3_600_000);

  /**
   * ⚠️ **`new` SÍ entra desde el 5 de octubre de 2026, y es una REVERSIÓN — por
   * eso está escrita.** Hasta ese día el invariante era el contrario: una
   * solicitud sin atender es trabajo pendiente, así que borrarla por antigüedad
   * hacía desaparecer el viernes a las 23:40 lo que nadie había podido leer.
   *
   * Lo revocó Dorel: *«Para las pre-reservas que no han sido respondido de
   * ninguna manera en los 3 días (72h) se borran igual con el barrido del día
   * que le toque»*. Y lo que lo hace sostenible es que el plazo es **otro** —72
   * h, no las 24 del resto— y que ahora **se avisa**: el resumen diario las
   * nombra una por una con lo que les queda, y las del último día salen hasta en
   * el asunto. Sin ese aviso esto volvería a ser un borrado silencioso.
   */
  it('`new` entra, con su plazo propio de 72 h', () => {
    expect([...ESTADOS_BORRABLES]).toEqual(['new', 'contacted', 'discarded', 'converted']);
    expect(HORAS_SIN_CONTESTAR).toBe(72);
  });

  /**
   * ⚠️ **Una sin contestar NO mira `keepHours`**, y eso es lo que separa los dos
   * plazos. Ese campo lo congela el operador **al atender** y vale 24 h; si una
   * `new` lo tuviera puesto —por un ajuste futuro, o por un documento viejo—,
   * leerlo le recortaría el plazo a un día justo a la que nadie ha visto.
   */
  it('sin contestar se cuenta desde `createdAt` y a las 72 h, pase lo que pase en `keepHours`', () => {
    expect(solicitudCaducada({ status: 'new', createdAt: hace(73) }, ahora)).toBe(true);
    expect(solicitudCaducada({ status: 'new', createdAt: hace(71) }, ahora)).toBe(false);
    // Con 24 h puestas seguiría aguantando hasta las 72.
    expect(solicitudCaducada({ status: 'new', createdAt: hace(30), keepHours: 24 }, ahora)).toBe(
      false
    );
  });

  /**
   * ⚠️ **Y una `new` con `handledAt` se cuenta igual desde `createdAt`.** Suena
   * imposible y no lo es: «Ampliar 24 h» y guardar una nota tocan el documento
   * sin cambiar el estado. Mandando el reloj sobre lo manipulado, bastaría
   * teclear una nota para resetear el plazo de algo que sigue sin contestarse.
   */
  it('lo que manda es el ESTADO, no que el documento se haya tocado', () => {
    const d = { status: 'new', createdAt: hace(80), handledAt: hace(1) };
    expect(solicitudCaducada(d, ahora)).toBe(true);
  });

  /**
   * ⚠️ **La garantía de precio protege también a las sin contestar.** Es el
   * mismo caso que abajo y aquí duele más: se le prometió un precio a alguien a
   * quien encima no se ha llamado.
   */
  it('una sin contestar con el precio todavía prometido no se borra', () => {
    const d = {
      status: 'new',
      createdAt: hace(100),
      priceGuaranteedUntil: new Date(ahora.getTime() + 3_600_000)
    };
    expect(solicitudCaducada(d, ahora)).toBe(false);
  });

  it('la atendida hace 25 h con un plazo de 24 se borra', () => {
    expect(solicitudCaducada({ handledAt: hace(25), keepHours: 24 }, ahora)).toBe(true);
  });

  it('y la de hace 23 h se queda', () => {
    expect(solicitudCaducada({ handledAt: hace(23), keepHours: 24 }, ahora)).toBe(false);
  });

  /**
   * ⚠️ El reloj arranca cuando el operador la ATIENDE, no cuando entró: una
   * solicitud que tarda dos días en contestarse conserva su plazo completo
   * desde la llamada.
   */
  it('cuenta desde `handledAt`, no desde `createdAt`', () => {
    const d = { createdAt: hace(200), handledAt: hace(2), keepHours: 24 };
    expect(solicitudCaducada(d, ahora)).toBe(false);
  });

  it('sin `handledAt` cae a `createdAt`, que es el respaldo', () => {
    expect(solicitudCaducada({ createdAt: hace(25), keepHours: 24 }, ahora)).toBe(true);
    expect(solicitudCaducada({ createdAt: hace(10), keepHours: 24 }, ahora)).toBe(false);
  });

  /**
   * ⚠️ **En la duda no se borra.** Un dato de más se puede borrar mañana; uno
   * borrado no vuelve. `Number(null)` es **0** y `Number('')` también, así que
   * la ausencia se comprueba con `isFinite` y el `<= 0` — es el mismo fallo que
   * ya salió con `ownerSharePercent`.
   */
  it('sin fecha ninguna, NO se borra', () => {
    expect(solicitudCaducada({ keepHours: 24 }, ahora)).toBe(false);
  });

  it('con un plazo ilegible o absurdo, NO se borra', () => {
    expect(solicitudCaducada({ handledAt: hace(999), keepHours: undefined }, ahora)).toBe(false);
    expect(solicitudCaducada({ handledAt: hace(999), keepHours: null }, ahora)).toBe(false);
    expect(solicitudCaducada({ handledAt: hace(999), keepHours: 0 }, ahora)).toBe(false);
    expect(solicitudCaducada({ handledAt: hace(999), keepHours: -5 }, ahora)).toBe(false);
    expect(solicitudCaducada({ handledAt: hace(999), keepHours: 'pronto' }, ahora)).toBe(false);
  });

  /**
   * ⚠️ **El caso que costaría un alquiler.** «Ampliar 24 h» alarga lo que se le
   * promete al cliente y no movía este plazo: la solicitud se borraba con el
   * precio todavía en pie, y quien llamaba citando su referencia no existía.
   */
  it('MIENTRAS EL PRECIO SIGA PROMETIDO no se borra, aunque el plazo haya pasado', () => {
    const d = {
      handledAt: hace(48),
      keepHours: 24,
      priceGuaranteedUntil: new Date(ahora.getTime() + 24 * 3_600_000)
    };
    expect(solicitudCaducada(d, ahora)).toBe(false);
  });

  it('y en cuanto el precio caduca, se borra', () => {
    const d = { handledAt: hace(48), keepHours: 24, priceGuaranteedUntil: hace(1) };
    expect(solicitudCaducada(d, ahora)).toBe(true);
  });

  it('una sin garantía guardada se decide solo por el plazo, como siempre', () => {
    expect(solicitudCaducada({ handledAt: hace(48), keepHours: 24 }, ahora)).toBe(true);
  });
});

/**
 * ⚠️ **Esto decide un borrado DEFINITIVO de datos personales**, corre una vez
 * al día sin nadie delante, y el plazo está **publicado** en `/privacidad`. Las
 * dos direcciones tienen coste: borrar antes de tiempo deja a Dorel sin un
 * mensaje que quizá no había leído, y borrar tarde convierte la propia política
 * de privacidad en la prueba del incumplimiento.
 */
describe('cuándo se borra un mensaje de contacto', () => {
  const ahora = new Date('2026-10-02T09:00:00');
  const hace = (horas: number) => new Date(ahora.getTime() - horas * 3600_000);

  it('a las 24 horas de haberse escrito', () => {
    expect(consultaCaducada({ createdAt: hace(25) }, ahora)).toBe(true);
    expect(consultaCaducada({ createdAt: hace(24) }, ahora)).toBe(true);
  });

  it('y ni un minuto antes', () => {
    expect(consultaCaducada({ createdAt: hace(23) }, ahora)).toBe(false);
    expect(consultaCaducada({ createdAt: hace(1) }, ahora)).toBe(false);
  });

  /** Lo que permite ampliarle el plazo a uno sin mover los demás. */
  it('respeta el plazo congelado en el propio mensaje', () => {
    expect(consultaCaducada({ createdAt: hace(30), keepHours: 72 }, ahora)).toBe(false);
    expect(consultaCaducada({ createdAt: hace(80), keepHours: 72 }, ahora)).toBe(true);
  });

  /**
   * ⚠️ En la duda NO se borra: un dato de más se puede borrar mañana, y uno
   * borrado no vuelve.
   */
  it('sin fecha desde la que contar, se conserva', () => {
    expect(consultaCaducada({}, ahora)).toBe(false);
    expect(consultaCaducada({ createdAt: null }, ahora)).toBe(false);
    expect(consultaCaducada({ createdAt: 'el martes' }, ahora)).toBe(false);
  });

  it('con un plazo ilegible, se conserva', () => {
    expect(consultaCaducada({ createdAt: hace(99), keepHours: 'muchas' }, ahora)).toBe(false);
    expect(consultaCaducada({ createdAt: hace(99), keepHours: 0 }, ahora)).toBe(false);
    expect(consultaCaducada({ createdAt: hace(99), keepHours: -5 }, ahora)).toBe(false);
  });

  /**
   * ⚠️ **Al revés que una solicitud de reserva, el estado NO importa.** De un
   * mensaje de contacto ya salió un correo en el instante de enviarlo: lo que
   * se borra aquí es la copia, no el original. Una solicitud sin atender sí es
   * trabajo pendiente y por eso aquella no se borra nunca en `new`.
   */
  it('se borra aunque siga sin contestar, porque el correo ya salió', () => {
    expect(consultaCaducada({ createdAt: hace(25), status: 'new' }, ahora)).toBe(true);
  });
});
