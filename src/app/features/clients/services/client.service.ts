import { Injectable, inject } from '@angular/core';
import { Firestore, CollectionReference, collection, doc, addDoc, getDoc, getDocs, query, orderBy, where, or } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Client, QuickClientData } from '@shared/models/client.model';

@Injectable({ providedIn: 'root' })
export class ClientService {
  private firestore = inject(Firestore);
  private clientsRef: CollectionReference;

  constructor() {
    this.clientsRef = collection(this.firestore, 'clients');
  }

  /** Removes undefined/null fields recursively */
  private cleanData<T extends object>(data: T): Partial<T> {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        cleaned[key] = typeof value === 'object' && !Array.isArray(value) && value !== null
          ? this.cleanData(value)
          : value;
      }
    }
    return cleaned;
  }

  /**
   * Search clients by name, phone, or email.
   */
  searchClients(term: string): Observable<Client[]> {
    if (!term || term.length < 2) {
      return of([]);
    }

    const searchTerm = term.toLowerCase();
    
    return from(getDocs(this.clientsRef)).pipe(
      map(snapshot => {
        const clients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
        
        // Filter client-side (Firestore lacks proper search)
        return clients.filter(client => 
          client.fullName.toLowerCase().includes(searchTerm) ||
          (client.phone && client.phone.includes(searchTerm)) ||
          (client.email && client.email.toLowerCase().includes(searchTerm))
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
   * Create a quick client for reservation.
   */
  async createQuickClient(data: QuickClientData): Promise<string> {
    const docRef = await addDoc(this.clientsRef, this.cleanData({
      ...data,
      createdAt: { seconds: Date.now() / 1000 }
    }));
    return docRef.id;
  }

  /**
   * Get all clients (for dropdowns).
   */
  getClients(): Observable<Client[]> {
    const q = query(this.clientsRef, orderBy('fullName'));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)))
    );
  }
}