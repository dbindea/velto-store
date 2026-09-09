/**
 * La declaración responsable del art. 15 de la Orden HAC/1177/2024.
 *
 * ⚠️ **Le toca a Velto porque la aplicación es desarrollo propio.** Cuando se
 * compra un programa de facturación, su fabricante declara que cumple el RD
 * 1007/2023; aquí el productor del software y el obligado tributario son la
 * misma empresa, así que no hay nadie más que pueda declararlo.
 *
 * ⚠️ **Una declaración por CADA versión del sistema.** No es un papel que se
 * firme una vez: la norma lo ata a la versión concreta que está en uso, así que
 * cambiar la versión obliga a emitir una nueva. Por eso se guardan todas y
 * ninguna se borra — la de una versión pasada sigue acreditando lo que se
 * declaró mientras esa versión estuvo emitiendo facturas.
 *
 * Lo que declara tiene que coincidir **exactamente** con lo que la aplicación
 * mete en cada registro de facturación: son el mismo hecho contado en dos
 * sitios. Por eso los datos del sistema salen de `sistemaInformatico()` y no se
 * escriben aparte.
 */

import { PDFDocument } from 'pdf-lib';
import { PdfBuilder, companyFooterLines, companyHeaderLines, formatDate } from '../contracts/pdf';
import { sistemaInformatico, VERIFACTU_SYSTEM_NAME, verifactuSystemVersion } from './verifactu';

export interface DeclarationCompany {
  legalName: string;
  taxId: string;
  /** Domicilio social: la declaración identifica a la empresa como persona jurídica. */
  address: string;
  officeAddress?: string;
  phone?: string;
  email: string;
  registry?: string;
  brandName: string;
}

/**
 * Un componente del sistema.
 *
 * La Orden pide identificar **las partes que lo integran**, no solo el conjunto:
 * un sistema de facturación que corre en un navegador, unas funciones en la nube
 * y una base de datos son tres piezas con responsabilidades distintas, y la que
 * calcula la huella no es la misma que la que enseña el formulario.
 */
export interface SystemComponent {
  name: string;
  /** Qué hace, en una línea. Es lo que distingue un componente de otro. */
  role: string;
  version: string;
}

export interface ComplianceDeclaration {
  /** La versión del sistema que ampara. Una declaración por versión. */
  systemVersion: string;
  systemName: string;
  systemId: string;
  producerName: string;
  producerTaxId: string;
  /** `S`: el sistema opera exclusivamente en modalidad VERI\*FACTU. */
  onlyVerifactu: 'S' | 'N';
  multipleTaxpayers: 'S' | 'N';
  components: SystemComponent[];
  /** Fecha de la declaración. */
  declaredAt: Date;
  /** Lugar. La norma lo pide expresamente. */
  declaredPlace: string;
  /** Quién la generó, para el registro interno. */
  declaredByEmail?: string;
}

/**
 * Los componentes del sistema.
 *
 * Declarados por lo que **hacen frente al registro de facturación**, que es lo
 * que la norma quiere saber, y no por su tecnología: importa cuál calcula la
 * huella y cuál conserva los registros, no que uno esté escrito en Angular.
 */
export function systemComponents(version: string): SystemComponent[] {
  return [
    {
      name: 'Velto Store · Backoffice',
      role: 'Interfaz de emisión: captura los datos de la factura y solicita su emisión. No numera ni calcula la huella.',
      version
    },
    {
      name: 'Velto Store · Servicios de facturación',
      role: 'Asigna el número correlativo, calcula la huella encadenada y construye el registro de facturación. Es el único camino por el que puede nacer una factura.',
      version
    },
    {
      name: 'Velto Store · Registro',
      role: 'Conserva las facturas y sus registros de forma inalterable: creación permitida, modificación y borrado denegados a todos los usuarios.',
      version
    }
  ];
}

export function buildComplianceDeclaration(
  company: DeclarationCompany,
  options: { place?: string; declaredByEmail?: string } = {}
): ComplianceDeclaration {
  const version = verifactuSystemVersion();
  const sistema = sistemaInformatico(company.taxId, company.legalName);
  return {
    systemVersion: version,
    systemName: VERIFACTU_SYSTEM_NAME,
    systemId: sistema.idSistemaInformatico,
    producerName: company.legalName,
    producerTaxId: company.taxId,
    // ⚠️ Salen del mismo sitio que el registro de facturación: si aquí se
    // declarara una modalidad y allí se enviara otra, la declaración sería
    // falsa sin que nadie tocara nada.
    onlyVerifactu: sistema.tipoUsoPosibleSoloVerifactu,
    multipleTaxpayers: sistema.tipoUsoPosibleMultiOT,
    components: systemComponents(version),
    declaredAt: new Date(),
    declaredPlace: options.place || process.env.VELTO_VERIFACTU_PLACE || 'Arganda del Rey (Madrid)',
    declaredByEmail: options.declaredByEmail
  };
}

/**
 * El texto de la declaración.
 *
 * ⚠️ **Es lo que se declara, no una descripción del producto.** Cada frase
 * corresponde a un requisito del art. 8 del RD 1007/2023 —integridad,
 * conservación, trazabilidad, inalterabilidad— y no se reformula para que quede
 * mejor: si una de esas cosas dejara de ser cierta, lo que hay que cambiar es
 * el sistema, no la frase.
 */
export function declarationStatements(d: ComplianceDeclaration): string[] {
  return [
    `Que ${d.producerName}, con NIF ${d.producerTaxId}, es el productor del sistema informático de facturación «${d.systemName}», versión ${d.systemVersion}, desarrollado para su uso exclusivo por la propia entidad.`,
    'Que dicho sistema cumple lo dispuesto en el Reglamento aprobado por el Real Decreto 1007/2023, de 5 de diciembre, y en la Orden HAC/1177/2024, de 17 de octubre, que lo desarrolla.',
    'Que el sistema genera, por cada factura expedida, un registro de facturación de alta con el contenido y el formato previstos en la norma, en el mismo momento de la expedición.',
    'Que cada registro incorpora la huella o «hash» del registro inmediatamente anterior, de modo que su alteración resulta detectable, y se calcula mediante el algoritmo SHA-256 conforme a las especificaciones publicadas por la Agencia Estatal de Administración Tributaria.',
    'Que los registros de facturación se conservan íntegros, accesibles, legibles y trazables, sin que el sistema permita su modificación ni su eliminación, ni siquiera a los usuarios con el máximo nivel de privilegios.',
    'Que la corrección de una factura expedida se realiza exclusivamente mediante la expedición de una factura rectificativa, sin que el número consumido pueda reutilizarse.',
    `Que el sistema opera ${d.onlyVerifactu === 'S' ? 'exclusivamente en la modalidad VERI*FACTU, remitiendo los registros de facturación a la Agencia Estatal de Administración Tributaria' : 'en modalidad no verificable, firmando electrónicamente cada registro'}.`,
    `Que el sistema se utiliza por ${d.multipleTaxpayers === 'S' ? 'varios obligados tributarios' : 'un único obligado tributario'}.`
  ];
}

export async function buildDeclarationPdf(
  company: DeclarationCompany,
  d: ComplianceDeclaration
): Promise<Uint8Array> {
  const titulo = 'DECLARACIÓN RESPONSABLE';
  const referencia = `v${d.systemVersion}`;

  const doc = await PDFDocument.create();
  doc.setTitle(`${company.brandName} — ${titulo} ${referencia}`);
  doc.setAuthor(company.brandName);
  doc.setSubject(`Declaración responsable del sistema informático de facturación ${d.systemName}`);
  doc.setCreator(company.brandName);
  doc.setProducer(`${company.brandName} · pdf-lib`);

  const b = new PdfBuilder(doc);
  await b.init(titulo, referencia, companyFooterLines(company));

  b.documentHeader({
    companyName: company.brandName,
    companyLines: companyHeaderLines(company),
    title: titulo,
    reference: referencia
  });

  b.text(
    'Declaración responsable a los efectos del artículo 15 de la Orden HAC/1177/2024, de 17 de octubre, sobre el sistema informático de facturación utilizado por el obligado tributario.',
    { size: 8.4, gap: 4 }
  );
  b.separator();

  b.section('Productor del sistema', { lead: 6 });
  b.twoColumnWrap('Razón social:', d.producerName, true);
  b.twoColumnWrap('NIF:', d.producerTaxId, true);
  b.twoColumnWrap('Domicilio:', company.address, true);

  b.y -= 6;
  b.section('Sistema informático de facturación', { lead: 6 });
  b.twoColumnWrap('Denominación:', d.systemName, true);
  b.twoColumnWrap('Identificador:', d.systemId, true);
  b.twoColumnWrap('Versión:', d.systemVersion, true);
  b.twoColumnWrap(
    'Modalidad:',
    d.onlyVerifactu === 'S' ? 'Exclusivamente VERI*FACTU' : 'No verificable',
    true
  );
  b.twoColumnWrap(
    'Obligados tributarios:',
    d.multipleTaxpayers === 'S' ? 'Varios' : 'Uno solo',
    true
  );

  /**
   * Los componentes.
   *
   * Van con lo que hace cada uno, no solo con su nombre: una lista de tres
   * nombres no dice cuál calcula la huella, que es lo que la norma quiere poder
   * identificar.
   */
  b.y -= 6;
  b.section('Componentes del sistema', { lead: 6 });
  for (const c of d.components) {
    b.text(`${c.name} — versión ${c.version}`, { size: 8.6, bold: true, gap: 1 });
    b.text(c.role, { size: 8.2, color: [0.35, 0.35, 0.35], gap: 3 });
  }

  b.y -= 6;
  b.section('Declara', { lead: 6 });
  let i = 1;
  for (const frase of declarationStatements(d)) {
    b.highlightBox(i++, frase, { size: 8.6 });
  }

  b.y -= 10;
  b.text(`En ${d.declaredPlace}, a ${formatDate(d.declaredAt, 'es')}.`, {
    size: 8.6,
    gap: 4
  });
  b.text(`${d.producerName} · NIF ${d.producerTaxId}`, { size: 8.6, bold: true, gap: 2 });

  b.finalizeFooters();
  return await doc.save();
}
