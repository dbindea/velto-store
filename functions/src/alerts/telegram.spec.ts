/**
 * El aviso de cobro por Telegram.
 *
 * ⚠️ **Se prueba la COMPOSICIÓN, no el envío**, igual que el resumen diario:
 * `avisarPorTelegram()` habla con una API de fuera y lo único que puede fallar
 * ahí —que esté caída, que el token no valga— ya está resuelto por no lanzar
 * nunca. Lo que sí se puede romper en silencio es el texto, y es lo que se
 * mide aquí.
 */

import { describe, expect, it } from 'vitest';
import { mensajeCobro } from './telegram';

describe('mensajeCobro', () => {
  const base = {
    importe: 50,
    concepto: 'Señal de la reserva P-4K7M9X',
    completo: true
  };

  it('lleva el importe en euros y el concepto', () => {
    const m = mensajeCobro(base);
    expect(m).toContain('50,00');
    expect(m).toContain('Señal de la reserva P-4K7M9X');
  });

  /**
   * ⚠️ **El caso que decide qué hace el operador después.** Un cobro parcial
   * deja la fila con importe pendiente; leído como completo, esa fila se queda
   * esperando a que alguien mire la pantalla de Pagos.
   */
  it('distingue el cobro completo del parcial, y el parcial lo dice', () => {
    expect(mensajeCobro(base)).toContain('Cobro recibido');
    expect(mensajeCobro(base)).not.toContain('pendiente');

    const parcial = mensajeCobro({ ...base, completo: false });
    expect(parcial).toContain('Cobro parcial recibido');
    expect(parcial).toContain('pendiente');
  });

  it('nombra la solicitud cuando el cobro salió de una', () => {
    const m = mensajeCobro({ ...base, referencia: 'P-4K7M9X' });
    expect(m).toContain('P-4K7M9X');
  });

  it('se calla lo que no consta en vez de escribir un hueco', () => {
    const m = mensajeCobro(base);
    expect(m).not.toContain('undefined');
    expect(m).not.toContain('De ');
    expect(m.split('\n').some((l) => l.trim() === '·')).toBe(false);
  });

  /**
   * ⚠️ **Este es el test que de verdad importa, y no es cosmético.** El nombre
   * del pagador llega desde un formulario PÚBLICO. Con `parse_mode: 'HTML'`,
   * un `<` sin escapar hace que la API conteste `400 can't parse entities` y
   * el aviso **no llegue** — o sea, quedarse sin enterarse del cobro, que es
   * justo lo que este módulo viene a arreglar.
   */
  it('escapa el HTML de lo que teclea una persona', () => {
    const m = mensajeCobro({
      ...base,
      pagador: 'Juan <script>alert(1)</script> Pérez',
      concepto: 'Señal & resto'
    });
    expect(m).not.toContain('<script>');
    expect(m).toContain('&lt;script&gt;');
    expect(m).toContain('Señal &amp; resto');
  });

  /**
   * Las etiquetas que el mensaje usa a propósito sí tienen que sobrevivir: son
   * nuestras, no del dato. Si alguien escapara el mensaje entero en vez de sus
   * partes, esto lo caza.
   */
  it('conserva el formato propio del mensaje', () => {
    const m = mensajeCobro(base);
    expect(m).toContain('<b>');
    expect(m).toContain('</b>');
  });
});
