/**
 * La cáscara que comparten los correos que manda la aplicación.
 *
 * ⚠️ **Existe para que no diverjan.** El resumen diario y el aviso de una
 * solicitud de la web son dos correos del mismo negocio y llegan al mismo
 * buzón: con cada uno maquetado por su cuenta, el segundo que alguien toque
 * acaba con otro gris, otro interlineado y otro ancho, y la cuenta parece de dos
 * empresas. Es la misma razón por la que la marca de los PDF vive en un solo
 * `brand.ts`.
 *
 * ⚠️ **Y va con estilos EN LÍNEA.** Los clientes de correo tiran las hojas de
 * estilo: Gmail borra el `<style>` del `<head>` en la vista móvil, y lo que
 * queda es texto sin formato con lo importante perdido entre lo demás.
 *
 * ⚠️ **Se lee en un móvil, de pie y con prisa.** No es un informe: no lleva
 * logotipo grande, ni tabla de dos columnas que se rompa en pantalla estrecha,
 * ni colores de marca compitiendo con lo único que importa.
 */

/** Escapa lo que rompería el HTML. Un cliente llamado «Pérez & Hijos» basta. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const GRIS = '#5b6b6f';
export const TINTA = '#14181a';
export const ROJO = '#b3261e';
export const TURQUESA = '#20a48f';

/**
 * ⚠️ **La familia va repetida en cada elemento y no en el `<body>`.** Outlook no
 * hereda `font-family` dentro de una tabla, así que lo que no la lleve encima
 * sale en Times New Roman — y estos correos son casi todo tabla.
 */
export const TIPO = '-apple-system,Segoe UI,Roboto,sans-serif';

/** Un rótulo de sección: versalitas turquesa, como los PDF de la casa. */
export function seccion(titulo: string, cuerpo: string): string {
  if (!cuerpo) return '';
  return (
    `<tr><td style="padding:22px 0 6px 0;font:600 12px/1.4 ${TIPO};` +
    `letter-spacing:.09em;text-transform:uppercase;color:${TURQUESA}">${esc(titulo)}</td></tr>` +
    cuerpo
  );
}

/** Una fila: lo principal, lo que lo explica y, si hay, lo que grita. */
export function fila(principal: string, secundario: string, alerta?: string): string {
  return (
    `<tr><td style="padding:9px 0;border-top:1px solid #e6eaea">` +
    `<div style="font:600 15px/1.35 ${TIPO};color:${TINTA}">${principal}</div>` +
    `<div style="font:400 13px/1.5 ${TIPO};color:${GRIS}">${secundario}</div>` +
    (alerta
      ? `<div style="margin-top:4px;font:700 13px/1.4 ${TIPO};color:${ROJO}">${alerta}</div>`
      : '') +
    `</td></tr>`
  );
}

/**
 * Un aviso en caja, con su filete de color a la izquierda.
 *
 * ⚠️ **El urgente va en rojo y en negrita, no solo en otro tono.** Un aviso que
 * se distingue únicamente por el color del fondo desaparece en un cliente de
 * correo que fuerce su propio tema — y son justo los que no pueden pasarse.
 */
export function aviso(texto: string, urgente: boolean): string {
  return (
    `<tr><td style="padding:10px 12px;margin:0;border-radius:8px;` +
    `background:${urgente ? '#fdeceb' : '#fbf3e2'};` +
    `border-left:4px solid ${urgente ? ROJO : '#c98500'}">` +
    `<div style="font:${urgente ? '700' : '600'} 13px/1.45 ${TIPO};` +
    `color:${urgente ? ROJO : TINTA}">${esc(texto)}</div></td></tr>` +
    `<tr><td style="height:6px"></td></tr>`
  );
}

/**
 * Un botón.
 *
 * ⚠️ **Es una tabla y no un `<a>` con relleno**, porque Outlook ignora el
 * `padding` de un enlace: el botón saldría como texto subrayado. Con la celda
 * de por medio, el color y la caja llegan a todas partes.
 */
export function boton(texto: string, url: string): string {
  return (
    `<tr><td style="padding-top:20px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="background:${TURQUESA};border-radius:999px">` +
    `<a href="${esc(url)}" style="display:inline-block;padding:11px 22px;` +
    `font:600 14px/1 ${TIPO};color:#ffffff;text-decoration:none">${esc(texto)}</a>` +
    `</td></tr></table></td></tr>`
  );
}

export interface SobreOpciones {
  /** El titular, en grande. Lo primero que se lee. */
  titulo: string;
  /** La línea de debajo: quién lo manda y de qué va. */
  entradilla: string;
  /** Las filas ya montadas. */
  cuerpo: string;
  /** El pie gris, que explica por qué llega este correo. */
  pie: string;
}

/**
 * El sobre: fondo, tarjeta blanca, titular y pie.
 *
 * ⚠️ **560 px de ancho máximo y `width="100%"`**, que es lo que hace que se lea
 * en un móvil sin ampliar. Un ancho fijo obliga a desplazarse en horizontal para
 * leer cada línea, y este correo se abre de pie en la calle.
 */
export function sobre(o: SobreOpciones): string {
  return (
    `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#f4f6f6">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f6">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="max-width:560px;background:#fff;border-radius:12px;padding:24px">` +
    `<tr><td style="font:700 20px/1.3 ${TIPO};color:${TINTA}">${esc(o.titulo)}</td></tr>` +
    `<tr><td style="padding-top:4px;font:400 13px/1.5 ${TIPO};color:${GRIS}">` +
    `${esc(o.entradilla)}</td></tr>` +
    o.cuerpo +
    `<tr><td style="padding-top:24px;border-top:1px solid #e6eaea;` +
    `font:400 11px/1.5 ${TIPO};color:${GRIS}">${esc(o.pie)}</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
