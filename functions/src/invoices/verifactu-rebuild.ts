/**
 * El registro que se manda, reconstruido desde la factura.
 *
 * ⚠️ **Por qué no se manda tal cual el que se guardó al emitir.** Un registro
 * rechazado por la AEAT **no queda registrado**: hay que corregirlo y volver a
 * enviarlo. Pero la factura es inmutable, así que un registro congelado con un
 * error dentro no se puede arreglar **nunca**, y como todo lo que venga detrás
 * encadena con su huella, la facturación entera se queda parada sin remedio
 * dentro de la aplicación.
 *
 * Pasó de verdad el 9 de septiembre de 2026 contra preproducción: el NIF-IVA de
 * un cliente rumano iba en `NIF` en vez de en `IDOtro`, la AEAT devolvió el
 * `1100` y la cadena se bloqueó. El fallo estaba en el código, se arregló en
 * diez minutos — y el registro guardado seguía siendo el malo.
 *
 * Así que el registro se **reconstruye** con el código de hoy a partir de los
 * campos de la factura, que son los que de verdad son inmutables. Lo que no se
 * puede recalcular —el encadenamiento, el sistema informático, el instante de
 * generación y la huella— se toma del registro guardado, porque son hechos
 * históricos y no derivados.
 *
 * ⚠️ **Y la huella se COMPRUEBA, no se copia.** Se recalcula desde los datos
 * reconstruidos y tiene que dar la que se selló al emitir. Es lo que separa
 * «corregir cómo se declara un dato» de «cambiar la factura»: los campos que
 * entran en la huella —emisor, número, fecha, tipo, cuota, total, huella
 * anterior e instante— no pueden moverse, y si se mueven esto lo dice en vez de
 * mandar a la Agencia un registro que no se corresponde con el documento.
 */

import { computeRegistroAltaHash, formatFechaExpedicion, TipoFacturaAeat } from './hash';
import { buildRegistroAlta, sistemaInformatico, type RegistroAlta } from './verifactu';
import type { InvoiceLineInput, InvoiceTotals } from './invoice-core';

export class RegistroInconsistenteError extends Error {
  constructor(
    readonly fullNumber: string,
    readonly huellaGuardada: string,
    readonly huellaRecalculada: string
  ) {
    super(
      `verifactu: la huella de ${fullNumber} no se reproduce ` +
        `(guardada ${huellaGuardada}, recalculada ${huellaRecalculada})`
    );
    this.name = 'RegistroInconsistenteError';
  }
}

/** La factura tal y como quedó guardada, en lo que hace falta para el registro. */
export interface FacturaGuardada {
  fullNumber: string;
  issueDate: Date;
  operationDate?: Date | null;
  tipoFacturaAeat: TipoFacturaAeat;
  recipient?: { name?: string; taxId?: string; countryCode?: string } | null;
  lines?: InvoiceLineInput[];
  totals: InvoiceTotals;
  rectifyingType?: 'S' | 'I' | null;
  rectifies?: { fullNumber?: string; issueDate?: Date | null } | null;
  rectifiedBase?: number | null;
  rectifiedVat?: number | null;
  /** El registro sellado al emitir. De aquí salen los hechos históricos. */
  verifactu: RegistroAlta;
}

export function registroParaEnvio(
  factura: FacturaGuardada,
  emisor: { nif: string; nombre: string }
): RegistroAlta {
  const guardado = factura.verifactu;

  /**
   * El encadenamiento sale del registro guardado y **no se recalcula**: dice con
   * qué factura se encadenó esta al emitirse, que es un hecho de aquel momento.
   * Recalcularlo hoy lo ataría a la última factura emitida, que ya es otra.
   */
  const anterior =
    'RegistroAnterior' in guardado.Encadenamiento
      ? {
          numSerieFactura: guardado.Encadenamiento.RegistroAnterior.NumSerieFactura,
          fechaExpedicionFactura:
            guardado.Encadenamiento.RegistroAnterior.FechaExpedicionFactura,
          huella: guardado.Encadenamiento.RegistroAnterior.Huella
        }
      : undefined;

  const fechaExpedicion = formatFechaExpedicion(factura.issueDate);

  /**
   * ⚠️ La huella se recalcula **antes** de construir nada, y con los datos de la
   * factura, no con los del registro guardado. Comparándola contra la sellada se
   * comprueba que la factura de la que estamos reconstruyendo es la misma que
   * generó aquel registro. Si alguien tocara un importe —cosa que las reglas ya
   * impiden—, esto lo cazaría antes de mandarlo.
   */
  const huellaRecalculada = computeRegistroAltaHash({
    idEmisorFactura: emisor.nif,
    numSerieFactura: factura.fullNumber,
    fechaExpedicion: factura.issueDate,
    tipoFactura: factura.tipoFacturaAeat,
    cuotaTotal: factura.totals.vat,
    importeTotal: factura.totals.total,
    huellaAnterior: anterior?.huella || '',
    // El instante es el que se selló: recalcularlo daría «ahora», y la huella
    // de un registro no puede depender de cuándo se reintenta el envío.
    fechaHoraGenRegistro: new Date(guardado.FechaHoraHusoGenRegistro)
  });

  if (huellaRecalculada !== guardado.Huella) {
    throw new RegistroInconsistenteError(
      factura.fullNumber,
      guardado.Huella,
      huellaRecalculada
    );
  }

  const esRectificativa = !!factura.rectifyingType;

  return buildRegistroAlta({
    emisorNif: emisor.nif,
    emisorNombre: emisor.nombre,
    fullNumber: factura.fullNumber,
    fechaExpedicion,
    fechaOperacion: factura.operationDate
      ? formatFechaExpedicion(factura.operationDate)
      : undefined,
    tipoFactura: factura.tipoFacturaAeat,
    tipoRectificativa: factura.rectifyingType || undefined,
    rectificada:
      esRectificativa && factura.rectifies?.fullNumber
        ? {
            numSerieFactura: factura.rectifies.fullNumber,
            fechaExpedicionFactura: formatFechaExpedicion(
              factura.rectifies.issueDate || factura.issueDate
            )
          }
        : undefined,
    importeRectificacion:
      esRectificativa &&
      typeof factura.rectifiedBase === 'number' &&
      typeof factura.rectifiedVat === 'number'
        ? { baseRectificada: factura.rectifiedBase, cuotaRectificada: factura.rectifiedVat }
        : undefined,
    descripcionOperacion: (factura.lines || [])
      .map((l) => l.description)
      .filter(Boolean)
      .join('; '),
    destinatario: factura.recipient?.name
      ? {
          nombreRazon: factura.recipient.name,
          nif: factura.recipient.taxId,
          codigoPais: factura.recipient.countryCode
        }
      : undefined,
    lines: factura.lines || [],
    desglose: factura.totals.byVatRate,
    exemptTotal: factura.totals.exemptTotal,
    cuotaTotal: factura.totals.vat,
    importeTotal: factura.totals.total,
    anterior,
    /**
     * ⚠️ **El sistema informático sale del registro guardado, no de la
     * configuración de hoy.** Identifica al programa que **emitió** la factura,
     * con su versión: poner la versión actual diría que una factura de marzo la
     * emitió el software de septiembre. Y esa versión es la que ampara la
     * declaración responsable del art. 15 de aquel momento.
     */
    sistema: sistemaGuardado(guardado, emisor),
    fechaHoraHusoGenRegistro: guardado.FechaHoraHusoGenRegistro,
    huella: guardado.Huella
  });
}

function sistemaGuardado(
  guardado: RegistroAlta,
  emisor: { nif: string; nombre: string }
): ReturnType<typeof sistemaInformatico> {
  const s = guardado.SistemaInformatico;
  if (!s?.IdSistemaInformatico) return sistemaInformatico(emisor.nif, emisor.nombre);
  return {
    nombreSistemaInformatico: s.NombreSistemaInformatico,
    nombreRazonProductor: s.NombreRazon,
    nifProductor: s.NIF,
    idSistemaInformatico: s.IdSistemaInformatico,
    version: s.Version,
    numeroInstalacion: s.NumeroInstalacion,
    tipoUsoPosibleSoloVerifactu: s.TipoUsoPosibleSoloVerifactu,
    tipoUsoPosibleMultiOT: s.TipoUsoPosibleMultiOT,
    indicadorMultiplesOT: s.IndicadorMultiplesOT
  };
}
