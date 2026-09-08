/**
 * El registro de facturación de VeriFactu, y el QR de cotejo.
 *
 * Lo que hay aquí es **todo lo que no necesita hablar con la AEAT**: construir
 * el registro con la forma que exige la Orden HAC/1177/2024 y la URL del QR.
 * El envío —XML SOAP firmado, estados, reintentos— va aparte y no se puede dar
 * por bueno sin probarlo contra el entorno de preproducción, que necesita alta.
 *
 * ⚠️ **Esto se guarda desde HOY aunque no se envíe hasta 2027**, por el mismo
 * motivo por el que ya se encadena la huella: **una factura emitida no se puede
 * editar**. Lo que no se guarde al emitirla no se podrá añadir después, y en
 * enero habría que reconstruir el registro de cada factura de 2026 a partir de
 * lo que quedara — que es exactamente lo que `docs/facturacion.md` advierte que
 * la fase 3 no puede rescatar.
 *
 * Fuentes:
 * - Orden HAC/1177/2024 (BOE-A-2024-22138), anexo de diseño de registro.
 * - AEAT, «Veri-Factu — especificaciones de la huella o hash».
 *
 * ⚠️ **Antes de enviar nada de verdad, contrastar los nombres de campo y la URL
 * de cotejo contra la versión vigente de esas especificaciones.** Aquí están
 * escritos para que el registro nazca completo, no para dar por cerrada la
 * integración.
 */

import type { TipoFacturaAeat } from './hash';

/** `01` = SHA-256. Es el único valor admitido hoy. */
export const TIPO_HUELLA_SHA256 = '01';

/** Versión del esquema. La fija la AEAT, no nosotros. */
export const VERIFACTU_ID_VERSION = '1.0';

/**
 * El bloque «Sistema Informático» del registro.
 *
 * ⚠️ **Es obligatorio y no es cosmético.** Identifica al programa que emite, y
 * la norma responsabiliza al productor del software de que cumpla el RD
 * 1007/2023. Aquí el productor **es la propia empresa**: la aplicación es
 * desarrollo propio, así que el NIF del productor y el del emisor coinciden.
 * Eso es lo normal en autodesarrollo y es lo que hay que declarar.
 */
export interface SistemaInformatico {
  /** Nombre comercial del sistema. */
  nombreSistemaInformatico: string;
  /** Razón social de quien lo produce. En autodesarrollo, la propia empresa. */
  nombreRazonProductor: string;
  /** NIF del productor. */
  nifProductor: string;
  /** Identificador del sistema dado por el productor. Máx. 2 caracteres. */
  idSistemaInformatico: string;
  /** Versión. Cambiarla cuando cambie lo que afecta al registro. */
  version: string;
  /** Número de instalación del sistema en este emisor. */
  numeroInstalacion: string;
  /** ¿Solo puede funcionar como VERI*FACTU? */
  tipoUsoPosibleSoloVerifactu: 'S' | 'N';
  /** ¿Puede usarse para varios obligados tributarios? */
  tipoUsoPosibleMultiOT: 'S' | 'N';
  /** ¿Lo está usando ahora más de un obligado tributario? */
  indicadorMultiplesOT: 'S' | 'N';
}

/**
 * El sistema, tal y como se declara.
 *
 * ⚠️ **`SoloVerifactu: 'N'`** porque la aplicación **guarda el registro aunque
 * no lo remita**: hoy no envía nada. Declarar `'S'` sería afirmar que solo
 * funciona en modo remisión, que no es cierto todavía.
 *
 * ⚠️ **`MultiOT: 'N'`** porque emite para un único obligado tributario, VELTO
 * MOBILITY. El día que la aplicación facture para otra empresa, esto cambia y
 * el registro cambia con ello.
 */
export function sistemaInformatico(taxId: string, legalName: string): SistemaInformatico {
  return {
    nombreSistemaInformatico: 'Velto Store',
    nombreRazonProductor: legalName,
    nifProductor: taxId,
    idSistemaInformatico: process.env.VELTO_VERIFACTU_SYSTEM_ID || 'VS',
    version: process.env.VELTO_VERIFACTU_SYSTEM_VERSION || '1.0',
    numeroInstalacion: process.env.VELTO_VERIFACTU_INSTALLATION || '001',
    tipoUsoPosibleSoloVerifactu: 'N',
    tipoUsoPosibleMultiOT: 'N',
    indicadorMultiplesOT: 'N'
  };
}

/** Una línea del desglose, por tipo impositivo y régimen. */
export interface DetalleDesglose {
  /** Clave de régimen: `01` general, `04` REBU, `02` exportación… */
  claveRegimen: string;
  /** `S1` sujeta y no exenta, `S2` inversión del sujeto pasivo, `N1`/`N2` no sujeta. */
  calificacionOperacion?: string;
  /** Solo en exentas: el motivo, `E1`…`E6`. */
  operacionExenta?: string;
  tipoImpositivo?: string;
  baseImponibleOimporteNoSujeto: string;
  cuotaRepercutida?: string;
}

export interface RegistroAnterior {
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  huella: string;
}

export interface RegistroAlta {
  idVersion: string;
  idFactura: {
    idEmisorFactura: string;
    numSerieFactura: string;
    fechaExpedicionFactura: string;
  };
  nombreRazonEmisor: string;
  tipoFactura: TipoFacturaAeat;
  /** `S` sustitución o `I` diferencias. Solo en rectificativas. */
  tipoRectificativa?: 'S' | 'I';
  /** A qué factura rectifica. Solo en rectificativas. */
  facturasRectificadas?: { idEmisorFactura: string; numSerieFactura: string; fechaExpedicionFactura: string }[];
  /** Base y cuota rectificadas. Solo en la modalidad `S`. */
  importeRectificacion?: { baseRectificada: string; cuotaRectificada: string };
  descripcionOperacion: string;
  destinatarios?: { nombreRazon: string; nif?: string; idOtro?: { idType: string; id: string } }[];
  desglose: DetalleDesglose[];
  cuotaTotal: string;
  importeTotal: string;
  /**
   * El encadenamiento.
   *
   * ⚠️ **Necesita los CUATRO datos del registro anterior**, no solo su huella.
   * La factura guardaba únicamente `previousHash`, así que el número y la fecha
   * del anterior habría que buscarlos después por huella — sobre una colección
   * que no se puede editar. Aquí van dentro del registro, que nace con la
   * factura y muere con ella.
   */
  encadenamiento: { primerRegistro: 'S' } | { registroAnterior: RegistroAnterior };
  sistemaInformatico: SistemaInformatico;
  fechaHoraHusoGenRegistro: string;
  tipoHuella: string;
  huella: string;
}

/**
 * Cómo se declara cada régimen de IVA de la aplicación.
 *
 * ⚠️ **No es una traducción de etiquetas, es cómo tributa cada línea.** La
 * clave de régimen y la calificación son campos distintos y la AEAT los cruza:
 * una exenta intracomunitaria declarada como sujeta y no exenta es una factura
 * con el impuesto mal declarado, no un error de formato.
 */
const REGIMEN: Record<
  string,
  { claveRegimen: string; calificacion?: string; exenta?: string }
> = {
  // Régimen general: sujeta y no exenta.
  standard: { claveRegimen: '01', calificacion: 'S1' },
  // Bienes usados: régimen especial propio, con la cuota calculada al margen.
  rebu: { claveRegimen: '03', calificacion: 'S1' },
  // Entrega intracomunitaria exenta, art. 25 LIVA.
  exempt_eu: { claveRegimen: '01', exenta: 'E5' },
  // Exportación, art. 21 LIVA.
  exempt_export: { claveRegimen: '02', exenta: 'E2' },
  // Inversión del sujeto pasivo: sujeta, pero la declara el destinatario.
  reverse_charge: { claveRegimen: '01', calificacion: 'S2' },
  // Exenta por otra causa; la norma concreta la escribe el operador.
  exempt_other: { claveRegimen: '01', exenta: 'E6' }
};

export interface RegistroAltaBuildInput {
  emisorNif: string;
  emisorNombre: string;
  fullNumber: string;
  /** Ya en `dd-mm-aaaa`: la compone `formatFechaExpedicion`. */
  fechaExpedicion: string;
  tipoFactura: TipoFacturaAeat;
  tipoRectificativa?: 'S' | 'I';
  rectificada?: { numSerieFactura: string; fechaExpedicionFactura: string };
  importeRectificacion?: { baseRectificada: number; cuotaRectificada: number };
  descripcionOperacion: string;
  destinatario?: { nombreRazon: string; nif?: string };
  lines: { taxRegime?: string; vatRate?: number; exemptionNote?: string }[];
  desglose: { vatRate: number; base: number; vat: number }[];
  exemptTotal?: number;
  cuotaTotal: number;
  importeTotal: number;
  anterior?: { numSerieFactura: string; fechaExpedicionFactura: string; huella: string };
  sistema: SistemaInformatico;
  fechaHoraHusoGenRegistro: string;
  huella: string;
}

/** Dos decimales exactos, como en la huella: el formato no se negocia. */
function importe(value: number): string {
  return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
}

/**
 * El registro de alta, listo para guardar con la factura.
 *
 * Se construye **dentro de la transacción que emite**, con los mismos datos que
 * sellaron la huella. Reconstruirlo después a partir de la factura guardada
 * daría un registro parecido y no necesariamente el mismo.
 */
export function buildRegistroAlta(input: RegistroAltaBuildInput): RegistroAlta {
  const regimenes = new Set(
    (input.lines || []).map((l) => (l.taxRegime || 'standard') as string)
  );

  const desglose: DetalleDesglose[] = input.desglose.map((d) => {
    // El régimen de la línea manda; con varias mezcladas se declara el general,
    // que es el de la parte que lleva cuota.
    const clave = regimenes.has('rebu') && regimenes.size === 1 ? REGIMEN['rebu'] : REGIMEN['standard'];
    return {
      claveRegimen: clave.claveRegimen,
      calificacionOperacion: clave.calificacion,
      tipoImpositivo: (Math.round(d.vatRate * 10000) / 100).toFixed(2),
      baseImponibleOimporteNoSujeto: importe(d.base),
      cuotaRepercutida: importe(d.vat)
    };
  });

  /**
   * Las exentas van **fuera del desglose por tipo**: no son un 0 %, son otra
   * cosa. Cada una lleva su clave de exención, que es lo que dice por qué no
   * hay cuota.
   */
  if (input.exemptTotal) {
    for (const key of ['exempt_eu', 'exempt_export', 'exempt_other', 'reverse_charge']) {
      if (!regimenes.has(key)) continue;
      const r = REGIMEN[key];
      desglose.push({
        claveRegimen: r.claveRegimen,
        calificacionOperacion: r.calificacion,
        operacionExenta: r.exenta,
        baseImponibleOimporteNoSujeto: importe(input.exemptTotal)
      });
    }
  }

  const registro: RegistroAlta = {
    idVersion: VERIFACTU_ID_VERSION,
    idFactura: {
      idEmisorFactura: input.emisorNif.trim(),
      numSerieFactura: input.fullNumber.trim(),
      fechaExpedicionFactura: input.fechaExpedicion
    },
    nombreRazonEmisor: input.emisorNombre,
    tipoFactura: input.tipoFactura,
    descripcionOperacion: (input.descripcionOperacion || '').slice(0, 500),
    desglose,
    cuotaTotal: importe(input.cuotaTotal),
    importeTotal: importe(input.importeTotal),
    encadenamiento: input.anterior
      ? {
          registroAnterior: {
            idEmisorFactura: input.emisorNif.trim(),
            numSerieFactura: input.anterior.numSerieFactura,
            fechaExpedicionFactura: input.anterior.fechaExpedicionFactura,
            huella: input.anterior.huella
          }
        }
      : { primerRegistro: 'S' },
    sistemaInformatico: input.sistema,
    fechaHoraHusoGenRegistro: input.fechaHoraHusoGenRegistro,
    tipoHuella: TIPO_HUELLA_SHA256,
    huella: input.huella
  };

  if (input.destinatario?.nombreRazon) {
    registro.destinatarios = [
      { nombreRazon: input.destinatario.nombreRazon, nif: input.destinatario.nif }
    ];
  }

  if (input.tipoRectificativa) {
    registro.tipoRectificativa = input.tipoRectificativa;
    if (input.rectificada) {
      registro.facturasRectificadas = [
        {
          idEmisorFactura: input.emisorNif.trim(),
          numSerieFactura: input.rectificada.numSerieFactura,
          fechaExpedicionFactura: input.rectificada.fechaExpedicionFactura
        }
      ];
    }
    // ⚠️ Solo en `S`. En `I` la rectificativa ya declara el ajuste con su signo
    // y no hay nada que sustituir: son campos distintos del registro, no una
    // variante de formato.
    if (input.tipoRectificativa === 'S' && input.importeRectificacion) {
      registro.importeRectificacion = {
        baseRectificada: importe(input.importeRectificacion.baseRectificada),
        cuotaRectificada: importe(input.importeRectificacion.cuotaRectificada)
      };
    }
  }

  return registro;
}

/**
 * Las URL de cotejo de la AEAT.
 *
 * ⚠️ **Dos entornos, y el de pruebas NO valida facturas reales.** Se elige con
 * `VELTO_VERIFACTU_ENV`, igual que Redsys elige `test` o `live`, para que una
 * factura de desarrollo no lleve un QR que apunte al validador de producción.
 */
const QR_BASE_PRODUCCION =
  'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR';
const QR_BASE_PRUEBAS = 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR';

export function qrBaseUrl(): string {
  return process.env.VELTO_VERIFACTU_ENV === 'live' ? QR_BASE_PRODUCCION : QR_BASE_PRUEBAS;
}

/**
 * La URL que va dentro del QR.
 *
 * Cuatro parámetros y en este orden: NIF del emisor, número de factura, fecha
 * de expedición y importe total. Van **codificados**: el número de factura
 * lleva una barra (`2026/0001`) y sin escapar rompería la URL.
 */
export function buildQrUrl(input: {
  nif: string;
  numSerieFactura: string;
  fechaExpedicion: string;
  importeTotal: string;
}): string {
  const params = new URLSearchParams({
    nif: input.nif.trim(),
    numserie: input.numSerieFactura.trim(),
    fecha: input.fechaExpedicion,
    importe: input.importeTotal
  });
  return `${qrBaseUrl()}?${params.toString()}`;
}

/**
 * ¿Se imprime el QR y su leyenda?
 *
 * ⚠️ **Solo cuando el registro se remita de verdad.** «Factura verificable en
 * la sede electrónica de la AEAT» impresa sobre una factura que nunca se envió
 * es una promesa falsa: el cliente escanea, la sede no encuentra nada y lo que
 * parece roto es la factura. Es exactamente el error de la frase que anunciaba
 * una firma digital que el contrato no llevaba, y se resuelve igual — la frase
 * y el hecho se deciden juntos.
 *
 * Hasta que el envío funcione, el registro se guarda y el documento calla.
 */
export function verifactuEnabled(): boolean {
  return process.env.VELTO_VERIFACTU_ENABLED === 'true';
}
