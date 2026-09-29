/**
 * ⚠️ **Lo que estos tests protegen no es la comodidad de volver: es que el
 * login de la empresa no se convierta en un trampolín.** Un `returnUrl` que
 * llega por la barra de direcciones es entrada de fuera, y la mitad de los
 * casos de abajo —`//`, `/\`— parecen rutas internas y no lo son.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDING, safeReturnUrl } from './return-url.util';

describe('safeReturnUrl', () => {
  it('deja pasar una ruta interna, que es para lo que existe', () => {
    expect(safeReturnUrl('/booking-requests/aBc123')).toBe('/booking-requests/aBc123');
    expect(safeReturnUrl('/reservations/1?tab=pagos')).toBe('/reservations/1?tab=pagos');
  });

  it('RECHAZA una URL absoluta', () => {
    expect(safeReturnUrl('https://otro-sitio.example/robo')).toBe(DEFAULT_LANDING);
    expect(safeReturnUrl('http://otro-sitio.example')).toBe(DEFAULT_LANDING);
  });

  it('y `javascript:`, que no es una navegación', () => {
    expect(safeReturnUrl('javascript:alert(1)')).toBe(DEFAULT_LANDING);
  });

  it('RECHAZA `//otro-sitio`, que parece interna y es absoluta', () => {
    // El navegador la resuelve heredando el protocolo: es el caso que se cuela
    // cuando uno solo comprueba «empieza por barra».
    expect(safeReturnUrl('//otro-sitio.example/robo')).toBe(DEFAULT_LANDING);
  });

  it('y `/\\otro-sitio`, que Chrome y Firefox tratan igual', () => {
    expect(safeReturnUrl('/\\otro-sitio.example/robo')).toBe(DEFAULT_LANDING);
  });

  it('no devuelve al propio login, o se entraría para volver a entrar', () => {
    expect(safeReturnUrl('/login')).toBe(DEFAULT_LANDING);
    expect(safeReturnUrl('/login?returnUrl=/x')).toBe(DEFAULT_LANDING);
    expect(safeReturnUrl('/login/algo')).toBe(DEFAULT_LANDING);
  });

  it('pero `/loginx` no es el login: es una ruta que empieza igual', () => {
    expect(safeReturnUrl('/loginx')).toBe('/loginx');
  });

  it('lo que no es una cadena cae al panel, sin romperse', () => {
    expect(safeReturnUrl(undefined)).toBe(DEFAULT_LANDING);
    expect(safeReturnUrl(null)).toBe(DEFAULT_LANDING);
    expect(safeReturnUrl(['/x'])).toBe(DEFAULT_LANDING);
    expect(safeReturnUrl('')).toBe(DEFAULT_LANDING);
  });
});
