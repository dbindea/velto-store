import { describe, expect, it } from 'vitest';
import {
  pareceBot,
  diaDeMadrid,
  huellaVisitante,
  ipDelVisitante,
  normalizaRuta,
  normalizaHito
} from './analitica-core';

const CHROME =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Mobile Safari/537.36';

describe('pareceBot', () => {
  it('deja pasar un navegador de verdad', () => {
    expect(pareceBot(CHROME)).toBe(false);
    expect(pareceBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/604.1')).toBe(false);
  });

  it('caza a los que se anuncian', () => {
    for (const ua of [
      'Googlebot/2.1 (+http://www.google.com/bot.html)',
      'GPTBot/1.0', 'ClaudeBot/1.0', 'CCBot/2.0', 'PerplexityBot/1.0',
      'AhrefsBot/7.0', 'SemrushBot/7', 'Bytespider',
      'python-requests/2.31', 'curl/8.4.0', 'Wget/1.21', 'axios/1.6',
      'HeadlessChrome/120', 'node-fetch/1.0'
    ]) {
      expect(pareceBot(ua), ua).toBe(true);
    }
  });

  /**
   * ⚠️ **Los clientes de consola que se disfrazan de navegador.** PowerShell
   * manda un agente que empieza por `Mozilla/5.0`, y se contó como visitante
   * en la primera prueba contra desarrollo. Este test está porque pasó.
   */
  it('caza a los clientes HTTP que empiezan por Mozilla', () => {
    expect(
      pareceBot(
        'Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.19045; es-ES) WindowsPowerShell/5.1.19041.6093'
      )
    ).toBe(true);
    expect(pareceBot('PostmanRuntime/7.37.0')).toBe(true);
    expect(pareceBot('GuzzleHttp/7')).toBe(true);
    expect(pareceBot('Apache-HttpClient/4.5')).toBe(true);
  });

  /**
   * ⚠️ Sin agente no se cuenta. Un navegador siempre manda uno; quien no lo
   * manda es un programa que no se ha molestado en disimular.
   */
  it('sin agente, no cuenta', () => {
    expect(pareceBot(undefined)).toBe(true);
    expect(pareceBot('')).toBe(true);
    expect(pareceBot('   ')).toBe(true);
  });
});

describe('huellaVisitante', () => {
  it('la misma persona el mismo día da la misma huella', () => {
    const a = huellaVisitante('1.2.3.4', CHROME, '2026-10-05', 's3cr3t');
    const b = huellaVisitante('1.2.3.4', CHROME, '2026-10-05', 's3cr3t');
    expect(a).toBe(b);
  });

  /**
   * ⚠️ **Este es el test que sostiene el «sin banner».** Si la huella
   * sobreviviera al cambio de día, sería un identificador persistente — y un
   * identificador persistente exige consentimiento. Que no se parezcan es la
   * propiedad legal, no un detalle de implementación.
   */
  it('la misma persona en OTRO día da una huella distinta', () => {
    const lunes = huellaVisitante('1.2.3.4', CHROME, '2026-10-05', 's3cr3t');
    const martes = huellaVisitante('1.2.3.4', CHROME, '2026-10-06', 's3cr3t');
    expect(martes).not.toBe(lunes);
  });

  it('personas distintas, huellas distintas', () => {
    const uno = huellaVisitante('1.2.3.4', CHROME, '2026-10-05', 's3cr3t');
    const otro = huellaVisitante('5.6.7.8', CHROME, '2026-10-05', 's3cr3t');
    expect(otro).not.toBe(uno);
  });

  /** Sin el secreto, el espacio de IPs es tan pequeño que se deshace probando. */
  it('con otro secreto no coincide', () => {
    const a = huellaVisitante('1.2.3.4', CHROME, '2026-10-05', 'uno');
    const b = huellaVisitante('1.2.3.4', CHROME, '2026-10-05', 'otro');
    expect(b).not.toBe(a);
  });

  it('no deja la IP dentro de lo que se guarda', () => {
    const h = huellaVisitante('85.60.123.45', CHROME, '2026-10-05', 's3cr3t');
    expect(h).not.toContain('85.60');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('ipDelVisitante', () => {
  /**
   * ⚠️ `x-forwarded-for` trae una lista y la del visitante es la PRIMERA. Con
   * la última se contaría el proxy de Google y todo el tráfico saldría como un
   * único visitante.
   */
  it('coge la primera de la lista, no la última', () => {
    expect(ipDelVisitante('85.60.1.2, 10.0.0.1, 35.191.0.5')).toBe('85.60.1.2');
  });

  it('aguanta espacios y una sola', () => {
    expect(ipDelVisitante('  85.60.1.2  ')).toBe('85.60.1.2');
  });

  it('sin cabecera usa el respaldo, y si no hay, lo dice', () => {
    expect(ipDelVisitante(undefined, '9.9.9.9')).toBe('9.9.9.9');
    expect(ipDelVisitante(undefined)).toBe('desconocida');
  });
});

describe('normalizaRuta', () => {
  it('acepta las rutas que existen', () => {
    expect(normalizaRuta('/')).toBe('/');
    expect(normalizaRuta('/flota')).toBe('/flota');
    expect(normalizaRuta('/reservar')).toBe('/reservar');
  });

  /** La ficha se agrupa: interesa cuánta gente mira fichas, no cuál mira cada uno. */
  it('agrupa la ficha de coche y se deja el id fuera', () => {
    expect(normalizaRuta('/coche/RuEYtRi9CvtwSjPoSRvd')).toBe('/coche');
    expect(normalizaRuta('/coche/demo-toyota-corolla?from=x')).toBe('/coche');
  });

  it('quita la query y el ancla, que pueden traer datos del visitante', () => {
    expect(normalizaRuta('/reservar?place=Arganda&from=2026-11-02')).toBe('/reservar');
    expect(normalizaRuta('/condiciones#cancelar')).toBe('/condiciones');
  });

  /**
   * ⚠️ **Lo inventado no entra, y no es celo.** El endpoint es público: sin
   * lista blanca, cualquiera llenaría el documento del día con una clave por
   * ruta falsa hasta reventar el límite de Firestore.
   */
  it('rechaza lo que no está en la lista', () => {
    expect(normalizaRuta('/no-existe')).toBeNull();
    expect(normalizaRuta('/../../etc/passwd')).toBeNull();
    expect(normalizaRuta('')).toBeNull();
    expect(normalizaRuta(42)).toBeNull();
    expect(normalizaRuta(null)).toBeNull();
  });
});

describe('normalizaHito', () => {
  it('acepta los tres del embudo', () => {
    expect(normalizaHito('precios')).toBe('precios');
    expect(normalizaHito('ficha')).toBe('ficha');
    expect(normalizaHito('cotizacion')).toBe('cotizacion');
  });

  it('rechaza cualquier otro', () => {
    expect(normalizaHito('lo-que-sea')).toBeNull();
    expect(normalizaHito(7)).toBeNull();
    expect(normalizaHito(undefined)).toBeNull();
  });
});

describe('diaDeMadrid', () => {
  /**
   * ⚠️ **En UTC, lo que pasa entre medianoche y las 2:00 de Madrid caería en el
   * día anterior.** En verano son dos horas de visitas apuntadas al día que no
   * es, y el informe no cuadraría con lo que se vio en pantalla.
   */
  it('la medianoche y media de Madrid en verano ya es el día siguiente', () => {
    // 00:30 del 6 de julio en Madrid son las 22:30 UTC del día 5.
    expect(diaDeMadrid(new Date('2026-07-05T22:30:00Z'))).toBe('2026-07-06');
  });

  it('y en invierno, con una hora de diferencia', () => {
    // 00:30 del 6 de enero en Madrid son las 23:30 UTC del día 5.
    expect(diaDeMadrid(new Date('2026-01-05T23:30:00Z'))).toBe('2026-01-06');
  });

  it('da el formato que se usa como id del documento', () => {
    expect(diaDeMadrid(new Date('2026-10-05T10:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
