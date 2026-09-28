/**
 * Cómo se ve el resumen en el correo.
 *
 * ⚠️ **Se lee en un móvil, de pie y con prisa.** No es un informe: es una lista
 * de lo que hay que hacer. Por eso no lleva logotipo grande, ni tabla de dos
 * columnas que se rompe en pantalla estrecha, ni colores de marca compitiendo
 * con lo único que importa —que falta una firma—.
 *
 * ⚠️ **Y va con estilos EN LÍNEA.** Los clientes de correo tiran las hojas de
 * estilo: Gmail borra el `<style>` del `<head>` en la vista móvil, y lo que
 * queda es texto sin formato con el aviso de la firma perdido entre lo demás.
 */

import type { Resumen } from './daily-digest';
/**
 * ⚠️ La cáscara es común con el aviso de las solicitudes de la web: dos
 * correos del mismo negocio al mismo buzón no pueden parecer de dos empresas.
 */
import { aviso, esc, fila, seccion, sobre } from './email-shell';

export interface DigestCompany {
  brandName: string;
  website?: string;
}

export function renderDigestEmail(
  r: Resumen,
  company: DigestCompany
): { html: string; text: string } {
  const entregas = r.entregas
    .map((e) =>
      fila(
        `${esc(e.hora)} · ${esc(e.cliente)}`,
        [esc(e.vehiculo), e.telefono ? esc(e.telefono) : ''].filter(Boolean).join(' · '),
        /**
         * ⚠️ **En rojo y con todas las letras.** Sin contrato firmado no se
         * puede entregar el coche: no es un detalle de la fila, es el motivo
         * por el que este correo sale hoy y no mañana.
         */
        e.contratoSinFirmar ? 'SIN CONTRATO FIRMADO · hay que resolverlo hoy' : undefined
      )
    )
    .join('');

  const devoluciones = r.devoluciones
    .map((d) =>
      fila(
        `${esc(d.hora)} · ${esc(d.cliente)}`,
        [esc(d.vehiculo), d.telefono ? esc(d.telefono) : ''].filter(Boolean).join(' · ')
      )
    )
    .join('');

  /**
   * ⚠️ **Los avisos del sistema van ARRIBA, antes que el trabajo del día.**
   *
   * No es jerarquía de importancia abstracta: es que lo de abajo se hace hoy y
   * esto no se hace nunca si no se ve. Un certificado caducado y una cadena de
   * facturación parada no dan error en ninguna pantalla — el correo es el único
   * sitio donde aparecen, y detrás de tres entregas no aparecen.
   */
  const avisos = r.avisos.map((a) => aviso(a.texto, a.urgente)).join('');

  const vencimientos = r.vencimientos
    .map((v) =>
      fila(
        `${esc(v.concepto)} · ${esc(v.vehiculo)}`,
        v.diasRestantes < 0
          ? `Venció el ${esc(v.fecha)}`
          : v.diasRestantes === 0
            ? `Vence hoy, ${esc(v.fecha)}`
            : `Vence el ${esc(v.fecha)} · en ${v.diasRestantes} día${v.diasRestantes === 1 ? '' : 's'}`,
        /**
         * ⚠️ **«No alquiles este coche» solo si es verdad.** Lo decía de
         * cualquier vencimiento, y solo la ITV y el seguro impiden circular:
         * un cambio de aceite vencido salía con la misma frase mientras la
         * aplicación lo dejaba alquilar. Un aviso que el sistema no respalda se
         * deja de creer, y arrastra a los que sí.
         */
        v.diasRestantes < 0
          ? v.bloquea
            ? 'VENCIDO · este coche no se puede alquilar hasta pasarla'
            : 'VENCIDO · conviene hacerlo, el coche sigue alquilándose'
          : undefined
      )
    )
    .join('');

  const html = sobre({
    titulo: `Mañana, ${r.fecha}`,
    entradilla: `${company.brandName} · lo que hay que preparar`,
    cuerpo:
      (avisos ? `<tr><td style="height:16px"></td></tr>${avisos}` : '') +
      seccion('Entregas', entregas) +
      seccion('Devoluciones', devoluciones) +
      seccion('Vence en la flota', vencimientos),
    pie:
      'Este resumen sale cada mañana con lo del día siguiente. ' +
      'Si no hay nada que preparar, no se envía.'
  });

  // ⚠️ La versión de texto no es un adorno: hay clientes que solo muestran esa,
  // y un correo cuyo texto plano está vacío acaba en spam.
  const lineas: string[] = [`Mañana, ${r.fecha} — ${company.brandName}`, ''];
  // También arriba en el texto plano, y por el mismo motivo: hay clientes de
  // correo que solo enseñan esta versión.
  if (r.avisos.length) {
    for (const a of r.avisos) {
      lineas.push(`${a.urgente ? '*** ' : ''}${a.texto}${a.urgente ? ' ***' : ''}`);
    }
    lineas.push('');
  }
  if (r.entregas.length) {
    lineas.push('ENTREGAS');
    for (const e of r.entregas) {
      lineas.push(
        `  ${e.hora}  ${e.cliente}  ${e.vehiculo}${e.telefono ? `  ${e.telefono}` : ''}` +
          (e.contratoSinFirmar ? '\n         *** SIN CONTRATO FIRMADO — resolver hoy ***' : '')
      );
    }
    lineas.push('');
  }
  if (r.devoluciones.length) {
    lineas.push('DEVOLUCIONES');
    for (const d of r.devoluciones) {
      lineas.push(`  ${d.hora}  ${d.cliente}  ${d.vehiculo}${d.telefono ? `  ${d.telefono}` : ''}`);
    }
    lineas.push('');
  }
  if (r.vencimientos.length) {
    lineas.push('VENCE EN LA FLOTA');
    for (const v of r.vencimientos) {
      lineas.push(
        `  ${v.concepto}  ${v.vehiculo}  ${
          v.diasRestantes < 0 ? `VENCIDO el ${v.fecha}` : `${v.fecha} (${v.diasRestantes} d)`
        }`
      );
    }
  }

  return { html, text: lineas.join('\n').trimEnd() };
}
