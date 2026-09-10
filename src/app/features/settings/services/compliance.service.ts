import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toDate } from '@shared/utils/reservation-date.util';

/**
 * Milisegundos de una fecha de Firestore, que llega de tres formas distintas.
 *
 * ⚠️ El proyecto ya tiene `toDate()` justo para esto: un conversor propio se
 * come el `{ seconds }` del SDK web, que es lo que dejó una factura sin periodo
 * ni fecha de operación (fase 1).
 */
function toMillis(value: unknown): number {
  const d = value ? toDate(value) : null;
  return d ? d.getTime() : 0;
}

/**
 * La declaración responsable del art. 15 de la Orden HAC/1177/2024.
 *
 * ⚠️ **Le toca a Velto porque la aplicación es desarrollo propio.** Al no
 * comprar un programa de facturación, no hay fabricante que declare que cumple
 * el RD 1007/2023: el productor del software y el obligado tributario son la
 * misma empresa.
 *
 * ⚠️ **Una por cada versión del sistema.** No es un papel que se firme una vez:
 * la norma lo ata a la versión concreta en uso. Y ninguna se borra —la de una
 * versión pasada sigue acreditando lo que se declaró mientras esa versión
 * estuvo emitiendo facturas—, lo que `firestore.rules` impide de verdad
 * denegando `update` y `delete` a todo el mundo.
 */
export interface ComplianceDeclaration {
  systemVersion: string;
  systemName: string;
  systemId: string;
  producerName: string;
  producerTaxId: string;
  onlyVerifactu: 'S' | 'N';
  multipleTaxpayers: 'S' | 'N';
  components?: { name: string; role: string; version: string }[];
  statements?: string[];
  /** Ya convertida a `Date` por el servicio: la plantilla no ve `Timestamp`. */
  declaredAt?: Date | null;
  declaredPlace?: string;
  pdfUrl: string;
}

/**
 * Qué sistema se está declarando.
 *
 * ⚠️ **Lo sirve la function, no una constante de la aplicación.** Son los
 * mismos datos que van en cada registro de facturación: repetirlos aquí sería
 * un cuarto sitio donde escribir la versión, y el primero en quedarse viejo.
 */
export interface ComplianceStatus {
  systemName: string;
  systemId: string;
  version: string;
  producerName: string;
  producerTaxId: string;
  onlyVerifactu: 'S' | 'N';
  multipleTaxpayers: 'S' | 'N';
  /**
   * Si **este entorno emite facturas**.
   *
   * ⚠️ No es lo mismo que remitir a la AEAT: aquello es
   * `VELTO_VERIFACTU_ENABLED`, y esto es si la aplicación factura aquí siquiera.
   * Hoy producción no emite ninguna, así que no hay nada que declarar ni que
   * remitir — y la pantalla no puede ofrecer botones para ninguna de las dos
   * cosas, porque un botón que no hace nada es un fallo.
   */
  invoicingEnabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class ComplianceService {
  private firestore = inject(Firestore);
  private functions = inject(Functions);

  private col = collection(this.firestore, 'verifactuDeclarations');

  /**
   * Todas las declaraciones emitidas, de la más reciente a la más antigua.
   *
   * ⚠️ **Se ordena en memoria, a propósito.** Dos motivos, y los dos han costado
   * ya en este proyecto:
   *
   * - Un `orderBy` deja fuera a los documentos que no tengan ese campo, sin
   *   avisar (M-40). Aquí eso escondería una declaración, que es justo lo que
   *   no puede pasar con un documento de cumplimiento.
   * - Y ordenar por el id no vale: son versiones, y como cadena «1.10» va antes
   *   que «1.9».
   *
   * La fecha manda, y la versión desempata.
   */
  async list(): Promise<ComplianceDeclaration[]> {
    const snap = await getDocs(this.col);
    const declaraciones = snap.docs.map((d) => ({
      ...(d.data() as ComplianceDeclaration),
      // ⚠️ `data()` no incluye el id, y aquí el id ES la versión.
      systemVersion: d.id,
      // ⚠️ **Convertida aquí, no en la plantilla.** `declaredAt` llega como
      // `Timestamp` y el pipe `date` de Angular no lo entiende: pinta vacío, sin
      // error. La fecha salía en blanco justo debajo de «Declaración emitida
      // el». Es la misma trampa que dejó una factura sin periodo.
      declaredAt: toDate(d.data()?.['declaredAt'])
    }));
    return declaraciones.sort((a, b) => {
      const fa = toMillis(a.declaredAt);
      const fb = toMillis(b.declaredAt);
      if (fa !== fb) return fb - fa;
      return b.systemVersion.localeCompare(a.systemVersion, undefined, { numeric: true });
    });
  }

  /** Nombre, versión y productor del sistema, tal y como se declaran. */
  async status(): Promise<ComplianceStatus> {
    const fn = httpsCallable<Record<string, unknown>, ComplianceStatus>(
      this.functions,
      'getComplianceStatus'
    );
    const res = await fn({});
    return res.data;
  }

  /**
   * Emite la de la versión actual.
   *
   * Si ya existe, la function devuelve la que hay en vez de crear otra: la
   * versión es el id, así que no puede haber dos.
   */
  async issue(): Promise<{ version: string; pdfUrl: string; alreadyIssued: boolean }> {
    const fn = httpsCallable<
      Record<string, unknown>,
      { version: string; pdfUrl: string; alreadyIssued: boolean }
    >(this.functions, 'issueComplianceDeclaration');
    const res = await fn({});
    return res.data;
  }
}
