/**
 * Emitir y conservar la declaración responsable del art. 15.
 *
 * ⚠️ **Una por cada versión del sistema, y ninguna se borra.** La declaración
 * de una versión pasada sigue acreditando lo que se declaró mientras esa
 * versión estuvo emitiendo facturas: borrarla dejaría sin amparo a todas las
 * facturas de ese periodo. Es la misma razón por la que una factura emitida no
 * se toca, y las reglas de Firestore lo tratan igual — `create` sí, `update` y
 * `delete` para nadie.
 *
 * Por eso **no se puede emitir dos veces la misma versión**: el id del
 * documento ES la versión, así que un segundo intento choca contra la que ya
 * hay en vez de duplicarla o pisarla.
 */

import * as functions from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../admin-guard';
import { companyConfig } from '../company-config';
import { uploadPdf } from '../documents/storage';
import {
  buildComplianceDeclaration,
  buildDeclarationPdf,
  declarationStatements
} from './compliance-declaration';
import { sistemaInformatico, verifactuSystemVersion } from './verifactu';

interface DeclarationResponse {
  version: string;
  pdfUrl: string;
  /** `true` si ya existía y se devuelve la que hay. */
  alreadyIssued: boolean;
}

/**
 * Qué sistema se está declarando, para que la pantalla lo enseñe.
 *
 * ⚠️ **Existe para que el frontend NO duplique estos datos.** Son los mismos
 * que van en cada registro de facturación y en la declaración responsable; una
 * constante repetida en la aplicación sería un cuarto sitio donde escribir la
 * versión, y el primero en quedarse viejo. Aquí solo hay una fuente.
 */
export const getComplianceStatus = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
  }
  const company = companyConfig();
  const sistema = sistemaInformatico(company.taxId, company.legalName);
  return {
    systemName: sistema.nombreSistemaInformatico,
    systemId: sistema.idSistemaInformatico,
    version: sistema.version,
    producerName: sistema.nombreRazonProductor,
    producerTaxId: sistema.nifProductor,
    onlyVerifactu: sistema.tipoUsoPosibleSoloVerifactu,
    multipleTaxpayers: sistema.tipoUsoPosibleMultiOT,
    invoicingEnabled: invoicingEnabled()
  };
});

/**
 * ¿Este entorno factura ya?
 *
 * ⚠️ **No es lo mismo que `VELTO_VERIFACTU_ENABLED`.** Aquella dice si los
 * registros se **remiten** a la AEAT; esta, si la aplicación **emite facturas**
 * en este entorno. Hoy producción no emite ninguna, y eso era un hecho que no
 * estaba escrito en ningún sitio: la pantalla ofrecía «Emitir declaración» y el
 * módulo de Facturas entero, con las functions que los sirven sin desplegar.
 *
 * Un botón que no hace nada es un fallo, y la declaración responsable del art.
 * 15 declara lo que hace **un sistema que emite facturas**: en un entorno que no
 * emite ninguna no hay nada que declarar todavía.
 *
 * ⚠️ **Y no se deduce de que falte la function.** Un callable ausente devuelve
 * un error, y un error significa «algo va mal», no «esto aún no toca». Son dos
 * cosas distintas y la pantalla tiene que poder distinguirlas, así que el dato
 * viaja explícito.
 */
export function invoicingEnabled(): boolean {
  return process.env.VELTO_INVOICING_ENABLED === 'true';
}

export const issueComplianceDeclaration = functions.https.onCall(
  async (request): Promise<DeclarationResponse> => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'invoices.errors.unauthenticated');
    }

    /**
     * ⚠️ **Se comprueba aquí también, no solo en la pantalla.** Una declaración
     * emitida **no se puede borrar** —`firestore.rules` deniega `delete` a todo
     * el mundo—, así que una emitida por error en un entorno que todavía no
     * factura se queda ahí para siempre, declarando lo que hacía un sistema que
     * no emitía nada. Misma defensa en profundidad que aplica `issueInvoice`
     * revalidando lo que la pantalla ya validó.
     */
    if (!invoicingEnabled()) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'invoices.errors.invoicingDisabled'
      );
    }

    const db = firestore();
    const version = verifactuSystemVersion();
    // El id ES la versión: no hacen falta comprobaciones para saber si ya
    // existe, y no puede haber dos declaraciones de la misma versión.
    const ref = db.collection('verifactuDeclarations').doc(version);

    const existente = await ref.get();
    if (existente.exists) {
      const data = existente.data() as Record<string, any>;
      return { version, pdfUrl: data['pdfUrl'], alreadyIssued: true };
    }

    const company = companyConfig();
    const declaracion = buildComplianceDeclaration(
      {
        legalName: company.legalName,
        taxId: company.taxId,
        address: company.address,
        officeAddress: company.officeAddress,
        phone: company.phone,
        email: company.email,
        registry: company.registry,
        brandName: company.brandName
      },
      { declaredByEmail: request.auth.token?.email }
    );

    const pdf = await buildDeclarationPdf(
      {
        legalName: company.legalName,
        taxId: company.taxId,
        address: company.address,
        officeAddress: company.officeAddress,
        phone: company.phone,
        email: company.email,
        registry: company.registry,
        brandName: company.brandName
      },
      declaracion
    );

    // El PDF antes que el documento: si Storage falla, no queda una declaración
    // registrada que apunte a un fichero inexistente y que ya no se pueda
    // volver a emitir porque el id está ocupado.
    const subido = await uploadPdf(
      `verifactu-declarations/${version}/declaracion-responsable.pdf`,
      pdf
    );

    await ref.create({
      ...declaracion,
      // El texto declarado se guarda **con** la declaración: si algún día se
      // reformula una frase, la de esta versión tiene que seguir diciendo lo
      // que dijo.
      statements: declarationStatements(declaracion),
      declaredAt: FieldValue.serverTimestamp(),
      pdfUrl: subido.pdfUrl,
      pdfPath: subido.pdfPath,
      createdAt: FieldValue.serverTimestamp()
    });

    functions.logger.info('Compliance declaration issued', { version });
    return { version, pdfUrl: subido.pdfUrl, alreadyIssued: false };
  }
);
