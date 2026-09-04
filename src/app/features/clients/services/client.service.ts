import { Injectable, inject } from '@angular/core';
import { Firestore, CollectionReference, DocumentReference, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, query, orderBy, where } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Client, QuickClientData, ClientDocumentFile, ClientDocumentType_File, LoyaltyDiscountChange } from '@shared/models/client.model';
import { normalizeLoyaltyDiscountPercent } from '@shared/utils/pricing.util';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';
import { AuthService } from '@core/auth/auth.service';
import { PermissionsService } from '@core/auth/permissions.service';

@Injectable({ providedIn: 'root' })
export class ClientService {
  private firestore = inject(Firestore);
  private permissions = inject(PermissionsService);
  private storage = inject(Storage);
  private authService = inject(AuthService);
  private clientsRef: CollectionReference;

  constructor() {
    this.clientsRef = collection(this.firestore, 'clients');
  }

  /**
   * Removes `undefined` and `null` before writing. Delegates to the shared
   * cleaner, which leaves Firestore sentinels intact.
   */
  private cleanData<T>(data: T): T {
    return cleanForFirestore(data, { stripNulls: true });
  }

  /** Normalize fullName: trim + collapse spaces */
  private normalizeFullName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  /** Get all clients (ordered by fullName) */
  getClients(): Observable<Client[]> {
    const q = query(this.clientsRef, orderBy('fullName'));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)))
    );
  }

  /**
   * The most recently created clients, newest first.
   *
   * Sorted in memory instead of with `orderBy('createdAt', 'desc')`: Firestore
   * drops documents that lack the ordering field, so any client created before
   * `createdAt` existed would silently vanish from the list. Reading the
   * collection is cheap at this fleet size and needs no extra index.
   */
  getRecentClients(max = 10): Observable<Client[]> {
    return from(getDocs(this.clientsRef)).pipe(
      map(snapshot => snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Client))
        .sort((a, b) => this.createdAtMillis(b) - this.createdAtMillis(a))
        .slice(0, max)
      ),
      catchError(() => of([]))
    );
  }

  /**
   * Creation time in milliseconds, 0 when missing.
   *
   * Deliberately not `toDate()`: that one falls back to *now* for missing
   * values, which would float undated clients to the top of "most recent".
   */
  private createdAtMillis(client: Client): number {
    const value: any = client.createdAt;
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    const seconds = value.seconds ?? value._seconds;
    if (typeof seconds === 'number') return seconds * 1000;
    const parsed = new Date(value).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Search clients by name, phone, email or document.
   * Client-side filter (suitable for small fleet).
   */
  searchClients(term: string): Observable<Client[]> {
    if (!term || term.length < 2) {
      return of([]);
    }

    const searchTerm = term.toLowerCase();
    
    return from(getDocs(this.clientsRef)).pipe(
      map(snapshot => {
        const clients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
        
        return clients.filter(client => 
          client.fullName?.toLowerCase().includes(searchTerm) ||
          (client.phone && client.phone.includes(searchTerm)) ||
          (client.email && client.email.toLowerCase().includes(searchTerm)) ||
          (client.documentNumber && client.documentNumber.toLowerCase().includes(searchTerm))
        ).slice(0, 10);
      }),
      catchError(() => of([]))
    );
  }

  /**
   * Get client by ID.
   */
  getClientById(id: string): Observable<Client | null> {
    const docRef = doc(this.firestore, `clients/${id}`);
    return from(getDoc(docRef)).pipe(
      map(snap => {
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() } as Client;
      }),
      catchError(() => of(null))
    );
  }

  /**
   * Create a full client (with all fields).
   */
  async createClient(client: Client): Promise<string> {
    const normalized: Client = {
      ...client,
      fullName: this.normalizeFullName(client.fullName),
      documentNumber: client.documentNumber?.toUpperCase().trim() || undefined,
      drivingLicenseNumber: client.drivingLicenseNumber?.toUpperCase().trim() || undefined,
      trustLevel: client.trustLevel || 'new',
      // A brand-new client blocked on creation has no discount to keep.
      loyaltyDiscountPercent:
        client.trustLevel === 'blocked'
          ? 0
          : normalizeLoyaltyDiscountPercent(client.loyaltyDiscountPercent),
      documents: client.documents || [],
      createdAt: { seconds: Date.now() / 1000 }
    };

    const docRef = await addDoc(this.clientsRef, this.cleanData(normalized));
    return docRef.id;
  }

  /**
   * Create a quick client for reservation.
   * Compatible with existing reservations flow.
   */
  async createQuickClient(data: QuickClientData): Promise<string> {
    const normalized: QuickClientData = {
      fullName: this.normalizeFullName(data.fullName),
      phone: data.phone?.trim() || undefined,
      email: data.email?.trim().toLowerCase() || undefined,
      documentNumber: data.documentNumber?.toUpperCase().trim() || undefined
    };

    const docRef = await addDoc(this.clientsRef, this.cleanData({
      ...normalized,
      trustLevel: 'new',
      createdAt: { seconds: Date.now() / 1000 }
    }));
    return docRef.id;
  }

  /**
   * Update an existing client.
   * Does NOT touch documents array - they are managed separately.
   */
  async updateClient(id: string, data: Partial<Client>): Promise<void> {
    const docRef = doc(this.firestore, `clients/${id}`);

    const update: any = {
      ...data,
      updatedAt: { seconds: Date.now() / 1000 }
    };

    // The history is append-only and rebuilt below when the discount actually
    // moves. Writing back whatever the caller happened to be holding would let
    // a stale form overwrite an entry appended in the meantime.
    delete update.loyaltyDiscountHistory;
    await this.applyLoyaltyDiscountChange(docRef, data, update);

    if (data.fullName) {
      update.fullName = this.normalizeFullName(data.fullName);
    }
    if (data.documentNumber !== undefined) {
      update.documentNumber = data.documentNumber?.toUpperCase().trim() || undefined;
    }
    if (data.drivingLicenseNumber !== undefined) {
      update.drivingLicenseNumber = data.drivingLicenseNumber?.toUpperCase().trim() || undefined;
    }
    if (data.email !== undefined) {
      update.email = data.email?.trim().toLowerCase() || undefined;
    }

    await updateDoc(docRef, this.cleanData(update));
  }

  /**
   * Clamp the loyalty discount, withdraw it when the client is being blocked,
   * and append an audit entry whenever the percentage actually moves.
   *
   * A `blocked` client keeping a 10 % discount is absurd, so blocking removes
   * it — and the removal is recorded like any other change, with its reason.
   *
   * The history array is rebuilt in JS rather than with `arrayUnion()` on
   * purpose: `cleanData()` walks the payload with `Object.entries()`, and a
   * Firestore sentinel has no enumerable own properties, so it would be
   * flattened to `{}` — the same way `stripUndefined()` corrupted contract
   * timestamps (F-4).
   */
  private async applyLoyaltyDiscountChange(
    docRef: DocumentReference,
    data: Partial<Client>,
    update: any
  ): Promise<void> {
    const touchesDiscount = data.loyaltyDiscountPercent !== undefined;
    const isBeingBlocked = data.trustLevel === 'blocked';
    if (!touchesDiscount && !isBeingBlocked) return;

    /**
     * ⚠️ Solo quien puede conceder descuentos los mueve.
     *
     * La retirada automática al **bloquear** a un cliente sí se deja pasar: no
     * es conceder nada, es la consecuencia de bloquearlo, y quitársela a un
     * empleado dejaría a un cliente bloqueado conservando su descuento — justo
     * al revés de lo que se quiere.
     */
    if (touchesDiscount && !isBeingBlocked && !this.permissions.can('grantDiscounts')) {
      throw new Error('permissions.notAllowed');
    }

    const snap = await getDoc(docRef);
    const current = snap.exists() ? (snap.data() as Client) : undefined;
    const previousPercent = normalizeLoyaltyDiscountPercent(current?.loyaltyDiscountPercent);

    let percent = touchesDiscount
      ? normalizeLoyaltyDiscountPercent(data.loyaltyDiscountPercent)
      : previousPercent;

    let reason: string | undefined;
    if (isBeingBlocked && percent > 0) {
      percent = 0;
      reason = 'clients.loyalty.withdrawnOnBlock';
    }

    update.loyaltyDiscountPercent = percent;

    if (percent === previousPercent) return;

    const author = this.authService.authorizedUser?.();
    const entry: LoyaltyDiscountChange = {
      percent,
      previousPercent,
      changedAt: { seconds: Date.now() / 1000 },
      changedBy: author?.displayName,
      changedByEmail: author?.email,
      reason
    };

    update.loyaltyDiscountHistory = [...(current?.loyaltyDiscountHistory ?? []), entry];
  }

  /**
   * Delete a client.
   * TODO: Also delete documents from Storage.
   */
  async deleteClient(id: string): Promise<void> {
    // Defensa en profundidad: la UI esconde el botón y esto rechaza la
    // llamada igualmente. Cualquier camino que no pase por ese botón se
    // saltaría el permiso.
    if (!this.permissions.can('deleteRecords')) {
      throw new Error('permissions.notAllowed');
    }
    const docRef = doc(this.firestore, `clients/${id}`);
    await deleteDoc(docRef);
  }

  /**
   * Upload a client document to Firebase Storage.
   * Updates the client's documents array in Firestore.
   */
  async uploadClientDocument(
    clientId: string, 
    file: File, 
    type: ClientDocumentType_File,
    label?: string
  ): Promise<ClientDocumentFile> {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${timestamp}-${safeName}`;
    const storagePath = `clients/${clientId}/documents/${filename}`;
    const storageRef = ref(this.storage, storagePath);

    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const document: ClientDocumentFile = {
      type,
      label,
      url,
      path: storagePath,
      fileName: file.name,
      size: file.size,
      contentType: file.type,
      uploadedAt: { seconds: Date.now() / 1000 }
    };

    // Get current client and append document
    const clientRef = doc(this.firestore, `clients/${clientId}`);
    const snap = await getDoc(clientRef);
    if (!snap.exists()) throw new Error('Client not found');
    const client = snap.data() as Client;
    const documents = [...(client.documents || []), document];

    // Clean undefined values - Firestore doesn't accept them
    const cleanDocuments = documents.map(d => {
      const cleaned: any = { type: d.type, url: d.url, path: d.path };
      if (d.label) cleaned.label = d.label;
      if (d.fileName) cleaned.fileName = d.fileName;
      if (d.size !== undefined) cleaned.size = d.size;
      if (d.contentType) cleaned.contentType = d.contentType;
      if (d.uploadedAt) cleaned.uploadedAt = d.uploadedAt;
      return cleaned;
    });

    await updateDoc(clientRef, {
      documents: cleanDocuments,
      updatedAt: { seconds: Date.now() / 1000 }
    });

    return document;
  }

  /**
   * Delete a client document.
   * Removes from Storage and from client's documents array.
   */
  async deleteClientDocument(clientId: string, document: ClientDocumentFile): Promise<void> {
    // Delete from Storage
    try {
      const storageRef = ref(this.storage, document.path);
      await deleteObject(storageRef);
    } catch (e) {
      // Ignore storage delete errors (file may not exist)
    }

    // Remove from Firestore array
    const clientRef = doc(this.firestore, `clients/${clientId}`);
    const snap = await getDoc(clientRef);
    if (!snap.exists()) return;
    const client = snap.data() as Client;
    const documents = (client.documents || []).filter(d => d.path !== document.path);

    // Clean undefined values before writing to Firestore
    const cleanDocuments = documents.map((d: any) => {
      const cleaned: any = { type: d.type, url: d.url, path: d.path };
      if (d.label) cleaned.label = d.label;
      if (d.fileName) cleaned.fileName = d.fileName;
      if (d.size !== undefined) cleaned.size = d.size;
      if (d.contentType) cleaned.contentType = d.contentType;
      if (d.uploadedAt) cleaned.uploadedAt = d.uploadedAt;
      return cleaned;
    });

    await updateDoc(clientRef, {
      documents: cleanDocuments,
      updatedAt: { seconds: Date.now() / 1000 }
    });
  }
}