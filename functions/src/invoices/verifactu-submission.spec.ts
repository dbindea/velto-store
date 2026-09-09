import { describe, expect, it } from 'vitest';
import {
  cabeceraPara,
  esperaHasta,
  remisionBloqueada,
  resultadosDelLote,
  siguientesAEnviar,
  type Remision
} from './verifactu-submission';
import type { RespuestaEnvio } from './verifactu-respuesta';

const remision = (p: Partial<Remision> & { chainIndex: number }): Remision => ({
  invoiceId: `f${p.chainIndex}`,
  fullNumber: `2026/${String(p.chainIndex).padStart(4, '0')}`,
  estado: 'pendiente',
  intentos: 0,
  ...p
});

const respuesta = (
  lineas: RespuestaEnvio['lineas'],
  extra: Partial<RespuestaEnvio> = {}
): RespuestaEnvio => ({
  estadoEnvio: 'Correcto',
  csv: 'CSV-1',
  lineas,
  ...extra
});

describe('el orden del envío', () => {
  /**
   * ⚠️ **El orden de la cadena, no el de llegada.** Un registro que referencia
   * una huella que la AEAT todavía no tiene se rechaza con un error de
   * encadenamiento que parece un fallo del cálculo.
   */
  it('va en orden de cadena aunque lleguen desordenadas', () => {
    const lote = siguientesAEnviar([
      remision({ chainIndex: 3 }),
      remision({ chainIndex: 1 }),
      remision({ chainIndex: 2 })
    ]);
    expect(lote.map((r) => r.chainIndex)).toEqual([1, 2, 3]);
  });

  it('se salta las que ya están aceptadas', () => {
    const lote = siguientesAEnviar([
      remision({ chainIndex: 1, estado: 'aceptado' }),
      remision({ chainIndex: 2 })
    ]);
    expect(lote.map((r) => r.chainIndex)).toEqual([2]);
  });

  /**
   * ⚠️ **La prueba que importa.** Todo lo que viene detrás de un rechazo
   * encadena con su huella, así que la AEAT lo rechazaría igual: seguir
   * adelante convierte un problema en veinte idénticos y consume el límite de
   * envíos sin arreglar nada.
   */
  it('se PARA en la primera rechazada, no la salta', () => {
    const lote = siguientesAEnviar([
      remision({ chainIndex: 1, estado: 'aceptado' }),
      remision({ chainIndex: 2, estado: 'rechazado' }),
      remision({ chainIndex: 3 }),
      remision({ chainIndex: 4 })
    ]);
    expect(lote).toHaveLength(0);
  });

  it('una que falló por causa técnica sí se reintenta', () => {
    const lote = siguientesAEnviar([
      remision({ chainIndex: 1, estado: 'error', intentos: 2 }),
      remision({ chainIndex: 2 })
    ]);
    expect(lote.map((r) => r.chainIndex)).toEqual([1, 2]);
  });

  it('el lote tiene tope', () => {
    const muchas = Array.from({ length: 250 }, (_, i) => remision({ chainIndex: i + 1 }));
    expect(siguientesAEnviar(muchas, 100)).toHaveLength(100);
  });

  /**
   * ⚠️ Un rechazo bloquea la cadena entera, así que tiene que **verse**. En un
   * log no lo ve nadie hasta que la Agencia pregunta por qué faltan facturas.
   */
  it('la que bloquea se puede señalar', () => {
    const bloqueada = remisionBloqueada([
      remision({ chainIndex: 1, estado: 'aceptado' }),
      remision({ chainIndex: 3, estado: 'rechazado' }),
      remision({ chainIndex: 2, estado: 'rechazado' })
    ]);
    // La primera de la cadena, no la primera de la lista.
    expect(bloqueada?.chainIndex).toBe(2);
  });
});

describe('qué le pasó a cada registro del lote', () => {
  it('la aceptada se queda con el CSV del envío', () => {
    const lote = [remision({ chainIndex: 1 })];
    const r = resultadosDelLote(
      lote,
      respuesta([{ numSerieFactura: '2026/0001', estadoRegistro: 'Correcto' }])
    );
    expect(r[0].estado).toBe('aceptado');
    expect(r[0].csv).toBe('CSV-1');
  });

  /**
   * ⚠️ **El caso que hay que acertar.** Se mandan dos, contesta por una, y dar
   * por buena la otra porque «el envío fue correcto» deja una factura sin
   * remitir con el sistema convencido de lo contrario.
   */
  it('una factura sin respuesta se queda PENDIENTE, no aceptada', () => {
    const lote = [remision({ chainIndex: 1 }), remision({ chainIndex: 2 })];
    const r = resultadosDelLote(
      lote,
      respuesta([{ numSerieFactura: '2026/0001', estadoRegistro: 'Correcto' }])
    );
    expect(r[0].estado).toBe('aceptado');
    expect(r[1].estado).toBe('pendiente');
    expect(r[1].csv).toBeUndefined();
  });

  /**
   * ⚠️ Nada garantiza que la respuesta venga en el mismo orden que el envío.
   * Cruzar por posición asignaría el resultado de una factura a otra — y con
   * ello el CSV, que es el acuse de una factura concreta.
   */
  it('se cruza por número de factura, no por posición', () => {
    const lote = [remision({ chainIndex: 1 }), remision({ chainIndex: 2 })];
    const r = resultadosDelLote(
      lote,
      respuesta(
        [
          { numSerieFactura: '2026/0002', estadoRegistro: 'Correcto' },
          {
            numSerieFactura: '2026/0001',
            estadoRegistro: 'Incorrecto',
            codigoError: 1174
          }
        ],
        { estadoEnvio: 'ParcialmenteCorrecto' }
      )
    );
    expect(r[0].fullNumber).toBe('2026/0001');
    expect(r[0].estado).toBe('rechazado');
    expect(r[1].fullNumber).toBe('2026/0002');
    expect(r[1].estado).toBe('aceptado');
  });

  /**
   * ⚠️ **Un duplicado es un registro que ya entró**, casi siempre porque un
   * envío anterior llegó y se perdió la respuesta. Tratarlo como fallo deja la
   * cadena parada esperando algo que ya ocurrió.
   */
  it('un duplicado cuenta como aceptado', () => {
    const r = resultadosDelLote(
      [remision({ chainIndex: 1 })],
      respuesta(
        [
          {
            numSerieFactura: '2026/0001',
            estadoRegistro: 'Incorrecto',
            codigoError: 3000,
            duplicado: { estadoRegistroDuplicado: 'Correcto' }
          }
        ],
        { estadoEnvio: 'Incorrecto' }
      )
    );
    expect(r[0].estado).toBe('aceptado');
  });

  it('un error técnico deja la factura en error, que sí se reintenta', () => {
    const r = resultadosDelLote(
      [remision({ chainIndex: 1 })],
      respuesta(
        [{ numSerieFactura: '2026/0001', estadoRegistro: 'Incorrecto', codigoError: 3501 }],
        { estadoEnvio: 'Incorrecto' }
      )
    );
    expect(r[0].estado).toBe('error');
    expect(r[0].codigoError).toBe(3501);
  });

  it('un error de validación la rechaza, y guarda el motivo', () => {
    const r = resultadosDelLote(
      [remision({ chainIndex: 1 })],
      respuesta(
        [
          {
            numSerieFactura: '2026/0001',
            estadoRegistro: 'Incorrecto',
            codigoError: 1180,
            descripcionError: 'Error en el bloque de Encadenamiento.'
          }
        ],
        { estadoEnvio: 'Incorrecto' }
      )
    );
    expect(r[0].estado).toBe('rechazado');
    expect(r[0].descripcionError).toContain('Encadenamiento');
  });

  /**
   * ⚠️ El CSV es el acuse de las facturas que entraron. Ponérselo a una
   * rechazada la haría parecer registrada en cualquier pantalla que lo mire.
   */
  it('la rechazada no se queda con el CSV', () => {
    const r = resultadosDelLote(
      [remision({ chainIndex: 1 })],
      respuesta(
        [{ numSerieFactura: '2026/0001', estadoRegistro: 'Incorrecto', codigoError: 1180 }],
        { estadoEnvio: 'ParcialmenteCorrecto' }
      )
    );
    expect(r[0].csv).toBeUndefined();
  });
});

describe('la cabecera del envío', () => {
  /**
   * ⚠️ **Antes de 2027 la remisión es voluntaria y hay que declararlo**; a
   * partir del 1 de enero es obligatoria y el bloque sobra.
   */
  it('en 2026 declara la remisión voluntaria', () => {
    const c = cabeceraPara('VELTO MOBILITY, S.L.', 'B88866900', new Date('2026-09-09T10:00:00Z'));
    expect(c.remisionVoluntaria?.fechaFinVerifactu).toBe('31-12-2026');
  });

  /**
   * ⚠️ La fecha sale del año de la propia fecha, no de un literal: escrita a
   * mano se queda vieja el 1 de enero, y la AEAT la rechaza con el `4120`
   * cuando ya hay una factura emitida detrás.
   */
  it('el 31 de diciembre sigue siendo el del año en curso', () => {
    const c = cabeceraPara('X', 'B1', new Date('2026-12-31T12:00:00Z'));
    expect(c.remisionVoluntaria?.fechaFinVerifactu).toBe('31-12-2026');
  });

  /**
   * ⚠️ **El año es el de Madrid, no el del reloj del servidor.** Las Cloud
   * Functions corren en UTC: a las 00:30 del 1 de enero en España todavía es 31
   * de diciembre en UTC. Con el año del runtime, la cabecera declararía un año
   * distinto del que lleva la factura que va dentro — y esa media hora existe
   * todos los años.
   */
  it('a las 00:30 del 1 de enero en Madrid ya es el año nuevo, aunque en UTC no', () => {
    // 23:30 UTC del 31 de diciembre = 00:30 del 1 de enero en Madrid.
    const c = cabeceraPara('X', 'B1', new Date('2026-12-31T23:30:00Z'));
    expect(c.remisionVoluntaria).toBeUndefined();
  });

  it('desde 2027 ya no se declara: es obligatoria', () => {
    const c = cabeceraPara('X', 'B1', new Date('2027-01-15T00:00:00Z'));
    expect(c.remisionVoluntaria).toBeUndefined();
  });
});

describe('la espera entre envíos', () => {
  /**
   * ⚠️ La marca la AEAT en cada respuesta. Enviar antes se rechaza con el
   * `4102`, y el rechazo tumba el envío entero: ignorarla no adelanta, retrasa.
   */
  it('la dice la AEAT y se respeta', () => {
    const ahora = new Date('2026-09-09T10:00:00Z');
    const hasta = esperaHasta(respuesta([], { tiempoEsperaEnvio: 120 }), ahora);
    expect(hasta.getTime() - ahora.getTime()).toBe(120_000);
  });

  it('si no la dice, un minuto', () => {
    const ahora = new Date('2026-09-09T10:00:00Z');
    expect(esperaHasta(respuesta([]), ahora).getTime() - ahora.getTime()).toBe(60_000);
  });
});
