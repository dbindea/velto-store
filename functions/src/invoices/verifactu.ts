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

/** `01` = IVA, en el catálogo `ImpuestoType` del esquema. */
export const IMPUESTO_IVA = '01';

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
 * ⚠️ **`SoloVerifactu: 'S'`, decisión de Dorel del 9 de septiembre de 2026:**
 * la modalidad es **exclusivamente VERI\*FACTU**. El campo describe **cómo es el
 * sistema**, no en qué punto de su despliegue está: esta aplicación no va a
 * operar nunca en la modalidad no verificable —la que obliga a firmar cada
 * registro y a sostener durante años la prueba de que nada se ha tocado—, así
 * que declarar `'N'` sería reservarse una posibilidad que no existe.
 *
 * ⚠️ **`MultiOT: 'N'`** porque emite para un único obligado tributario, VELTO
 * MOBILITY, que es además quien produce el software. El día que la aplicación
 * facture para otra empresa, esto cambia y el registro cambia con ello.
 *
 * Estos tres valores son los mismos que declara la **declaración responsable**
 * del art. 15, y no pueden discrepar: son el mismo hecho contado en dos sitios.
 * Por eso salen de aquí y la declaración los lee, en vez de escribirlos aparte.
 */
export function sistemaInformatico(taxId: string, legalName: string): SistemaInformatico {
  return {
    nombreSistemaInformatico: VERIFACTU_SYSTEM_NAME,
    nombreRazonProductor: legalName,
    nifProductor: taxId,
    idSistemaInformatico: process.env.VELTO_VERIFACTU_SYSTEM_ID || 'VS',
    version: verifactuSystemVersion(),
    numeroInstalacion: process.env.VELTO_VERIFACTU_INSTALLATION || '001',
    tipoUsoPosibleSoloVerifactu: 'S',
    tipoUsoPosibleMultiOT: 'N',
    indicadorMultiplesOT: 'N'
  };
}

/** El nombre comercial del sistema. Un solo sitio: lo citan el registro y la declaración. */
export const VERIFACTU_SYSTEM_NAME = 'Velto Store';

/**
 * La versión del sistema informático.
 *
 * ⚠️ **Hay que generar una declaración responsable por CADA versión** (art. 15),
 * así que este número no es decorativo: cambiarlo obliga a emitir una
 * declaración nueva, y la pantalla de Ajustes avisa cuando la vigente no
 * corresponde a la versión que está corriendo.
 */
export function verifactuSystemVersion(): string {
  return process.env.VELTO_VERIFACTU_SYSTEM_VERSION || '1.0';
}

/**
 * Una línea del desglose.
 *
 * ⚠️ **`CalificacionOperacion` y `OperacionExenta` son alternativas**, no dos
 * campos que se rellenen a la vez: en el esquema forman un `choice`. Una exenta
 * lleva su clave de exención y **no** lleva calificación; una sujeta, al revés.
 */
export interface DetalleDesglose {
  /** `01` = IVA. */
  Impuesto?: string;
  /** `01` general, `02` exportación, `03` bienes usados (REBU)… */
  ClaveRegimen?: string;
  /** `S1` sujeta y no exenta, `S2` con inversión del sujeto pasivo. */
  CalificacionOperacion?: string;
  /** `E1` art. 20 · `E2` art. 21 · `E3` art. 22 · `E4` arts. 23 y 24 · `E5` art. 25 · `E6` otros. */
  OperacionExenta?: string;
  TipoImpositivo?: string;
  BaseImponibleOimporteNoSujeto: string;
  CuotaRepercutida?: string;
}

export interface RegistroAnterior {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  Huella: string;
}

/**
 * El registro de alta.
 *
 * ⚠️ **Los nombres de campo son los del esquema oficial, en mayúsculas y con su
 * grafía exacta** (`SuministroInformacion.xsd`, `RegistroFacturacionAltaType`).
 * No es un capricho de estilo: así el XML es una **serialización directa** de
 * este objeto, sin una tabla de traducción en medio que alguien tenga que
 * mantener y en la que un nombre mal escrito produzca un registro que la AEAT
 * rechaza. El orden de las propiedades es también el del esquema, porque en un
 * `xs:sequence` el orden forma parte de la validación.
 */
export interface RegistroAlta {
  IDVersion: string;
  IDFactura: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
  NombreRazonEmisor: string;
  TipoFactura: TipoFacturaAeat;
  /** `S` sustitutiva o `I` incremental (por diferencias). Solo en rectificativas. */
  TipoRectificativa?: 'S' | 'I';
  /** A qué factura rectifica. Solo en rectificativas. */
  FacturasRectificadas?: {
    IDFacturaRectificada: {
      IDEmisorFactura: string;
      NumSerieFactura: string;
      FechaExpedicionFactura: string;
    }[];
  };
  /** Base y cuota rectificadas. Solo en la modalidad `S`. */
  ImporteRectificacion?: { BaseRectificada: string; CuotaRectificada: string };
  /** Solo si difiere de la de expedición. */
  FechaOperacion?: string;
  DescripcionOperacion: string;
  Destinatarios?: { IDDestinatario: { NombreRazon: string; NIF?: string }[] };
  Desglose: { DetalleDesglose: DetalleDesglose[] };
  CuotaTotal: string;
  ImporteTotal: string;
  /**
   * El encadenamiento.
   *
   * ⚠️ **Necesita los CUATRO datos del registro anterior**, no solo su huella.
   * La factura guardaba únicamente `previousHash`, así que el número y la fecha
   * del anterior habría que buscarlos después por huella — sobre una colección
   * que no se puede editar. Aquí van dentro del registro, que nace con la
   * factura y muere con ella.
   */
  Encadenamiento: { PrimerRegistro: 'S' } | { RegistroAnterior: RegistroAnterior };
  SistemaInformatico: SistemaInformaticoXml;
  FechaHoraHusoGenRegistro: string;
  TipoHuella: string;
  Huella: string;
}

/** El bloque del sistema, con los nombres del esquema. */
export interface SistemaInformaticoXml {
  NombreRazon: string;
  NIF: string;
  NombreSistemaInformatico: string;
  IdSistemaInformatico: string;
  Version: string;
  NumeroInstalacion: string;
  TipoUsoPosibleSoloVerifactu: 'S' | 'N';
  TipoUsoPosibleMultiOT: 'S' | 'N';
  IndicadorMultiplesOT: 'S' | 'N';
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
  /**
   * Cuándo se prestó el servicio, en `dd-mm-aaaa`. Solo va al registro si
   * difiere de la expedición, que es el caso normal aquí: se factura en agosto
   * un alquiler de junio.
   */
  fechaOperacion?: string;
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

  const detalle: DetalleDesglose[] = input.desglose.map((d) => {
    // El régimen de la línea manda; con varias mezcladas se declara el general,
    // que es el de la parte que lleva cuota.
    const clave =
      regimenes.has('rebu') && regimenes.size === 1 ? REGIMEN['rebu'] : REGIMEN['standard'];
    return {
      Impuesto: IMPUESTO_IVA,
      ClaveRegimen: clave.claveRegimen,
      CalificacionOperacion: clave.calificacion,
      // ⚠️ El esquema lo quiere como **porcentaje** (`21.00`), no como la
      // fracción `0.21` con la que trabaja la aplicación.
      TipoImpositivo: (Math.round(d.vatRate * 10000) / 100).toFixed(2),
      BaseImponibleOimporteNoSujeto: importe(d.base),
      CuotaRepercutida: importe(d.vat)
    };
  });

  /**
   * Las exentas van **fuera del desglose por tipo**: no son un 0 %, son otra
   * cosa. Cada una lleva su clave de exención —y **no** calificación, que en el
   * esquema son alternativas— y es lo que dice por qué no hay cuota.
   */
  if (input.exemptTotal) {
    for (const key of ['exempt_eu', 'exempt_export', 'exempt_other', 'reverse_charge']) {
      if (!regimenes.has(key)) continue;
      const r = REGIMEN[key];
      detalle.push({
        Impuesto: IMPUESTO_IVA,
        ClaveRegimen: r.claveRegimen,
        CalificacionOperacion: r.calificacion,
        OperacionExenta: r.exenta,
        BaseImponibleOimporteNoSujeto: importe(input.exemptTotal)
      });
    }
  }

  const registro: RegistroAlta = {
    IDVersion: VERIFACTU_ID_VERSION,
    IDFactura: {
      IDEmisorFactura: input.emisorNif.trim(),
      NumSerieFactura: input.fullNumber.trim(),
      FechaExpedicionFactura: input.fechaExpedicion
    },
    NombreRazonEmisor: input.emisorNombre,
    TipoFactura: input.tipoFactura,
    DescripcionOperacion: (input.descripcionOperacion || '').slice(0, 500),
    Desglose: { DetalleDesglose: detalle },
    CuotaTotal: importe(input.cuotaTotal),
    ImporteTotal: importe(input.importeTotal),
    Encadenamiento: input.anterior
      ? {
          RegistroAnterior: {
            IDEmisorFactura: input.emisorNif.trim(),
            NumSerieFactura: input.anterior.numSerieFactura,
            FechaExpedicionFactura: input.anterior.fechaExpedicionFactura,
            Huella: input.anterior.huella
          }
        }
      : { PrimerRegistro: 'S' },
    SistemaInformatico: {
      NombreRazon: input.sistema.nombreRazonProductor,
      NIF: input.sistema.nifProductor,
      NombreSistemaInformatico: input.sistema.nombreSistemaInformatico,
      IdSistemaInformatico: input.sistema.idSistemaInformatico,
      Version: input.sistema.version,
      NumeroInstalacion: input.sistema.numeroInstalacion,
      TipoUsoPosibleSoloVerifactu: input.sistema.tipoUsoPosibleSoloVerifactu,
      TipoUsoPosibleMultiOT: input.sistema.tipoUsoPosibleMultiOT,
      IndicadorMultiplesOT: input.sistema.indicadorMultiplesOT
    },
    FechaHoraHusoGenRegistro: input.fechaHoraHusoGenRegistro,
    TipoHuella: TIPO_HUELLA_SHA256,
    Huella: input.huella
  };

  /**
   * ⚠️ Solo si difiere de la expedición, que es cuando la norma la pide.
   *
   * Es el caso normal aquí: se factura en agosto un alquiler de junio, y sin
   * este campo el registro diría que el servicio se prestó el día en que se
   * emitió la factura.
   */
  if (input.fechaOperacion && input.fechaOperacion !== input.fechaExpedicion) {
    registro.FechaOperacion = input.fechaOperacion;
  }

  if (input.destinatario?.nombreRazon) {
    registro.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: input.destinatario.nombreRazon, NIF: input.destinatario.nif }
      ]
    };
  }

  if (input.tipoRectificativa) {
    registro.TipoRectificativa = input.tipoRectificativa;
    if (input.rectificada) {
      registro.FacturasRectificadas = {
        IDFacturaRectificada: [
          {
            IDEmisorFactura: input.emisorNif.trim(),
            NumSerieFactura: input.rectificada.numSerieFactura,
            FechaExpedicionFactura: input.rectificada.fechaExpedicionFactura
          }
        ]
      };
    }
    // ⚠️ Solo en `S`. En `I` la rectificativa ya declara el ajuste con su signo
    // y no hay nada que sustituir: son campos distintos del registro, no una
    // variante de formato.
    if (input.tipoRectificativa === 'S' && input.importeRectificacion) {
      registro.ImporteRectificacion = {
        BaseRectificada: importe(input.importeRectificacion.baseRectificada),
        CuotaRectificada: importe(input.importeRectificacion.cuotaRectificada)
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
 * Los endpoints del servicio de remisión, tomados de `SistemaFacturacion.wsdl`.
 *
 * Operaciones del servicio `sfVerifactu`: `RegFactuSistemaFacturacion` para
 * enviar y `ConsultaFactuSistemaFacturacion` para consultar. SOAP
 * *document/literal*, con `soapAction` vacío.
 *
 * ⚠️ **Hay dos direcciones por entorno según el tipo de certificado**, y no son
 * intercambiables: `www1`/`prewww1` para certificado de **representante** —el
 * nuestro, el de la FNMT con el que ya se sellan los contratos— y
 * `www10`/`prewww10` para certificado de **sello**. Llamar a la que no toca es
 * un rechazo de autenticación que parece un problema del certificado.
 */
export const VERIFACTU_ENDPOINT_PRUEBAS =
  'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';
export const VERIFACTU_ENDPOINT_PRODUCCION =
  'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';
/** Las mismas, para certificado de sello. Hoy no se usan. */
export const VERIFACTU_ENDPOINT_PRUEBAS_SELLO =
  'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';
export const VERIFACTU_ENDPOINT_PRODUCCION_SELLO =
  'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';

/**
 * A dónde se remitiría el registro.
 *
 * ⚠️ Lo decide `VELTO_VERIFACTU_ENV`, igual que el QR, para que los dos no
 * puedan apuntar a entornos distintos: un QR de producción sobre un registro
 * enviado a pruebas sería una factura que dice ser cotejable y no lo es.
 */
export function verifactuEndpoint(): string {
  return process.env.VELTO_VERIFACTU_ENV === 'live'
    ? VERIFACTU_ENDPOINT_PRODUCCION
    : VERIFACTU_ENDPOINT_PRUEBAS;
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
