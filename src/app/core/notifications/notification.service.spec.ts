import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new NotificationService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * La regla que sostiene todo lo demás: un error se queda hasta que alguien
   * lo atiende. Uno que se desvanece solo es un error que el operador se pierde
   * mientras mira otra cosa, y entonces cree que la acción salió bien.
   */
  it('no retira un error por sí solo', () => {
    service.error('contracts.errors.generate');
    vi.advanceTimersByTime(60_000);
    expect(service.notices()).toHaveLength(1);
  });

  it('retira solo lo que es buena noticia', () => {
    service.success('inspections.success.depositRetained');
    service.info('common.loading');
    expect(service.notices()).toHaveLength(2);

    vi.advanceTimersByTime(5000);
    expect(service.notices()).toHaveLength(0);
  });

  it('no apila copias del mismo fallo', () => {
    // El operador que pulsa tres veces un botón roto acabaría con tres avisos
    // idénticos tapándose entre sí.
    service.error('contracts.errors.generate');
    service.error('contracts.errors.generate');
    service.error('contracts.errors.generate');
    expect(service.notices()).toHaveLength(1);
  });

  it('distingue dos fallos distintos', () => {
    service.error('contracts.errors.generate');
    service.error('contracts.errors.pdfNotReady');
    expect(service.notices()).toHaveLength(2);
  });

  it('un éxito no borra un error de la misma clave', () => {
    // Se comparan clase y clave: un `success` no debe hacer desaparecer el
    // error que sigue vigente.
    service.error('inspections.errors.photoUpload');
    service.success('inspections.errors.photoUpload');
    expect(service.notices()).toHaveLength(2);
  });

  it('conserva los parámetros del mensaje', () => {
    service.success('inspections.success.depositRetained', { amount: '145.00' });
    expect(service.notices()[0].params).toEqual({ amount: '145.00' });
  });

  it('guarda el reintento solo cuando se le da uno', () => {
    const retry = vi.fn();
    service.error('contracts.errors.generate', { retry });
    service.error('contracts.errors.pdfNotReady');

    const [conReintento, sinReintento] = service.notices();
    expect(conReintento.retry).toBe(retry);
    expect(sinReintento.retry).toBeUndefined();
  });

  it('cierra el aviso que se le pide y deja el resto', () => {
    const id = service.error('contracts.errors.generate');
    service.error('contracts.errors.pdfNotReady');

    service.dismiss(id);
    expect(service.notices().map(n => n.key)).toEqual(['contracts.errors.pdfNotReady']);
  });

  it('los reparte en el orden en que ocurrieron', () => {
    service.error('a');
    service.error('b');
    expect(service.notices().map(n => n.key)).toEqual(['a', 'b']);
  });

  it('vacía la pila', () => {
    service.error('a');
    service.success('b');
    service.clear();
    expect(service.notices()).toHaveLength(0);
  });
});
