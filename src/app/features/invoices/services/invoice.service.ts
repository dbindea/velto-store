import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BillingProfile, Invoice } from '@shared/models/invoice.model';
import { calculateInvoiceTotals, validateInvoice } from '@shared/utils/invoice.util';
import { firstProblem } from '@shared/utils/form-problems.util';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';
import { TranslateService } from '@core/i18n/translate.service';

export interface IssueInvoicePayload {
  invoiceId?: string;
  recipient: Invoice['recipient'];
  lines: Invoice['lines'];
  paymentMethod: Invoice['paymentMethod'];
  amountAlreadyPaid?: number;
  operationDate?: Date | null;
  operationPeriodStart?: Date | null;
  operationPeriodEnd?: Date | null;
  reservationId?: string;
  vehicleId?: string;
  vehicleLabel?: string;
  contractNumber?: string;
  notes?: string;
  reservationTotal?: number;
}

export interface IssuedInvoice {
  invoiceId: string;
  fullNumber: string;
  series: string;
  number: number;
  hash: string;
  pdfUrl?: string;
}

/**
 * Facturas y destinatarios de factura.
 *
 * ⚠️ **Este servicio NO crea facturas.** Emitir es una llamada a la Cloud
 * Function `issueInvoice`, y no por gusto: `firestore.rules` deniega el
 * `create` desde cliente porque una regla no sabe cuál es el siguiente número
 * correlativo, así que no podría impedir que alguien escribiese el que
 * quisiera. Lo único que este servicio hace contra Firestore es **leer**
 * facturas y gestionar los borradores y los destinatarios.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private translate = inject(TranslateService);

  private col = collection(this.firestore, 'invoices');
  private profilesCol = collection(this.firestore, 'billingProfiles');

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  async list(filters: { reservationId?: string } = {}): Promise<Invoice[]> {
    const q = filters.reservationId
      ? query(
          this.col,
          where('reservationId', '==', filters.reservationId),
          orderBy('issueDate', 'desc')
        )
      : query(this.col, orderBy('issueDate', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...(d.data() as Invoice), id: d.id }));
  }

  async getById(id: string): Promise<Invoice | null> {
    const snap = await getDoc(doc(this.firestore, 'invoices', id));
    // ⚠️ `data()` no incluye el id. Olvidarlo es lo que rompió la pantalla de
    // Ajustes con `authorizedUsers` (M-41) y antes el contrato (M-29).
    return snap.exists() ? { ...(snap.data() as Invoice), id: snap.id } : null;
  }

  /**
   * La última factura emitida, para enseñar por dónde va la numeración.
   *
   * Es informativo: el número real lo asigna la function dentro de su
   * transacción, y no se puede adivinar desde aquí sin arriesgarse a enseñar
   * uno que otro operador esté a punto de consumir.
   */
  async lastIssued(): Promise<Invoice | null> {
    const snap = await getDocs(query(this.col, orderBy('issueDate', 'desc'), limit(1)));
    const d = snap.docs[0];
    return d ? { ...(d.data() as Invoice), id: d.id } : null;
  }

  // -------------------------------------------------------------------------
  // Emisión
  // -------------------------------------------------------------------------

  /**
   * Emite la factura: asigna número, calcula la huella encadenada y genera el
   * PDF. A partir de aquí el documento es intocable.
   *
   * ⚠️ **Se valida aquí y también dentro de la function.** La misma
   * `validateInvoice()` en los dos sitios, para que la pantalla no deje intentar
   * algo que el backend va a rechazar; y el backend la repite porque lo que se
   * congela en un documento fiscal no puede depender de que el formulario
   * estuviera bien.
   */
  async issue(payload: IssueInvoicePayload): Promise<IssuedInvoice> {
    const problems = validateInvoice({
      recipient: payload.recipient,
      lines: payload.lines,
      paymentMethod: payload.paymentMethod
    });
    const problema = firstProblem(problems);
    if (problema) throw new Error(problema);

    const fn = httpsCallable<Record<string, unknown>, IssuedInvoice>(
      this.functions,
      'issueInvoice'
    );
    const res = await fn({
      ...payload,
      // Las fechas viajan como ISO: un `Date` no sobrevive al canal del
      // callable, y llegaría como objeto vacío.
      operationDate: payload.operationDate?.toISOString(),
      operationPeriodStart: payload.operationPeriodStart?.toISOString(),
      operationPeriodEnd: payload.operationPeriodEnd?.toISOString(),
      // El documento sale en el idioma que tiene puesto la plataforma: es el
      // idioma en el que se está hablando con este cliente.
      locale: this.translate.getCurrentLanguage()
    });
    return res.data;
  }

  // -------------------------------------------------------------------------
  // Borradores
  // -------------------------------------------------------------------------

  /**
   * Un borrador es lo único que se puede tocar, y **no tiene número**: el
   * número se asigna al emitir. Sirve para dejar una factura a medias sin
   * consumir un correlativo que después habría que justificar.
   */
  async saveDraft(draft: Partial<Invoice>): Promise<string> {
    const totals = calculateInvoiceTotals(draft.lines || []);
    const data = cleanForFirestore({
      ...draft,
      kind: 'invoice',
      status: 'draft',
      totals,
      updatedAt: serverTimestamp()
    });
    if (draft.id) {
      await updateDoc(doc(this.firestore, 'invoices', draft.id), data as never);
      return draft.id;
    }
    const ref = await addDoc(this.col, { ...(data as object), createdAt: serverTimestamp() });
    return ref.id;
  }

  /** Solo un borrador. Una factura emitida no se borra ni se puede borrar. */
  async deleteDraft(id: string): Promise<void> {
    const invoice = await this.getById(id);
    if (!invoice) return;
    if (invoice.status !== 'draft') {
      throw new Error('invoices.errors.cannotDeleteIssued');
    }
    await deleteDoc(doc(this.firestore, 'invoices', id));
  }

  // -------------------------------------------------------------------------
  // Destinatarios de factura
  // -------------------------------------------------------------------------

  async listProfiles(): Promise<BillingProfile[]> {
    const snap = await getDocs(query(this.profilesCol, orderBy('name')));
    return snap.docs.map((d) => ({ ...(d.data() as BillingProfile), id: d.id }));
  }

  async saveProfile(profile: BillingProfile): Promise<string> {
    const data = cleanForFirestore({ ...profile, updatedAt: serverTimestamp() });
    if (profile.id) {
      await updateDoc(doc(this.firestore, 'billingProfiles', profile.id), data as never);
      return profile.id;
    }
    const ref = await addDoc(this.profilesCol, {
      ...(data as object),
      createdAt: serverTimestamp()
    });
    return ref.id;
  }
}
