/**
 * El localizador de una reserva, tal y como lo ve el cliente.
 *
 * `R-P2RJP0`: los seis primeros caracteres del id de Firestore en mayúsculas.
 * No es un identificador nuevo ni se guarda en ningún sitio — es una forma
 * legible del que ya existe, para que alguien pueda leerlo por teléfono.
 *
 * ⚠️ **Vive aquí porque lo imprimen dos documentos distintos.** Estaba escrito
 * a mano dentro del justificante de reserva; en cuanto el recibo de cobro
 * necesitó el mismo dato, dos copias de la misma fórmula empiezan a poder
 * divergir — y el cliente tendría en la mano dos papeles del mismo alquiler con
 * dos referencias que no se parecen.
 */
export function reservationLocator(reservationId: string): string {
  return `R-${(reservationId || '').slice(0, 6).toUpperCase()}`;
}
