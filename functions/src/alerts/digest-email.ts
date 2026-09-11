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

/** Escapa lo que romperia el HTML. Un cliente llamado «Pérez & Hijos» basta. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const GRIS = '#5b6b6f';
const TINTA = '#14181a';
const ROJO = '#b3261e';
const TURQUESA = '#20a48f';

function seccion(titulo: string, cuerpo: string): string {
  if (!cuerpo) return '';
  return (
    `<tr><td style="padding:22px 0 6px 0;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;` +
    `letter-spacing:.09em;text-transform:uppercase;color:${TURQUESA}">${esc(titulo)}</td></tr>` +
    cuerpo
  );
}

function fila(principal: string, secundario: string, alerta?: string): string {
  return (
    `<tr><td style="padding:9px 0;border-top:1px solid #e6eaea">` +
    `<div style="font:600 15px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;color:${TINTA}">${principal}</div>` +
    `<div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${GRIS}">${secundario}</div>` +
    (alerta
      ? `<div style="margin-top:4px;font:700 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${ROJO}">${alerta}</div>`
      : '') +
    `</td></tr>`
  );
}

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
  const avisos = r.avisos
    .map(
      (a) =>
        `<tr><td style="padding:10px 12px;margin:0;border-radius:8px;` +
        `background:${a.urgente ? '#fdeceb' : '#fbf3e2'};` +
        `border-left:4px solid ${a.urgente ? ROJO : '#c98500'}">` +
        `<div style="font:${a.urgente ? '700' : '600'} 13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;` +
        `color:${a.urgente ? ROJO : TINTA}">${esc(a.texto)}</div></td></tr>` +
        `<tr><td style="height:6px"></td></tr>`
    )
    .join('');

  const vencimientos = r.vencimientos
    .map((v) =>
      fila(
        `${esc(v.concepto)} · ${esc(v.vehiculo)}`,
        v.diasRestantes < 0
          ? `Venció el ${esc(v.fecha)}`
          : v.diasRestantes === 0
            ? `Vence hoy, ${esc(v.fecha)}`
            : `Vence el ${esc(v.fecha)} · en ${v.diasRestantes} día${v.diasRestantes === 1 ? '' : 's'}`,
        v.diasRestantes < 0 ? 'VENCIDO · el coche no se puede alquilar' : undefined
      )
    )
    .join('');

  const html =
    `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#f4f6f6">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f6">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="max-width:560px;background:#fff;border-radius:12px;padding:24px">` +
    `<tr><td style="font:700 20px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:${TINTA}">` +
    `Mañana, ${esc(r.fecha)}</td></tr>` +
    `<tr><td style="padding-top:4px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${GRIS}">` +
    `${esc(company.brandName)} · lo que hay que preparar</td></tr>` +
    (avisos ? `<tr><td style="height:16px"></td></tr>${avisos}` : '') +
    seccion('Entregas', entregas) +
    seccion('Devoluciones', devoluciones) +
    seccion('Vence en la flota', vencimientos) +
    `<tr><td style="padding-top:24px;border-top:1px solid #e6eaea;` +
    `font:400 11px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${GRIS}">` +
    `Este resumen sale cada mañana con lo del día siguiente. ` +
    `Si no hay nada que preparar, no se envía.</td></tr>` +
    `</table></td></tr></table></body></html>`;

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
