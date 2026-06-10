import { Injectable, inject } from '@angular/core';
import { Firestore, CollectionReference, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, query, orderBy, where } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Client, QuickClientData, ClientDocumentFile, ClientDocumentType_File } from '@shared/models/client.model';

@Injectable({ providedIn: 'root' })
export class ClientService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private clientsRef: CollectionReference;

  constructor() {
    this.clientsRef = collection(this.firestore, 'clients');
  }

  /** Removes undefined/null fields recursively. Preserves arrays. */
  private cleanData<T>(data: T): T {
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) {
      return data.map(item => this.cleanData(item)) as any;
    }
    if (typeof data !== 'object') return data;

    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        cleaned[key] = this.cleanData(value);
      }
    }
    return cleaned;
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
   * Delete a client.
   * TODO: Also delete documents from Storage.
   */
  async deleteClient(id: string): Promise<void> {
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

    await updateDoc(clientRef, {
      documents,
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

    await updateDoc(clientRef, {
      documents,
      updatedAt: { seconds: Date.now() / 1000 }
    });
  }
}