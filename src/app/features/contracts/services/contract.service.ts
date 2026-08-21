/**
 * Contract Service (Frontend).
 *
 * The Angular app NEVER handles signing secrets, PDF rendering, Resend API
 * keys, or token generation. All sensitive operations are performed by
 * Cloud Functions and accessed via HTTPS callables or public endpoints
 * controlled by one-time tokens.
 *
 * The frontend is responsible for:
 *   - listing / reading contract documents
 *   - asking the backend to perform operations
 *   - showing the operator the public signing URL
 *   - downloading the generated PDFs (via Storage read URLs)
 */

import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot, updateDoc } from '@angular/fire/firestore';
import { Storage, ref as storageRef, getDownloadURL } from '@angular/fire/storage';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Contract } from '@shared/models/contract.model';

export interface GenerateContractResponse {
  contractId: string;
  pdfUrl: string;
  pdfPath: string;
}

export interface CreateSigningLinkResponse {
  contractId: string;
  /** Relative URL to send to the customer, e.g. /sign-contract/<token> */
  signingUrl: string;
  /** Absolute origin the customer should open, when the frontend knows it. */
  signingUrlAbsolute: string;
  expiresAt: any;
}

export interface SendEmailResponse {
  contractId: string;
  emailedAt: any;
  to: string;
}

@Injectable({ providedIn: 'root' })
export class ContractService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private functions = inject(Functions);

  // ============================================================
  // Firestore reads (allowed by rules for authenticated users)
  // ============================================================

  getContracts(): Observable<Contract[]> {
    const colRef = collection(this.firestore, 'contracts');
    const q = query(colRef, orderBy('createdAt', 'desc'));
    return new Observable<Contract[]>((subscriber) => {
      const unsubscribe = onSnapshot(
        q,
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contract);
          subscriber.next(items);
        },
        (err) => subscriber.error(err)
      );
      return () => unsubscribe();
    });
  }

  getContractById(id: string): Observable<Contract | null> {
    const docRef = doc(this.firestore, `contracts/${id}`);
    return from(getDoc(docRef)).pipe(
      map((snap) => (snap.exists() ? ({ id: snap.id, ...snap.data() } as Contract) : null))
    );
  }

  /**
   * Live subscription to the reservation's contract.
   *
   * This used to be a one-shot `getDocs()`, which meant the operator's screen
   * never reflected a status change: generating the signing link moved the
   * contract to `pending_signature` in Firestore while the UI still read
   * "Generado", and a customer signing on their phone produced no visible
   * change at all until the page was reloaded by hand.
   *
   * `onSnapshot` keeps the detail view in step with the document, which is what
   * the signing flow needs — the operator is typically watching this screen
   * while the customer signs.
   */
  getContractByReservation(reservationId: string): Observable<Contract | null> {
    const colRef = collection(this.firestore, 'contracts');
    const q = query(colRef, where('reservationId', '==', reservationId));

    return new Observable<Contract | null>((subscriber) => {
      const unsubscribe = onSnapshot(
        q,
        (snap) => {
          if (snap.empty) {
            subscriber.next(null);
            return;
          }
          // Most recent first if there are multiple
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contract);
          docs.sort((a, b) => {
            const aT = a.createdAt?.seconds || 0;
            const bT = b.createdAt?.seconds || 0;
            return bT - aT;
          });
          subscriber.next(docs[0]);
        },
        (error) => subscriber.error(error)
      );
      return () => unsubscribe();
    });
  }

  // ============================================================
  // Cloud Function calls (auth required except sign/get)
  // ============================================================

  /**
   * Generates the original contract PDF and creates/updates the contract
   * document. Returns the new contract id and the PDF download URL.
   */
  async generateContractFromReservation(reservationId: string): Promise<GenerateContractResponse> {
    const fn = httpsCallable<{ reservationId: string }, GenerateContractResponse>(
      this.functions,
      'generateContractPdf'
    );
    const result = await fn({ reservationId });
    return result.data;
  }

  /**
   * Creates a one-time signing link for the customer.
   * Returns a relative URL the frontend can show/copy.
   */
  async generateSigningLink(contractId: string): Promise<CreateSigningLinkResponse> {
    // Workflow guard: refuse to issue a signing link if the contract has
    // no PDF yet or has already been signed / cancelled.
    const contract = await this.getContractById(contractId).toPromise();
    if (!contract) throw new Error('Contrato no encontrado');
    if (contract.status === 'draft') {
      throw new Error('workflow.missingContract');
    }
    if (contract.status === 'signed') {
      throw new Error('workflow.contractAlreadySigned');
    }
    if (contract.status === 'cancelled') {
      throw new Error('workflow.contractCancelled');
    }
    const fn = httpsCallable<{ contractId: string }, CreateSigningLinkResponse>(
      this.functions,
      'createContractSigningLink'
    );
    const result = await fn({ contractId });
    return result.data;
  }

  /**
   * Cancels the active signing link of a contract. The contract goes back
   * to `generated` (or stays as-is if already signed).
   */
  async cancelSigningLink(contractId: string): Promise<void> {
    const fn = httpsCallable<{ contractId: string }, { ok: true }>(
      this.functions,
      'cancelContractSigningLink'
    );
    await fn({ contractId });
  }

  /**
   * Sends the signed contract to the customer (or a manual email) using
   * Resend. The email is sent by a Cloud Function, never the frontend.
   */
  async sendSignedContractByEmail(contractId: string, email?: string): Promise<SendEmailResponse> {
    const fn = httpsCallable<{ contractId: string; email?: string }, SendEmailResponse>(
      this.functions,
      'sendSignedContractEmail'
    );
    const result = await fn({ contractId, email });
    return result.data;
  }

  // ============================================================
  // Downloads
  // ============================================================

  /** Returns a Storage download URL for the original PDF, or null. */
  async getOriginalPdfUrl(contract: Contract): Promise<string | null> {
    if (contract.pdfUrl) return contract.pdfUrl;
    if (!contract.pdfPath) return null;
    try {
      return await getDownloadURL(storageRef(this.storage, contract.pdfPath));
    } catch (error) {
      console.error('Error getting original PDF URL:', error);
      return null;
    }
  }

  /** Returns a Storage download URL for the signed PDF, or null. */
  async getSignedPdfUrl(contract: Contract): Promise<string | null> {
    if (contract.signedPdfUrl) return contract.signedPdfUrl;
    if (!contract.signedPdfPath) return null;
    try {
      return await getDownloadURL(storageRef(this.storage, contract.signedPdfPath));
    } catch (error) {
      console.error('Error getting signed PDF URL:', error);
      return null;
    }
  }

  /**
   * Returns a Storage download URL for the signature image, or null.
   * Only used in preview/detail UI for internal users.
   */
  async getSignatureUrl(contract: Contract): Promise<string | null> {
    if (contract.signatureUrl) return contract.signatureUrl;
    if (!contract.signaturePath) return null;
    try {
      return await getDownloadURL(storageRef(this.storage, contract.signaturePath));
    } catch (error) {
      console.error('Error getting signature URL:', error);
      return null;
    }
  }

  /**
   * Convenience: triggers a browser download of a URL. Used for the
   * "Download PDF" / "Download signed PDF" buttons.
   */
  async triggerDownload(url: string, filename: string): Promise<void> {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      // Fallback: open in new tab
      console.warn('Download failed, opening in new tab:', error);
      window.open(url, '_blank');
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Returns the absolute signing URL the customer should open. Falls back
   * to the relative path if window is not available.
   */
  buildAbsoluteSigningUrl(relativeUrl: string): string {
    if (typeof window === 'undefined') return relativeUrl;
    return `${window.location.origin}${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`;
  }

  /**
   * Updates an internal-only field on the contract (currently a no-op
   * kept for symmetry with other services). Sensitive state transitions
   * always go through Cloud Functions.
   */
  async updateInternalNotes(contractId: string, notes: string): Promise<void> {
    const docRef = doc(this.firestore, `contracts/${contractId}`);
    await updateDoc(docRef, {
      updatedAt: { seconds: Date.now() / 1000 }
    });
    // notes are intentionally not stored at the contract level - they would
    // require extending the model. Placeholder for future use.
    void notes;
  }
}
