import { describe, expect, it } from 'vitest';
import {
  DIAS_AVISO_DIARIO,
  INTENTOS_PARA_ATASCO,
  UMBRALES_CERTIFICADO,
  avisoCertificado,
  avisoRemision,
  avisosDelSistema
} from './system-alerts';
import type { Remision } from '../invoices/verifactu-submission';

const fila = (p: Partial<Remision> = {}): Remision => ({
  invoiceId: p.invoiceId || 'i1',
  fullNumber: p.fullNumber || '2027/0001',
  chainIndex: p.chainIndex ?? 1,
  estado: p.estado || 'aceptado',
  intentos: p.intentos ?? 0
});

describe('el certificado de la FNMT', () => {
  it('no avisa cuando queda mucho', () => {
    expect(avisoCertificado(200)).toBeNull();
    expect(avisoCertificado(61)).toBeNull();
  });

  it('avisa al cruzar cada umbral', () => {
    for (const dias of UMBRALES_CERTIFICADO) {
      expect(avisoCertificado(dias), `${dias} días`).not.toBeNull();
    }
  });

  /**
   * ⚠️ Lo que este test protege es que NO se avise los sesenta días seguidos.
   * Un correo que repite lo mismo dos meses se deja de leer, y con él se deja de
   * leer el que traía las entregas de mañana.
   */
  it('entre umbrales calla', () => {
    expect(avisoCertificado(59)).toBeNull();
    expect(avisoCertificado(45)).toBeNull();
    expect(avisoCertificado(20)).toBeNull();
    expect(avisoCertificado(10)).toBeNull();
  });

  it('desde una semana antes avisa todos los días, y es urgente', () => {
    for (let d = 0; d <= DIAS_AVISO_DIARIO; d++) {
      const a = avisoCertificado(d);
      expect(a, `${d} días`).not.toBeNull();
      expect(a!.urgente, `${d} días`).toBe(true);
    }
  });

  it('un umbral lejano avisa pero no es urgente: da tiempo a renovar sin prisa', () => {
    expect(avisoCertificado(60)!.urgente).toBe(false);
    expect(avisoCertificado(30)!.urgente).toBe(false);
  });

  it('ya caducado lo dice en pasado y con los días que lleva', () => {
    const a = avisoCertificado(-3);
    expect(a!.urgente).toBe(true);
    expect(a!.texto).toContain('CADUCÓ');
    expect(a!.texto).toContain('3 días');
  });

  it('el singular no dice «1 días»', () => {
    expect(avisoCertificado(1)!.texto).toContain('1 día.');
    expect(avisoCertificado(-1)!.texto).toContain('1 día');
    expect(avisoCertificado(1)!.texto).not.toContain('1 días');
    expect(avisoCertificado(-1)!.texto).not.toContain('1 días');
  });

  /**
   * Sin certificado configurado no hay caducidad que mirar. Avisar de un dato
   * que no existe es peor que callar: manda a buscar un problema inventado.
   */
  it('sin dato no inventa un aviso', () => {
    expect(avisoCertificado(undefined)).toBeNull();
    expect(avisoCertificado(NaN)).toBeNull();
  });
});

describe('la remisión a la AEAT', () => {
  it('todo aceptado no genera aviso', () => {
    expect(avisoRemision([fila(), fila({ chainIndex: 2 })])).toBeNull();
  });

  it('un pendiente reciente tampoco: el barrido corre cada cinco minutos', () => {
    expect(avisoRemision([fila({ estado: 'pendiente', intentos: 1 })])).toBeNull();
  });

  it('un rechazo es urgente aunque sea uno, porque para la cadena entera', () => {
    const a = avisoRemision([
      fila({ chainIndex: 1 }),
      fila({ chainIndex: 2, estado: 'rechazado', fullNumber: '2027/0002' })
    ]);
    expect(a!.urgente).toBe(true);
    expect(a!.texto).toContain('2027/0002');
    expect(a!.texto).toContain('PARADA');
  });

  it('avisa de lo atascado a partir del umbral de intentos', () => {
    expect(avisoRemision([fila({ estado: 'error', intentos: INTENTOS_PARA_ATASCO - 1 })])).toBeNull();
    const a = avisoRemision([
      fila({ estado: 'error', intentos: INTENTOS_PARA_ATASCO, fullNumber: '2027/0009' })
    ]);
    expect(a!.texto).toContain('2027/0009');
    expect(a!.urgente).toBe(false);
  });

  it('el rechazo manda sobre lo atascado: es lo que hay que mirar primero', () => {
    const a = avisoRemision([
      fila({ chainIndex: 1, estado: 'error', intentos: 99, fullNumber: '2027/0001' }),
      fila({ chainIndex: 2, estado: 'rechazado', fullNumber: '2027/0002' })
    ]);
    expect(a!.clase).toBe('remision');
    expect(a!.texto).toContain('2027/0002');
    expect(a!.texto).not.toContain('intentos');
  });

  it('no lista más de cinco números, pero dice cuántas son', () => {
    const muchas = Array.from({ length: 8 }, (_, i) =>
      fila({ chainIndex: i, estado: 'error', intentos: 50, fullNumber: `2027/000${i}` })
    );
    const a = avisoRemision(muchas)!;
    expect(a.texto).toContain('8 facturas llevan');
    expect(a.texto).toContain('…');
  });

  it('una sola atascada se dice en singular', () => {
    const a = avisoRemision([fila({ estado: 'error', intentos: 50 })])!;
    expect(a.texto).toContain('1 factura lleva');
  });
});

describe('los dos juntos', () => {
  it('la remisión va primero: es lo que está parado ahora', () => {
    const avisos = avisosDelSistema(5, [fila({ estado: 'rechazado' })]);
    expect(avisos.map((a) => a.clase)).toEqual(['remision', 'certificado']);
  });

  it('sin nada que contar, lista vacía', () => {
    expect(avisosDelSistema(300, [fila()])).toEqual([]);
  });
});
